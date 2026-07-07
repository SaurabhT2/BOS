// ============================================================
// AIRuntime V2 — LM Studio Adapter (P1 REVIEW)
//
// LM Studio exposes an OpenAI-compatible /v1/chat/completions API.
// The original adapter CORRECTLY used message arrays — no P1 fix needed here.
//
// This version cleans up:
//   - Explicit json_mode handling via response_format
//   - Consistent max_tokens default (2048, matching Ollama fix)
//   - Cleaner token_usage spread
//   - No functional changes to the OpenAI-compat chat path
// ============================================================

import {
  ExecutionMode,
  IProviderAdapter,
  ProviderCapabilityStatus,
  ProviderInvokeRequest,
  ProviderInvokeResult,
  ProviderName,
} from "@brandos/contracts";

export interface LMStudioAdapterConfig {
  base_url?: string | undefined;
  default_model?: string | undefined;
}

export class LMStudioAdapter implements IProviderAdapter {
  readonly name: ProviderName = "lmstudio";
  readonly supportedModes: ExecutionMode[] = ["local", "auto"];

  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(config: LMStudioAdapterConfig = {}) {
    this.baseUrl = config.base_url ?? "http://localhost:1234/v1";
    this.defaultModel = config.default_model ?? "local-model";
  }

  async healthCheck(timeout_ms: number): Promise<ProviderCapabilityStatus> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout_ms);

      const res = await fetch(`${this.baseUrl}/models`, {
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      return {
        available: res.ok,
        healthy: res.ok,
        latency_ms: Date.now() - start,
        checked_at: Date.now(),
        reason: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        available: false,
        healthy: false,
        reason: `LM Studio not reachable: ${(err as Error).message}`,
        checked_at: Date.now(),
      };
    }
  }

  async invoke(request: ProviderInvokeRequest): Promise<ProviderInvokeResult> {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeout_ms);

    // Role-based message array — correct OpenAI chat format
    const messages: Array<{ role: string; content: string }> = [];
    if (request.system_prompt) {
      messages.push({ role: "system", content: request.system_prompt });
    }
    messages.push({ role: "user", content: request.user_prompt });

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.model ?? this.defaultModel,
          messages,
          max_tokens: request.max_tokens ?? 2048,
          temperature: request.temperature ?? 0.7,
          // json_mode: use structured output format if supported
          ...(request.json_mode
            ? { response_format: { type: "json_object" } }
            : {}),
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!res.ok) throw new Error(`LM Studio error ${res.status}: ${await res.text()}`);

      const data = await res.json() as {
        choices: Array<{ message: { content: string }; finish_reason: string }>;
        usage?: { prompt_tokens: number; completion_tokens: number };
      };

      const choice = data.choices?.[0];

      if (!choice) {
        throw new Error("No completion choices returned from LM Studio");
      }

      return {
        content: choice.message.content,
        finish_reason: (choice.finish_reason as ProviderInvokeResult["finish_reason"]) ?? "stop",

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

  // ─── Phase 2: Capability contract ────────────────────────────────────────────

  readonly capabilities: readonly string[] = ["text.generation", "text.structured"];

  describeCapability(id: string): import("@brandos/contracts").CapabilityDescriptor | null {
    if (!(this.capabilities as readonly string[]).includes(id)) return null;
    return {
      id: id as import("@brandos/contracts").CapabilityId,
      version: "1.0.0",
      provider: this.name,
      model_id: this.defaultModel,
      health_score: 65,
      latency_p50_ms: 10000,
      cost_per_1k_tokens: 0.0,
      supports_streaming: false,
      max_context_tokens: 4096,
    };
  }
}


