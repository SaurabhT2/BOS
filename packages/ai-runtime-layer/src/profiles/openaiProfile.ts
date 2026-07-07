// ============================================================
// packages/ai-runtime-layer/src/profiles/openaiProfile.ts
//
// Semantic profile for api.openai.com
// Extends generic behaviour with OpenAI-specific error codes and
// capability declarations (vision, tools, json_mode, high context).
// ============================================================

import type { ProviderProfile, ProviderResult, RuntimeError, ProviderCapabilities } from "../contracts/provider";
import { normalizeError } from "../utils/normalizeError";
import { genericOpenAIProfile } from "./genericOpenAIProfile";

const capabilities: ProviderCapabilities = {
  supportsStreaming: true,
  supportsTools:    true,
  supportsVision:   true,   // gpt-4o, gpt-4-turbo
  supportsJsonMode: true,
  maxTokens:        16_384,
  maxContext:       128_000,
};

export const openaiProfile: ProviderProfile = {
  capabilities,

  normalizeError(error: unknown, provider = "openai"): RuntimeError {
    // OpenAI SDK wraps errors as { status, error: { code, message, type } }
    // normalizeError handles this natively; we only override the provider tag.
    const base = normalizeError(error, provider);

    // OpenAI-specific: map "insufficient_quota" → quota_exceeded
    const e = error as Record<string, unknown> | null;
    const sdkErr = e?.["error"] as Record<string, unknown> | undefined;
    const sdkCode = sdkErr?.["code"] as string | undefined;
    if (sdkCode === "insufficient_quota") {
      return { ...base, code: "quota_exceeded", retryable: false };
    }

    return base;
  },

  normalizeResponse(response: unknown, provider = "openai"): ProviderResult {
    // OpenAI response shape is the canonical OAI shape — delegate to generic.
    return genericOpenAIProfile.normalizeResponse(response, provider);
  },
};


