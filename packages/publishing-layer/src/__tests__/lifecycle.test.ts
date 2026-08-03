import { describe, it, expect } from 'vitest'
import {
  assertActionLegal,
  assertGateAllowed,
  buildEvent,
  deriveVersionState,
  LifecycleError,
} from '../lifecycle'
import type { Actor, Approval, ArtifactVersion, Publication, PublishEvent } from '../types'

const actor: Actor = { userId: 'u1', role: 'owner', kind: 'human' }

function makeVersion(overrides: Partial<ArtifactVersion> = {}): ArtifactVersion {
  return {
    id: 'v1',
    artifactId: 'a1',
    workspaceId: 'w1',
    versionNumber: 1,
    source: { artifactType: 'carousel', contentHash: 'hash1' },
    renderedOutputs: [],
    createdAt: new Date().toISOString(),
    createdBy: actor,
    supersedes: null,
    supersededBy: null,
    ...overrides,
  }
}

function makeApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 'ap1',
    artifactVersionId: 'v1',
    workspaceId: 'w1',
    purpose: 'external_distribution',
    decision: 'approved',
    decidedBy: actor,
    decidedAt: new Date().toISOString(),
    policySnapshot: { requirePublishingApproval: true, requireApprovalForExternalPublish: true },
    ...overrides,
  }
}

function makePublication(overrides: Partial<Publication> = {}): Publication {
  return {
    id: 'p1',
    artifactVersionId: 'v1',
    destinationId: 'd1',
    distributionJobId: 'j1',
    workspaceId: 'w1',
    destinationReference: 'ref1',
    publishedAt: new Date().toISOString(),
    publishedBy: actor,
    revoked: false,
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  }
}

describe('deriveVersionState', () => {
  it('returns generated for a version with no evidence', () => {
    const state = deriveVersionState({ version: makeVersion(), approvals: [], publications: [], events: [] })
    expect(state).toBe('generated')
  })

  it('returns reviewed when a reviewed event exists', () => {
    const events: PublishEvent[] = [
      buildEvent('reviewed', { artifactId: 'a1', artifactVersionId: 'v1', workspaceId: 'w1', actor }),
    ]
    const state = deriveVersionState({ version: makeVersion(), approvals: [], publications: [], events })
    expect(state).toBe('reviewed')
  })

  it('returns approved when an approved Approval exists', () => {
    const state = deriveVersionState({
      version: makeVersion(),
      approvals: [makeApproval({ decision: 'approved' })],
      publications: [],
      events: [],
    })
    expect(state).toBe('approved')
  })

  it('does not treat a rejected Approval as approved', () => {
    const state = deriveVersionState({
      version: makeVersion(),
      approvals: [makeApproval({ decision: 'rejected' })],
      publications: [],
      events: [],
    })
    expect(state).toBe('generated')
  })

  it('returns published when an active Publication exists', () => {
    const state = deriveVersionState({
      version: makeVersion(),
      approvals: [makeApproval()],
      publications: [makePublication()],
      events: [],
    })
    expect(state).toBe('published')
  })

  it('falls back below published when the only Publication is revoked', () => {
    const state = deriveVersionState({
      version: makeVersion(),
      approvals: [makeApproval()],
      publications: [makePublication({ revoked: true })],
      events: [],
    })
    expect(state).toBe('approved')
  })

  it('returns archived when supersededBy is set, regardless of other evidence', () => {
    const state = deriveVersionState({
      version: makeVersion({ supersededBy: 'v2' }),
      approvals: [makeApproval()],
      publications: [makePublication()],
      events: [],
    })
    expect(state).toBe('archived')
  })

  it('returns archived when an explicit artifact_archived event exists', () => {
    const events: PublishEvent[] = [
      buildEvent('artifact_archived', { artifactId: 'a1', artifactVersionId: 'v1', workspaceId: 'w1', actor }),
    ]
    const state = deriveVersionState({ version: makeVersion(), approvals: [], publications: [], events })
    expect(state).toBe('archived')
  })

  it('returns deleted when an artifact_deleted event exists, overriding everything else', () => {
    const events: PublishEvent[] = [
      buildEvent('artifact_deleted', { artifactId: 'a1', artifactVersionId: 'v1', workspaceId: 'w1', actor }),
    ]
    const state = deriveVersionState({
      version: makeVersion({ supersededBy: 'v2' }),
      approvals: [makeApproval()],
      publications: [makePublication()],
      events,
    })
    expect(state).toBe('deleted')
  })
})

describe('assertActionLegal', () => {
  it('allows review from generated', () => {
    expect(() => assertActionLegal('review', 'generated')).not.toThrow()
  })

  it('allows decide_approval to be called again from approved (re-approval)', () => {
    expect(() => assertActionLegal('decide_approval', 'approved')).not.toThrow()
  })

  it('rejects any action once deleted', () => {
    expect(() => assertActionLegal('review', 'deleted')).toThrow(LifecycleError)
    expect(() => assertActionLegal('archive', 'deleted')).toThrow(LifecycleError)
  })

  it('rejects most actions once archived, except delete', () => {
    expect(() => assertActionLegal('review', 'archived')).toThrow(LifecycleError)
    expect(() => assertActionLegal('decide_approval', 'archived')).toThrow(LifecycleError)
    expect(() => assertActionLegal('delete', 'archived')).not.toThrow()
  })

  it('rejects archive from a state not in its allowed set is unreachable, but rejects illegal combos generally', () => {
    // 'review' is not a legal action from 'published' per the guard table's
    // absence — 'review' only allows generated/reviewed.
    expect(() => assertActionLegal('review', 'published')).toThrow(LifecycleError)
  })

  it('throws with code "invalid_action" for a plain illegal transition', () => {
    let caught: unknown
    try {
      assertActionLegal('review', 'published')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(LifecycleError)
    expect((caught as InstanceType<typeof LifecycleError>).code).toBe('invalid_action')
  })

  it('throws with code "version_superseded" for archived-state violations', () => {
    let caught: unknown
    try {
      assertActionLegal('review', 'archived')
    } catch (err) {
      caught = err
    }
    expect((caught as InstanceType<typeof LifecycleError>).code).toBe('version_superseded')
  })
})

describe('assertGateAllowed', () => {
  it('does not throw when the gate allows', () => {
    expect(() => assertGateAllowed({ allowed: true })).not.toThrow()
  })

  it('throws LifecycleError with code "gate_denied" when the gate denies', () => {
    let caught: unknown
    try {
      assertGateAllowed({ allowed: false, reason: 'nope' })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(LifecycleError)
    expect((caught as InstanceType<typeof LifecycleError>).code).toBe('gate_denied')
    expect((caught as Error).message).toBe('nope')
  })
})

describe('buildEvent', () => {
  it('produces a fully-populated, frozen-detail PublishEvent', () => {
    const event = buildEvent('reviewed', {
      artifactId: 'a1',
      artifactVersionId: 'v1',
      workspaceId: 'w1',
      actor,
      detail: { note: 'looks good' },
    })
    expect(event.type).toBe('reviewed')
    expect(event.artifactId).toBe('a1')
    expect(event.actor).toEqual(actor)
    expect(event.detail).toEqual({ note: 'looks good' })
    expect(() => {
      ;(event.detail as any).note = 'mutated'
    }).toThrow()
    expect(event.id).toBeTruthy()
    expect(event.occurredAt).toBeTruthy()
  })

  it('generates unique ids across calls', () => {
    const a = buildEvent('reviewed', { artifactId: 'a1', artifactVersionId: 'v1', workspaceId: 'w1', actor })
    const b = buildEvent('reviewed', { artifactId: 'a1', artifactVersionId: 'v1', workspaceId: 'w1', actor })
    expect(a.id).not.toBe(b.id)
  })
})
