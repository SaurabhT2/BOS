// ============================================================
// packages/ai-runtime-layer/src/config/loader.ts
//
// CONFIGURATION LOADING & MERGING
//
// This file owns three responsibilities:
//
//   1. fromEnv()   — Build an AIRuntimeConfig from environment variables.
//                    This is always the BASE config. Admin overrides are
//                    layered on top via merge().
//
//   2. fromFile()  — Load a config from a JSON file (standalone / gateway mode).
//
//   3. merge()     — Deep-merge multiple Partial<AIRuntimeConfig> objects.
//                    Array fields (fallback_rules, task_timeouts) are atomic
//                    replacements — never index-merged.
//
// DESIGN PRINCIPLES:
//   - fromEnv() must never throw. Missing env vars → feature disabled.
//   - merge() must preserve env api_keys when admin overrides only set enabled/model.
//   - fallback_rules and task_timeouts are always atomic in merge() — last writer wins.
//     This prevents partial rule list merges that would produce invalid state.
//   - Providers not listed in OPENAI_COMPATIBLE_DEFS require explicit code in fromEnv().
//     But any provider IN the registry with pattern <ID_UPPER>_API_KEY is auto-loaded.
//
// P0-VERCEL: Local providers (Ollama, LMStudio) are NEVER registered in a
//   Vercel/production environment. Detection uses the canonical isProductionEnv()
//   helper which checks VERCEL=1, VERCEL_URL, and NODE_ENV=production.
//   DISABLE_OLLAMA=1 still works but is superseded by the production guard.
//   This is the single enforcement point — no scattered checks elsewhere.
//
// CHANGES LOG:
//   1. OPENAI_COMPATIBLE_PROVIDER_DEFS replaced with OPENAI_COMPATIBLE_DEFS from
//      @brandos/contracts. Adding a provider to PROVIDER_REGISTRY auto-adds its
//      env var loading here without any changes to this file.
//   2. fromEnv() derives the OpenAI-compatible block via a loop over OPENAI_COMPATIBLE_DEFS
//      instead of 4 hardcoded stanzas. ENV_KEY_OVERRIDES handles non-standard patterns.
//   3. Ollama: enabled:true explicit so admin override enabled:false merges correctly.
//   4. DISABLE_OLLAMA=1 env gate for environments where Ollama is not installed.
//   5. LMStudio: enabled:true explicit, only loaded when LMSTUDIO_URL is set.
//   6. merge(): providers are deep-merged per-key (env api_keys + admin overrides coexist).
//      fallback_rules and task_timeouts are atomic (last-write-wins).
//   7. P0-VERCEL: isProductionEnv() gate — local providers never registered in production.
//      Supersedes DISABLE_OLLAMA for Vercel/production deployments.
// ============================================================

import type { AIRuntimeConfig, AIRuntimePolicy, ProviderName } from '@brandos/contracts'
import { OPENAI_COMPATIBLE_DEFS } from '@brandos/contracts'

// ─────────────────────────────────────────────────────────────
// isProductionEnv
//
// Returns true when running on Vercel or in any NODE_ENV=production context.
//
// WHY THREE CHECKS:
//   VERCEL=1         — set by Vercel's build runtime on every deployment.
//   VERCEL_URL       — set by Vercel preview/prod deployments (e.g. my-app.vercel.app).
//   NODE_ENV=production — standard Node.js production flag; covers non-Vercel PaaS.
//
// NEVER THROWS. Returns false when process.env is unavailable (edge runtime).
// ─────────────────────────────────────────────────────────────
export function isProductionEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    env['VERCEL']         === '1'          ||
    env['NODE_ENV']       === 'production'  ||
    typeof env['VERCEL_URL'] === 'string' && env['VERCEL_URL'] !== ''
  )
}

// ─────────────────────────────────────────────────────────────
// ENV_KEY_OVERRIDES
//
// Maps provider IDs to their env var key prefix when the provider
// doesn't follow the simple `<ID.toUpperCase()>_API_KEY` pattern.
//
// Examples:
//   togetherai → TOGETHER_API_KEY (not TOGETHERAI_API_KEY)
//   openrouter → OPENROUTER_API_KEY (follows the pattern, listed for clarity)
//
// When adding a new provider to PROVIDER_REGISTRY, add it here if its
// env key prefix doesn't match ID.toUpperCase().replace(/[^A-Z0-9]/g, '_').
// ─────────────────────────────────────────────────────────────
const ENV_KEY_OVERRIDES: Record<string, string> = {
  togetherai: 'TOGETHER',
  openrouter: 'OPENROUTER',
  deepseek:   'DEEPSEEK',
  groq:       'GROQ',
}

/**
 * Resolve the env var key prefix for a provider ID.
 *
 * @param id - Provider ID from PROVIDER_REGISTRY (e.g. 'togetherai', 'groq').
 * @returns The env var key prefix (e.g. 'TOGETHER', 'GROQ').
 */
function envKeyForProvider(id: string): string {
  return ENV_KEY_OVERRIDES[id] ?? id.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

export class ConfigLoader {

  /**
   * Build an AIRuntimeConfig from environment variables.
   *
   * This is ALWAYS the base config. It provides api_keys (secrets) that admin
   * overrides cannot see or provide. Admin settings are layered on top via merge().
   *
   * ENABLED FLAG SEMANTICS:
   *   Cloud providers: enabled is intentionally left undefined (not set).
   *   This allows the adminSettingsApplied guard in factory.ts to work:
   *     - Without admin settings:   undefined !== false → provider registered (old path)
   *     - With admin settings + enabled:false  → not registered (correct)
   *     - With admin settings + enabled:true   → registered (correct)
   *
   *   Local providers (Ollama, LMStudio): enabled is explicitly set to true.
   *   This means admin override enabled:false merges cleanly to false, disabling them.
   *   Without explicit true, the merge would leave enabled:undefined which the
   *   adminSettingsApplied guard would treat as disabled.
   *
   * P0-VERCEL: Local providers are NEVER registered in production/Vercel environments.
   *   isProductionEnv() is evaluated once at call time. If true, Ollama and LMStudio
   *   blocks are skipped entirely — they never appear in the config, so the factory
   *   never instantiates their adapters, so the capability engine never marks 'local'
   *   as available, so the router can never select a local provider.
   *   This is the single, canonical enforcement point for this invariant.
   *
   * @param env - Environment variable map. Defaults to process.env.
   *              Override in tests: ConfigLoader.fromEnv({ OPENAI_API_KEY: 'test-key' })
   */
  static fromEnv(env: Record<string, string | undefined> = process.env): AIRuntimeConfig {
    const providers: AIRuntimeConfig['providers'] = {}
    const policy: AIRuntimePolicy = {}

    // ── P0-VERCEL: production guard ───────────────────────────────────────────
    // Local providers are physically impossible in production. Skip both blocks
    // entirely so no adapter is ever instantiated for a URL that doesn't exist.
    const inProduction = isProductionEnv(env)

    if (inProduction) {
      console.info(
        '[ConfigLoader] Production environment detected — local providers (Ollama, LMStudio) disabled. ' +
        'Set cloud provider API keys to enable generation.'
      )
    }

    // ── Ollama (local) ────────────────────────────────────────────────────────
    // Skipped when: inProduction OR DISABLE_OLLAMA=1
    // Always configured unless DISABLE_OLLAMA=1.
    // DISABLE_OLLAMA=1: use in Docker/serverless environments without Ollama installed
    //   to prevent health-check failures at startup.
    // enabled:true: explicit so admin enabled:false override merges correctly.
    if (!inProduction && env.DISABLE_OLLAMA !== '1') {
      providers.ollama = {
        base_url:      env.OLLAMA_URL    ?? 'http://localhost:11434',
        default_model: env.OLLAMA_MODEL  ?? 'llama3',
        enabled:       true,
      }
    }

    // ── LM Studio (local) ─────────────────────────────────────────────────────
    // Skipped when: inProduction (regardless of LMSTUDIO_URL)
    // Only configured when LMSTUDIO_URL is set (LM Studio is not always installed).
    // enabled:true: explicit so admin enabled:false override merges correctly.
    if (!inProduction && env.LMSTUDIO_URL !== undefined) {
      providers.lmstudio = {
        base_url:      env.LMSTUDIO_URL,
        default_model: env.LMSTUDIO_MODEL ?? 'local-model',
        enabled:       true,
      }
    }

    // ── Named cloud providers with dedicated adapters ─────────────────────────
    // These have dedicated adapter classes in factory.ts and must be registered
    // here explicitly. They are NOT picked up by the OPENAI_COMPATIBLE_DEFS loop
    // below (because factory.ts's HANDLED_NATIVE_PROVIDERS excludes them there).

    if (env.OPENAI_API_KEY) {
      providers.openai = {
        api_key:       env.OPENAI_API_KEY,
        default_model: env.OPENAI_MODEL ?? 'gpt-4o-mini',
        // enabled intentionally undefined — adminSettingsApplied guard handles it
      }
    }

    if (env.ANTHROPIC_API_KEY) {
      providers.anthropic = {
        api_key:       env.ANTHROPIC_API_KEY,
        default_model: env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001',
      }
    }

    if (env.GOOGLE_API_KEY) {
      providers.google = {
        api_key:       env.GOOGLE_API_KEY,
        default_model: env.GOOGLE_MODEL ?? 'gemini-2.5-flash',
      }
    }

    // ── OpenAI-compatible providers (registry-driven) ─────────────────────────
    // Loops over OPENAI_COMPATIBLE_DEFS from @brandos/contracts.
    // Each def contributes <PROVIDER_UPPER>_API_KEY and <PROVIDER_UPPER>_MODEL.
    //
    // Adding a new OpenAI-compatible provider to PROVIDER_REGISTRY automatically
    // activates its env var loading here — no changes needed in this file.
    // Only add to ENV_KEY_OVERRIDES if the key prefix is non-standard.
    //
    // Note: openai, anthropic, google, deepseek may appear in OPENAI_COMPATIBLE_DEFS
    // because their wire protocol is 'openai-compatible'. That's fine — they're
    // already loaded above by the explicit block. The loop below will produce a
    // duplicate provider entry which the explicit block will overwrite on merge.
    // The factory.ts HANDLED_NATIVE_PROVIDERS guard prevents double-registration.
    for (const def of OPENAI_COMPATIBLE_DEFS) {
      const envPrefix = envKeyForProvider(def.id)
      const apiKeyVar = `${envPrefix}_API_KEY`
      const modelVar  = `${envPrefix}_MODEL`
      const apiKey    = env[apiKeyVar]

      if (apiKey) {
        providers[def.id as ProviderName] = {
          api_key:       apiKey,
          default_model: env[modelVar] ?? def.defaultModel,
          // enabled intentionally undefined — adminSettingsApplied guard handles it
        }
      }
    }

    // ── Policy from env ───────────────────────────────────────────────────────
    // Runtime policy can be set via env vars for simple deployments.
    // For full policy management, control-plane-layer injects via configProvider.

    if (env.AIRUNTIME_MAX_COST) {
      policy.max_cost_per_request_usd = parseFloat(env.AIRUNTIME_MAX_COST)
    }

    if (env.AIRUNTIME_BLOCKED_PROVIDERS) {
      policy.blocked_providers = env.AIRUNTIME_BLOCKED_PROVIDERS
        .split(',')
        .map(s => s.trim() as ProviderName)
    }

    // ── Assemble config ───────────────────────────────────────────────────────
    const config: AIRuntimeConfig = { providers, policy }

    if (env.AIRUNTIME_LOG_LEVEL) {
      config.log_level = env.AIRUNTIME_LOG_LEVEL as AIRuntimeConfig['log_level']
    }
    if (env.AIRUNTIME_CACHE_TTL_MS) {
      config.capability_cache_ttl_ms = parseInt(env.AIRUNTIME_CACHE_TTL_MS, 10)
    }
    if (env.AIRUNTIME_BUDGET_USD) {
      config.budget_usd = parseFloat(env.AIRUNTIME_BUDGET_USD)
    }

    return config
  }

  /**
   * Parse a JSON config (string or object) into an AIRuntimeConfig.
   * Used by tests and programmatic config construction.
   *
   * @param json - JSON string or already-parsed object.
   * @returns Parsed AIRuntimeConfig.
   */
  static fromJSON(json: string | Record<string, unknown>): AIRuntimeConfig {
    if (typeof json === 'string') return JSON.parse(json) as AIRuntimeConfig
    return json as unknown as AIRuntimeConfig
  }

  /**
   * Load a config from a JSON file on disk.
   * Used by AIRuntimeGateway (standalone HTTP server mode) where env vars
   * may not be available and a config file is preferred.
   *
   * @param filePath - Absolute or relative path to the JSON config file.
   * @returns Loaded AIRuntimeConfig.
   */
  static fromFile(filePath: string): AIRuntimeConfig {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs')
    return ConfigLoader.fromJSON(fs.readFileSync(filePath, 'utf-8'))
  }

  /**
   * Merge multiple partial AIRuntimeConfig objects into a single config.
   *
   * MERGE SEMANTICS:
   *
   *   providers: Deep-merged per-provider-key (one level deep).
   *     - env-provided api_keys survive alongside admin-controlled enabled/model fields.
   *     - Each provider config is spread with later values winning per-key.
   *     - Example: env { api_key: 'sk-...' } + admin { enabled: true, default_model: 'gpt-4o' }
   *                → { api_key: 'sk-...', enabled: true, default_model: 'gpt-4o' }
   *
   *   policy: Merged per-key (last write wins for each policy field).
   *
   *   fallback_rules: ATOMIC replacement. The last config to specify fallback_rules
   *     wins outright. Never index-merged. An empty array from admin overrides
   *     correctly replaces a non-empty array from env config.
   *
   *   task_timeouts: ATOMIC replacement. Same semantics as fallback_rules.
   *
   *   All other scalar and object fields: last-write-wins via Object.assign.
   *
   * CALL PATTERN (AIRuntimeAdapter.inner getter):
   *   ConfigLoader.merge(ConfigLoader.fromEnv(), this.configProvider())
   *
   *   env config provides: api_keys, local provider URLs
   *   admin override provides: enabled, priority, fallback_rules, task_timeouts, policy
   *
   * @param configs - One or more partial configs to merge, in priority order (last wins).
   * @returns Fully merged AIRuntimeConfig.
   */
  static merge(...configs: Partial<AIRuntimeConfig>[]): AIRuntimeConfig {
    const result: AIRuntimeConfig = { providers: {}, policy: {} }

    for (const cfg of configs) {
      if (!cfg) continue

      const { providers, policy, fallback_rules, task_timeouts, ...rest } = cfg

      // Scalar and object fields: last-write-wins
      Object.assign(result, rest)

      // providers: deep-merge per-provider-key so env api_keys and admin
      // enabled/model/base_url fields coexist without either overwriting the other.
      if (providers) {
        for (const [name, provCfg] of Object.entries(providers)) {
          const existing = (result.providers as Record<string, unknown>)[name]
          ;(result.providers as Record<string, unknown>)[name] =
            typeof existing === 'object' && existing !== null
              ? { ...(existing as object), ...(provCfg as object) }
              : provCfg
        }
      }

      // policy: merge per-key (last write wins for each individual policy field)
      if (policy) Object.assign(result.policy!, policy)

      // fallback_rules: ATOMIC — the last config to define this array replaces
      // everything. Never index-merged. An empty admin list correctly clears rules.
      if (fallback_rules !== undefined) result.fallback_rules = [...fallback_rules]

      // task_timeouts: ATOMIC — same semantics as fallback_rules.
      if (task_timeouts !== undefined) result.task_timeouts = { ...task_timeouts }
    }

    return result
  }
}
