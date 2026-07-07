// ============================================================
// packages/ai-runtime-layer/src/router-engine/index.ts
//
// CAPABILITY ENGINE & ROUTER ENGINE
//
// This file contains two classes:
//
//   CapabilityEngine — Detects which providers and modes are available.
//                      Health-checks all registered providers in parallel.
//                      Results are cached (default 60s TTL).
//                      Policy restrictions (local_only, blocked_providers)
//                      are applied to the available mode set.
//
//   RouterEngine     — Given capabilities, selects the primary provider
//                      and builds a fallback chain for an InvocationRequest.
//                      Applies routing hints (preferred_tiers, forceProvider).
//                      Enforces LOCAL/CLOUD mode isolation (no cross-boundary
//                      fallback unless mode is 'auto').
//
// TWO-MODE EXECUTION (Phase 5):
//   local: Only LOCAL_PROVIDERS (ollama, lmstudio). Explicit failure if none healthy.
//          No cloud fallback.
//   cloud: Only providers NOT in LOCAL_PROVIDERS. Explicit failure if none healthy.
//          No local fallback.
//   auto:  All providers in Map insertion order (= admin priority order). Full cascade.
//
// Removed in Phase 5: cloud_free, cloud_pro, enterprise_private, custom_provider modes.
// ============================================================

import type {
  AIRuntimePolicy,
  CapabilityCheckOptions,
  CapabilityResult,
  ExecutionMode,
  ExecutionPlan,
  FallbackRule,
  ICapabilityEngine,
  IProviderAdapter,
  IRouterEngine,
  InvocationRequest,
  ProviderCapabilityStatus,
  ProviderName,
  RetryBudget,
  InvocationType,
} from '@brandos/contracts'
import { isLocalProvider } from '@brandos/contracts'
import { Logger } from '../runtime-engine/logger'

// ─────────────────────────────────────────────────────────────
// CapabilityEngine
//
// Detects provider health in parallel and computes available modes.
// Results are cached to avoid N health-checks on every invocation.
//
// CACHE BEHAVIOUR:
//   - Cache TTL: 60s by default (config.capability_cache_ttl_ms).
//   - force_refresh: true bypasses the cache (e.g. admin "check now" button).
//   - Cached results are marked with cached: true in the result.
//
// AVAILABLE MODES:
//   A mode is available if at least one provider that supports it is healthy.
//   'auto' is added whenever any mode is available.
//   Policy-restricted modes are removed from the final list.
// ─────────────────────────────────────────────────────────────

const DEFAULT_HEALTH_TIMEOUT_MS = 3000  // Per-provider health check timeout
const DEFAULT_CACHE_TTL_MS      = 60_000 // Capability cache TTL

export class CapabilityEngine implements ICapabilityEngine {
  private cache:          CapabilityResult | null = null
  private readonly cacheTtlMs: number
  private readonly logger:     Logger

  constructor(
    private readonly providers: Map<ProviderName, IProviderAdapter>,
    private readonly policy:    AIRuntimePolicy,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    logger?:    Logger,
  ) {
    this.cacheTtlMs = cacheTtlMs
    this.logger     = (logger ?? new Logger('info')).child('CapabilityEngine')
  }

  /**
   * Detect which execution modes and providers are currently available.
   *
   * FLOW:
   *   1. Check cache (return early if valid and not force_refresh).
   *   2. Health-check all providers in parallel (with timeout).
   *   3. Compute available modes from healthy providers' supportedModes.
   *   4. Apply policy restrictions (local_only, allowed_modes).
   *   5. Pick a recommended mode (priority: local > cloud > auto).
   *   6. Cache and return the result.
   *
   * @param options - Detection options (force_refresh, timeout_ms, include_providers).
   */
  async detect(options: CapabilityCheckOptions = {}): Promise<CapabilityResult> {
    const now          = Date.now()
    const forceRefresh = options.force_refresh ?? false

    // Return cached result if still within TTL and not forced.
    if (!forceRefresh && this.cache && now - this.cache.checked_at < this.cacheTtlMs) {
      this.logger.debug('Cache hit', { age_ms: now - this.cache.checked_at })
      return { ...this.cache, cached: true }
    }

    this.logger.info('Running capability detection', {
      providerCount: this.providers.size,
      providers:     [...this.providers.keys()],
    })

    const timeout  = options.timeout_ms ?? DEFAULT_HEALTH_TIMEOUT_MS
    const statuses: Partial<Record<ProviderName, ProviderCapabilityStatus>> = {}

    // Health-check all providers in parallel.
    // Each check is independent — a failure in one does not affect others.
    const checks = [...this.providers.entries()].map(async ([name, adapter]) => {
      // Skip providers not in the include list (when specified).
      if (options.include_providers && !options.include_providers.includes(name)) return

      // Policy-blocked providers are marked unavailable without a network call.
      if (this.policy.blocked_providers?.includes(name)) {
        statuses[name] = {
          available:  false,
          healthy:    false,
          reason:     'blocked_by_policy',
          checked_at: now,
        }
        return
      }

      try {
        statuses[name] = await adapter.healthCheck(timeout)
        this.logger.debug(`${name} health`, statuses[name])
      } catch (err) {
        // Health check threw — provider is considered unhealthy.
        // This should not happen (adapters should return available:false on failure)
        // but is a safety net for poorly implemented adapters.
        statuses[name] = {
          available:  false,
          healthy:    false,
          reason:     `health_check_threw: ${(err as Error).message}`,
          checked_at: now,
        }
      }
    })

    await Promise.all(checks)

    const availableModes   = this.computeAvailableModes(statuses)
    const policyRestricted = this.computePolicyRestricted(availableModes)
    const finalModes       = availableModes.filter(m => !policyRestricted.includes(m))
    const recommended      = this.pickRecommended(finalModes)

    const result: CapabilityResult = {
      available_modes:          finalModes,
      recommended_mode:         recommended,
      providers:                statuses,
      policy_restricted_modes:  policyRestricted,
      cached:                   false,
      checked_at:               now,
    }

    this.cache = result

    this.logger.info('Detection complete', {
      available_modes:   finalModes,
      recommended,
      healthy_providers: Object.entries(statuses)
        .filter(([, s]) => s?.healthy)
        .map(([n]) => n),
    })

    return result
  }

  /**
   * Manually invalidate the capability cache.
   * The next detect() call will perform a fresh health check.
   * Called after provider registration changes.
   */
  invalidateCache(): void {
    this.cache = null
    this.logger.debug('Cache invalidated')
  }

  /**
   * Compute available execution modes from provider health statuses.
   *
   * A mode is available if at least one healthy provider supports it.
   * 'auto' is added whenever at least one mode is available.
   *
   * @param statuses - Health status per provider from parallel health checks.
   * @returns Set of available execution modes.
   */
  private computeAvailableModes(
    statuses: Partial<Record<ProviderName, ProviderCapabilityStatus>>,
  ): ExecutionMode[] {
    const modes = new Set<ExecutionMode>()
    for (const [name, status] of Object.entries(statuses) as [ProviderName, ProviderCapabilityStatus][]) {
      if (!status.available || !status.healthy) continue
      const adapter = this.providers.get(name)
      if (!adapter) continue
      for (const mode of adapter.supportedModes) modes.add(mode)
    }
    // 'auto' is only available when at least one other mode is available.
    if (modes.size > 0) modes.add('auto')
    return [...modes]
  }

  /**
   * Compute which available modes are restricted by policy.
   *
   * local_only or no_external_providers: all non-local, non-auto modes restricted.
   * allowed_modes: all modes not in the allowlist are restricted (auto exempt).
   *
   * @param modes - Available modes before policy filtering.
   * @returns Modes that should be excluded from the final available_modes list.
   */
  private computePolicyRestricted(modes: ExecutionMode[]): ExecutionMode[] {
    const restricted: ExecutionMode[] = []
    if (this.policy.local_only || this.policy.no_external_providers) {
      for (const m of modes) if (m !== 'local' && m !== 'auto') restricted.push(m)
    }
    if (this.policy.allowed_modes) {
      for (const m of modes) {
        if (!this.policy.allowed_modes.includes(m) && m !== 'auto') restricted.push(m)
      }
    }
    return [...new Set(restricted)]
  }

  /**
   * Pick the recommended mode from the available list.
   *
   * Priority: local > cloud > auto (prefer local for privacy/cost, then cloud, then auto).
   * Falls back to the first available mode, then 'auto' as last resort.
   *
   * @param modes - Final available modes after policy filtering.
   */
  private pickRecommended(modes: ExecutionMode[]): ExecutionMode {
    const priority: ExecutionMode[] = ['local', 'cloud', 'auto']
    for (const m of priority) if (modes.includes(m)) return m
    return modes[0] ?? 'auto'
  }
}

// ─────────────────────────────────────────────────────────────
// RouterEngine
//
// Builds an ExecutionPlan from an InvocationRequest and CapabilityResult.
// Selects the primary provider and constructs the fallback chain.
//
// KEY INVARIANTS:
//   - LOCAL mode: only LOCAL_PROVIDERS. Explicit null if none healthy.
//     No cloud providers enter the plan or fallback chain.
//   - CLOUD mode: only non-LOCAL_PROVIDERS. Explicit null if none healthy.
//     No local providers enter the plan or fallback chain.
//   - AUTO mode: all providers in Map insertion order. Cascade from primary
//     through all subsequent healthy providers.
//   - forceProvider: only honoured in non-production environments.
//     Dev/staging routing hint for testing specific providers.
//
// COST ESTIMATION:
//   PROVIDER_COST values are approximate per-1k-token rates.
//   These are used for estimated_cost_usd in the ExecutionPlan only.
//   Actual billing is tracked by CostTracker.
// ─────────────────────────────────────────────────────────────

// LOCAL_PROVIDERS — sourced from @brandos/contracts/provider-registry (isLocalProvider)
// Use isLocalProvider(name) to classify a provider as local vs cloud.

/**
 * Default timeouts per InvocationType (milliseconds).
 *
 * These are the MINIMUM timeouts. Admin settings can override via
 * config.task_timeouts (passed to RouterEngine constructor).
 *
 * Longer timeouts for article/report/generate types because LLMs produce
 * more tokens and network latency scales with output size.
 */
const DEFAULT_TIMEOUTS_MS: Partial<Record<InvocationType, number>> = {
  chat:             15_000,
  post:             10_000,
  article:          60_000,
  carousel:         20_000,
  analyze:          30_000,
  json:             15_000,
  image_analysis:   20_000,
  code:             30_000,
  summarize:        20_000,
  classify:          8_000,
  embed:             5_000,
  generate_deck:    45_000, // Structured deck generation — large JSON output
  generate_carousel: 30_000, // Structured carousel — medium JSON output
  generate_report:  60_000, // Report generation — longest structured output
}

const DEFAULT_RETRY_BUDGET: RetryBudget = {
  max_total_attempts: 3,
  max_per_provider:   2,
  backoff_ms:         500,
}

/**
 * Approximate cost in USD per 1,000 tokens.
 * Used ONLY for estimated_cost_usd in ExecutionPlan.
 * Actual cost tracking is done by CostTracker in ExecutionEngine.
 */
const PROVIDER_COST: Partial<Record<ProviderName, number>> = {
  openai:    0.00015,
  anthropic: 0.00025,
  google:    0.0001,
  ollama:    0,       // Local — no API cost
  lmstudio:  0,       // Local — no API cost
  deepseek:  0.00014,
  groq:      0,       // Has free tier; use 0 as conservative estimate
  custom:    0.0002,
}

export class RouterEngine implements IRouterEngine {
  private readonly logger: Logger

  constructor(
    private readonly providers:    Map<ProviderName, IProviderAdapter>,
    private readonly fallbackRules: FallbackRule[],
    private readonly retryBudget:  RetryBudget = DEFAULT_RETRY_BUDGET,
    private readonly taskTimeouts: Partial<Record<InvocationType, number>> = {},
    logger?: Logger,
  ) {
    this.logger = (logger ?? new Logger('info')).child('RouterEngine')
  }

  /**
   * Build an ExecutionPlan for the given request and capability snapshot.
   *
   * PLAN COMPONENTS:
   *   primary_provider: The first provider to try.
   *   primary_mode:     The resolved execution mode.
   *   fallback_chain:   Ordered list of {provider, mode} to try if primary fails.
   *   retry_budget:     Total number of attempts across all providers.
   *   timeout_ms:       Per-attempt timeout (resolved from task type).
   *   estimated_cost_usd: Approximate cost for telemetry/display.
   *
   * @param request    - The InvocationRequest from the caller.
   * @param capability - Fresh or cached CapabilityResult from CapabilityEngine.
   */
  buildPlan(request: InvocationRequest, capability: CapabilityResult): ExecutionPlan {
    const hint = request.routing_hint

    // ── forceProvider (dev/staging only) ──────────────────────────────────────
    // Bypasses normal mode and provider selection. Used for manual testing and
    // request tracing. Blocked in production to prevent routing manipulation.
    if (hint?.forceProvider && process.env.NODE_ENV !== 'production') {
      const forced   = hint.forceProvider as ProviderName
      if (this.providers.has(forced)) {
        const forceMode: ExecutionMode = isLocalProvider(forced) ? 'local' : 'cloud'
        const timeout = this.resolveTimeout(request)
        this.logger.info('[forceProvider] applied', { provider: forced, mode: forceMode })
        return {
          primary_provider:     forced,
          primary_mode:         forceMode,
          fallback_chain:       [], // No fallbacks for forced routing
          estimated_latency_ms: capability.providers[forced]?.latency_ms ?? 2000,
          estimated_cost_usd:   this.estimateCost(forced, request.output_schema?.max_tokens ?? 512),
          retry_budget:         1,  // Forced = single attempt
          timeout_ms:           timeout,
        }
      }
      this.logger.warn('[forceProvider] provider not registered — falling through', { provider: forced })
    }

    // ── Normal routing ────────────────────────────────────────────────────────
    const mode    = this.resolveMode(request, capability)
    const primary = this.selectProvider(mode, capability, request.routing_hint?.preferred_provider)

    // No healthy provider for this mode — return an empty plan.
    // ExecutionEngine will return terminal_failure for retry_budget: 0.
    if (!primary) {
      this.logger.warn('[RouterEngine] no healthy provider', {
        mode,
        registered: [...this.providers.keys()],
        healthy: Object.entries(capability.providers)
          .filter(([, s]) => s?.healthy)
          .map(([n]) => n),
      })
      return {
        primary_provider:     'unknown' as ProviderName,
        primary_mode:         mode,
        fallback_chain:       [],
        estimated_latency_ms: 0,
        estimated_cost_usd:   0,
        retry_budget:         0,
        timeout_ms:           this.resolveTimeout(request),
      }
    }

    const fallbackChain = this.buildFallbackChain(primary, mode, capability)
    const timeout       = this.resolveTimeout(request)
    const cost          = this.estimateCost(primary, request.output_schema?.max_tokens ?? 512)

    const plan: ExecutionPlan = {
      primary_provider:     primary,
      primary_mode:         mode,
      fallback_chain:       fallbackChain,
      estimated_latency_ms: capability.providers[primary]?.latency_ms ?? 2000,
      estimated_cost_usd:   cost,
      retry_budget:         this.retryBudget.max_total_attempts,
      timeout_ms:           timeout,
    }

    this.logger.info('[RouterEngine] Plan', {
      provider:     primary,
      mode,
      fallbacks:    fallbackChain.map(f => f.provider),
      timeout_ms:   timeout,
      hint_applied: !!hint,
    })

    return plan
  }

  /**
   * Resolve the execution mode for this request.
   *
   * PRIORITY ORDER:
   *   1. Routing hint preferred_tiers (dev/staging testing)
   *   2. max_cost_usd === 0 → prefer local (free), then cloud
   *   3. quality_target === 'best' → prefer cloud (higher capability)
   *   4. quality_target === 'fast' → prefer local (lower latency)
   *   5. request.preferred_mode (explicit caller preference)
   *   6. capability.recommended_mode (CapabilityEngine's suggestion)
   *
   * @param request    - The caller's InvocationRequest.
   * @param capability - Current CapabilityResult.
   */
  private resolveMode(request: InvocationRequest, capability: CapabilityResult): ExecutionMode {
    const hint = request.routing_hint

    // Routing hint: try each preferred tier in order.
    if (hint?.preferred_tiers?.length) {
      for (const tier of hint.preferred_tiers) {
        const mode = tier as ExecutionMode
        if (capability.available_modes.includes(mode)) {
          this.logger.debug('[RouterEngine] Mode from hint', { mode })
          return mode
        }
      }
    }

    // Cost target: zero cost → local preferred (free local models).
    if (request.max_cost_usd === 0) {
      if (capability.available_modes.includes('local')) return 'local'
      if (capability.available_modes.includes('cloud')) return 'cloud'
    }

    // Quality target: best → cloud (more capable models).
    if (request.quality_target === 'best') {
      if (capability.available_modes.includes('cloud')) return 'cloud'
    }

    // Quality target: fast → local (lower network latency).
    if (request.quality_target === 'fast') {
      if (capability.available_modes.includes('local')) return 'local'
    }

    // Explicit preferred mode from caller.
    if (request.preferred_mode) {
      if (
        request.preferred_mode === 'auto' ||
        capability.available_modes.includes(request.preferred_mode)
      ) {
        this.logger.debug('[RouterEngine] Mode from preferred_mode', { mode: request.preferred_mode })
        return request.preferred_mode
      }
    }

    // Fall through to capability recommendation.
    this.logger.debug('[RouterEngine] Mode from recommended', { mode: capability.recommended_mode })
    return capability.recommended_mode
  }

  /**
   * Select the primary provider for the given mode.
   *
   * AUTO:  Iterate all registered providers in Map insertion order
   *        (= admin priority order). Return the first healthy one.
   *
   * LOCAL: Only LOCAL_PROVIDERS. Explicit null if none healthy.
   *        Never falls back to cloud providers.
   *
   * CLOUD: Only providers NOT in LOCAL_PROVIDERS. Explicit null if none healthy.
   *        Never falls back to local providers.
   *
   * @param mode       - Resolved execution mode.
   * @param capability - Current capability result with provider statuses.
   * @returns The selected ProviderName, or null if no healthy provider found.
   */
  private selectProvider(
    mode:              ExecutionMode,
    capability:        CapabilityResult,
    preferredProvider?: ProviderName,
  ): ProviderName | null {
    // P3 — W9: if a preferred provider is specified, healthy, and compatible
    // with the resolved mode, try it first before falling back to insertion order.
    if (preferredProvider && this.providers.has(preferredProvider)) {
      const s = capability.providers[preferredProvider]
      const compatibleMode =
        mode === 'auto' ||
        (mode === 'local'  && isLocalProvider(preferredProvider)) ||
        (mode === 'cloud'  && !isLocalProvider(preferredProvider))
      if (compatibleMode && s?.available && s?.healthy) {
        this.logger.debug('[RouterEngine] preferred_provider applied', { provider: preferredProvider })
        return preferredProvider
      }
      // Preferred provider unhealthy or mode-incompatible — fall through to normal selection.
      this.logger.debug('[RouterEngine] preferred_provider unavailable, falling through', {
        provider: preferredProvider,
        healthy: s?.healthy,
        compatible: compatibleMode,
      })
    }

    if (mode === 'auto') {
      // Walk providers in insertion order (= admin priority order).
      for (const [name] of this.providers) {
        const s = capability.providers[name as ProviderName]
        if (s?.available && s?.healthy) {
          this.logger.debug('[RouterEngine] Auto: selected', { provider: name })
          return name as ProviderName
        }
      }
      return null
    }

    if (mode === 'local') {
      // LOCAL mode: only try local providers. No cross-boundary fallback.
      for (const [name] of this.providers) {
        if (!isLocalProvider(name as ProviderName)) continue
        const s = capability.providers[name as ProviderName]
        if (s?.available && s?.healthy) return name as ProviderName
      }
      return null // Explicit failure — user asked for local, no local available.
    }

    if (mode === 'cloud') {
      // CLOUD mode: only try cloud providers. No cross-boundary fallback.
      for (const [name] of this.providers) {
        if (isLocalProvider(name as ProviderName)) continue
        const s = capability.providers[name as ProviderName]
        if (s?.available && s?.healthy) return name as ProviderName
      }
      return null // Explicit failure — user asked for cloud, no cloud available.
    }

    // Unknown mode — treat as auto for forward compatibility.
    for (const [name] of this.providers) {
      const s = capability.providers[name as ProviderName]
      if (s?.available && s?.healthy) return name as ProviderName
    }
    return null
  }

  /**
   * Build the fallback chain for a primary provider and mode.
   *
   * AUTO:  All healthy providers after the primary in Map insertion order.
   *        No mode restrictions — auto cascades across all providers.
   *        Capped at 5 fallbacks.
   *
   * LOCAL: Only LOCAL_PROVIDERS after the primary in insertion order.
   *        Cloud providers never enter the chain.
   *
   * CLOUD: Only non-LOCAL_PROVIDERS after the primary in insertion order.
   *        Local providers never enter the chain.
   *
   * RULE-BASED (when fallback_rules is non-empty):
   *   Rules are evaluated in order. A rule matches when:
   *     - from_provider matches primary (or rule has no from_provider constraint)
   *     - from_mode matches primaryMode (or rule has no from_mode constraint)
   *     - to_provider is in the correct mode group (localOnly/cloudOnly respected)
   *     - to_provider is healthy
   *   Each provider appears at most once in the chain.
   *
   * @param primary     - The primary provider name.
   * @param primaryMode - The execution mode for this plan.
   * @param capability  - Current capability result.
   */
  private buildFallbackChain(
    primary:     ProviderName,
    primaryMode: ExecutionMode,
    capability:  CapabilityResult,
  ): Array<{ provider: ProviderName; mode: ExecutionMode }> {

    if (primaryMode === 'auto') {
      // AUTO: cascade through all healthy providers after the primary.
      const chain: Array<{ provider: ProviderName; mode: ExecutionMode }> = []
      let primarySeen = false

      for (const [name] of this.providers) {
        if (name === primary) { primarySeen = true; continue }
        if (!primarySeen) continue // Skip providers before the primary

        const s = capability.providers[name as ProviderName]
        if (s?.available && s?.healthy) {
          chain.push({ provider: name as ProviderName, mode: 'auto' })
        }
      }

      this.logger.debug('[RouterEngine] Auto cascade chain', {
        primary,
        fallbacks: chain.map(c => c.provider),
      })
      return chain.slice(0, 5) // Cap at 5 to bound total request duration
    }

    // RULE-BASED: use admin-configured fallback rules.
    // Empty rules = empty chain (each provider stands alone in local/cloud modes).
    if (this.fallbackRules.length === 0) return []

    const localOnly = primaryMode === 'local'
    const cloudOnly = primaryMode === 'cloud'
    const chain: Array<{ provider: ProviderName; mode: ExecutionMode }> = []

    for (const rule of this.fallbackRules) {
      // Filter rules: must match primary provider and mode constraints.
      if (rule.from_provider && rule.from_provider !== primary) continue
      if (rule.from_mode    && rule.from_mode    !== primaryMode) continue

      // Enforce mode isolation: local rules stay local, cloud rules stay cloud.
      if (localOnly && !isLocalProvider(rule.to_provider)) continue
      if (cloudOnly &&  isLocalProvider(rule.to_provider)) continue

      const s = capability.providers[rule.to_provider]
      if (s?.available && s?.healthy) {
        // Deduplicate: each provider appears at most once in the chain.
        if (!chain.some(c => c.provider === rule.to_provider)) {
          chain.push({ provider: rule.to_provider, mode: rule.to_mode })
        }
      }
    }

    return chain.slice(0, 5) // Cap at 5
  }

  /**
   * Resolve the timeout for a given request.
   *
   * Priority:
   *   1. request.latency_target_ms — caller-specified deadline
   *   2. config.task_timeouts[task_type] — admin override per task type
   *   3. DEFAULT_TIMEOUTS_MS[task_type] — built-in default per task type
   *   4. 15_000ms — fallback default
   *
   * @param request - The InvocationRequest.
   * @returns Timeout in milliseconds.
   */
  private resolveTimeout(request: InvocationRequest): number {
    if (request.latency_target_ms) return request.latency_target_ms
    return (
      this.taskTimeouts[request.task_type] ??
      DEFAULT_TIMEOUTS_MS[request.task_type] ??
      15_000
    )
  }

  /**
   * Estimate the USD cost for a provider + token count.
   *
   * Used for ExecutionPlan.estimated_cost_usd (display/logging only).
   * Actual billing is tracked by CostTracker in ExecutionEngine.
   *
   * @param provider - Provider name.
   * @param tokens   - Estimated output token count.
   */
  private estimateCost(provider: ProviderName, tokens: number): number {
    return (tokens / 1000) * (PROVIDER_COST[provider] ?? 0.0002)
  }
}


