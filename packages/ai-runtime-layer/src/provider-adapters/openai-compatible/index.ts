// ============================================================
// packages/ai-runtime-layer/src/provider-adapters/openai-compatible/index.ts
//
// OpenAICompatibleAdapter — renamed from the legacy OpenAIAdapter.
//
// RESPONSIBILITIES (transport only):
//   • HTTP request construction
//   • Auth headers (Bearer token)
//   • Request body formatting (OAI chat/completions schema)
//   • Timeout + AbortController
//   • Raw response retrieval
//   • Retry signals (surface to caller via thrown error, not swallowed)
//
// NOT responsible for:
//   • Error semantic interpretation  → ProviderProfile.normalizeError()
//   • Response shape validation      → ProviderProfile.normalizeResponse()
//   • Provider-specific conditionals → use profiles
//
// P0-GROQ-RETRY (Retry-After header support):
//   When a 429 response arrives, the adapter reads the `Retry-After` header
//   (seconds) or `x-ratelimit-reset-requests` / `x-ratelimit-reset-tokens`
//   (ISO-8601 or seconds). The wait duration is attached to the thrown error
//   as retryAfterMs so the SINGLE retry loop in ExecutionEngine can honour it.
//
//   Retry classification:
//     429 (rate_limited)   → retryable, retryAfterMs set from header
//     5xx (server_error)   → retryable, exponential backoff (no header)
//     4xx other            → NOT retryable (configuration problem)
//     AbortError (timeout) → return finish_reason='timeout' (no retry)
//
//   There is ONE retry implementation: withRetry() in @brandos/shared-utils,
//   called in ExecutionEngine. This adapter only surfaces the signal.
//   Never add a retry loop inside this file.
//
// Backward compatibility:
//   • Implements IProviderAdapter — drop-in for any adapter slot
//   • Accepts optional `profile` parameter for integrated normalisation
//     so existing ExecutionEngine can opt-in incrementally (Step 7).
// ============================================================

import type {
  ExecutionMode,
  IProviderAdapter,
  ProviderCapabilityStatus,
  ProviderInvokeRequest,
  ProviderInvokeResult,
  ProviderName,
} from "@brandos/contracts";
import type { ProviderProfile } from "../../contracts/provider";
import { resolveProfile } from "../../profiles/index";

export interface OpenAICompatibleAdapterConfig {
  provider_name: string;
  api_key: string;
  base_url?: string | undefined;
  default_model?: string | undefined;
  extra_headers?: Record<string, string> | undefined;
  cost_per_1k_tokens?: number | undefined;
  display_name?: string | undefined;
  /**
   * Semantic profile key (e.g. "groq", "deepseek", "generic").
   * When provided, invoke() normalises via the profile before returning.
   * Default: "generic" — safe for any OAI-compatible endpoint.
   */
  semantic_profile?: string | undefined;
}

interface OAIMessage  { role: "system" | "user" | "assistant"; content: string }
interface OAIRequest  {
  model:           string;
  messages:        OAIMessage[];
  max_tokens?:     number;
  temperature?:    number;
  response_format?: { type: "json_object" | "text" };
  stream?:         boolean;
}

// ─────────────────────────────────────────────────────────────
// parseRetryAfterMs
//
// Extract wait duration from Groq/OAI rate-limit response headers.
//
// Header priority (first match wins):
//   1. Retry-After (seconds integer or HTTP-date) — standard RFC 7231
//   2. x-ratelimit-reset-requests (ISO-8601 or seconds)  — Groq extension
//   3. x-ratelimit-reset-tokens   (ISO-8601 or seconds)  — Groq extension
//
// Returns undefined when no usable header is present so the caller
// falls through to its own exponential backoff.
//
// Never throws — header parsing failures return undefined silently.
// ─────────────────────────────────────────────────────────────
function parseRetryAfterMs(headers: Headers): number | undefined {
  // Try standard Retry-After first (seconds or HTTP-date)
  const retryAfter = headers.get('Retry-After') ?? headers.get('retry-after')
  if (retryAfter) {
    const secs = Number(retryAfter)
    if (!isNaN(secs) && secs > 0) return Math.ceil(secs * 1000)
    // Try HTTP-date format
    try {
      const date = new Date(retryAfter)
      const ms   = date.getTime() - Date.now()
      if (ms > 0) return ms
    } catch { /* ignore */ }
  }

  // Groq-specific: x-ratelimit-reset-requests / x-ratelimit-reset-tokens
  // These are ISO-8601 durations (e.g. "1.234s") or Unix timestamps
  for (const header of ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens']) {
    const val = headers.get(header)
    if (!val) continue

    // ISO-8601 duration: "0.5s", "1.234s", "2m30s"
    const secMatch = val.match(/^(\d+(?:\.\d+)?)s$/)
    if (secMatch) {
      const ms = Math.ceil(parseFloat(secMatch[1]) * 1000)
      if (ms > 0) return ms
    }

    // Unix timestamp (seconds)
    const ts = Number(val)
    if (!isNaN(ts) && ts > 1_000_000_000) {
      const ms = Math.ceil(ts * 1000 - Date.now())
      if (ms > 0) return ms
    }
  }

  return undefined
}

export class OpenAICompatibleAdapter implements IProviderAdapter {
  readonly name:           ProviderName;
  readonly supportedModes: ExecutionMode[] = ["cloud", "auto"];

  private readonly apiKey:       string;
  private readonly baseUrl:      string;
  private readonly defaultModel: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly profile:      ProviderProfile;

  // Capability metadata exposed to CapabilityEngine
  readonly capabilities: readonly string[];

  constructor(config: OpenAICompatibleAdapterConfig) {
    this.name         = config.provider_name as ProviderName;
    this.apiKey       = config.api_key;
    this.baseUrl      = config.base_url ?? "https://api.openai.com/v1";
    this.defaultModel = config.default_model ?? "gpt-4o-mini";
    this.extraHeaders = config.extra_headers ?? {};
    this.profile      = resolveProfile(config.semantic_profile ?? "generic");

    const caps = this.profile.capabilities ?? {};
    const capList: string[] = ["text.generation"];
    if (caps.supportsJsonMode)  capList.push("text.structured");
    if (caps.supportsStreaming) capList.push("text.streaming");
    if (caps.supportsVision)    capList.push("vision.analysis");
    this.capabilities = capList;
  }

  async healthCheck(timeout_ms: number): Promise<ProviderCapabilityStatus> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer      = setTimeout(() => controller.abort(), timeout_ms);
      const res        = await fetch(`${this.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (res.status === 401) {
        return { available: false, healthy: false, reason: "invalid_api_key", checked_at: Date.now() };
      }
      if (res.status === 429) {
        return { available: false, healthy: false, reason: "rate_limited", rate_limited: true, checked_at: Date.now() };
      }
      return { available: res.ok, healthy: res.ok, latency_ms: Date.now() - start, checked_at: Date.now() };
    } catch (err) {
      return { available: false, healthy: false, reason: (err as Error).message, checked_at: Date.now() };
    }
  }

  async invoke(request: ProviderInvokeRequest): Promise<ProviderInvokeResult> {
    const start      = Date.now();
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), request.timeout_ms);

    const messages: OAIMessage[] = [];
    if (request.system_prompt) messages.push({ role: "system", content: request.system_prompt });
    messages.push({ role: "user", content: request.user_prompt });

    const body: OAIRequest = {
      model:       request.model ?? this.defaultModel,
      messages,
      max_tokens:  request.max_tokens,
      temperature: request.temperature ?? 0.7,
    };
    if (request.json_mode) body.response_format = { type: "json_object" };

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          // P3 — BYOK (F5): use per-request override key if provided, else platform key
          Authorization:  `Bearer ${request.api_key ?? this.apiKey}`,
          ...this.extraHeaders,
        },
        body:   JSON.stringify(body),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      // ── Non-OK HTTP: normalise via profile, then re-throw ─────────────────
      if (!res.ok) {
        let errPayload: unknown;
        try { errPayload = await res.json(); } catch { errPayload = { message: await res.text().catch(() => "") }; }

        // ── P0-GROQ-RETRY: extract Retry-After before profile normalisation ──
        // The header must be read while the Response object is still alive.
        // retryAfterMs is attached to the thrown Error as a non-enumerable property
        // so ExecutionEngine's withRetry loop can honour the server's backoff hint
        // without adding a new field to ProviderInvokeResult.
        const retryAfterMs = res.status === 429
          ? parseRetryAfterMs(res.headers)
          : undefined

        // Attach status so normalizeError can map it
        const enriched = Object.assign(
          typeof errPayload === "object" && errPayload !== null ? errPayload : {},
          { status: res.status }
        );
        const runtimeErr = this.profile.normalizeError(enriched, String(this.name));

        // Convert back to a plain Error so IProviderAdapter contract is honoured —
        // ExecutionEngine catches Error; it will normalise again via the profile
        // in Step 7 once ExecutionEngine is patched.  Until then, the message
        // carries safe structured data.
        const thrownErr = new Error(runtimeErr.message) as Error & {
          code?: string;
          statusCode?: number;
          retryAfterMs?: number;
        };
        thrownErr.code        = runtimeErr.code;
        thrownErr.statusCode  = runtimeErr.statusCode;
        // P0-GROQ-RETRY: surface the Retry-After hint to ExecutionEngine.
        // ExecutionEngine's withRetry onRetry callback should use this to
        // delay before the next attempt instead of the default exponential backoff.
        if (retryAfterMs !== undefined) {
          thrownErr.retryAfterMs = retryAfterMs
        }
        throw thrownErr;
      }

      // ── Parse raw response ────────────────────────────────────────────────
      const raw   = await res.json() as unknown;

      // ── Normalise via profile ─────────────────────────────────────────────
      const result = this.profile.normalizeResponse(raw, String(this.name));

      if (!result.success) {
        const thrownErr = new Error(result.error.message) as Error & { code?: string };
        thrownErr.code = result.error.code;
        throw thrownErr;
      }

      // ── Map to ProviderInvokeResult (contracts shape) ─────────────────────
      const rawData = raw as Record<string, unknown>;
      const usage   = rawData["usage"] as { prompt_tokens?: number; completion_tokens?: number } | undefined;
      const choices = rawData["choices"] as Array<Record<string, unknown>> | undefined;
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
        model_used: body.model,
        raw,
      };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return { content: "", finish_reason: "timeout", latency_ms: Date.now() - start };
      }
      throw err; // let ExecutionEngine handle retry / fallback
    }
  }

  describeCapability(id: string): import("@brandos/contracts").CapabilityDescriptor | null {
    if (!(this.capabilities as readonly string[]).includes(id)) return null;
    const caps = this.profile.capabilities ?? {};
    return {
      id:                id as import("@brandos/contracts").CapabilityId,
      version:           "1.0.0",
      provider:          this.name,
      model_id:          this.defaultModel,
      health_score:      85,
      latency_p50_ms:    1200,
      cost_per_1k_tokens: 0.001,
      supports_streaming: caps.supportsStreaming ?? false,
      max_context_tokens: caps.maxContext ?? 8192,
    };
  }
}
