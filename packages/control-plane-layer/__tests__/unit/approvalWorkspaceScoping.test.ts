/**
 * Regression test — G-24 (Architecture Verification Report, P1)
 *
 * `runPhaseCLifecycle()`'s two `globalApprovalService` calls (`.evaluate()`
 * and `.submit()`) previously passed `input.userId` as `workspaceId`, the
 * same conflation bug already fixed for the audit-trail/versioning calls
 * three lines above them. Left deliberately unfixed pending a verification
 * pass against `brandos_artifact_approvals` consumers — that audit found
 * zero callers of `ApprovalService.getPending()` and no other consumer of
 * the table anywhere in either repository, so the fix is a safe, isolated
 * change with no consumer migration required.
 *
 * This test spies on the real `globalApprovalService` (no module mock — the
 * bug is specifically about what gets passed to it) and asserts both calls
 * receive `input.workspaceId`, using a workspace id that is deliberately
 * different from userId so the pre-fix bug (asserting on workspaceId ===
 * userId) cannot silently pass.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { compileAndGovernMock, orchestrateMock } = vi.hoisted(() => ({
  compileAndGovernMock: vi.fn(),
  orchestrateMock: vi.fn(),
}))

vi.mock('@brandos/artifact-engine-layer', () => ({
  globalArtifactEngine: {
    compileAndGovern: (...args: unknown[]) => compileAndGovernMock(...args),
  },
  ArtifactEngineRejection: class ArtifactEngineRejection extends Error {
    constructor(
      public reason: string,
      public repairAttempts: number,
      public lastValidArtifact?: unknown,
    ) {
      super(reason)
      this.name = 'ArtifactEngineRejection'
    }
  },
  isArtifactEngineRejection: (err: unknown): boolean =>
    err instanceof Error && err.name === 'ArtifactEngineRejection',
}))

vi.mock('../../src/orchestrator', () => ({
  CPLOrchestrator: vi.fn().mockImplementation(() => ({
    orchestrate: (...args: unknown[]) => orchestrateMock(...args),
  })),
}))

// Governance/richness threshold set to 0 so any compileAndGovern score
// reaches Phase C — this test is about the approval-service call, not the
// richness-retry loop, which is already covered by richnessRetryBestArtifact.test.ts.
vi.mock('../../src/admin/settings-service', () => ({
  AdminSettingsService: {
    getGovernancePolicy: () => ({ scoreThresholds: { carousel: 0 } }),
  },
}))

import { executeArtifactPipeline } from '../../src/artifact-pipeline'
import type { ArtifactPipelineInput } from '../../src/artifact-pipeline'
import { globalApprovalService } from '../../src/approval/approval-service'

function fakeCarouselArtifact(score: number) {
  return {
    artifact_type: 'carousel',
    carousel_meta: {},
    slides: [{ role: 'hook', text: 'placeholder' }],
    richness_metrics: { overall_score: score },
  }
}

function fakeCompileAndGovernResult(score: number) {
  return {
    artifact: fakeCarouselArtifact(score),
    governanceResult: {
      success: true,
      artifact: fakeCarouselArtifact(score),
      repaired: false,
      attempts: 1,
      passed: true,
    },
  }
}

function baseInput(overrides: Partial<ArtifactPipelineInput> = {}): ArtifactPipelineInput {
  return {
    topic: 'AI Governance',
    taskType: 'carousel',
    tone: 'professional',
    rawLLMOutput: 'initial raw LLM text',
    cpResponse: {} as ArtifactPipelineInput['cpResponse'],
    runtimeMode: 'cloud',
    userId: 'user-distinct-1',
    workspaceId: 'ws-distinct-9',
    requestId: 'req-g24-test',
    supabase: {},
    ...overrides,
  }
}

describe('runPhaseCLifecycle — approval-service workspace scoping (G-24)', () => {
  let evaluateSpy: ReturnType<typeof vi.spyOn>
  let submitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    compileAndGovernMock.mockReset()
    orchestrateMock.mockReset()
    evaluateSpy = vi.spyOn(globalApprovalService, 'evaluate')
    submitSpy = vi.spyOn(globalApprovalService, 'submit').mockResolvedValue({
      requestId: 'req-g24-test',
      workspaceId: 'ws-distinct-9',
      artifactType: 'carousel',
      status: 'pending',
      score: 50,
      createdAt: new Date().toISOString(),
    })
  })

  afterEach(() => {
    evaluateSpy.mockRestore()
    submitSpy.mockRestore()
  })

  it('passes input.workspaceId (not input.userId) to ApprovalService.evaluate()', async () => {
    // Score 85 — above the 70 approval threshold, so evaluate() is called
    // but submit() is not (auto-approved).
    compileAndGovernMock.mockResolvedValueOnce(fakeCompileAndGovernResult(85))

    await executeArtifactPipeline(baseInput())

    expect(evaluateSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: 'ws-distinct-9' }),
    )
    // Regression guard: must NOT be the userId, which is the pre-fix bug.
    expect(evaluateSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: 'user-distinct-1' }),
    )
  })

  it('passes input.workspaceId (not input.userId) to ApprovalService.submit() when approval is required', async () => {
    // Score 50 — below the 70 approval threshold, so both evaluate() and
    // submit() fire.
    compileAndGovernMock.mockResolvedValueOnce(fakeCompileAndGovernResult(50))

    await executeArtifactPipeline(baseInput())

    expect(submitSpy).toHaveBeenCalledWith(
      'req-g24-test',
      expect.anything(),
      expect.objectContaining({ workspaceId: 'ws-distinct-9' }),
    )
    expect(submitSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ workspaceId: 'user-distinct-1' }),
    )
  })

  it('a workspace-scoped approvals read (getPending) sees artifacts generated by any user in that workspace', async () => {
    // Integration-style guard for the acceptance criterion: two different
    // users in the SAME workspace both generate artifacts requiring
    // approval; a single workspace-scoped getPending() call must surface both.
    submitSpy.mockRestore()

    compileAndGovernMock
      .mockResolvedValueOnce(fakeCompileAndGovernResult(50))
      .mockResolvedValueOnce(fakeCompileAndGovernResult(55))

    await executeArtifactPipeline(baseInput({ userId: 'user-a', workspaceId: 'ws-shared', requestId: 'req-a' }))
    await executeArtifactPipeline(baseInput({ userId: 'user-b', workspaceId: 'ws-shared', requestId: 'req-b' }))

    const pending = globalApprovalService.getPending('ws-shared')
    const requestIds = pending.map(r => r.requestId)
    expect(requestIds).toContain('req-a')
    expect(requestIds).toContain('req-b')
  })
})
