/**
 * @brandos/runtime-config — validatePackage.test.ts
 *
 * L4 test suite for runtime-config self-validation and invariant coverage.
 */

import { describe, it, expect } from 'vitest'
import {
  RuntimeConfigSchema,
  ProviderSettingsSchema,
  DEFAULT_PROVIDERS,
  DEFAULT_RUNTIME_CONFIG,
  mergeProviders,
  mergeRuntimeConfig,
  toAIRuntimeConfig,
} from '../index'
import { validatePackage } from '../validatePackage'
import { runtimeCapabilityRegistry } from '../RuntimeCapabilityRegistry'

// ─── validatePackage() ────────────────────────────────────────────────────────

describe('validatePackage()', () => {
  it('returns a healthy report for the default configuration', () => {
    const report = validatePackage()
    expect(report.package).toBe('@brandos/runtime-config')
    expect(report.level).toBe('L4')
    expect(report.healthy).toBe(true)
    expect(report.checks.every(c => c.passed)).toBe(true)
  })

  it('includes all required check names', () => {
    const report = validatePackage()
    const names = report.checks.map(c => c.name)
    expect(names).toContain('default_config_parseable')
    expect(names).toContain('default_providers_valid')
    expect(names).toContain('merge_providers_idempotent')
    expect(names).toContain('to_ai_runtime_config_shape_valid')
    expect(names).toContain('capability_registry_complete')
  })

  it('never throws', () => {
    expect(() => validatePackage()).not.toThrow()
  })
})

// ─── RuntimeConfigSchema ──────────────────────────────────────────────────────

describe('RuntimeConfigSchema', () => {
  it('parses empty input with all defaults', () => {
    const result = RuntimeConfigSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.runtimeMode).toBe('cloud')
      expect(result.data.retryCount).toBe(2)
      expect(result.data.streamingEnabled).toBe(true)
      expect(result.data.fallbackEnabled).toBe(true)
      expect(result.data.safetyMode).toBe('standard')
      expect(result.data.telemetryEnabled).toBe(true)
    }
  })

  it('rejects retryCount above 10', () => {
    const result = RuntimeConfigSchema.safeParse({ retryCount: 99 })
    expect(result.success).toBe(false)
  })

  it('accepts all valid runtimeMode values', () => {
    expect(RuntimeConfigSchema.safeParse({ runtimeMode: 'local' }).success).toBe(true)
    expect(RuntimeConfigSchema.safeParse({ runtimeMode: 'cloud' }).success).toBe(true)
  })

  it('rejects unknown runtimeMode', () => {
    expect(RuntimeConfigSchema.safeParse({ runtimeMode: 'hybrid' }).success).toBe(false)
  })
})

// ─── DEFAULT_PROVIDERS ────────────────────────────────────────────────────────

describe('DEFAULT_PROVIDERS', () => {
  it('all pass ProviderSettingsSchema validation', () => {
    for (const p of DEFAULT_PROVIDERS) {
      const result = ProviderSettingsSchema.safeParse(p)
      expect(result.success, `Provider ${p.id} failed: ${JSON.stringify(result)}`).toBe(true)
    }
  })

  it('has unique priority values', () => {
    const priorities = DEFAULT_PROVIDERS.map(p => p.priority)
    const unique = new Set(priorities)
    expect(unique.size).toBe(priorities.length)
  })

  it('includes expected provider IDs', () => {
    const ids = DEFAULT_PROVIDERS.map(p => p.id)
    expect(ids).toContain('ollama')
    expect(ids).toContain('openai')
    expect(ids).toContain('anthropic')
  })
})

// ─── mergeProviders() ─────────────────────────────────────────────────────────

describe('mergeProviders()', () => {
  it('is idempotent: merging P with P returns P.length items', () => {
    const result = mergeProviders(DEFAULT_PROVIDERS, DEFAULT_PROVIDERS)
    expect(result.length).toBe(DEFAULT_PROVIDERS.length)
  })

  it('appends new providers not in existing list', () => {
    const newProvider = { ...DEFAULT_PROVIDERS[0]!, id: 'custom', name: 'Custom', priority: 99 }
    const result = mergeProviders(DEFAULT_PROVIDERS, [newProvider])
    expect(result.length).toBe(DEFAULT_PROVIDERS.length + 1)
    expect(result.find(p => p.id === 'custom')).toBeDefined()
  })

  it('overwrites existing provider fields on merge', () => {
    const updated = { ...DEFAULT_PROVIDERS[0]!, enabled: true, health: 'healthy' as const }
    const result = mergeProviders(DEFAULT_PROVIDERS, [updated])
    const found = result.find(p => p.id === updated.id)
    expect(found?.enabled).toBe(true)
    expect(found?.health).toBe('healthy')
  })

  it('preserves providers not in the incoming list', () => {
    const result = mergeProviders(DEFAULT_PROVIDERS, [DEFAULT_PROVIDERS[0]!])
    expect(result.length).toBe(DEFAULT_PROVIDERS.length)
  })
})

// ─── mergeRuntimeConfig() ────────────────────────────────────────────────────

describe('mergeRuntimeConfig()', () => {
  it('preserves existing providers on empty patch', () => {
    const merged = mergeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, {})
    expect(merged.providers.length).toBe(DEFAULT_RUNTIME_CONFIG.providers.length)
  })

  it('overwrites scalar fields from patch', () => {
    const merged = mergeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, { runtimeMode: 'local', retryCount: 5 })
    expect(merged.runtimeMode).toBe('local')
    expect(merged.retryCount).toBe(5)
  })

  it('deep-merges providers by ID when patch includes providers', () => {
    const patch = { providers: [{ ...DEFAULT_PROVIDERS[0]!, enabled: true }] }
    const merged = mergeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, patch)
    const provider = merged.providers.find(p => p.id === DEFAULT_PROVIDERS[0]!.id)
    expect(provider?.enabled).toBe(true)
  })
})

// ─── toAIRuntimeConfig() ─────────────────────────────────────────────────────

describe('toAIRuntimeConfig()', () => {
  it('produces an object with retry_budget and circuit_breaker', () => {
    const result = toAIRuntimeConfig(DEFAULT_RUNTIME_CONFIG, {})
    expect(result.retry_budget).toBeDefined()
    expect(typeof result.retry_budget!.max_total_attempts).toBe('number')
    expect(result.circuit_breaker).toBeDefined()
    expect(typeof result.circuit_breaker!.threshold).toBe('number')
  })

  it('sets local_only when runtimeMode is local', () => {
    const config = mergeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, { runtimeMode: 'local' })
    const result = toAIRuntimeConfig(config, {})
    expect(result.policy?.local_only).toBe(true)
  })

  it('translates circuitBreakerCooldown to reset_ms in seconds', () => {
    const config = mergeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, { circuitBreakerCooldown: 30 })
    const result = toAIRuntimeConfig(config, {})
    expect(result.circuit_breaker!.reset_ms).toBe(30_000)
  })

  it('injects api_key for enabled providers', () => {
    const config = mergeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, {
      providers: [{ ...DEFAULT_PROVIDERS.find(p => p.id === 'openai')!, enabled: true }],
    })
    const result = toAIRuntimeConfig(config, { openai: 'sk-test' })
    expect(result.providers['openai']?.api_key).toBe('sk-test')
  })

  it('produces fallback_rules when fallbackEnabled and multiple enabled providers', () => {
    const config = mergeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, {
      fallbackEnabled: true,
      providers: [
        { ...DEFAULT_PROVIDERS[0]!, enabled: true, priority: 1 },
        { ...DEFAULT_PROVIDERS[1]!, enabled: true, priority: 2 },
      ],
    })
    const result = toAIRuntimeConfig(config, {})
    expect(result.fallback_rules?.length).toBeGreaterThan(0)
  })
})

// ─── RuntimeCapabilityRegistry ───────────────────────────────────────────────

describe('RuntimeCapabilityRegistry', () => {
  it('owns runtime.mode', () => {
    expect(runtimeCapabilityRegistry.owns('runtime.mode')).toBe(true)
  })

  it('owns runtime.provider', () => {
    expect(runtimeCapabilityRegistry.owns('runtime.provider')).toBe(true)
  })

  it('owns runtime.bridge', () => {
    expect(runtimeCapabilityRegistry.owns('runtime.bridge')).toBe(true)
  })

  it('has at least 10 capabilities', () => {
    expect(runtimeCapabilityRegistry.keys().length).toBeGreaterThanOrEqual(10)
  })

  it('flags toAIRuntimeConfig as zero-refs', () => {
    const flagged = runtimeCapabilityRegistry.flagged()
    const bridgeFlagged = flagged.some(c => c.exports.includes('toAIRuntimeConfig'))
    expect(bridgeFlagged).toBe(true)
  })

  it('does not own governance capabilities', () => {
    expect(runtimeCapabilityRegistry.owns('governance.policy.threshold' as never)).toBe(false)
  })
})


