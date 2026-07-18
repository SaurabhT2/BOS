/**
 * Contract tests — CPLOrchestrator
 *
 * These tests verify the shape and behaviour of CPLOrchestrator.orchestrate()
 * WITHOUT hitting any real provider, database, or IntelligenceOS instance.
 *
 * All external dependencies are mocked at the module boundary.
 *
 * PLATFORM SPLIT: this file previously mocked IBrandCognitionRuntime
 * (resolve / recordArtifactObservation, @brandos/contracts — deleted). It
 * now mocks CognitionProvider (resolveCognitionContext / observe /
 * summarizeCognition / checkHealth, @platform/cognition-contract). review()
 * was removed from the BrandOS-local CognitionProvider contract as part of
 * Option B — BrandOS no longer passes through raw-signal review decisions.
 *
 * Coverage goals:
 *   ✓ orchestrate() returns a GenerationResult with the correct contract shape
 *   ✓ orchestrate() calls cognitionClient.resolveCognitionContext() exactly once
 *   ✓ orchestrate() calls cognitionClient.observe() fire-and-forget
 *   ✓ orchestrate() returns a degraded context when cognition resolution throws
 *   ✓ cognitionContext in result is the resolved snapshot (not mutated)
 *   ✓ requestId in result matches input requestId
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CPLOrchestrator } from '../../src/orchestrator'
import type { CognitionContext, CognitionProvider } from '@platform/cognition-contract'
import type { GenerationRequest } from '../../src/types'

// ─── Mock CognitionProvider ────────────────────────────────────────────────

const MOCK_COGNITION_CONTEXT: CognitionContext = {
  contractVersion: '1.0.0',
  workspaceId: 'ws-test-001',
  resolvedAt: '2026-05-28T00:00:00.000Z',
  confidence: 'high',
  voice: {
    tone: 'professional',
    cadence: 'medium',
    audienceType: 'b2b',
    executiveLevel: false,
    domain: 'saas',
    bannedPhrases: [],
  },
  identity: {
    brandName: 'Acme',
    narrativeArcs: ['problem-solution'],
    argumentationStyle: 'confident',
    namedFrameworks: [],
    preferredLength: 'medium',
    hookStyle: 'question',
    ctaIntent: 'get started',
  },
  visualIdentity: null,
  provenance: {
    signalCount: 12,
    lastConsolidatedAt: '2026-05-27T00:00:00.000Z',
  },
  // EM-1.1 (Cognitive Platform Evolution Program) — these three fields
  // became required (nullable) when CognitionContext gained ADR-004's
  // sections; null here is a legitimate value (this fixture's workspace
  // has nothing synthesized for these sections), not a placeholder.
  knowledge: null,
  reasoning: null,
  positioning: null,
}

function makeMockCognitionClient(
  resolveImpl?: () => Promise<CognitionContext>
): CognitionProvider {
  return {
    resolveCognitionContext: vi.fn(resolveImpl ?? (() => Promise.resolve(MOCK_COGNITION_CONTEXT))),
    observe: vi.fn(() => Promise.resolve()),
    summarizeCognition: vi.fn(() => Promise.resolve({
      preferredTone: null, audience: null, industry: null, positioning: null, keywords: null,
    })),
    checkHealth: vi.fn(() => Promise.resolve({ healthy: true })),
  }
}

// ─── Test request ─────────────────────────────────────────────────────────────

const BASE_REQUEST: GenerationRequest = {
  requestId: 'req-test-001',
  workspaceId: 'ws-test-001',
  taskType: 'carousel',
  userPrompt: 'Create a carousel about scaling a SaaS startup',
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CPLOrchestrator contract', () => {
  let mockClient: CognitionProvider
  let orchestrator: CPLOrchestrator

  beforeEach(() => {
    mockClient = makeMockCognitionClient()
    // Patch runGenerationPipeline and evaluateGovernance to avoid
    // hitting real OCL / artifact-engine-layer in contract tests.
    orchestrator = new CPLOrchestrator(mockClient)
    // Override internal pipeline stubs to return controlled results
    ;(orchestrator as any).runStructuredPipeline = vi.fn(async () => ({
      rawText: 'Mock raw LLM content for carousel',
      governanceScore: 88,
      wasRepaired: false,
    }))
    // Non-structured taskTypes (post, chat, etc.) route through runTextPipeline
    // instead of runStructuredPipeline — stub it too so those requests don't
    // fall through to the real AI runtime layer (which needs a live, capable
    // provider) and stay consistent with "no real provider" contract above.
    ;(orchestrator as any).runTextPipeline = vi.fn(async () => ({
      content: 'Mock raw LLM content for post',
    }))
  })

  // ── Shape contract ──────────────────────────────────────────────────────────

  it('returns a GenerationResult with required fields', async () => {
    const result = await orchestrator.orchestrate(BASE_REQUEST)

    expect(result).toMatchObject({
      requestId: BASE_REQUEST.requestId,
      score: expect.any(Number),
      wasRepaired: expect.any(Boolean),
      durationMs: expect.any(Number),
    })
    expect(result.artifact).toBeDefined()
    expect(result.cognitionContext).toBeDefined()
  })

  it('preserves requestId from input unchanged', async () => {
    const result = await orchestrator.orchestrate(BASE_REQUEST)
    expect(result.requestId).toBe(BASE_REQUEST.requestId)
  })

  it('exposes durationMs as a non-negative number', async () => {
    const result = await orchestrator.orchestrate(BASE_REQUEST)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  // ── Cognition resolution delegation ─────────────────────────────────────────

  it('calls cognitionClient.resolveCognitionContext() exactly once per orchestrate() call', async () => {
    await orchestrator.orchestrate(BASE_REQUEST)
    expect(mockClient.resolveCognitionContext).toHaveBeenCalledTimes(1)
  })

  it('passes workspaceId and taskType to resolveCognitionContext()', async () => {
    const req: GenerationRequest = { ...BASE_REQUEST, taskType: 'post' }
    await orchestrator.orchestrate(req)
    expect(mockClient.resolveCognitionContext).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: req.workspaceId,
        taskType: req.taskType,
      })
    )
  })

  it('returns the resolved cognitionContext unchanged in the result', async () => {
    const result = await orchestrator.orchestrate(BASE_REQUEST)
    // The cognitionContext in the result must be the snapshot returned by
    // the cognition client.
    expect(result.cognitionContext).toEqual(MOCK_COGNITION_CONTEXT)
  })

  it('calls observe() fire-and-forget after generation', async () => {
    await orchestrator.orchestrate(BASE_REQUEST)
    // Fire-and-forget — it should have been called (void-ed, not awaited to completion)
    expect(mockClient.observe).toHaveBeenCalledTimes(1)
    expect(mockClient.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: BASE_REQUEST.requestId,
        workspaceId: BASE_REQUEST.workspaceId,
      })
    )
  })

  // Completion Mission (RCA finding — missing topic propagation): observe()
  // used to omit `topic` entirely, so IntelligenceOS's SignalExtractor could
  // never emit its expertise_domains signal. This asserts the same topic
  // ContractAssembler anchors the prompt to (userPrompt, truncated to 120
  // chars) is now reported to observe() as well.
  it('propagates a topic (derived from userPrompt) into observe()', async () => {
    await orchestrator.orchestrate(BASE_REQUEST)
    expect(mockClient.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: BASE_REQUEST.userPrompt.slice(0, 120),
      })
    )
  })

  it('propagates topic into the failure-path observe() call as well', async () => {
    ;(orchestrator as any).runStructuredPipeline = vi.fn(async () => {
      throw new Error('AI runtime unavailable')
    })
    await expect(orchestrator.orchestrate(BASE_REQUEST)).rejects.toThrow()
    expect(mockClient.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: BASE_REQUEST.userPrompt.slice(0, 120),
        outcome: 'failure',
      })
    )
  })

  it('omits topic when userPrompt is empty/whitespace-only', async () => {
    const req: GenerationRequest = { ...BASE_REQUEST, userPrompt: '   ' }
    await orchestrator.orchestrate(req)
    const call = (mockClient.observe as any).mock.calls[0][0]
    expect(call.topic).toBeUndefined()
  })

  // ── Degraded context fallback ───────────────────────────────────────────────

  it('uses a degraded cognition context when resolveCognitionContext() throws', async () => {
    const failingClient = makeMockCognitionClient(async () => {
      throw new Error('IntelligenceOS unavailable')
    })
    const degradedOrchestrator = new CPLOrchestrator(failingClient)
    ;(degradedOrchestrator as any).runStructuredPipeline = vi.fn(async () => ({
      rawText: 'Degraded content',
      governanceScore: 50,
      wasRepaired: false,
    }))

    const result = await degradedOrchestrator.orchestrate(BASE_REQUEST)

    // Should still return a valid result shape (not throw)
    expect(result.requestId).toBe(BASE_REQUEST.requestId)
    // Degraded context has confidence 'degraded' and no identity
    expect(result.cognitionContext.confidence).toBe('degraded')
    expect(result.cognitionContext.identity).toBeNull()
  })

  // ── Immutability of cognitionContext ────────────────────────────────────────

  it('does not mutate the cognitionContext snapshot returned by the cognition client', async () => {
    const original = JSON.stringify(MOCK_COGNITION_CONTEXT)
    await orchestrator.orchestrate(BASE_REQUEST)
    expect(JSON.stringify(MOCK_COGNITION_CONTEXT)).toBe(original)
  })

  // ── Governance integration ─────────────────────────────────────────────────
  // NOTE (AB-002): compile+govern now runs inside executeArtifactPipeline, not
  // the orchestrator. The orchestrator's runStructuredPipeline returns raw text
  // plus a preliminary governanceScore/wasRepaired for the orchestration result.
  // These tests verify the orchestrator correctly propagates what runStructuredPipeline returns.

  it('returns wasRepaired: false when governance does not require repair', async () => {
    ;(orchestrator as any).runStructuredPipeline = vi.fn(async () => ({
      rawText: 'Mock carousel content',
      governanceScore: 95,
      wasRepaired: false,
    }))
    const result = await orchestrator.orchestrate(BASE_REQUEST)
    expect(result.wasRepaired).toBe(false)
  })

  it('returns wasRepaired: true when governance requires repair', async () => {
    ;(orchestrator as any).runStructuredPipeline = vi.fn(async () => ({
      rawText: 'Mock repaired carousel content',
      governanceScore: 40,
      wasRepaired: true,
    }))
    const result = await orchestrator.orchestrate(BASE_REQUEST)
    expect(result.wasRepaired).toBe(true)
  })

  it('returns the score from governance evaluation', async () => {
    ;(orchestrator as any).runStructuredPipeline = vi.fn(async () => ({
      rawText: 'Mock carousel content',
      governanceScore: 73,
      wasRepaired: false,
    }))
    const result = await orchestrator.orchestrate(BASE_REQUEST)
    expect(result.score).toBe(73)
  })
})
