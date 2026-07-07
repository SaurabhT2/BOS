// ============================================================
// packages/ai-runtime-layer/src/config/factory.ts
//
// DEPENDENCY INJECTION WIRING
//
// AIRuntimeFactory.create() is the single place where all engine
// classes are instantiated and wired together. It is the composition
// root for the AI runtime.
//
// DESIGN PRINCIPLES:
//   - Caller provides AIRuntimeConfig. Factory does not read env directly.
//     Env reading is ConfigLoader.fromEnv()'s job.
//   - Provider Map insertion order = admin priority order.
//     RouterEngine (auto mode) selects providers in Map insertion order.
//     The admin's provider priority list must be reflected here.
//   - adminSettingsApplied guard: when fallback_rules is present in the
//     config, admin settings have been applied. Provider enabled check
//     becomes strict (must === true). Without admin settings (env-only,
//     test path), enabled !== false is sufficient.
//   - Module-level singletons (CircuitBreaker, RateLimiter, CostTracker)
//     survive runtime rebuilds to preserve state across config reloads.
//     If the circuit is open for a provider when the runtime rebuilds,
//     it remains open — preventing repeated failures during recovery.
//
// CHANGES LOG:
//   1. buildProviders() iterates admin-sorted providers via config metadata.
//      Map insertion order = admin priority order for RouterEngine.
//   2. OPENAI_COMPATIBLE_PROVIDER_DEFS replaced with OPENAI_COMPATIBLE_DEFS
//      from @brandos/contracts/provider-registry. Adding a provider to the
//      registry now auto-registers it here — no factory changes needed.
//   3. adminSettingsApplied guard: enabled must === true when admin settings
//      are applied; enabled !== false when only env config is present.
//   4. Ollama/LMStudio explicit enable guard: enabled:false always skips,
//      enabled:true OR !adminSettingsApplied registers.
//   5. buildDefaultFallbackRules() → [] (empty list = no fallback rules from
//      the runtime itself; admin settings provide fallback_rules via ConfigLoader).
//   6. HANDLED_NATIVE_PROVIDERS: prevents OpenAI-compatible loop from
//      registering providers that already have dedicated adapters, which
//      would silently overwrite the dedicated class with the generic one.
//   7. Phase 1 — Runtime Consolidation (Gate 1): buildProviders() rewritten
//      from three hardcoded sequential blocks (named adapters, then local,
//      then OpenAI-compatible) into a single loop over a priority-ordered
//      provider-id list. This makes change #1's claim ("Map insertion order
//      = admin priority order") actually true — previously, named adapters
//      (openai, anthropic, google, deepseek) were always inserted ahead of
//      registry-priority providers (groq, openrouter, togetherai) regardless
//      of priority_default or admin-configured priority. Ordering source:
//      config.provider_priority when present (admin priority, emitted by
//      assembleRuntimeOverrides() — Phase 3, not yet wired as of this gate),
//      else PROVIDER_REGISTRY sorted by priority_default. Per-provider
//      enabled/api_key gating and adapter construction are unchanged from
//      before this rewrite — only iteration order changed.
// ============================================================

import {
  AIRuntimeConfig, IAIRuntime, IProviderAdapter, ProviderName, FallbackRule,
} from '@brandos/contracts'

// OPENAI_COMPATIBLE_DEFS is the single source of truth for all OpenAI-compatible
// provider definitions. It is derived from PROVIDER_REGISTRY in @brandos/contracts.
// Adding a provider to PROVIDER_REGISTRY with protocol:'openai-compatible'
// automatically activates the env var loading (loader.ts) and adapter
// registration (factory.ts) without changes to either file.
import { OPENAI_COMPATIBLE_DEFS } from '@brandos/contracts'

// Phase 1 — Runtime Consolidation (Gate 1): ALL_PROVIDER_IDS gives
// buildProviders() a registry-driven default ordering (already sorted by
// priority_default ascending — see provider-registry.ts) to fall back on
// when no admin-configured order (config.provider_priority, Phase 3 — not
// yet wired) is present.
import { ALL_PROVIDER_IDS } from '@brandos/contracts'

import { Logger } from '../runtime-engine/logger'
import { RuntimeEngine, ExecutionEngine } from '../runtime-engine/index'
import { CapabilityEngine, RouterEngine } from '../router-engine/index'
import { ValidatorEngine } from '../validator-engine/index'
import { PolicyEngine } from '../policy-engine/index'
import { TelemetryEngine } from '../telemetry-engine/index'
import { CircuitBreaker, RateLimiter, CostTracker } from '../runtime-engine/resilience'
import { PromptBuilder } from '../runtime-engine/prompt-builder'
import { PluginRegistry } from '../plugins/index'

import { OpenAIAdapter }            from '../provider-adapters/openai/index'
import { AnthropicAdapter }         from '../provider-adapters/anthropic/index'
import { GoogleAdapter }            from '../provider-adapters/google/index'
import { OllamaAdapter }            from '../provider-adapters/ollama/index'
import { LMStudioAdapter }          from '../provider-adapters/lmstudio/index'
import { DeepSeekAdapter }          from '../provider-adapters/deepseek/index'
import { OpenAICompatibleAdapter }  from '../provider-adapters/openai-compatible/index'

// ─────────────────────────────────────────────────────────────
// Default Fallback Rules
//
// The runtime itself provides NO fallback rules by default.
// Fallback rules come exclusively from admin settings via
// assembleRuntimeOverrides() in control-plane-layer.
//
// An empty array means: each provider stands alone. If the primary
// provider fails in local/cloud mode, the request fails (no automatic
// cross-provider fallback). In auto mode, RouterEngine cascades through
// all registered providers in insertion order regardless of rules.
//
// This is intentional: the runtime should not make business decisions
// about which providers are acceptable fallbacks — that's the admin's choice.
// ─────────────────────────────────────────────────────────────
export function buildDefaultFallbackRules(): FallbackRule[] {
  return []
}

const DEFAULT_FALLBACK_RULES: FallbackRule[] = buildDefaultFallbackRules()

const DEFAULT_RETRY_BUDGET = {
  max_total_attempts: 3,
  max_per_provider:   2,
  backoff_ms:         500,
}

// ─────────────────────────────────────────────────────────────
// Module-Level Singletons
//
// These three resilience components survive runtime rebuilds.
// When AIRuntimeAdapter.invalidate() is called and a new RuntimeEngine
// is built, the SAME CircuitBreaker, RateLimiter, and CostTracker
// instances are reused.
//
// WHY SINGLETONS?
//   CircuitBreaker: if a provider's circuit is open due to 3 failures,
//     rebuilding the runtime (e.g. after an admin setting change) must
//     not reset the circuit. The provider is still broken.
//   RateLimiter: accumulated token counts for the current rate window
//     must not reset on config changes.
//   CostTracker: cumulative cost for the billing period must persist
//     across runtime rebuilds.
//
// CAUTION: These singletons are per-process (per-Node instance).
//   In clustered/serverless deployments, each process has its own state.
//   This is acceptable — the runtime is designed for single-process operation.
// ─────────────────────────────────────────────────────────────
const _sharedCircuitBreaker = new CircuitBreaker({ threshold: 3, reset_ms: 60_000 })
const _sharedRateLimiter    = new RateLimiter({})
const _sharedCostTracker    = new CostTracker(undefined)

// ─────────────────────────────────────────────────────────────
// AIRuntimeFactory
// ─────────────────────────────────────────────────────────────
export class AIRuntimeFactory {

  /**
   * Create a fully-wired IAIRuntime from a merged AIRuntimeConfig.
   *
   * Called by AIRuntimeAdapter.inner getter on each runtime build/rebuild.
   * All parameters come from the config — this method has no env reads.
   *
   * Wire order matters for some engines:
   *   1. Logger, Policy, FallbackRules, RetryBudget from config
   *   2. Providers Map (insertion order = priority order)
   *   3. TelemetryEngine (used by ExecutionEngine for recording)
   *   4. CapabilityEngine (providers + policy + cache TTL)
   *   5. RouterEngine (providers + rules + budget + timeouts)
   *   6. ValidatorEngine (stateless, no deps)
   *   7. PolicyEngine (policy rules)
   *   8. PromptBuilder (stateless, no deps)
   *   9. ExecutionEngine (all the above + singletons)
   *  10. RuntimeEngine (CapabilityEngine + RouterEngine + PromptBuilder + ExecutionEngine)
   *
   * @param config - Fully-assembled AIRuntimeConfig from ConfigLoader.merge().
   * @returns A new IAIRuntime instance.
   */
  static create(config: AIRuntimeConfig): IAIRuntime {
    const logger        = new Logger(config.log_level ?? 'info')
    const policy        = config.policy ?? {}
    const fallbackRules = config.fallback_rules ?? DEFAULT_FALLBACK_RULES
    const retryBudget   = config.retry_budget ?? DEFAULT_RETRY_BUDGET

    const providers = AIRuntimeFactory.buildProviders(config, logger)
    const plugins   = new PluginRegistry()

    const telemetry     = new TelemetryEngine(
      config.telemetry_sink ? [config.telemetry_sink] : [],
      logger,
    )
    const capability    = new CapabilityEngine(
      providers,
      policy,
      config.capability_cache_ttl_ms ?? 60_000,
      logger,
    )
    const router        = new RouterEngine(
      providers,
      fallbackRules,
      retryBudget,
      config.task_timeouts ?? {},
      logger,
    )
    const validator     = new ValidatorEngine()
    const policyEngine  = new PolicyEngine(policy)
    const promptBuilder = new PromptBuilder()

    const executor = new ExecutionEngine({
      providers,
      validator,
      policy:         policyEngine,
      telemetry,
      circuitBreaker: _sharedCircuitBreaker,
      rateLimiter:    _sharedRateLimiter,
      costTracker:    _sharedCostTracker,
      logger,
      backoffMs:      retryBudget.backoff_ms,
      plugins,
    })

    const runtime = new RuntimeEngine({
      providers, capability, router, promptBuilder, executor, telemetry, logger, plugins,
    })

    logger.info('AIRuntime initialized', { providers: [...providers.keys()] })
    return runtime
  }

  /**
   * Build the provider Map from the config.
   *
   * THE PROVIDER MAP IS THE PRIORITY LIST.
   * RouterEngine uses Map insertion order for provider selection in auto mode.
   * The first healthy provider in the map wins. Admin priority settings must
   * be reflected in the order providers are inserted here.
   *
   * REGISTRATION PATHS:
   *   A. Named cloud adapters (openai, anthropic, google, deepseek):
   *      These have dedicated adapter classes with protocol-specific logic.
   *      Registered first in the priority order. isKeyedEnabled() guard applied.
   *
   *   B. Local adapters (ollama, lmstudio):
   *      No API key required. enabled:true or !adminSettingsApplied registers.
   *      enabled:false always skips (admin disabled).
   *
   *   C. OpenAI-compatible providers (from OPENAI_COMPATIBLE_DEFS):
   *      Registry-driven. Adding a provider to PROVIDER_REGISTRY auto-registers
   *      it here using OpenAICompatibleAdapter. Providers in HANDLED_NATIVE_PROVIDERS
   *      are skipped to avoid duplicating dedicated adapters.
   *
   * ADMIN SETTINGS DETECTION:
   *   adminSettingsApplied = config.fallback_rules !== undefined.
   *   When true: provider must have enabled === true (strict).
   *   When false (env-only, tests): enabled !== false is sufficient.
   *   This ensures env-configured providers work without an admin setup step,
   *   while admin-disabled providers are correctly excluded.
   *
   * @param config - Merged runtime config.
   * @param logger - Logger instance for registration diagnostics.
   * @returns Ordered Map<ProviderName, IProviderAdapter>.
   */
  private static buildProviders(
    config: AIRuntimeConfig,
    logger: Logger,
  ): Map<ProviderName, IProviderAdapter> {
    const map = new Map<ProviderName, IProviderAdapter>()
    const p   = config.providers

    // adminSettingsApplied: true when assembleRuntimeOverrides() has been called.
    // Detected by whether fallback_rules is defined (always emitted by assembler).
    // When true: enabled must === true (strict check).
    // When false (env-only / test path): enabled !== false (permissive check).
    const adminSettingsApplied = config.fallback_rules !== undefined

    /**
     * Check if a cloud provider should be registered.
     * Requires: api_key present AND enabled check passes.
     */
    const isKeyedEnabled = (
      cfg: { api_key?: string; enabled?: boolean } | undefined,
    ): boolean => {
      if (!cfg?.api_key) return false
      return adminSettingsApplied ? cfg.enabled === true : cfg.enabled !== false
    }

    // ── Provider iteration order ─────────────────────────────────────────────
    // Phase 1 — Runtime Consolidation (Gate 1).
    //
    // Priority order source, highest precedence first:
    //   1. config.provider_priority — admin-configured order, emitted by
    //      assembleRuntimeOverrides() (Phase 3, NOT YET WIRED as of this gate;
    //      this field is always undefined today, so branch 2 always applies
    //      until Phase 3 lands).
    //   2. ALL_PROVIDER_IDS — already sorted by priority_default ascending
    //      at module load in provider-registry.ts (ollama=1, lmstudio=2,
    //      groq=3, openai=4, anthropic=5, google=6, deepseek=7,
    //      openrouter=8, togetherai=9).
    //
    // This replaces the previous fixed structure (named adapters first,
    // unconditionally, then local, then registry-priority order) which made
    // Map insertion order independent of priority_default and of any
    // admin-configured priority for PRIMARY selection (RouterEngine.
    // selectProvider() walks Map insertion order when no routing hint
    // resolves) — see forensic audit §D.4 / §A row 7.
    const orderedIds: string[] = config.provider_priority?.length
      ? config.provider_priority
      : ALL_PROVIDER_IDS

    // Native adapters with dedicated classes (not OpenAI-compatible generic).
    // Config shape differs slightly per adapter (e.g. GoogleAdapter takes no
    // base_url), so each keeps its own construction — unchanged from before
    // this rewrite, just relocated into the loop below.
    const buildNativeAdapter = (id: string): IProviderAdapter | null => {
      switch (id) {
        case 'openai':
          if (!isKeyedEnabled(p.openai)) return null
          return new OpenAIAdapter({
            api_key:       p.openai!.api_key!,
            base_url:      p.openai!.base_url,
            default_model: p.openai!.default_model,
          })
        case 'anthropic':
          if (!isKeyedEnabled(p.anthropic)) return null
          return new AnthropicAdapter({
            api_key:       p.anthropic!.api_key!,
            base_url:      p.anthropic!.base_url,
            default_model: p.anthropic!.default_model,
          })
        case 'google':
          if (!isKeyedEnabled(p.google)) return null
          return new GoogleAdapter({
            api_key:       p.google!.api_key!,
            default_model: p.google!.default_model,
          })
        case 'deepseek':
          if (!isKeyedEnabled(p.deepseek)) return null
          return new DeepSeekAdapter({
            api_key:       p.deepseek!.api_key!,
            default_model: p.deepseek!.default_model,
          })
        default:
          return null
      }
    }

    // Local adapters (no API key required).
    // Guard: enabled:true OR env-only context (!adminSettingsApplied).
    // enabled:false always skips — admin has explicitly disabled the provider.
    // enabled:undefined in admin context is treated as disabled (strict mode).
    const buildLocalAdapter = (id: string): IProviderAdapter | null => {
      if (id === 'ollama') {
        if (!p.ollama) return null
        const enabled = p.ollama.enabled
        if (enabled === false) return null
        if (enabled === true || !adminSettingsApplied) {
          return new OllamaAdapter({
            base_url:      p.ollama.base_url,
            default_model: p.ollama.default_model,
          })
        }
        return null
      }
      if (id === 'lmstudio') {
        if (!p.lmstudio) return null
        const enabled = p.lmstudio.enabled
        if (enabled === false) return null
        if (enabled === true || !adminSettingsApplied) {
          return new LMStudioAdapter({
            base_url:      p.lmstudio.base_url,
            default_model: p.lmstudio.default_model,
          })
        }
        return null
      }
      return null
    }

    // OpenAI-compatible providers (registry-driven: groq, openrouter,
    // togetherai, and any future protocol:'openai-compatible' registry entry).
    // HANDLED_NATIVE_PROVIDERS prevents double-registration of providers that
    // have dedicated adapter classes above. If openai or deepseek appeared in
    // OPENAI_COMPATIBLE_DEFS (because their protocol is 'openai-compatible'),
    // this would overwrite the dedicated adapter with OpenAICompatibleAdapter,
    // silently losing protocol-specific error normalisation and handling.
    const HANDLED_NATIVE_PROVIDERS = new Set([
      'openai',
      'anthropic',
      'google',
      'deepseek',
    ])

    const buildOpenAICompatibleAdapter = (
      id: string,
    ): { adapter: IProviderAdapter; displayName: string } | null => {
      if (HANDLED_NATIVE_PROVIDERS.has(id)) return null

      const def = OPENAI_COMPATIBLE_DEFS.find(d => d.id === id)
      if (!def) return null

      const provCfg = p[id as keyof typeof p] as
        | {
            api_key?: string
            base_url?: string
            default_model?: string
            enabled?: boolean
            semantic_profile?: string
          }
        | undefined

      const apiKey  = provCfg?.api_key
      const enabled = adminSettingsApplied
        ? provCfg?.enabled === true
        : provCfg?.enabled !== false

      if (!apiKey || !enabled) return null

      const adapter = new OpenAICompatibleAdapter({
        provider_name:      id as ProviderName,
        api_key:            apiKey,
        base_url:           provCfg?.base_url ?? def.defaultBaseUrl ?? '',
        default_model:      provCfg?.default_model ?? def.defaultModel,
        extra_headers:      def.extra_headers,
        cost_per_1k_tokens:  def.cost_per_1k_tokens,
        display_name:       def.name,
        semantic_profile:   provCfg?.semantic_profile ?? def.semanticProfile ?? 'generic',
      })

      return { adapter, displayName: def.name }
    }

    for (const id of orderedIds) {
      const native = buildNativeAdapter(id)
      if (native) {
        map.set(id as ProviderName, native)
        logger.info(`Registered provider: ${id}`)
        continue
      }

      const local = buildLocalAdapter(id)
      if (local) {
        map.set(id as ProviderName, local)
        logger.info(`Registered provider: ${id}`)
        continue
      }

      const compat = buildOpenAICompatibleAdapter(id)
      if (compat) {
        map.set(id as ProviderName, compat.adapter)
        logger.info(`Registered provider: ${id} (${compat.displayName})`)
      }
    }

    if (map.size === 0) {
      // All runs will fail without a provider. Log at warn (not error) because this
      // can happen legitimately during startup before env vars are populated.
      logger.warn('No providers configured — all runs will fail')
    }

    return map
  }
}


