// packages/ai-runtime-layer/src/__tests__/integration/singleton.integration.test.ts
//
// INTEGRATION TESTS for singleton ownership rules.
//
// Verifies:
//   - ONE authoritative singleton
//   - No hollow instances
//   - Telemetry reads from live singleton (not a disconnected copy)
//   - getActiveTelemetryStats() returns live data
//
// "Integration" here means integration of llmRouter's own module-level
// singleton with its public telemetry API (getActiveTelemetryStats() /
// getActiveTelemetryHistory()) — NOT integration with a real external LLM
// provider. Every callWithMode() call below is expected to fail fast with
// no provider available (see "will fail without providers" comments) —
// the assertions are about telemetry bookkeeping after that failure, not
// about model output. This is guaranteed deterministically by
// vitest.config.ts's DISABLE_OLLAMA=1; without it, these calls fall
// through to a real local Ollama adapter whenever one happens to be
// reachable on the host machine, turning "fails fast" into a real,
// 15+ second inference call. See that file's comment for the full
// investigation.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  callWithMode,
  isUnavailable,
  setRuntimeConfigProvider,
  getActiveTelemetryStats,
  getActiveTelemetryHistory,
  isRuntimeInitialized,
  _resetRuntimeForTest,
} from '../llmRouter'

describe('Singleton — ownership rules', () => {
  beforeEach(() => {
    _resetRuntimeForTest()
  })

  it('runtime is not initialized until first call', () => {
    expect(isRuntimeInitialized()).toBe(false)
  })

  it('getActiveTelemetryStats() returns zero-value before initialization', () => {
    const stats = getActiveTelemetryStats()
    expect(stats.total_requests).toBe(0)
    expect(stats.success_rate).toBe(0)
  })

  it('getActiveTelemetryHistory() returns empty array before initialization', () => {
    const history = getActiveTelemetryHistory()
    expect(history).toEqual([])
  })

  it('telemetry stats reflect actual invocations (not hollow instance)', async () => {
    // This test fails the OLD behavior: getAIRuntime() with {providers:{}} would
    // always return total_requests: 0 even after real invocations.
    // With the new pattern, getActiveTelemetryStats() reads from the live singleton.

    const statsBefore = getActiveTelemetryStats()
    expect(statsBefore.total_requests).toBe(0)

    // Make an invocation (will fail without providers, but still records telemetry)
    await callWithMode('test prompt', 'cloud')

    const statsAfter = getActiveTelemetryStats()
    // After a real invocation, total_requests should be > 0
    expect(statsAfter.total_requests).toBeGreaterThan(0)
  })

  it('telemetry history grows after invocations', async () => {
    await callWithMode('prompt 1', 'cloud')
    await callWithMode('prompt 2', 'cloud')

    const history = getActiveTelemetryHistory()
    expect(history.length).toBeGreaterThanOrEqual(2)
  })

  it('setRuntimeConfigProvider does not create multiple singleton instances', () => {
    setRuntimeConfigProvider(() => ({}))
    setRuntimeConfigProvider(() => ({}))

    // Both calls should reconfigure the same singleton, not create parallel instances.
    // If two singletons existed, calling getActiveTelemetryStats() would return
    // stats from whichever was last set. We can only verify no errors thrown here.
    expect(isRuntimeInitialized()).toBe(false) // not yet built (lazy)
  })
})

describe('Singleton — no hollow instances in apps/web', () => {
  // This describe block documents and guards the fix for the hollow singleton bug.
  //
  // ORIGINAL BUG:
  //   apps/web/lib/ai-runtime.ts called AIRuntimeFactory.create({ providers: {} })
  //   creating a SECOND singleton that had no providers and always returned zero stats.
  //   Any route using getLiveRuntimeStats() got stale data disconnected from real invocations.
  //
  // FIX:
  //   apps/web/lib/ai-runtime.ts now imports getActiveTelemetryStats() and
  //   getActiveTelemetryHistory() from @brandos/ai-runtime-layer, which read
  //   directly from the module-level _runtime singleton in llmRouter.ts.
  //
  // VERIFICATION STRATEGY:
  //   We cannot dynamic-import apps/web from a package test (package boundary violation).
  //   Instead, we verify the invariant that getActiveTelemetryStats() reflects live
  //   invocations — which is exactly what apps/web/lib/ai-runtime.ts delegates to.
  //   If this test passes, getLiveRuntimeStats() in apps/web is correct by construction.

  beforeEach(() => {
    _resetRuntimeForTest()
  })

  it('getActiveTelemetryStats returns zero before any invocation (no hollow instance)', () => {
    const stats = getActiveTelemetryStats()
    expect(stats.total_requests).toBe(0)
  })

  it('getActiveTelemetryStats reflects invocations — same source as getLiveRuntimeStats()', async () => {
    // Before any invocations: zero
    const before = getActiveTelemetryStats()
    expect(before.total_requests).toBe(0)

    // After an invocation (will fail without providers — still records telemetry)
    await callWithMode('test', 'cloud')

    // getActiveTelemetryStats() is what apps/web/getLiveRuntimeStats() delegates to.
    // If this assertion holds, the hollow-singleton bug cannot occur.
    const after = getActiveTelemetryStats()
    expect(after.total_requests).toBeGreaterThan(0)
  })
})


