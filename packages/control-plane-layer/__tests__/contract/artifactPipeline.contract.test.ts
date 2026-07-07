/**
 * Contract tests — ArtifactPipeline
 *
 * Verifies the shape, type-guards, and error semantics of:
 *   - ArtifactPipelineResult interface shape
 *   - ArtifactPipelineRejection class contract
 *   - isArtifactPipelineRejection() type-guard
 *
 * These are pure structural / contract tests — no real OCL or governance
 * invocations are made. All dependencies are stubbed.
 */

import { describe, it, expect } from 'vitest'
import {
  ArtifactPipelineRejection,
  isArtifactPipelineRejection,
} from '../../src/artifact-pipeline'

// ─── ArtifactPipelineRejection ────────────────────────────────────────────────

describe('ArtifactPipelineRejection contract', () => {
  it('constructs with the correct name', () => {
    const err = new ArtifactPipelineRejection('low_score', 3, 'carousel', 'req-001')
    expect(err.name).toBe('ArtifactPipelineRejection')
  })

  it('is an instance of Error', () => {
    const err = new ArtifactPipelineRejection('low_score', 3, 'carousel', 'req-001')
    expect(err).toBeInstanceOf(Error)
  })

  it('exposes reason field', () => {
    const err = new ArtifactPipelineRejection('missing_hook', 2, 'deck', 'req-002')
    expect(err.reason).toBe('missing_hook')
  })

  it('exposes repairAttempts field', () => {
    const err = new ArtifactPipelineRejection('score_below_threshold', 5, 'report', 'req-003')
    expect(err.repairAttempts).toBe(5)
  })

  it('exposes artifactType field', () => {
    const err = new ArtifactPipelineRejection('low_score', 1, 'carousel', 'req-004')
    expect(err.artifactType).toBe('carousel')
  })

  it('exposes requestId field', () => {
    const err = new ArtifactPipelineRejection('low_score', 1, 'carousel', 'req-test-xyz')
    expect(err.requestId).toBe('req-test-xyz')
  })

  it('message includes repairAttempts count', () => {
    const err = new ArtifactPipelineRejection('low_score', 4, 'deck', 'req-005')
    expect(err.message).toContain('4')
  })

  it('message includes reason', () => {
    const err = new ArtifactPipelineRejection('governance_timeout', 2, 'carousel', 'req-006')
    expect(err.message).toContain('governance_timeout')
  })
})

// ─── isArtifactPipelineRejection type-guard ───────────────────────────────────

describe('isArtifactPipelineRejection type-guard', () => {
  it('returns true for ArtifactPipelineRejection instances', () => {
    const err = new ArtifactPipelineRejection('low_score', 1, 'carousel', 'req-001')
    expect(isArtifactPipelineRejection(err)).toBe(true)
  })

  it('returns false for generic Error instances', () => {
    const err = new Error('something else')
    expect(isArtifactPipelineRejection(err)).toBe(false)
  })

  it('returns false for null', () => {
    expect(isArtifactPipelineRejection(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isArtifactPipelineRejection(undefined)).toBe(false)
  })

  it('returns false for plain objects', () => {
    expect(isArtifactPipelineRejection({ reason: 'low_score' })).toBe(false)
  })

  it('returns false for strings', () => {
    expect(isArtifactPipelineRejection('ArtifactPipelineRejection')).toBe(false)
  })
})


