/**
 * __tests__/unit/normalizeObservationInput.test.ts
 *
 * Cognitive Platform Evolution Program follow-up fix. Found via a live
 * end-to-end run's server logs: the observation that actually survives
 * Brand Memory's Gate 1 score threshold and reaches IntelligenceOS's
 * Learning Pipeline (fired from `recordBrandMemoryAfterPipeline()` in
 * artifact-pipeline.ts, with the real post-governance-repair score) was
 * showing `providerId: undefined, modelId: undefined` in IntelligenceOS's
 * own logs, even though `IObservationEvent` had already been extended to
 * carry those fields (EM-3.4/EM-3.5).
 *
 * Root cause: `normalizeObservationInput()` built its return value as an
 * explicit field-by-field allowlist that predated the EM-3.4 extension and
 * was never updated — so the new fields were present on the input object
 * but silently dropped on the way out. This test exercises that function
 * directly and would have caught the bug before it ever reached a live run.
 */

import { describe, it, expect } from 'vitest'
import { normalizeObservationInput } from '../../src/brand-memory/service'
import type { IObservationEvent } from '@brandos/contracts'

describe('normalizeObservationInput', () => {
  const baseInput: IObservationEvent = {
    requestId: 'req-1',
    workspaceId: 'ws-1',
    artifactType: 'carousel',
    artifactText: 'raw output',
    artifactScore: 81,
    wasRepaired: true,
    observedAt: '2026-07-16T04:23:24.184Z',
  }

  it('maps the original pre-EM-3.4 fields correctly (no regression)', () => {
    const result = normalizeObservationInput(baseInput)
    expect(result.workspaceId).toBe('ws-1')
    expect(result.requestId).toBe('req-1')
    expect(result.outputText).toBe('raw output')
    expect(result.score).toBe(81)
    expect(result.artifactType).toBe('carousel')
    expect(result.wasRepaired).toBe(true)
    expect(result.observedAt).toBe('2026-07-16T04:23:24.184Z')
  })

  it('passes providerId and modelId through — the exact bug a live run found', () => {
    const result = normalizeObservationInput({
      ...baseInput,
      providerId: 'groq',
      modelId: 'llama-3.3-70b-versatile',
    })
    expect(result.providerId).toBe('groq')
    expect(result.modelId).toBe('llama-3.3-70b-versatile')
  })

  it('passes routingHint, tokenUsage, outcome, and failureReason through', () => {
    const result = normalizeObservationInput({
      ...baseInput,
      routingHint: 'ollama:llama-3.3',
      tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      outcome: 'failure',
      failureReason: 'provider_timeout',
    })
    expect(result.routingHint).toBe('ollama:llama-3.3')
    expect(result.tokenUsage).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150 })
    expect(result.outcome).toBe('failure')
    expect(result.failureReason).toBe('provider_timeout')
  })

  it('leaves the new fields undefined when the input does not set them (no fabricated defaults)', () => {
    const result = normalizeObservationInput(baseInput)
    expect(result.providerId).toBeUndefined()
    expect(result.modelId).toBeUndefined()
    expect(result.tokenUsage).toBeUndefined()
  })
})
