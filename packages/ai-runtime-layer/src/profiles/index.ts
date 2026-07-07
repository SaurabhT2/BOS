// ============================================================
// packages/ai-runtime-layer/src/profiles/index.ts
//
// Central profile registry.
// Keys match the `semanticProfile` field in DynamicProviderConfig
// and the `profile` field in OPENAI_COMPATIBLE_PROVIDER_DEFS.
//
// To add a new vendor profile:
//   1. Create profiles/myVendorProfile.ts implementing ProviderProfile
//   2. Add it here under a stable key
//   3. Set semanticProfile: "myvendor" in the provider config
//   — NO other changes needed
// ============================================================

import type { ProviderProfile } from "../contracts/provider";
import { genericOpenAIProfile } from "./genericOpenAIProfile";
import { openaiProfile         } from "./openaiProfile";
import { groqProfile           } from "./groqProfile";
import { deepseekProfile       } from "./deepseekProfile";

export const PROVIDER_PROFILES: Record<string, ProviderProfile> = {
  // Vendor-specific profiles
  openai:   openaiProfile,
  groq:     groqProfile,
  deepseek: deepseekProfile,

  // Generic fallback — covers vLLM, OpenRouter, Together, Fireworks,
  // Anyscale, self-hosted OAI-compatible endpoints, future vendors.
  generic:    genericOpenAIProfile,
  openrouter: genericOpenAIProfile,
  togetherai: genericOpenAIProfile,
  fireworks:  genericOpenAIProfile,
  anyscale:   genericOpenAIProfile,
  vllm:       genericOpenAIProfile,
};

/**
 * Resolve a semantic profile by name.
 * Falls back to "generic" when the key is unknown — never returns undefined.
 */
export function resolveProfile(semanticProfile: string): ProviderProfile {
  return PROVIDER_PROFILES[semanticProfile] ?? genericOpenAIProfile;
}

export {
  genericOpenAIProfile,
  openaiProfile,
  groqProfile,
  deepseekProfile,
};

export type { ProviderProfile } from "../contracts/provider";


