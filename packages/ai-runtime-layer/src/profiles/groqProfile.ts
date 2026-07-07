// ============================================================
// packages/ai-runtime-layer/src/profiles/groqProfile.ts
//
// Semantic profile for api.groq.com
//
// Groq differences from vanilla OpenAI:
//   • Rate limits are stricter and fire on BOTH tokens AND requests/minute.
//     Their 429 body includes { error: { code: "rate_limit_exceeded" } }.
//   • Context windows vary sharply per model (8K-128K).
//   • No native JSON mode (as of mid-2024); json_mode must use prompt engineering.
//   • No vision support on current hosted models.
//   • Error body shape: { error: { message, type, code } }
// ============================================================

import type { ProviderProfile, ProviderResult, RuntimeError, ProviderCapabilities } from "../contracts/provider";
import { normalizeError } from "../utils/normalizeError";
import { genericOpenAIProfile } from "./genericOpenAIProfile";

const capabilities: ProviderCapabilities = {
  supportsStreaming: true,
  supportsTools:    false,
  supportsVision:   false,
  supportsJsonMode: false, // prompt-level only
  maxTokens:        8_192,
  maxContext:       32_768,
};

export const groqProfile: ProviderProfile = {
  capabilities,

  normalizeError(error: unknown, provider = "groq"): RuntimeError {
    const base = normalizeError(error, provider);

    // Groq wraps rate-limit info in error body — detect via message pattern
    // when the code normalizer maps it to "unknown".
    if (base.code === "unknown") {
      const msg = base.message.toLowerCase();
      if (msg.includes("rate limit") || msg.includes("rate_limit")) {
        return { ...base, code: "rate_limited", retryable: true };
      }
      if (msg.includes("please reduce") || msg.includes("token limit")) {
        return { ...base, code: "context_length", retryable: false };
      }
    }

    // Groq returns 413 for context-length violations (non-standard)
    if (base.statusCode === 413) {
      return { ...base, code: "context_length", retryable: false };
    }

    return base;
  },

  normalizeResponse(response: unknown, provider = "groq"): ProviderResult {
    // Groq response shape matches OAI — delegate to generic
    return genericOpenAIProfile.normalizeResponse(response, provider);
  },
};


