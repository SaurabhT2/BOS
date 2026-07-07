// ============================================================
// packages/ai-runtime-layer/src/profiles/genericOpenAIProfile.ts
//
// Covers ALL OpenAI-compatible vendors that don't need custom overrides:
//   vLLM, OpenRouter, Together, Fireworks, Anyscale, custom endpoints
//
// This profile is the safe fallback when no vendor-specific profile
// is registered. Adding new OAI-compatible vendors requires zero code
// changes here — just a provider config with semanticProfile: "generic".
// ============================================================

import type { ProviderProfile, ProviderResult, RuntimeError, ProviderCapabilities } from "../contracts/provider";
import { normalizeError } from "../utils/normalizeError";

const capabilities: ProviderCapabilities = {
  supportsStreaming: true,
  supportsTools:    false, // conservative default; override per-vendor
  supportsVision:   false,
  supportsJsonMode: true,
  maxTokens:        4096,
  maxContext:       16_384,
};

export const genericOpenAIProfile: ProviderProfile = {
  capabilities,

  normalizeError(error: unknown, provider = "generic"): RuntimeError {
    return normalizeError(error, provider);
  },

  normalizeResponse(response: unknown, provider = "generic"): ProviderResult {
    try {
      if (response == null || typeof response !== "object") {
        return {
          success: false,
          error: { provider, code: "empty_response", message: "Response was null or non-object", retryable: false },
        };
      }

      const r = response as Record<string, unknown>;
      const choices = r["choices"] as Array<Record<string, unknown>> | undefined;

      if (!choices || choices.length === 0) {
        // Some OAI-compatible endpoints surface errors in r.error instead of choices
        const rawErr = r["error"];
        if (rawErr) return { success: false, error: normalizeError(rawErr, provider) };

        return {
          success: false,
          error: { provider, code: "no_choices", message: "No completion choices returned", retryable: false },
        };
      }

      const choice  = choices[0];
      const message = choice?.["message"] as Record<string, unknown> | undefined;
      const content = (message?.["content"] as string | null) ?? "";

      if (content === null || content === "") {
        // finish_reason=content_filter on some vendors
        const finishReason = choice?.["finish_reason"] as string | undefined;
        if (finishReason === "content_filter") {
          return { success: false, error: { provider, code: "content_filtered", message: "Response blocked by content filter", retryable: false } };
        }
      }

      return {
        success: true,
        content,
        metadata: {
          finish_reason: choice?.["finish_reason"],
          model: r["model"],
        },
      };
    } catch (err) {
      return { success: false, error: normalizeError(err, provider) };
    }
  },
};


