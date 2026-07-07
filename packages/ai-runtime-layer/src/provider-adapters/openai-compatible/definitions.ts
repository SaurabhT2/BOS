// ============================================================
// packages/ai-runtime-layer/src/provider-adapters/openai-compatible/definitions.ts
//
// Static definitions for known OpenAI-compatible cloud providers.
// Each entry drives:
//   • factory.ts registration (api key + enabled check)
//   • OpenAICompatibleAdapter configuration
//   • Semantic profile selection (error + response normalisation)
//
// To add a new provider:
//   1. Add an entry here
//   2. Add <PROVIDER>_API_KEY env var to ConfigLoader.fromEnv()
//   3. Optionally add a ProviderProfile in profiles/ if vendor has quirks
//   That's it. Nothing else changes.
// ============================================================

export interface OpenAICompatibleProviderDef {
  /** Must match ProviderName union in @brandos/contracts */
  provider_name:      string;
  display_name:       string;
  base_url:           string;
  default_model:      string;
  semantic_profile:   string; // key in PROVIDER_PROFILES
  extra_headers?:     Record<string, string>;
  cost_per_1k_tokens?: number;
}

export const OPENAI_COMPATIBLE_PROVIDER_DEFS: OpenAICompatibleProviderDef[] = [
  {
    provider_name:    "groq",
    display_name:     "Groq",
    base_url:         "https://api.groq.com/openai/v1",
    default_model:    "llama-3.3-70b-versatile",
    semantic_profile: "groq",
    cost_per_1k_tokens: 0,
  },
  {
    provider_name:    "openrouter",
    display_name:     "OpenRouter",
    base_url:         "https://openrouter.ai/api/v1",
    default_model:    "qwen/qwen-2.5-72b-instruct:free",
    semantic_profile: "generic",
    extra_headers: {
      "HTTP-Referer": "https://brandos.app",
      "X-Title":      "BrandOS",
    },
    cost_per_1k_tokens: 0,
  },
  {
    provider_name:    "togetherai",
    display_name:     "Together AI",
    base_url:         "https://api.together.xyz/v1",
    default_model:    "meta-llama/Llama-3-70b-chat-hf",
    semantic_profile: "generic",
    cost_per_1k_tokens: 0.0009,
  },
  {
    provider_name:    "fireworks",
    display_name:     "Fireworks AI",
    base_url:         "https://api.fireworks.ai/inference/v1",
    default_model:    "accounts/fireworks/models/llama-v3-70b-instruct",
    semantic_profile: "generic",
    cost_per_1k_tokens: 0.0009,
  },
];


