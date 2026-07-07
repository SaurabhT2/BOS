// ============================================================
// packages/ai-runtime-layer/src/utils/normalizeError.ts
//
// Safe extraction of RuntimeError from ANY throwable.
// MUST NEVER THROW. Always returns a valid RuntimeError.
//
// Handles:
//   • OpenAI SDK errors        — err.error.code / err.status
//   • Fetch/network errors     — AbortError, TypeError (no response)
//   • HTTP response bodies     — err.response.data.error.code
//   • Raw Error objects        — err.message / err.code
//   • Provider string errors   — "DeepSeek API error 429: ..."
//   • Unknown throwables       — anything else
// ============================================================

import type { RuntimeError } from "../contracts/provider";

// Known stable error codes we map to
const CODE_MAP: Record<string, string> = {
  invalid_api_key:         "auth_error",
  authentication_error:    "auth_error",
  access_denied:           "auth_error",
  rate_limit_exceeded:     "rate_limited",
  rate_limited:            "rate_limited",
  tokens_exceeded:         "context_length",
  context_length_exceeded: "context_length",
  model_not_found:         "model_not_found",
  model_does_not_exist:    "model_not_found",
  insufficient_quota:      "quota_exceeded",
  billing_hard_limit_reached: "quota_exceeded",
};

function mapCode(raw: string | undefined | null): string {
  if (!raw) return "unknown";
  const lower = String(raw).toLowerCase();
  return CODE_MAP[lower] ?? lower;
}

function statusToCode(status: number): { code: string; retryable: boolean } {
  if (status === 401 || status === 403) return { code: "auth_error",      retryable: false };
  if (status === 404)                   return { code: "model_not_found",  retryable: false };
  if (status === 429)                   return { code: "rate_limited",     retryable: true  };
  if (status >= 500)                    return { code: "server_error",     retryable: true  };
  if (status >= 400)                    return { code: "client_error",     retryable: false };
  return                                       { code: "unknown",          retryable: false };
}

/**
 * The single point of entry for raw throwables → RuntimeError.
 *
 * @param err     - Anything thrown by fetch / SDK / adapter code
 * @param provider - Provider name for context (defaults to "unknown")
 */
export function normalizeError(err: unknown, provider = "unknown"): RuntimeError {
  try {
    // ── 1. Already a RuntimeError (idempotent) ────────────────────────────────
    if (
      err != null &&
      typeof err === "object" &&
      "code" in err &&
      "message" in err &&
      "provider" in err
    ) {
      return err as RuntimeError;
    }

    // ── 2. Fetch AbortError (timeout) ─────────────────────────────────────────
    if (err instanceof Error && err.name === "AbortError") {
      return {
        provider,
        code: "timeout",
        message: "Request aborted (timeout)",
        retryable: true,
        raw: err,
      };
    }

    // ── 3. Network/fetch failure (no response) ────────────────────────────────
    if (err instanceof TypeError && err.message?.toLowerCase().includes("fetch")) {
      return {
        provider,
        code: "network_error",
        message: err.message,
        retryable: true,
        raw: err,
      };
    }

    if (typeof err !== "object" || err === null) {
      // ── 4. Primitive throw ────────────────────────────────────────────────
      return {
        provider,
        code: "unknown",
        message: String(err),
        retryable: false,
        raw: err,
      };
    }

    const e = err as Record<string, unknown>;

    // ── 5. OpenAI SDK-style: { status, error: { code, message } } ─────────────
    const sdkError = e["error"] as Record<string, unknown> | undefined;
    if (sdkError != null && typeof sdkError === "object") {
      const code    = mapCode(sdkError["code"] as string ?? sdkError["type"] as string);
      const message = (sdkError["message"] as string) ?? (e["message"] as string) ?? "Provider error";
      const status  = typeof e["status"] === "number" ? e["status"] : undefined;
      const { retryable } = status ? statusToCode(status) : { retryable: code === "rate_limited" };
      return { provider, code, message, retryable, statusCode: status, raw: err };
    }

    // ── 6. err.response.data.error.code (axios-style) ─────────────────────────
    const response = e["response"] as Record<string, unknown> | undefined;
    if (response != null && typeof response === "object") {
      const data      = response["data"] as Record<string, unknown> | undefined;
      const dataError = data?.["error"] as Record<string, unknown> | undefined;
      const code      = mapCode(
        (dataError?.["code"] as string) ??
        (dataError?.["type"] as string) ??
        undefined
      );
      const message   = (dataError?.["message"] as string) ??
                        (data?.["message"]       as string) ??
                        "Provider error";
      const status    = typeof response["status"] === "number" ? response["status"] : undefined;
      const { retryable } = status ? statusToCode(status) : { retryable: false };
      return { provider, code, message, retryable, statusCode: status, raw: err };
    }

    // ── 7. Plain Error with .code ─────────────────────────────────────────────
    const message = (e["message"] as string) ?? "Unknown error";
    const rawCode = e["code"] as string | undefined;

    // Parse "DeepSeek API error 429: ..." style messages
    const httpMatch = message.match(/(?:API\s+)?error\s+(\d{3})/i);
    if (httpMatch) {
      const status   = parseInt(httpMatch[1], 10);
      const { code, retryable } = statusToCode(status);
      return { provider, code, message, retryable, statusCode: status, raw: err };
    }

    return {
      provider,
      code:      rawCode ? mapCode(rawCode) : "unknown",
      message,
      retryable: rawCode === "rate_limited" || rawCode === "ECONNRESET",
      raw: err,
    };
  } catch {
    // Absolute last resort — normalizer itself must never throw
    return {
      provider,
      code: "unknown",
      message: "Error normalizer encountered an unexpected failure",
      retryable: false,
    };
  }
}


