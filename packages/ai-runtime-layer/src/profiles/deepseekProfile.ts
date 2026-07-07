// ============================================================
// packages/ai-runtime-layer/src/profiles/deepseekProfile.ts
//
// Semantic profile for api.deepseek.com
//
// DeepSeek differences from vanilla OpenAI:
//   • Returns reasoning_content field for deepseek-reasoner — we strip it.
//   • Error shape: { error: { message, type, code } }
//     but code is sometimes missing; message encodes the intent.
//   • No vision on hosted models (as of Q1 2025).
//   • Balance/quota errors return 402 (non-standard).
//   • deepseek-reasoner may return empty content when chain-of-thought
//     is in reasoning_content instead — we fall back to reasoning_content.
// ============================================================

import type { ProviderProfile, ProviderResult, RuntimeError, ProviderCapabilities } from "../contracts/provider";
import { normalizeError } from "../utils/normalizeError";
import { genericOpenAIProfile } from "./genericOpenAIProfile";

const capabilities: ProviderCapabilities = {
  supportsStreaming: true,
  supportsTools:    false,
  supportsVision:   false,
  supportsJsonMode: true,
  maxTokens:        8_192,
  maxContext:       64_000,
};

export const deepseekProfile: ProviderProfile = {
  capabilities,

  normalizeError(error: unknown, provider = "deepseek"): RuntimeError {
    const base = normalizeError(error, provider);

    // DeepSeek uses HTTP 402 for insufficient balance (non-standard)
    if (base.statusCode === 402) {
      return { ...base, code: "quota_exceeded", retryable: false };
    }

    // DeepSeek overloaded: 503 with "server is busy" message
    if (base.statusCode === 503) {
      return { ...base, code: "server_overloaded", retryable: true };
    }

    return base;
  },

  normalizeResponse(response: unknown, provider = "deepseek"): ProviderResult {
    try {
      if (response == null || typeof response !== "object") {
        return genericOpenAIProfile.normalizeResponse(response, provider);
      }

      const r       = response as Record<string, unknown>;
      const choices = r["choices"] as Array<Record<string, unknown>> | undefined;

      if (!choices || choices.length === 0) {
        return genericOpenAIProfile.normalizeResponse(response, provider);
      }

      const choice  = choices[0];
      const message = choice?.["message"] as Record<string, unknown> | undefined;
      let   content = (message?.["content"] as string | null) ?? "";

      // deepseek-reasoner: content may be empty; actual answer is in reasoning_content
      // We surface reasoning_content as the content so callers get a useful response.
      if (!content) {
        const reasoningContent = message?.["reasoning_content"] as string | undefined;
        if (reasoningContent) {
          content = reasoningContent;
        }
      }

      return {
        success: true,
        content,
        metadata: {
          finish_reason:     choice?.["finish_reason"],
          model:             r["model"],
          has_reasoning:     !!(message?.["reasoning_content"]),
        },
      };
    } catch (err) {
      return { success: false, error: normalizeError(err, provider) };
    }
  },
};


