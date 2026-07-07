/**
 * @brandos/runtime-config — validatePackage.ts
 *
 * Self-validation: produces a PackageHealthReport describing the current
 * runtime state of this package's configuration contracts.
 *
 * Used by:
 *   - repo-intelligence tooling
 *   - CI gate (package self-check)
 *   - Agentic pre-flight before modification
 *
 * This file has NO side effects. It is additive-only.
 * Depends on: RuntimeConfigSchema, DEFAULT_PROVIDERS, toAIRuntimeConfig
 *   (all from the same package — no new external dependencies).
 */

import {
  RuntimeConfigSchema,
  DEFAULT_RUNTIME_CONFIG,
  DEFAULT_PROVIDERS,
  mergeProviders,
  mergeRuntimeConfig,
  toAIRuntimeConfig,
  ProviderSettingsSchema,
} from './index'
import { runtimeCapabilityRegistry } from './RuntimeCapabilityRegistry'

// ─── PackageHealthReport ───────────────────────────────────────────────────────

export interface PackageHealthCheck {
  name: string
  passed: boolean
  detail: string
}

export interface PackageHealthReport {
  package: '@brandos/runtime-config'
  level: 'L4'
  timestamp: string
  healthy: boolean
  checks: PackageHealthCheck[]
  flaggedExports: string[]
  capabilityCount: number
  summary: string
}

// ─── Individual checks ────────────────────────────────────────────────────────

function checkDefaultConfigParseable(): PackageHealthCheck {
  try {
    const result = RuntimeConfigSchema.safeParse({})
    return {
      name: 'default_config_parseable',
      passed: result.success,
      detail: result.success
        ? 'RuntimeConfigSchema.parse({}) succeeds with all defaults'
        : `Schema parse failed: ${result.error?.message}`,
    }
  } catch (err) {
    return {
      name: 'default_config_parseable',
      passed: false,
      detail: `Unexpected error: ${String(err)}`,
    }
  }
}

function checkDefaultProvidersValid(): PackageHealthCheck {
  const invalidProviders = DEFAULT_PROVIDERS.filter(p => {
    const r = ProviderSettingsSchema.safeParse(p)
    return !r.success
  })
  return {
    name: 'default_providers_valid',
    passed: invalidProviders.length === 0,
    detail: invalidProviders.length === 0
      ? `All ${DEFAULT_PROVIDERS.length} default providers pass ProviderSettingsSchema`
      : `${invalidProviders.length} invalid default providers: ${invalidProviders.map(p => p.id).join(', ')}`,
  }
}

function checkProviderPriorityUnique(): PackageHealthCheck {
  const priorities = DEFAULT_PROVIDERS.map(p => p.priority)
  const unique = new Set(priorities)
  return {
    name: 'default_provider_priorities_unique',
    passed: unique.size === priorities.length,
    detail: unique.size === priorities.length
      ? 'All default provider priorities are unique'
      : `Duplicate priorities found: ${priorities.filter((p, i) => priorities.indexOf(p) !== i)}`,
  }
}

function checkMergeProvidersIdempotent(): PackageHealthCheck {
  try {
    const merged = mergeProviders(DEFAULT_PROVIDERS, DEFAULT_PROVIDERS)
    const passed = merged.length === DEFAULT_PROVIDERS.length
    return {
      name: 'merge_providers_idempotent',
      passed,
      detail: passed
        ? 'mergeProviders(P, P).length === P.length — idempotent'
        : `Expected ${DEFAULT_PROVIDERS.length} providers, got ${merged.length}`,
    }
  } catch (err) {
    return {
      name: 'merge_providers_idempotent',
      passed: false,
      detail: `mergeProviders threw: ${String(err)}`,
    }
  }
}

function checkMergeRuntimeConfigPreservesProviders(): PackageHealthCheck {
  try {
    const merged = mergeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, {})
    const passed = merged.providers.length === DEFAULT_RUNTIME_CONFIG.providers.length
    return {
      name: 'merge_runtime_config_preserves_providers',
      passed,
      detail: passed
        ? 'mergeRuntimeConfig(config, {}) preserves all providers'
        : `Provider count changed: ${DEFAULT_RUNTIME_CONFIG.providers.length} → ${merged.providers.length}`,
    }
  } catch (err) {
    return {
      name: 'merge_runtime_config_preserves_providers',
      passed: false,
      detail: `mergeRuntimeConfig threw: ${String(err)}`,
    }
  }
}

function checkToAIRuntimeConfigProducesValidShape(): PackageHealthCheck {
  try {
    const config = mergeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, {
      providers: [{ ...DEFAULT_PROVIDERS[0]!, enabled: true }],
    })
    const aiConfig = toAIRuntimeConfig(config, { ollama: undefined })
    const hasRetryBudget = typeof aiConfig.retry_budget?.max_total_attempts === 'number'
    const hasCircuitBreaker = typeof aiConfig.circuit_breaker?.threshold === 'number'
    const passed = hasRetryBudget && hasCircuitBreaker
    return {
      name: 'to_ai_runtime_config_shape_valid',
      passed,
      detail: passed
        ? 'toAIRuntimeConfig() produces object with retry_budget and circuit_breaker'
        : `Missing fields — retry_budget:${hasRetryBudget} circuit_breaker:${hasCircuitBreaker}`,
    }
  } catch (err) {
    return {
      name: 'to_ai_runtime_config_shape_valid',
      passed: false,
      detail: `toAIRuntimeConfig threw: ${String(err)}`,
    }
  }
}

function checkCapabilityRegistryComplete(): PackageHealthCheck {
  const registry = runtimeCapabilityRegistry
  const count = registry.keys().length
  const passed = count >= 10
  return {
    name: 'capability_registry_complete',
    passed,
    detail: passed
      ? `RuntimeCapabilityRegistry has ${count} capability entries`
      : `Only ${count} capabilities registered (expected ≥10)`,
  }
}

// ─── validatePackage ───────────────────────────────────────────────────────────

/**
 * validatePackage — run all self-checks and return a PackageHealthReport.
 *
 * This function has NO side effects. Call freely in CI or agentic preflight.
 * Returns a health report regardless of pass/fail — never throws.
 */
export function validatePackage(): PackageHealthReport {
  const checks: PackageHealthCheck[] = [
    checkDefaultConfigParseable(),
    checkDefaultProvidersValid(),
    checkProviderPriorityUnique(),
    checkMergeProvidersIdempotent(),
    checkMergeRuntimeConfigPreservesProviders(),
    checkToAIRuntimeConfigProducesValidShape(),
    checkCapabilityRegistryComplete(),
  ]

  const failed = checks.filter(c => !c.passed)
  const healthy = failed.length === 0
  const flaggedExports = runtimeCapabilityRegistry.flagged().flatMap(c => c.exports)

  return {
    package: '@brandos/runtime-config',
    level: 'L4',
    timestamp: new Date().toISOString(),
    healthy,
    checks,
    flaggedExports: [...new Set(flaggedExports)],
    capabilityCount: runtimeCapabilityRegistry.keys().length,
    summary: healthy
      ? `All ${checks.length} checks passed. Package is L4-healthy.`
      : `${failed.length}/${checks.length} checks failed: ${failed.map(c => c.name).join(', ')}`,
  }
}


