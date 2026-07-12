/**
 * Regression test — RICHNESS-RETRY-002 (P1 fix)
 *
 * Runtime investigation, Issue C: the carousel richness-retry loop
 * (runCarouselPipeline in artifact-pipeline.ts) previously threw
 * ArtifactPipelineRejection with the artifact from the MOST RECENT attempt
 * on budget exhaustion, even when an earlier attempt in the same retry
 * sequence had scored higher on richness. Observed in production trace
 * `8f32d207`: attempt scores were 72 → 77 → 67, and the artifact returned
 * to the frontend (via the P3-RECOVERY degraded path) was the 67-scoring
 * one, discarding the 77-scoring artifact that had already been generated.
 *
 * This test reproduces that exact score sequence with all provider/engine
 * calls mocked at the module boundary (no real OCL, governance, or LLM
 * calls) and asserts the recovered artifact is the 77-scoring one.
 *
 * It also covers the second call site that reads the same accumulator —
 * the regeneration-provider-failure fallback — to confirm it also recovers
 * the best attempt rather than the attempt that was in flight when the
 * provider failed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock @brandos/artifact-engine-layer ───────────────────────────────────
// compileAndGovern() is called once per richness attempt. We control its
// return value (and therefore richness_metrics.overall_score) per call via
// mockResolvedValueOnce / mockImplementationOnce chains in each test.
//
// vi.mock() factories are hoisted above all other module-level code, so the
// shared mock fns must be created via vi.hoisted() rather than a plain
// top-level `const` — otherwise the factory below would close over a
// not-yet-initialized binding.
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

// ─── Mock ./orchestrator ────────────────────────────────────────────────────
// Each richness-retry regeneration calls `new CPLOrchestrator().orchestrate()`.
// We don't care about its internals here — only that it returns raw text for
// the next compileAndGovern() call.

vi.mock('../../src/orchestrator', () => ({
  CPLOrchestrator: vi.fn().mockImplementation(() => ({
    orchestrate: (...args: unknown[]) => orchestrateMock(...args),
  })),
}))

// ─── Mock ./admin/settings-service ──────────────────────────────────────────
// Fixes the effective richness threshold at 80 for 'cloud' mode, matching
// the production trace this test reproduces (effectiveThreshold=80).

vi.mock('../../src/admin/settings-service', () => ({
  AdminSettingsService: {
    getGovernancePolicy: () => ({ scoreThresholds: { carousel: 80 } }),
  },
}))

import { executeArtifactPipeline, isArtifactPipelineRejection } from '../../src/artifact-pipeline'
import type { ArtifactPipelineInput } from '../../src/artifact-pipeline'

// ─── Test fixtures ──────────────────────────────────────────────────────────

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
    userId: 'user-1',
    workspaceId: 'ws-6756dc05',
    requestId: 'req-8f32d207',
    supabase: {},
    ...overrides,
  }
}

beforeEach(() => {
  compileAndGovernMock.mockReset()
  orchestrateMock.mockReset()
  orchestrateMock.mockResolvedValue({
    requestId: 'regen-req',
    artifact: { content: 'regenerated raw LLM text', artifactType: 'carousel' },
    score: 0,
    wasRepaired: false,
    cognitionContext: {},
    durationMs: 1,
  })
})

describe('runCarouselPipeline richness retry — best-artifact recovery (P1 fix)', () => {
  it('recovers the highest-scoring governance-valid attempt on budget exhaustion, not the last attempt', async () => {
    // Reproduces production trace 8f32d207: 72 → 77 → 67, all governance-passed,
    // all below the 80 threshold, budget exhausted after 3 attempts.
    compileAndGovernMock
      .mockResolvedValueOnce(fakeCompileAndGovernResult(72))
      .mockResolvedValueOnce(fakeCompileAndGovernResult(77))
      .mockResolvedValueOnce(fakeCompileAndGovernResult(67))

    let caught: unknown
    try {
      await executeArtifactPipeline(baseInput())
    } catch (err) {
      caught = err
    }

    expect(isArtifactPipelineRejection(caught)).toBe(true)
    const rejection = caught as import('../../src/artifact-pipeline').ArtifactPipelineRejection
    expect(rejection.isDegradedRecoverable).toBe(true)

    // Pre-fix behaviour returned 67 (the last attempt). Fixed behaviour
    // must return 77 (the best of the three governance-passed attempts).
    const recovered = rejection.lastValidArtifact as ReturnType<typeof fakeCarouselArtifact>
    expect(recovered.richness_metrics.overall_score).toBe(77)

    expect(compileAndGovernMock).toHaveBeenCalledTimes(3)
  })

  it('recovers the best attempt so far when a mid-loop regeneration provider call fails', async () => {
    // Attempt 1 scores 76 (below threshold, triggers retry).
    // Attempt 2's regeneration then fails at the provider level (e.g. rate
    // limit) before a second compileAndGovern() call ever happens — mirrors
    // production trace f57efc52. The recovered artifact must still be the
    // 76-scoring attempt (the only one that ever completed), not a crash
    // and not an empty artifact.
    compileAndGovernMock.mockResolvedValueOnce(fakeCompileAndGovernResult(76))
    orchestrateMock.mockRejectedValueOnce(new Error('rate_limited: Rate limit reached'))

    let caught: unknown
    try {
      await executeArtifactPipeline(baseInput())
    } catch (err) {
      caught = err
    }

    expect(isArtifactPipelineRejection(caught)).toBe(true)
    const rejection = caught as import('../../src/artifact-pipeline').ArtifactPipelineRejection
    expect(rejection.isDegradedRecoverable).toBe(true)

    const recovered = rejection.lastValidArtifact as ReturnType<typeof fakeCarouselArtifact>
    expect(recovered.richness_metrics.overall_score).toBe(76)
    expect(compileAndGovernMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry or reject when the first attempt already meets the threshold', async () => {
    compileAndGovernMock.mockResolvedValueOnce(fakeCompileAndGovernResult(85))

    const result = await executeArtifactPipeline(baseInput())

    expect(compileAndGovernMock).toHaveBeenCalledTimes(1)
    expect(orchestrateMock).not.toHaveBeenCalled()
    expect((result.artifact as ReturnType<typeof fakeCarouselArtifact>).richness_metrics.overall_score).toBe(85)
  })
})
