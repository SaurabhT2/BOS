/**
 * DeepSeek Provider Adapter
 * ─────────────────────────
 * Thin wrapper — transport only. Semantic normalisation is
 * handled by deepseekProfile via OpenAICompatibleAdapter.
 *
 * MIGRATION NOTE (Step 4/7):
 *   This adapter is preserved for backward compatibility.
 *   New dynamic registrations of DeepSeek use OpenAICompatibleAdapter
 *   with semanticProfile: "deepseek". Both paths produce the same result.
 *
 * BUG FIX (root cause of "Cannot read properties of undefined (reading 'code')"):
 *   Previous version used req.system / req.prompt — wrong field names.
 *   Contract is ProviderInvokeRequest: system_prompt / user_prompt.
 *   Fixed below. The malformed request caused an empty/null choices array,
 *   and the error body's missing `.code` crashed the ExecutionEngine catch.
 */

import type {
  ExecutionMode,
  IProviderAdapter,
  ProviderCapabilityStatus,
  ProviderInvokeRequest,
  ProviderInvokeResult,
  ProviderName,
} from "@brandos/contracts";
import { deepseekProfile } from "../../profiles/deepseekProfile";
import { normalizeError   } from "../../utils/normalizeError";

const DEEPSEEK_BASE = "https://api.deepseek.com/v1";

export interface DeepSeekAdapterConfig {
  api_key:        string;
  default_model?: string;
}

export class DeepSeekAdapter implements IProviderAdapter {
  readonly name:           ProviderName = "deepseek" as ProviderName;
  readonly supportedModes: ExecutionMode[] = ["cloud", "auto"];
  readonly capabilities:   readonly string[] = ["text.generation", "text.structured"];

  private readonly apiKey:       string;
  private readonly defaultModel: string;

  constructor(config: DeepSeekAdapterConfig) {
    this.apiKey       = config.api_key;
    this.defaultModel = config.default_model ?? "deepseek-chat";
  }

  async healthCheck(timeout_ms: number): Promise<ProviderCapabilityStatus> {
    const start      = Date.now();
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeout_ms);
    try {
      const res = await fetch(`${DEEPSEEK_BASE}/models`, {
        headers: {
          Authorization:  `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      return {
        available:  res.ok,
        healthy:    res.ok,
        latency_ms: Date.now() - start,
        reason:     res.ok ? undefined : `HTTP ${res.status}`,
        checked_at: Date.now(),
      };
    } catch (e: unknown) {
      clearTimeout(timer);
      const err = normalizeError(e, "deepseek");
      return {
        available:  false,
        healthy:    false,
        latency_ms: Date.now() - start,
        reason:     err.message,
        checked_at: Date.now(),
      };
    }
  }

  async invoke(req: ProviderInvokeRequest): Promise<ProviderInvokeResult> {
    const start = Date.now();
    const model = req.model ?? this.defaultModel;

    // ── FIXED: use correct contract fields (system_prompt / user_prompt) ────
    const messages: Array<{ role: string; content: string }> = [];
    if (req.system_prompt) messages.push({ role: "system", content: req.system_prompt });
    messages.push({ role: "user", content: req.user_prompt });

    const body = {
      model,
      messages,
      max_tokens:  req.max_tokens  ?? 2000,
      temperature: req.temperature ?? 0.7,
      ...(req.json_mode ? { response_format: { type: "json_object" } } : {}),
    };

    try {
      const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          // P3 — BYOK (F5): use per-request override key if provided, else platform key
          Authorization:  `Bearer ${req.api_key ?? this.apiKey}`,
        },
        body:   JSON.stringify(body),
        signal: AbortSignal.timeout(req.timeout_ms ?? 30_000),
      });

      if (!res.ok) {
        let errPayload: unknown;
        try { errPayload = await res.json(); } catch { errPayload = { message: await res.text().catch(() => "") }; }
        // Enrich with HTTP status so profile can map 402/503
        const enriched = Object.assign(
          typeof errPayload === "object" && errPayload !== null ? errPayload : {},
          { status: res.status }
        );
        const rErr = deepseekProfile.normalizeError(enriched, "deepseek");
        const thrown = new Error(rErr.message) as Error & { code?: string; statusCode?: number };
        thrown.code       = rErr.code;
        thrown.statusCode = rErr.statusCode;
        throw thrown;
      }

      const raw    = await res.json() as unknown;
      const result = deepseekProfile.normalizeResponse(raw, "deepseek");

      if (!result.success) {
        const thrown = new Error(result.error.message) as Error & { code?: string };
        thrown.code = result.error.code;
        throw thrown;
      }

      // Map to ProviderInvokeResult
      const data    = raw as Record<string, unknown>;
      const usage   = data["usage"]   as { prompt_tokens?: number; completion_tokens?: number } | undefined;
      const choices = data["choices"] as Array<Record<string, unknown>> | undefined;
      const choice  = choices?.[0];

      return {
        content:       result.content,
        finish_reason: (choice?.["finish_reason"] as ProviderInvokeResult["finish_reason"]) ?? "stop",
        ...(usage && {
          token_usage: {
            prompt:     usage.prompt_tokens     ?? 0,
            completion: usage.completion_tokens ?? 0,
          },
        }),
        latency_ms: Date.now() - start,
        model_used: model,
        raw,
      };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return { content: "", finish_reason: "timeout", latency_ms: Date.now() - start };
      }
      throw err;
    }
  }

  describeCapability(id: string): import("@brandos/contracts").CapabilityDescriptor | null {
    if (!(this.capabilities as readonly string[]).includes(id)) return null;
    return {
      id:                 id as import("@brandos/contracts").CapabilityId,
      version:            "1.0.0",
      provider:           this.name,
      model_id:           this.defaultModel,
      health_score:       80,
      latency_p50_ms:     1800,
      cost_per_1k_tokens: 0.00014,
      supports_streaming: true,
      max_context_tokens: 64_000,
    };
  }
}


