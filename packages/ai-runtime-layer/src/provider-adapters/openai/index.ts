// ============================================================
// AIRuntime V2 — OpenAI Provider Adapter
// Supports OpenAI and any OpenAI-compatible endpoint (Azure, Together, etc.)
// ============================================================

import {
  ExecutionMode,
  IProviderAdapter,
  ProviderCapabilityStatus,
  ProviderInvokeRequest,
  ProviderInvokeResult,
  ProviderName,
} from "@brandos/contracts";

// P3 — Multimodal: OpenAI vision messages can carry mixed content (text + image_url).
// When attachments are present the user message content becomes an array of content parts.
type OAITextPart  = { type: "text"; text: string }
type OAIImagePart = { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
type OAIContentPart = OAITextPart | OAIImagePart

interface OAIMessage {
  role: "system" | "user" | "assistant"
  content: string | OAIContentPart[]
}
interface OAIRequest {
  model: string;
  messages: OAIMessage[];
  max_tokens?: number | undefined;
  temperature?: number | undefined;
  response_format?: { type: "json_object" | "text" };
  stream?: boolean | undefined;
}

/**
 * Build an OpenAI data URL from a base64 attachment.
 * OpenAI vision requires: "data:<mime>;base64,<data>"
 */
function buildDataUrl(att: { type: string; data: string }): string {
  const mimeMap: Record<string, string> = {
    image_jpeg: "image/jpeg",
    image_png:  "image/png",
    image_webp: "image/webp",
    image_gif:  "image/gif",
  }
  const mime = mimeMap[att.type] ?? "image/png"
  return `data:${mime};base64,${att.data}`
}

export interface OpenAIAdapterConfig {
  api_key: string;
  base_url?: string | undefined;
  default_model?: string | undefined;
}

export class OpenAIAdapter implements IProviderAdapter {
  readonly name: ProviderName = "openai";
  readonly supportedModes: ExecutionMode[] = ["cloud", "auto"];

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(config: OpenAIAdapterConfig) {
    this.apiKey = config.api_key;
    this.baseUrl = config.base_url ?? "https://api.openai.com/v1";
    this.defaultModel = config.default_model ?? "gpt-4o-mini";
  }

  async healthCheck(timeout_ms: number): Promise<ProviderCapabilityStatus> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout_ms);
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
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
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeout_ms);

    const messages: OAIMessage[] = [];
    if (request.system_prompt) messages.push({ role: "system", content: request.system_prompt });

    // P3 — Multimodal: build content array when attachments are present.
    // OpenAI vision format: content is an array of { type: "image_url", image_url: { url } }
    // followed by { type: "text", text }. Without attachments, content is a plain string.
    if (request.attachments && request.attachments.length > 0) {
      const parts: OAIContentPart[] = [
        ...request.attachments.map((att): OAIImagePart => ({
          type: "image_url",
          image_url: { url: buildDataUrl(att), detail: "auto" },
        })),
        { type: "text", text: request.user_prompt },
      ]
      messages.push({ role: "user", content: parts })
    } else {
      messages.push({ role: "user", content: request.user_prompt });
    }

    const body: OAIRequest = {
      model: request.model ?? this.defaultModel,
      messages,
      max_tokens: request.max_tokens,
      temperature: request.temperature ?? 0.7,
    };
    if (request.json_mode) body.response_format = { type: "json_object" };

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // P3 — BYOK (F5): use per-request override key if provided, else platform key
          Authorization: `Bearer ${request.api_key ?? this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`OpenAI API error ${res.status}: ${err}`);
      }

      const data = await res.json() as {
        choices: Array<{ message: { content: string }; finish_reason: string }>;
        usage?: { prompt_tokens: number; completion_tokens: number };
      };

     const choice = data.choices?.[0];

if (!choice) {
  throw new Error("No completion choices returned");
}
      return {
  content: choice.message.content,

  finish_reason:
    (choice.finish_reason as ProviderInvokeResult["finish_reason"]) ?? "stop",

  ...(data.usage && {
    token_usage: {
      prompt: data.usage.prompt_tokens,
      completion: data.usage.completion_tokens,
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
  // ─── Phase 2: Capability contract implementation ────────────────────────────

  readonly capabilities: readonly string[] = ["text.generation", "text.structured", "text.streaming", "vision.analysis"];

  describeCapability(id: string): import("@brandos/contracts").CapabilityDescriptor | null {
    if (!(this.capabilities as readonly string[]).includes(id)) return null;
    return {
      id: id as import("@brandos/contracts").CapabilityId,
      version: "1.0.0",
      provider: this.name,
      model_id: this.defaultModel,
      health_score: 92,
      latency_p50_ms: 1500,
      cost_per_1k_tokens: 0.005,
      supports_streaming: true,
      max_context_tokens: 128000,
    };
  }

}


