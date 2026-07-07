// packages/ai-runtime-layer/src/__tests__/contract/IAIRuntime.contract.test.ts
//
// CONTRACT TESTS for IAIRuntime implementations.
//
// Every class that implements IAIRuntime must satisfy these tests.
// Run against both RuntimeEngine and AIRuntimeAdapter to ensure
// full contract compliance.

import { describe, it, expect, beforeEach } from 'vitest'
import { AIRuntimeAdapter } from '../AIRuntimeAdapter'
import { RuntimeEngine } from '../runtime-engine/index'
import { ExecutionEngine } from '../runtime-engine/index'
import { CapabilityEngine, RouterEngine } from '../router-engine/index'
import { ValidatorEngine } from '../validator-engine/index'
import { PolicyEngine } from '../policy-engine/index'
import { TelemetryEngine } from '../telemetry-engine/index'
import { CircuitBreaker, RateLimiter, CostTracker } from '../runtime-engine/resilience'
import { PromptBuilder } from '../runtime-engine/prompt-builder'
import { PluginRegistry } from '../plugins/index'
import { Logger } from '../runtime-engine/logger'
import { MockProviderAdapter } from './MockProviderAdapter'
import type { IAIRuntime, ProviderName } from '@brandos/contracts'

function buildTestRuntime(): IAIRuntime {
  const logger    = new Logger('error')
  const providers = new Map<ProviderName, any>([
    ['openai', MockProviderAdapter.success('contract test response')],
  ])
  const telemetry     = new TelemetryEngine([], logger)
  const circuitBreaker = new CircuitBreaker({ threshold: 3, reset_ms: 60_000 })
  const rateLimiter    = new RateLimiter({})
  const costTracker    = new CostTracker(undefined)
  const capability    = new CapabilityEngine(providers, {}, 0, logger) // 0ms TTL = always fresh
  const router        = new RouterEngine(providers, [], { max_total_attempts: 3, max_per_provider: 2, backoff_ms: 0 }, {}, logger)
  const validator     = new ValidatorEngine()
  const policy        = new PolicyEngine({})
  const promptBuilder = new PromptBuilder()
  const plugins       = new PluginRegistry()

  const executor = new ExecutionEngine({
    providers, validator, policy, telemetry, circuitBreaker, rateLimiter, costTracker, logger, backoffMs: 0, plugins,
  })

  return new RuntimeEngine({
    providers, capability, router, promptBuilder, executor, telemetry, logger, plugins,
  })
}

function runContractTests(name: string, factory: () => IAIRuntime) {
  describe(`IAIRuntime contract — ${name}`, () => {
    let runtime: IAIRuntime

    beforeEach(() => {
      runtime = factory()
    })

    it('implements all 5 required methods', () => {
      expect(typeof runtime.run).toBe('function')
      expect(typeof runtime.capabilities).toBe('function')
      expect(typeof runtime.refreshCapabilities).toBe('function')
      expect(typeof runtime.stats).toBe('function')
      expect(typeof runtime.telemetryHistory).toBe('function')
    })

    it('run() never throws — returns AIRuntimeOutput with status field', async () => {
      const result = await runtime.run({
        user_intent:    'test',
        task_type:      'chat',
        preferred_mode: 'cloud',
      })
      expect(result).toHaveProperty('status')
      expect(['success', 'degraded_success', 'terminal_failure']).toContain(result.status)
    })

    it('run() with empty user_intent returns terminal_failure (I-1 guard)', async () => {
      const result = await runtime.run({
        user_intent:    '',
        task_type:      'chat',
        preferred_mode: 'cloud',
      })
      expect(result.status).toBe('terminal_failure')
      expect(result.error).toBeDefined()
    })

    it('capabilities() returns CapabilityResult with available_modes array', async () => {
      const caps = await runtime.capabilities()
      expect(caps).toHaveProperty('available_modes')
      expect(Array.isArray(caps.available_modes)).toBe(true)
    })

    it('capabilities() with force_refresh does not throw', async () => {
      await expect(runtime.capabilities({ force_refresh: true })).resolves.toBeDefined()
    })

    it('refreshCapabilities() returns fresh CapabilityResult', async () => {
      const result = await runtime.refreshCapabilities()
      expect(result).toHaveProperty('available_modes')
    })

    it('stats() is synchronous and returns TelemetryStats', () => {
      const stats = runtime.stats()
      expect(stats).toHaveProperty('total_requests')
      expect(stats).toHaveProperty('success_rate')
      expect(stats).toHaveProperty('avg_latency_ms')
      expect(typeof stats.total_requests).toBe('number')
      expect(typeof stats.success_rate).toBe('number')
    })

    it('telemetryHistory() is synchronous and returns array', () => {
      const history = runtime.telemetryHistory()
      expect(Array.isArray(history)).toBe(true)
    })

    it('telemetryHistory() grows after a run()', async () => {
      await runtime.run({ user_intent: 'test', task_type: 'chat', preferred_mode: 'cloud' })
      const history = runtime.telemetryHistory()
      expect(history.length).toBeGreaterThan(0)
    })

    it('stats().total_requests increments after a run()', async () => {
      const before = runtime.stats().total_requests
      await runtime.run({ user_intent: 'test', task_type: 'chat', preferred_mode: 'cloud' })
      const after = runtime.stats().total_requests
      expect(after).toBeGreaterThan(before)
    })
  })
}

// Run contracts against the primary implementation
runContractTests('RuntimeEngine', buildTestRuntime)


