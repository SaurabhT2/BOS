// ============================================================
// @brandos/shared-utils — env.ts
//
// PURPOSE:
//   Boot-time environment contract validator.
//   Call validateEnv() once at startup to verify all required and
//   optional environment variables are present. Never throws on
//   missing optional vars — only returns structured results.
//
// USAGE:
//   // In instrumentation.ts or the first API route handler:
//   import { validateEnv } from '@brandos/shared-utils';
//   const env = validateEnv();
//   if (!env.valid) {
//     console.error('Missing required env vars', env.missing_required);
//     process.exit(1); // or throw, depending on your startup strategy
//   }
//
//   // For individual required vars at call sites:
//   import { requireEnv } from '@brandos/shared-utils';
//   const apiKey = requireEnv('ANTHROPIC_API_KEY');
//
// ARCHITECTURE:
//   - validateEnv() is a pure function (reads process.env, no side effects
//     other than console.error/warn in non-silent environments)
//   - requireEnv() throws immediately — use only where a missing var
//     would make the call-site code completely non-functional
//   - ENV_SPEC is the single source of truth for all expected env vars
//
// INVARIANTS:
//   - No imports from @brandos/* packages — env.ts runs before contracts
//   - No framework imports — must run in Node.js, Edge, and Worker contexts
//   - validateEnv() never throws — callers decide whether to abort
// ============================================================

import type { IEnvValidationResult } from "./ISharedUtils";

/**
 * Re-export for consumer convenience.
 * Callers: `import type { EnvValidationResult } from '@brandos/shared-utils'`
 */
export type EnvValidationResult = IEnvValidationResult;

/**
 * EnvVar — descriptor for a single expected environment variable.
 *
 * Each entry in ENV_SPEC maps to one env var and documents its
 * purpose, group, and whether its absence should fail validation.
 */
interface EnvVar {
  /** The process.env key to check. */
  key: string;
  /** true = missing value makes `valid: false`. false = warning only. */
  required: boolean;
  /** Human-readable description for error messages and documentation. */
  description: string;
  /**
   * Logical grouping for summary reporting.
   * Groups: 'Supabase' | 'AI Providers' | 'Analytics' | 'App'
   */
  group: string;
}

/**
 * ENV_SPEC — single source of truth for all expected environment variables.
 *
 * AGENT INSTRUCTIONS:
 *   - Add new required vars with required: true
 *   - Add new optional vars with required: false
 *   - Never remove entries without confirming all consumers have migrated
 *   - Group entries logically — the group field appears in log output
 *
 * AI PROVIDER KEYS:
 *   None are individually required (required: false), but at least one
 *   must be present. validateEnv() emits a warning if none are configured.
 *   This allows development with Ollama/LM Studio without API keys.
 */
const ENV_SPEC: EnvVar[] = [
  // ─── Required: Supabase ────────────────────────────────────────────────────
  // Both keys are needed for any Supabase operation (auth, DB, storage).
  // Missing either makes the app non-functional in any deployment.
  {
    key: "NEXT_PUBLIC_SUPABASE_URL",
    required: true,
    description: "Supabase project URL",
    group: "Supabase",
  },
  {
    key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    required: true,
    description: "Supabase anon key (safe for browser)",
    group: "Supabase",
  },

  // ─── Optional: AI Providers ────────────────────────────────────────────────
  // At least one of these must be present for cloud generation to work.
  // Local providers (Ollama, LM Studio) do not require any of these keys.
  {
    key: "ANTHROPIC_API_KEY",
    required: false,
    description: "Anthropic Claude (Frontier tier)",
    group: "AI Providers",
  },
  {
    key: "OPENAI_API_KEY",
    required: false,
    description: "OpenAI GPT-4o (Frontier tier)",
    group: "AI Providers",
  },
  {
    key: "GOOGLE_AI_API_KEY",
    required: false,
    description: "Google Gemini (Frontier tier)",
    group: "AI Providers",
  },
  {
    key: "GROQ_API_KEY",
    required: false,
    description: "Groq Llama/Mixtral (Free Cloud tier)",
    group: "AI Providers",
  },
  {
    key: "TOGETHER_API_KEY",
    required: false,
    description: "Together AI Llama (Free Cloud tier)",
    group: "AI Providers",
  },
  {
    key: "OPENROUTER_API_KEY",
    required: false,
    description: "OpenRouter free models",
    group: "AI Providers",
  },

  // ─── Optional: Analytics ───────────────────────────────────────────────────
  // Missing these disables server-side and client-side analytics.
  // App still functions normally without them.
  {
    key: "POSTHOG_API_KEY",
    required: false,
    description: "PostHog server-side analytics (event ingestion key)",
    group: "Analytics",
  },
  {
    key: "NEXT_PUBLIC_POSTHOG_KEY",
    required: false,
    description: "PostHog client-side analytics (public key)",
    group: "Analytics",
  },

  // ─── Optional: App Config ─────────────────────────────────────────────────
  // Missing NEXT_PUBLIC_APP_URL disables OAuth redirect construction.
  // Falls back to window.location.origin in browser contexts.
  {
    key: "NEXT_PUBLIC_APP_URL",
    required: false,
    description: "App base URL for OAuth redirects and absolute link generation",
    group: "App",
  },

  // ─── Optional: Export Integrations (Priority 4 — Canva Export) ────────────
  // Missing either disables the Canva connect flow — the export route falls
  // back gracefully (Canva export button shows "not configured" rather than
  // attempting an OAuth redirect with no client). Same env-var-driven
  // optionality pattern as the AI Providers group above.
  {
    key: "CANVA_CLIENT_ID",
    required: false,
    description: "Canva Connect API OAuth client ID (Priority 4 — Canva Export)",
    group: "Export Integrations",
  },
  {
    key: "CANVA_CLIENT_SECRET",
    required: false,
    description: "Canva Connect API OAuth client secret (Priority 4 — Canva Export)",
    group: "Export Integrations",
  },
];

/**
 * AI_PROVIDER_KEYS — subset of ENV_SPEC keys used to detect provider coverage.
 *
 * validateEnv() warns when none of these are present — generation would fail
 * in cloud mode. Local mode (Ollama, LM Studio) does not appear here because
 * it requires no API key.
 */
const AI_PROVIDER_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_AI_API_KEY",
  "GROQ_API_KEY",
  "TOGETHER_API_KEY",
  "OPENROUTER_API_KEY",
];

/**
 * validateEnv — check all expected environment variables at startup.
 *
 * Never throws. Returns a structured result that the caller can use
 * to decide whether to abort, warn, or proceed.
 *
 * SIDE EFFECTS (non-silent environments):
 *   - console.error() when required vars are missing
 *   - console.warn()  when no AI providers are configured
 *   - console.info()  in NODE_ENV=development with a compact summary
 *
 * RETURNS EnvValidationResult:
 *   valid: false          → missing_required is non-empty; app will likely crash later
 *   valid: true           → all required vars present; optional may be missing
 *   ai_providers: []      → generation will fail in cloud mode
 *
 * TYPICAL STARTUP PATTERN:
 *   const env = validateEnv();
 *   if (!env.valid) throw new Error(`Missing: ${env.missing_required.join(', ')}`);
 */
export function validateEnv(): EnvValidationResult {
  const missing_required: string[] = [];
  const missing_optional: string[] = [];
  const warnings: string[] = [];

  // Walk the spec and bucket each missing key by required/optional
  for (const spec of ENV_SPEC) {
    const val = process.env[spec.key];
    if (!val) {
      if (spec.required) {
        missing_required.push(spec.key);
      } else {
        missing_optional.push(spec.key);
      }
    }
  }

  // Check whether at least one AI provider is configured.
  // Empty result is a warning (not an error) to support local-only development.
  const ai_providers_configured = AI_PROVIDER_KEYS.filter(
    (k) => !!process.env[k]
  );

  if (ai_providers_configured.length === 0) {
    warnings.push(
      "No cloud AI provider keys configured. " +
        "Generation will only work with local Ollama/LM Studio. " +
        "Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or another provider key for cloud generation."
    );
  }

  // Emit actionable console messages (non-silent environments)
  if (missing_required.length > 0) {
    console.error(
      `[BrandOS] Missing required environment variables: ${missing_required.join(", ")}. ` +
        "Check your .env.local and deployment environment."
    );
  }

  if (warnings.length > 0) {
    warnings.forEach((w) => console.warn(`[BrandOS] ${w}`));
  }

  // In development, log a compact readiness summary for quick debugging
  if (process.env.NODE_ENV === "development") {
    console.info("[BrandOS] Env check:", {
      supabase: !missing_required.some((k) => k.includes("SUPABASE")),
      ai_providers: ai_providers_configured.length,
      analytics: !missing_optional.includes("POSTHOG_API_KEY"),
    });
  }

  return {
    valid: missing_required.length === 0,
    missing_required,
    missing_optional,
    ai_providers_configured,
    warnings,
  };
}

/**
 * requireEnv — read a required environment variable or throw immediately.
 *
 * Use this at call sites where the variable is needed for the immediate
 * operation and a missing value should abort the call (not just warn).
 *
 * CONTRAST with validateEnv():
 *   validateEnv() — boot-time check, never throws, structured result
 *   requireEnv()  — call-site check, throws immediately, single var
 *
 * @param key - The process.env key to read.
 * @returns   The env var value as a non-empty string.
 * @throws    Error if the key is not set or its value is empty.
 *
 * EXAMPLE:
 *   const anthropicKey = requireEnv('ANTHROPIC_API_KEY');
 *   // anthropicKey is guaranteed to be a non-empty string here
 */
export function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
        "See .env.example for the full list of expected variables."
    );
  }
  return val;
}


