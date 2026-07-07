// ============================================================
// AIRuntime V2 — Anthropic Provider Adapter
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
 * Derive an Anthropic-accepted MIME type from the attachment type tag.
 * Anthropic accepts: image/jpeg, image/png, image/gif, image/webp.
 * Unrecognised tags default to image/png.
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

export interface AnthropicAdapterConfig {
  api_key: string;
  default_model?: string | undefined;
  base_url?: string | undefined;
}

export class AnthropicAdapter implements IProviderAdapter {
  readonly name: ProviderName = "anthropic";
  readonly supportedModes: ExecutionMode[] = ["cloud", "auto"];

  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly baseUrl: string;

  constructor(config: AnthropicAdapterConfig) {
    this.apiKey = config.api_key;
    this.defaultModel = config.default_model ?? "claude-haiku-4-5-20251001";
    this.baseUrl = config.base_url ?? "https://api.anthropic.com";
  }

  async healthCheck(timeout_ms: number): Promise<ProviderCapabilityStatus> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout_ms);

      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.defaultModel,
          max_tokens: 5,
          messages: [{ role: "user", content: "Hi" }],
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (res.status === 401) return { available: false, healthy: false, reason: "invalid_api_key", checked_at: Date.now() };
      if (res.status === 429) return { available: false, healthy: false, reason: "rate_limited", rate_limited: true, checked_at: Date.now() };

      return { available: res.ok, healthy: res.ok, latency_ms: Date.now() - start, checked_at: Date.now() };
    } catch (err) {
      return { available: false, healthy: false, reason: (err as Error).message, checked_at: Date.now() };
    }
  }

  async invoke(request: ProviderInvokeRequest): Promise<ProviderInvokeResult> {
    const start = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), request.timeout_ms)

    const userContent = request.json_mode
      ? `${request.user_prompt}\n\nRespond ONLY with valid JSON, no explanation or markdown.`
      : request.user_prompt

    // P3 — Multimodal: build content array when attachments are present.
    // Anthropic vision requires an array of content blocks:
    //   { type: "image", source: { type: "base64", media_type, data } }
    //   { type: "text", text }
    // When no attachments are present, fall back to a plain string (existing behaviour).
    const messageContent: string | Array<Record<string, unknown>> =
      request.attachments && request.attachments.length > 0
        ? [
            ...request.attachments.map((att) => ({
              type: "image",
              source: {
                type: "base64",
                // Derive MIME type from attachment type tag; default to image/png.
                media_type: attTypeToMime(att.type),
                data: att.data,
              },
            })),
            { type: "text", text: userContent },
          ]
        : userContent

    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // P3 — BYOK (F5): use per-request override key if provided, else platform key
          "x-api-key": request.api_key ?? this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: request.model ?? this.defaultModel,
          max_tokens: request.max_tokens ?? 1024,
          system: request.system_prompt,
          messages: [{ role: "user", content: messageContent }],
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer))

      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Anthropic API error ${res.status}: ${err}`)
      }

      const data = await res.json() as {
        content: Array<{ type: string; text: string }>;
        stop_reason: string;
        usage?: { input_tokens: number; output_tokens: number };
      }

      const text = data.content.filter((c) => c.type === "text").map((c) => c.text).join("")

     return {
  content: text,
  finish_reason: data.stop_reason === "end_turn"
    ? "stop"
    : "length",

  ...(data.usage && {
    token_usage: {
      prompt: data.usage.input_tokens,
      completion: data.usage.output_tokens,
    },
  }),

  latency_ms: Date.now() - start,
  model_used: request.model ?? this.defaultModel,
  raw: data,
}
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return { content: "", finish_reason: "timeout", latency_ms: Date.now() - start }
      }
      throw err
    }
  }
  // ─── Phase 2: Capability contract implementation ────────────────────────────

  // P3 FIX: Added "vision.analysis" — Anthropic Claude models support vision.
  // Previously absent, causing the CapabilityRegistry to report Anthropic as
  // text-only even when claude-haiku / claude-sonnet were configured.
  readonly capabilities: readonly string[] = ["text.generation", "text.structured", "text.streaming", "vision.analysis"];

  describeCapability(id: string): import("@brandos/contracts").CapabilityDescriptor | null {
    if (!(this.capabilities as readonly string[]).includes(id)) return null;
    return {
      id: id as import("@brandos/contracts").CapabilityId,
      version: "1.0.0",
      provider: this.name,
      model_id: this.defaultModel,
      health_score: 95,
      latency_p50_ms: 1200,
      cost_per_1k_tokens: 0.003,
      supports_streaming: true,
      max_context_tokens: 200000,
    };
  }

}


