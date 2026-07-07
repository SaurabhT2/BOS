// packages/ai-runtime-layer/src/__tests__/multimodal/attachment-forwarding.test.ts
//
// P3 Regression Suite — Attachment Propagation
//
// Verifies that InvocationRequest.attachments are forwarded intact to
// ProviderInvokeRequest by ExecutionEngine. This test suite is the regression
// guard for defect D1: prior to the fix, attachments were silently dropped at
// the ExecutionEngine dispatch site.
//
// Test taxonomy:
//   - Attachments present → forwarded to adapter's invoke()
//   - Attachments absent  → attachments field absent on invokeReq (not empty array)
//   - Multiple attachments → all forwarded, order preserved
//   - BYOK + attachments  → both fields set correctly (no interference)

import { describe, it, expect, beforeEach } from 'vitest'
import { ExecutionEngine } from '../../runtime-engine/index'
import { CircuitBreaker, RateLimiter, CostTracker } from '../../runtime-engine/resilience'
import { ValidatorEngine } from '../../validator-engine/index'
import { PolicyEngine } from '../../policy-engine/index'
import { Logger } from '../../runtime-engine/logger'
import { MockProviderAdapter } from '../MockProviderAdapter'
import { MockTelemetryEngine } from '../MockTelemetryEngine'
import type { ExecutionPlan, InvocationRequest, BuiltPrompt, ProviderName, ProviderInvokeRequest } from '@brandos/contracts'

// ─── Capture adapter that records the full invokeReq ─────────────────────────
class CapturingAdapter extends MockProviderAdapter {
  public capturedRequests: ProviderInvokeRequest[] = []

  override async invoke(request: ProviderInvokeRequest) {
    this.capturedRequests.push({ ...request })
    return super.invoke(request)
  }
}

function makeEngine(adapter: CapturingAdapter) {
  const telemetry = new MockTelemetryEngine()
  const engine = new ExecutionEngine({
    providers:      new Map([['anthropic', adapter]] as [ProviderName, any][]),
    validator:      new ValidatorEngine(),
    policy:         new PolicyEngine({}),
    telemetry,
    circuitBreaker: new CircuitBreaker({ threshold: 3, reset_ms: 60_000 }),
    rateLimiter:    new RateLimiter({}),
    costTracker:    new CostTracker(undefined),
    logger:         new Logger('error'),
    backoffMs:      0,
  })
  return { engine, telemetry }
}

const basePlan: ExecutionPlan = {
  primary_provider: 'anthropic' as ProviderName,
  primary_mode:     'cloud',
  fallback_chain:   [],
  retry_budget:     1,
  timeout_ms:       5_000,
}

const basePrompt: BuiltPrompt = {
  system_prompt: 'You are a helpful assistant.',
  user_prompt:   'Describe this image.',
  json_mode:     false,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('P3 — Attachment Forwarding (D1 regression)', () => {
  it('forwards a single attachment from InvocationRequest to ProviderInvokeRequest', async () => {
    const adapter = new CapturingAdapter({ providerName: 'anthropic' })
    const { engine } = makeEngine(adapter)

    const request: InvocationRequest = {
      user_intent:    'Describe this image.',
      task_type:      'image_analysis',
      preferred_mode: 'cloud',
      attachments: [{ type: 'image_png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }],
    }

    const result = await engine.execute(request, basePlan, basePrompt)
    expect(result.status).toBe('success')

    const captured = adapter.capturedRequests[0]
    expect(captured).toBeDefined()
    expect(captured!.attachments).toBeDefined()
    expect(captured!.attachments).toHaveLength(1)
    expect(captured!.attachments![0]!.type).toBe('image_png')
    expect(captured!.attachments![0]!.data).toContain('iVBORw0KGgo')
  })

  it('forwards multiple attachments preserving order', async () => {
    const adapter = new CapturingAdapter({ providerName: 'anthropic' })
    const { engine } = makeEngine(adapter)

    const request: InvocationRequest = {
      user_intent:    'Compare these two images.',
      task_type:      'image_analysis',
      preferred_mode: 'cloud',
      attachments: [
        { type: 'image_jpeg', data: 'FIRST_IMAGE_BASE64' },
        { type: 'image_png',  data: 'SECOND_IMAGE_BASE64' },
      ],
    }

    await engine.execute(request, basePlan, basePrompt)

    const captured = adapter.capturedRequests[0]
    expect(captured!.attachments).toHaveLength(2)
    expect(captured!.attachments![0]!.type).toBe('image_jpeg')
    expect(captured!.attachments![1]!.type).toBe('image_png')
    expect(captured!.attachments![0]!.data).toBe('FIRST_IMAGE_BASE64')
    expect(captured!.attachments![1]!.data).toBe('SECOND_IMAGE_BASE64')
  })

  it('does NOT set attachments on ProviderInvokeRequest when none in InvocationRequest', async () => {
    const adapter = new CapturingAdapter({ providerName: 'anthropic' })
    const { engine } = makeEngine(adapter)

    const request: InvocationRequest = {
      user_intent:    'Write a haiku.',
      task_type:      'chat',
      preferred_mode: 'cloud',
      // No attachments field
    }

    await engine.execute(request, basePlan, basePrompt)

    const captured = adapter.capturedRequests[0]
    // attachments should be absent (not set to empty array)
    expect(captured!.attachments).toBeUndefined()
  })

  it('does NOT forward empty attachments array', async () => {
    const adapter = new CapturingAdapter({ providerName: 'anthropic' })
    const { engine } = makeEngine(adapter)

    const request: InvocationRequest = {
      user_intent:    'Write a haiku.',
      task_type:      'chat',
      preferred_mode: 'cloud',
      attachments:    [], // explicitly empty
    }

    await engine.execute(request, basePlan, basePrompt)

    const captured = adapter.capturedRequests[0]
    expect(captured!.attachments).toBeUndefined()
  })

  it('forwards attachments alongside BYOK api_key without interference', async () => {
    const adapter = new CapturingAdapter({ providerName: 'anthropic' })
    const { engine } = makeEngine(adapter)

    const request: InvocationRequest = {
      user_intent:        'Analyze this brand logo.',
      task_type:          'image_analysis',
      preferred_mode:     'cloud',
      attachments:        [{ type: 'image_png', data: 'LOGO_BASE64' }],
      api_key_overrides:  { anthropic: 'sk-ant-workspace-key-test' },
    }

    await engine.execute(request, basePlan, basePrompt)

    const captured = adapter.capturedRequests[0]
    expect(captured!.attachments).toHaveLength(1)
    expect(captured!.attachments![0]!.data).toBe('LOGO_BASE64')
    expect(captured!.api_key).toBe('sk-ant-workspace-key-test')
  })

  it('attachment count preserved through full execute() call', async () => {
    const adapter = new CapturingAdapter({ providerName: 'anthropic' })
    const { engine } = makeEngine(adapter)

    const ATTACHMENT_COUNT = 3
    const request: InvocationRequest = {
      user_intent:    'Analyze brand consistency across images.',
      task_type:      'image_analysis',
      preferred_mode: 'cloud',
      attachments:    Array.from({ length: ATTACHMENT_COUNT }, (_, i) => ({
        type: 'image_png',
        data: `IMAGE_${i}_BASE64`,
      })),
    }

    await engine.execute(request, basePlan, basePrompt)

    const captured = adapter.capturedRequests[0]
    expect(captured!.attachments).toHaveLength(ATTACHMENT_COUNT)
  })
})
