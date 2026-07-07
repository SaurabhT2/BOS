/**
 * packages/control-plane-layer/src/admin/runtime-override-assembler.ts
 *
 * Phase 4: CANONICAL_MODE_TO_PROVIDER removed. Fallback rules derived from
 * enabled provider priority order (provider-to-provider), not mode strings.
 *
 * Phase 2.1: toAIRuntimePolicy() bridge wired.
 * PolicyConfig from governance-config is now translated into AIRuntimePolicy
 * and merged into every runtime config build. This is the SINGLE translation
 * point from governance policy definitions into ARL runtime enforcement.
 *
 * Data flow:
 *   AdminSettingsService.getGovernancePolicy() → PolicyConfig
 *     → toAIRuntimePolicy(policy) → AIRuntimePolicy
 *     → merged via ConfigLoader.merge() into AIRuntimeConfig.policy
 *     → consumed by PolicyEngine (local_only, blocked_providers, etc.)
 */

import type { AIRuntimeConfig, FallbackRule, ProviderName, RetryBudget } from '@brandos/contracts'
import { ALL_PROVIDER_IDS } from '@brandos/contracts'
import { AdminSettingsService } from './settings-service'
import { toAIRuntimePolicy, DEFAULT_POLICY_CONFIG } from '@brandos/governance-config'

const ALL_KNOWN_PROVIDERS: ProviderName[] = ALL_PROVIDER_IDS as ProviderName[]

export function assembleRuntimeOverrides(): Partial<AIRuntimeConfig> {
  const rt = AdminSettingsService.getAIRuntime()

  const enabledOrdered = [...rt.providers]
    .filter(p => p.enabled)
    .sort((a, b) => a.priority - b.priority)

  console.info('[RuntimeOverrides] assembling', {
    runtimeMode:      rt.runtimeMode,
    enabledProviders: enabledOrdered.map(p => `${p.id}(p${p.priority})`),
    fallbackEnabled:  rt.fallbackEnabled,
    retryCount:       rt.retryCount,
    circuitBreaker:   `${rt.circuitBreakerCooldown}s`,
  })

  // ── Provider enable/disable ───────────────────────────────────────────────
  const providers: AIRuntimeConfig['providers'] = {}

  for (const name of ALL_KNOWN_PROVIDERS) {
    providers[name] = { enabled: false }
  }

  for (const p of enabledOrdered) {
    providers[p.id as ProviderName] = {
      enabled: true,
      // Sprint A — Obj 2: propagate admin-selected model to adapter config.
      // Without this the adapter always falls back to the env-sourced default.
      ...(p.defaultModel ? { default_model: p.defaultModel } : {}),
      // Carry through timeout override when set
      ...(p.timeout ? { timeout_ms: p.timeout } : {}),
    }
  }

  // ── Retry budget ──────────────────────────────────────────────────────────
  const retryBudget: RetryBudget = {
    max_total_attempts: rt.retryCount + 1,
    max_per_provider:   2,
    backoff_ms:         500,
  }

  // ── Fallback rules — provider-to-provider in priority order ───────────────
  // No mode-string lookup. The cascade is implicit in provider insertion order.
  // Explicit fallback rules are generated only when fallbackEnabled is true,
  // linking each enabled provider to the next one in priority order.
  const fallbackRules: FallbackRule[] = rt.fallbackEnabled
    ? enabledOrdered.slice(1).map((p, i) => ({
        trigger:       'provider_error' as const,
        from_provider: enabledOrdered[i]!.id as ProviderName,
        to_provider:   p.id as ProviderName,
        to_mode:       'auto' as const,
        max_attempts:  1,
      }))
    : []

  // ── Timeouts ──────────────────────────────────────────────────────────────
  const taskTimeouts: Partial<Record<string, number>> = {
    chat:              rt.cloudTimeout,
    post:              rt.cloudTimeout,
    carousel:          Math.max(rt.localTimeout, rt.cloudTimeout) + 15_000,
    generate_carousel: Math.max(rt.localTimeout, rt.cloudTimeout) + 15_000,
    deck:              Math.max(rt.localTimeout, rt.cloudTimeout) + 15_000,
    generate_deck:     Math.max(rt.localTimeout, rt.cloudTimeout) + 15_000,
    report:            Math.max(rt.localTimeout, rt.cloudTimeout) + 10_000,
    generate_report:   Math.max(rt.localTimeout, rt.cloudTimeout) + 10_000,
    local:             rt.localTimeout,
    image_analysis:    rt.cloudTimeout + 20_000,
  }

  // ── Circuit breaker ───────────────────────────────────────────────────────
  const circuitBreaker = {
    threshold: 3,
    reset_ms:  rt.circuitBreakerCooldown * 1_000,
  }

  // ── Phase 2.1: Governance → Runtime Policy Bridge ─────────────────────────
  // Translate the active PolicyConfig from governance-config into AIRuntimePolicy.
  // This is the single wiring point from governance definitions to ARL enforcement.
  //
  // HIGH-001 FIX: replaced `(AdminSettingsService as any).getGovernancePolicy?.()`
  // with a direct `AdminSettingsService.getGovernancePolicy()` call. The safe-navigation
  // always evaluated to undefined (method did not exist), causing the runtime to always
  // fall back to DEFAULT_POLICY_CONFIG regardless of saved governance settings.
  // Now calls the real method which reads from _governancePolicyStore (populated by
  // hydrateGovernance() on startup load and on save).
  let runtimePolicy: AIRuntimeConfig['policy'] = {}
  try {
    const governancePolicy = AdminSettingsService.getGovernancePolicy()
    runtimePolicy = toAIRuntimePolicy(governancePolicy)
  } catch {
    // Non-fatal: if governance policy translation fails, ARL uses env-based policy only
    runtimePolicy = toAIRuntimePolicy(DEFAULT_POLICY_CONFIG)
  }

  // Phase 3 — Runtime Consolidation: emit provider_priority so that
  // AIRuntimeFactory.buildProviders() (Phase 1) uses the admin-configured
  // priority order for Map insertion, making the factory truly data-driven.
  //
  // `enabledOrdered` is already sorted ascending by admin `priority` (see above).
  // Mapping to id[] gives the factory the ordered list it needs.
  //
  // Flow after this change:
  //   Admin Runtime Settings → assembleRuntimeOverrides() → AIRuntimeConfig.provider_priority
  //   → AIRuntimeFactory.buildProviders() → Map insertion order
  //   → RouterEngine.selectProvider() (first healthy = highest-priority admin choice)
  const provider_priority: string[] = enabledOrdered.map(p => p.id)

  return {
    providers,
    retry_budget:      retryBudget,
    fallback_rules:    fallbackRules,
    task_timeouts:     taskTimeouts as any,
    circuit_breaker:   circuitBreaker,
    policy:            runtimePolicy,
    provider_priority,
  }
}

export function makeRuntimeConfigProvider(): () => Partial<AIRuntimeConfig> {
  return assembleRuntimeOverrides
}


