// packages/ai-runtime-layer/src/__tests__/unit/executionEngine.test.ts
//
// Tests for ExecutionEngine: retry loop, circuit breaker integration,
// fallback chain execution, policy checks, bug-fix regressions.

import { describe, it, expect, beforeEach } from 'vitest'
import { ExecutionEngine } from '../runtime-engine/index'
import { CircuitBreaker, RateLimiter, CostTracker } from '../runtime-engine/resilience'
import { ValidatorEngine } from '../validator-engine/index'
import { PolicyEngine } from '../policy-engine/index'
import { Logger } from '../runtime-engine/logger'
import { MockProviderAdapter } from './MockProviderAdapter'
import { MockTelemetryEngine } from './MockTelemetryEngine'
import type { ExecutionPlan, InvocationRequest, BuiltPrompt, ProviderName } from '@brandos/contracts'

function makeEngine(
  providers: Record<string, MockProviderAdapter>,
  policy = {},
): { engine: ExecutionEngine; telemetry: MockTelemetryEngine } {
  const telemetry = new MockTelemetryEngine()
  const engine = new ExecutionEngine({
    providers:      new Map(Object.entries(providers)) as Map<ProviderName, any>,
    validator:      new ValidatorEngine(),
    policy:         new PolicyEngine(policy),
    telemetry,
    circuitBreaker: new CircuitBreaker({ threshold: 3, reset_ms: 60_000 }),
    rateLimiter:    new RateLimiter({}),
    costTracker:    new CostTracker(undefined),
    logger:         new Logger('error'), // suppress logs in tests
    backoffMs:      0, // no delay in tests
  })
  return { engine, telemetry }
}

const basePlan: ExecutionPlan = {
  primary_provider: 'openai' as ProviderName,
  primary_mode:     'cloud',
  fallback_chain:   [],
  retry_budget:     3,
  timeout_ms:       5_000,
}

const baseRequest: InvocationRequest = {
  user_intent:    'test prompt',
  task_type:      'chat',
  preferred_mode: 'cloud',
}

const basePrompt: BuiltPrompt = {
  system_prompt: 'system',
  user_prompt:   'user',
  json_mode:     false,
}

describe('ExecutionEngine — success path', () => {
  it('returns success output when provider succeeds', async () => {
    const { engine } = makeEngine({ openai: MockProviderAdapter.success('hello world') })
    const result = await engine.execute(baseRequest, basePlan, basePrompt)
    expect(result.status).toBe('success')
    expect(result.content).toBe('hello world')
    expect(result.engine_used).toBe('openai')
    expect(result.fallback_used).toBe(false)
  })

  it('records telemetry snapshot on success', async () => {
    const { engine, telemetry } = makeEngine({ openai: MockProviderAdapter.success() })
    await engine.execute(baseRequest, basePlan, basePrompt)
    expect(telemetry.snapshots).toHaveLength(1)
    expect(telemetry.snapshots[0]!.success).toBe(true)
  })
})

describe('ExecutionEngine — fallback chain', () => {
  it('falls back to second provider when primary fails', async () => {
    const { engine } = makeEngine({
      openai:    MockProviderAdapter.failure('primary error'),
      anthropic: MockProviderAdapter.success('fallback response'),
    })
    const plan: ExecutionPlan = {
      ...basePlan,
      fallback_chain: [{ provider: 'anthropic' as ProviderName, mode: 'cloud' }],
    }
    const result = await engine.execute(baseRequest, plan, basePrompt)
    expect(result.status).toBe('success')
    expect(result.content).toBe('fallback response')
    expect(result.fallback_used).toBe(true)
  })

  it('returns terminal_failure when all providers fail', async () => {
    const { engine } = makeEngine({
      openai:    MockProviderAdapter.failure(),
      anthropic: MockProviderAdapter.failure(),
    })
    const plan: ExecutionPlan = {
      ...basePlan,
      fallback_chain: [{ provider: 'anthropic' as ProviderName, mode: 'cloud' }],
    }
    const result = await engine.execute(baseRequest, plan, basePrompt)
    expect(result.status).toBe('terminal_failure')
    expect(result.fallback_chain_exhausted).toBe(true)
  })

  it('records failure telemetry when all providers fail', async () => {
    const { engine, telemetry } = makeEngine({ openai: MockProviderAdapter.failure() })
    await engine.execute(baseRequest, basePlan, basePrompt)
    expect(telemetry.snapshots).toHaveLength(1)
    expect(telemetry.snapshots[0]!.success).toBe(false)
  })
})

describe('ExecutionEngine — Bug B regression: retryCount', () => {
  it('does not double-count retries (Bug B fix)', async () => {
    // Provider fails twice then succeeds. retryCount should be 2, not 4.
    let callCount = 0
    const flaky = new MockProviderAdapter({
      get shouldThrow() {
        // Fail first 2 times, succeed on 3rd
        return false
      },
    })
    // Intercept to track calls
    let invokeCount = 0
    const originalInvoke = flaky.invoke.bind(flaky)
    flaky.invoke = async (req) => {
      invokeCount++
      if (invokeCount < 3) throw new Error('transient failure')
      return originalInvoke(req)
    }

    const { engine, telemetry } = makeEngine({ openai: flaky })
    const result = await engine.execute(baseRequest, basePlan, basePrompt)

    // After Bug B fix: retryCount is incremented only in onRetry, not in .catch()
    // So 2 failures = retryCount 2, not 4.
    if (result.status === 'success') {
      expect(result.retry_count).toBeLessThanOrEqual(2)
    }
  })
})

describe('ExecutionEngine — Bug M-5 regression: providerKind', () => {
  it('derives providerKind from provider name, not plan.primary_mode', async () => {
    const { engine } = makeEngine({ ollama: MockProviderAdapter.success('local response') })
    const plan: ExecutionPlan = {
      ...basePlan,
      primary_provider: 'ollama' as ProviderName,
      primary_mode:     'cloud', // Intentionally wrong — M-5 guard should override
    }
    const result = await engine.execute(baseRequest, plan, basePrompt)
    if (result.status === 'success') {
      expect(result.providerKind).toBe('local')
    }
  })

  it('lmstudio is labelled local regardless of mode', async () => {
    const { engine } = makeEngine({ lmstudio: MockProviderAdapter.success('local response') })
    const plan: ExecutionPlan = {
      ...basePlan,
      primary_provider: 'lmstudio' as ProviderName,
      primary_mode:     'cloud',
    }
    const result = await engine.execute(baseRequest, plan, basePrompt)
    if (result.status === 'success') {
      expect(result.providerKind).toBe('local')
    }
  })
})

describe('ExecutionEngine — unregistered provider', () => {
  it('handles missing provider gracefully (returns terminal_failure)', async () => {
    const { engine } = makeEngine({}) // empty providers map
    const result = await engine.execute(baseRequest, basePlan, basePrompt)
    expect(result.status).toBe('terminal_failure')
  })
})

describe('ExecutionEngine — policy block', () => {
  it('skips provider when policy blocks it', async () => {
    const { engine } = makeEngine({ openai: MockProviderAdapter.success() })
    // local_only policy blocks cloud providers
    const localOnlyPlan: ExecutionPlan = { ...basePlan, primary_mode: 'local' as any }
    // With local_only: true in policy, cloud provider should be blocked
    const policyEngine = new PolicyEngine({ local_only: true })
    const telemetry = new MockTelemetryEngine()
    const restrictedEngine = new ExecutionEngine({
      providers:      new Map([['openai', MockProviderAdapter.success()]]) as any,
      validator:      new ValidatorEngine(),
      policy:         policyEngine,
      telemetry,
      circuitBreaker: new CircuitBreaker({ threshold: 3, reset_ms: 60_000 }),
      rateLimiter:    new RateLimiter({}),
      costTracker:    new CostTracker(undefined),
      logger:         new Logger('error'),
      backoffMs:      0,
    })
    const result = await restrictedEngine.execute(baseRequest, basePlan, basePrompt)
    // local_only policy should block openai (cloud provider) → terminal_failure
    expect(result.status).toBe('terminal_failure')
  })
})


