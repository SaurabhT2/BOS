/**
 * Regression test — G-18 (Architecture Verification Report, P2)
 *
 * `CPLOrchestrator.runStructuredPipeline()` previously logged one combined
 * line — `hasIdentity=... confidence=... audienceType=...` — that reads as
 * if both values share a common source. They don't (see the code's own
 * comment): `identity` comes from identity synthesis/configuration,
 * `confidence` from Learning corroboration count alone, and the two can
 * legitimately diverge. This test asserts the log output is now two
 * separate lines, one per concern, so it no longer implies a shared source.
 *
 * Scoped narrowly: mocks `ContractAssemblerFactory.assemble()` to resolve
 * immediately after the log lines are emitted, then lets the (unmocked)
 * `compilePromptFromContract()` call fail — we only care that the log
 * lines already fired by that point, so the resulting rejection is caught
 * and ignored.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@brandos/output-control-layer', () => ({
  ContractAssemblerFactory: {
    create: () => ({
      assemble: vi.fn().mockResolvedValue({ /* minimal fake contract */ }),
    }),
  },
  compilePromptFromContract: vi.fn(() => {
    throw new Error('intentionally unmocked past this point — test only needs the log lines')
  }),
}))

import { CPLOrchestrator } from '../../src/orchestrator'
import type { CognitionContext } from '@platform/cognition-contract'
import type { OrchestrationContext } from '../../src/types'

const MOCK_COGNITION_CONTEXT: CognitionContext = {
  contractVersion: '1.0.0',
  workspaceId: 'ws-test-001',
  resolvedAt: '2026-05-28T00:00:00.000Z',
  confidence: 'degraded',
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
  provenance: { signalCount: 1, lastConsolidatedAt: '2026-05-27T00:00:00.000Z' },
  knowledge: null,
  reasoning: null,
  positioning: null,
}

function makeCtx(): OrchestrationContext {
  return {
    requestId: 'req-g18-test',
    workspaceId: 'ws-test-001',
    userPrompt: 'Create a carousel about scaling a SaaS startup',
    runtimeMode: 'cloud',
    cognitionContext: MOCK_COGNITION_CONTEXT,
    promptContext: null,
    visualContext: null,
    attemptNumber: 1,
  }
}

describe('CPLOrchestrator.runStructuredPipeline — identity/confidence logging (G-18)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('emits identity and confidence on two separate log lines, not one combined line', async () => {
    const orchestrator = new CPLOrchestrator({
      resolveCognitionContext: vi.fn(),
      observe: vi.fn(),
      summarizeCognition: vi.fn(),
      checkHealth: vi.fn(),
    } as any)

    await (orchestrator as any).runStructuredPipeline(makeCtx(), 'carousel').catch(() => {
      // Expected — compilePromptFromContract throws intentionally past the
      // point this test cares about (see module mock above).
    })

    const lines = logSpy.mock.calls.map(call => String(call[0]))

    // No single line combines both hasIdentity and confidence anymore.
    const combined = lines.find(l => l.includes('hasIdentity=') && l.includes('confidence='))
    expect(combined).toBeUndefined()

    // Each concern gets its own line, correlated by requestId.
    const identityLine = lines.find(l => l.includes('identity injected') && l.includes('hasIdentity=true'))
    const confidenceLine = lines.find(l => l.includes('confidence injected') && l.includes('confidence=degraded'))
    expect(identityLine).toBeDefined()
    expect(confidenceLine).toBeDefined()
    expect(identityLine).toContain('requestId=req-g18-test')
    expect(confidenceLine).toContain('requestId=req-g18-test')
  })
})
