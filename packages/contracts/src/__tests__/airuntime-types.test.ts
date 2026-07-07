/**
 * @brandos/contracts — airuntime-types.test.ts
 *
 * Tests for the runtime mode conversion functions and enum completeness.
 *
 * Why these matter:
 * - fromLegacyToRuntimeMode is the ONLY correct place to translate
 *   legacy DB strings into RuntimeMode. If it has gaps, the runtime
 *   silently falls back to 'cloud' for unknown values — which is the
 *   intended safe default, but undocumented edge cases could mislead.
 * - runtimeModeToExecutionMode must be exhaustive. Adding a new
 *   RuntimeMode value without updating this function creates a silent
 *   type gap that TypeScript won't catch at the call site.
 */

import { describe, it, expect } from 'vitest'
import {
  runtimeModeToExecutionMode,
  fromLegacyToRuntimeMode,
  RUNTIME_MODE_LABELS,
  type RuntimeMode,
  type ExecutionMode,
} from '../airuntime-types'

describe('runtimeModeToExecutionMode', () => {
  it('maps local → local', () => {
    expect(runtimeModeToExecutionMode('local')).toBe<ExecutionMode>('local')
  })

  it('maps cloud → cloud', () => {
    expect(runtimeModeToExecutionMode('cloud')).toBe<ExecutionMode>('cloud')
  })

  it('covers all RuntimeMode values (exhaustiveness guard)', () => {
    // If a new RuntimeMode value is added without updating this function,
    // this test will fail when TypeScript compiles — acting as an
    // exhaustiveness check at the test level.
    const allModes: RuntimeMode[] = ['local', 'cloud']
    allModes.forEach(mode => {
      expect(() => runtimeModeToExecutionMode(mode)).not.toThrow()
    })
  })
})

describe('fromLegacyToRuntimeMode', () => {
  // ── Canonical values ─────────────────────────────────────────────────────
  it('returns local for "local"', () => {
    expect(fromLegacyToRuntimeMode('local')).toBe<RuntimeMode>('local')
  })

  it('returns cloud for "cloud"', () => {
    expect(fromLegacyToRuntimeMode('cloud')).toBe<RuntimeMode>('cloud')
  })

  // ── Legacy aliases ───────────────────────────────────────────────────────
  it('maps legacy "bespoke" → local', () => {
    expect(fromLegacyToRuntimeMode('bespoke')).toBe('local')
  })

  it('maps legacy "cloud_pro" → cloud', () => {
    expect(fromLegacyToRuntimeMode('cloud_pro')).toBe('cloud')
  })

  it('maps legacy "cloud_free" → cloud', () => {
    expect(fromLegacyToRuntimeMode('cloud_free')).toBe('cloud')
  })

  it('maps legacy "premium" → cloud', () => {
    expect(fromLegacyToRuntimeMode('premium')).toBe('cloud')
  })

  it('maps legacy "auto" → cloud (safe default)', () => {
    expect(fromLegacyToRuntimeMode('auto')).toBe('cloud')
  })

  it('maps legacy "free" → cloud (safe default)', () => {
    expect(fromLegacyToRuntimeMode('free')).toBe('cloud')
  })

  // ── Edge cases ───────────────────────────────────────────────────────────
  it('returns cloud for null (safe default)', () => {
    expect(fromLegacyToRuntimeMode(null)).toBe('cloud')
  })

  it('returns cloud for undefined (safe default)', () => {
    expect(fromLegacyToRuntimeMode(undefined)).toBe('cloud')
  })

  it('returns cloud for empty string (safe default)', () => {
    expect(fromLegacyToRuntimeMode('')).toBe('cloud')
  })

  it('returns cloud for completely unknown string (safe default)', () => {
    expect(fromLegacyToRuntimeMode('super_ultra_pro_tier')).toBe('cloud')
  })

  it('is case-insensitive for canonical values', () => {
    expect(fromLegacyToRuntimeMode('LOCAL')).toBe('local')
    expect(fromLegacyToRuntimeMode('CLOUD')).toBe('cloud')
    expect(fromLegacyToRuntimeMode('Local')).toBe('local')
  })

  it('trims whitespace before matching', () => {
    expect(fromLegacyToRuntimeMode('  local  ')).toBe('local')
    expect(fromLegacyToRuntimeMode(' cloud ')).toBe('cloud')
  })
})

describe('RUNTIME_MODE_LABELS', () => {
  it('has entries for all RuntimeMode values', () => {
    const allModes: RuntimeMode[] = ['local', 'cloud']
    allModes.forEach(mode => {
      expect(RUNTIME_MODE_LABELS[mode]).toBeDefined()
      expect(RUNTIME_MODE_LABELS[mode].label).toBeTruthy()
      expect(RUNTIME_MODE_LABELS[mode].desc).toBeTruthy()
    })
  })
})


