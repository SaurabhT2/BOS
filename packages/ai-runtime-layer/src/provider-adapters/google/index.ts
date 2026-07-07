// ============================================================
// AIRuntime V2 — Google Gemini Provider Adapter
//
// F7 FIX: API key now sent via x-goog-api-key header, not URL query param.
// The previous implementation embedded ?key=${this.apiKey} in the URL
// (endpointFor() method). This exposes the key in server access logs,
// CDN logs, and any HTTP proxy that captures URLs.
//
// P3 — BYOK: uses request.api_key (per-request override) when present,
// falling back to this.apiKey (platform environment key).
// ============================================================

import {
  ExecutionMode,
  IProviderAdapter,
  ProviderCapabilityStatus,
  ProviderInvokeRequest,
  ProviderInvokeResult,
  ProviderName,
} from "@brandos/contracts";

/**
 * Derive a Gemini-accepted MIME type from the attachment type tag.
 * Gemini accepts: image/jpeg, image/png, image/gif, image/webp.
 */
function attTypeToMime(
  attType: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  switch (attType) {
    case "image_jpeg": return "image/jpeg"
    case "image_png":  return "image/png"
    case "image_gif":  return "image/gif"
    case "image_webp": return "image/webp"
    default:           return "image/png"
  }
}

export interface GoogleAdapterConfig {
  api_key: string;
  default_model?: string | undefined;
}

export class GoogleAdapter implements IProviderAdapter {
  readonly name: ProviderName = "google";
  readonly supportedModes: ExecutionMode[] = ["cloud", "auto"];

  private readonly apiKey: string;
  private readonly defaultModel: string;

  constructor(config: GoogleAdapterConfig) {
    this.apiKey = config.api_key;
    this.defaultModel = config.default_model ?? "gemini-2.5-flash";
  }

  // F7 FIX: endpoint no longer embeds the API key in the URL.
  // Key is sent via x-goog-api-key header in both healthCheck() and invoke().
  private endpointFor(model: string): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  }

  async healthCheck(timeout_ms: number): Promise<ProviderCapabilityStatus> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout_ms);

      const res = await fetch(this.endpointFor(this.defaultModel), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // F7 FIX: key in header, not URL
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }], generationConfig: { maxOutputTokens: 5 } }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        console.log("[GoogleHealth]", res.status, await res.text());
      }

      if (res.status === 400) return { available: false, healthy: false, reason: "bad_request_or_invalid_key", checked_at: Date.now() };

      return { available: res.ok, healthy: res.ok, latency_ms: Date.now() - start, checked_at: Date.now() };
    } catch (err) {
      return { available: false, healthy: false, reason: (err as Error).message, checked_at: Date.now() };
    }
  }

  async invoke(request: ProviderInvokeRequest): Promise<ProviderInvokeResult> {
    const start = Date.now();
    const model = request.model ?? this.defaultModel;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeout_ms);

    // Build text parts
    const parts: Array<Record<string, unknown>> = []
    if (request.system_prompt) parts.push({ text: `${request.system_prompt}\n\n` });
    parts.push({ text: request.user_prompt });
    if (request.json_mode) parts.push({ text: "\n\nRespond ONLY with valid JSON." });

    // P3 — Multimodal: insert inlineData blocks before the text prompt when
    // attachments are present. Gemini vision format:
    //   { inlineData: { mimeType: "image/png", data: "<base64>" } }
    // Insert images before text parts so the model sees image context first.
    if (request.attachments && request.attachments.length > 0) {
      const imageParts = request.attachments.map((att) => ({
        inlineData: {
          mimeType: attTypeToMime(att.type),
          data: att.data,
        },
      }))
      parts.unshift(...imageParts)
    }

    try {
      const res = await fetch(this.endpointFor(model), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // F7 FIX + P3 BYOK (F5): header-based key; per-request override if present
          "x-goog-api-key": request.api_key ?? this.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            maxOutputTokens: request.max_tokens ?? 4096,
            temperature: request.temperature ?? 0.7,
          },
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Google API error ${res.status}: ${err}`);
      }

      const data = await res.json() as {
        candidates: Array<{ content: { parts: Array<{ text: string }> }; finishReason: string }>;
        usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
      };

      const text =
        data.candidates[0]?.content.parts
          .map((p) => p.text)
          .join("") ?? "";

      return {
        content: text,
        finish_reason:
          data.candidates[0]?.finishReason === "STOP"
            ? "stop"
            : "length",
        ...(data.usageMetadata && {
          token_usage: {
            prompt: data.usageMetadata.promptTokenCount,
            completion: data.usageMetadata.candidatesTokenCount,
          },
        }),
        latency_ms: Date.now() - start,
        model_used: request.model ?? this.defaultModel,
        raw: data,
      };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return { content: "", finish_reason: "timeout", latency_ms: Date.now() - start };
      }
      throw err;
    }
  }

  // ─── Phase 2: Capability contract implementation ───────────────────────────

  readonly capabilities: readonly string[] = ["text.generation", "text.streaming", "vision.analysis"];

  describeCapability(id: string): import("@brandos/contracts").CapabilityDescriptor | null {
    if (!(this.capabilities as readonly string[]).includes(id)) return null;
    return {
      id: id as import("@brandos/contracts").CapabilityId,
      version: "1.0.0",
      provider: this.name,
      model_id: this.defaultModel,
      health_score: 90,
      latency_p50_ms: 1800,
      cost_per_1k_tokens: 0.002,
      supports_streaming: true,
      max_context_tokens: 1000000,
    };
  }
}
