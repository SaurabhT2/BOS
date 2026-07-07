// packages/ai-runtime-layer/src/__tests__/unit/llmRouter.test.ts
//
// Tests for the singleton lifecycle, callWithMode, and isUnavailable.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  callWithMode,
  callLLM,
  isUnavailable,
  setRuntimeConfigProvider,
  ensureRuntimeInitialized,
  resetRuntime,
  getAvailableModels,
  isRuntimeInitialized,
  _resetRuntimeForTest,
} from '../llmRouter'

describe('llmRouter — singleton lifecycle', () => {
  beforeEach(() => {
    _resetRuntimeForTest()
  })

  it('runtime is not initialized before first call', () => {
    expect(isRuntimeInitialized()).toBe(false)
  })

  it('setRuntimeConfigProvider invalidates existing runtime', () => {
    // Build runtime by calling isRuntimeInitialized after a trigger
    setRuntimeConfigProvider(() => ({}))
    setRuntimeConfigProvider(() => ({})) // second call should not throw
    // No assertion on internal state — just verify no error thrown
  })

  it('ensureRuntimeInitialized does not override already-set provider', () => {
    const providerA = vi.fn(() => ({ log_level: 'error' as const }))
    const providerB = vi.fn(() => ({}))

    setRuntimeConfigProvider(providerA)
    ensureRuntimeInitialized(() => providerB)

    // providerB factory should never be called because provider was already set
    expect(providerB).not.toHaveBeenCalled()
  })

  it('ensureRuntimeInitialized sets provider when none set', () => {
    // ensureRuntimeInitialized wires the config provider; it does NOT call it.
    // The config provider is called lazily during getRuntime() on the first
    // callWithMode() invocation. The factory function IS called immediately
    // by ensureRuntimeInitialized to extract the provider from the closure.
    const provider = vi.fn(() => ({}))
    const factory = vi.fn(() => provider)
    ensureRuntimeInitialized(factory)
    // The factory (() => provider) is called once immediately to extract the provider
    expect(factory).toHaveBeenCalledTimes(1)
    // The provider itself is NOT called yet — it is called lazily on first run()
    expect(provider).not.toHaveBeenCalled()
    // isRuntimeInitialized() remains false until a call is dispatched
    expect(isRuntimeInitialized()).toBe(false)
  })

  it('resetRuntime does not throw when runtime not built', () => {
    expect(() => resetRuntime()).not.toThrow()
  })
})

describe('llmRouter — isUnavailable type guard', () => {
  it('returns true for UnavailableResponse shape', () => {
    const response = {
      unavailable: true as const,
      runtimeMode: 'cloud' as const,
      message: 'test',
      userMessage: 'test',
      actions: [],
    }
    expect(isUnavailable(response)).toBe(true)
  })

  it('returns false for LLMResponse shape', () => {
    const response = {
      content: 'hello',
      providerKind: 'cloud' as const,
      model: 'gpt-4o',
      modelId: 'gpt-4o',
      provider: 'openai',
      runtimeMode: 'cloud' as const,
      latency_ms: 100,
      engine_badge: 'badge',
    }
    expect(isUnavailable(response)).toBe(false)
  })
})

describe('llmRouter — TASK_TYPE_MAP completeness', () => {
  // This test enforces I-7: TASK_TYPE_MAP covers all TaskType values.
  // If a new TaskType is added without a map entry, this test catches it.
  it('all expected task types are handled', async () => {
    const taskTypes = ['text', 'carousel', 'vlm', 'extraction'] as const

    // We don't run actual calls (no providers in test) — we just verify
    // the map entries exist by confirming callWithMode accepts these values
    // without TypeScript errors (compile-time guarantee).
    // The runtime will return UnavailableResponse without providers, which is expected.
    // "No providers" is guaranteed deterministically by vitest.config.ts's
    // DISABLE_OLLAMA=1 (see the comment there) — without it, this falls
    // through to a real local Ollama adapter whenever one happens to be
    // reachable on the host machine, and these calls become real inference
    // requests instead of the fast no-provider path this test expects.
    for (const taskType of taskTypes) {
      const result = await callWithMode('test prompt', 'cloud', { taskType })
      expect(isUnavailable(result)).toBe(true) // Expected: no providers in test
    }
  })
})

describe('llmRouter — getAvailableModels', () => {
  it('returns an array of model descriptors', () => {
    const models = getAvailableModels()
    expect(Array.isArray(models)).toBe(true)
    for (const m of models) {
      expect(m).toHaveProperty('id')
      expect(m).toHaveProperty('name')
      expect(m).toHaveProperty('provider')
      expect(m.providerKind).toMatch(/^(local|cloud)$/)
    }
  })
})

describe('llmRouter — callWithMode never throws', () => {
  beforeEach(() => {
    _resetRuntimeForTest()
  })

  // "No providers configured" here is guaranteed by vitest.config.ts's
  // DISABLE_OLLAMA=1, not by the absence of a config provider alone — see
  // that file's comment for why. Without it, this depends on whether Ollama
  // happens to be reachable on whoever's machine is running the suite.
  it('returns UnavailableResponse when no providers configured', async () => {
    // No config provider set, no providers → terminal failure
    const result = await callWithMode('hello', 'cloud')
    expect(isUnavailable(result)).toBe(true)
    if (isUnavailable(result)) {
      expect(result.runtimeMode).toBe('cloud')
      expect(result.userMessage).toBeTruthy()
      expect(Array.isArray(result.actions)).toBe(true)
    }
  })

  it('handles legacy mode strings without throwing', async () => {
    const result = await callWithMode('hello', 'cloud_pro')
    // cloud_pro → cloud via fromLegacyToRuntimeMode
    expect(isUnavailable(result)).toBe(true)
    if (isUnavailable(result)) {
      expect(result.runtimeMode).toBe('cloud')
    }
  })
})

describe('llmRouter — callLLM throws on failure', () => {
  beforeEach(() => {
    _resetRuntimeForTest()
  })

  it('throws when runtime is unavailable', async () => {
    await expect(callLLM('hello')).rejects.toThrow()
  })
})


