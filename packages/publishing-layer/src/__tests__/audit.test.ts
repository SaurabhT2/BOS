import { describe, it, expect } from 'vitest'
import { buildAuditRecord, publicationsByContentHash } from '../audit'
import { buildEvent } from '../lifecycle'
import type { Actor, Approval, Artifact, ArtifactVersion, Publication } from '../types'

const actor: Actor = { userId: 'u1', role: 'owner', kind: 'human' }

const artifact: Artifact = {
  id: 'a1',
  workspaceId: 'w1',
  ownerId: 'u1',
  title: 'Q3 Carousel',
  artifactType: 'carousel',
  createdAt: new Date().toISOString(),
  currentState: 'published',
  currentVersionId: 'v2',
  tags: [],
}

function makeVersion(id: string, versionNumber: number, supersededBy: string | null = null): ArtifactVersion {
  return {
    id,
    artifactId: 'a1',
    workspaceId: 'w1',
    versionNumber,
    source: { artifactType: 'carousel', contentHash: `hash-${id}` },
    renderedOutputs: [],
    createdAt: new Date().toISOString(),
    createdBy: actor,
    supersedes: versionNumber > 1 ? `v${versionNumber - 1}` : null,
    supersededBy,
  }
}

describe('buildAuditRecord', () => {
  it('groups approvals and publications under their own version', () => {
    const versions = [makeVersion('v1', 1, 'v2'), makeVersion('v2', 2)]
    const approval: Approval = {
      id: 'ap1',
      artifactVersionId: 'v2',
      workspaceId: 'w1',
      purpose: 'external_distribution',
      decision: 'approved',
      decidedBy: actor,
      decidedAt: new Date().toISOString(),
      policySnapshot: { requirePublishingApproval: true, requireApprovalForExternalPublish: true },
    }
    const publication: Publication = {
      id: 'p1',
      artifactVersionId: 'v2',
      destinationId: 'd1',
      distributionJobId: 'j1',
      workspaceId: 'w1',
      destinationReference: 'ref1',
      publishedAt: new Date().toISOString(),
      publishedBy: actor,
      revoked: false,
      revokedAt: null,
      revokedReason: null,
    }
    const record = buildAuditRecord({ artifact, versions, approvals: [approval], publications: [publication], events: [] })

    expect(record.artifactId).toBe('a1')
    expect(record.versions).toHaveLength(2)
    expect(record.versions[0].approvals).toHaveLength(0)
    expect(record.versions[1].approvals).toHaveLength(1)
    expect(record.versions[1].publications).toHaveLength(1)
    expect(record.currentState).toBe('published')
  })

  it('sorts versions by versionNumber regardless of input order', () => {
    const versions = [makeVersion('v2', 2), makeVersion('v1', 1)]
    const record = buildAuditRecord({ artifact, versions, approvals: [], publications: [], events: [] })
    expect(record.versions.map((v) => v.versionNumber)).toEqual([1, 2])
  })

  it('sorts events chronologically', () => {
    const versions = [makeVersion('v1', 1)]
    const e1 = buildEvent('version_generated', { artifactId: 'a1', artifactVersionId: 'v1', workspaceId: 'w1', actor })
    const e2 = { ...buildEvent('reviewed', { artifactId: 'a1', artifactVersionId: 'v1', workspaceId: 'w1', actor }), occurredAt: new Date(Date.now() - 100000).toISOString() }
    const record = buildAuditRecord({ artifact, versions, approvals: [], publications: [], events: [e1, e2] })
    expect(record.events[0].id).toBe(e2.id)
    expect(record.events[1].id).toBe(e1.id)
  })

  it('falls back to the last version when Artifact.currentVersionId is unset', () => {
    const noCurrentVersion: Artifact = { ...artifact, currentVersionId: null, currentState: 'generated' }
    const versions = [makeVersion('v1', 1), makeVersion('v2', 2)]
    const record = buildAuditRecord({ artifact: noCurrentVersion, versions, approvals: [], publications: [], events: [] })
    expect(record.currentState).toBe('generated')
  })
})

describe('publicationsByContentHash', () => {
  it('filters publications to only the version matching a given content hash', () => {
    const versions = [makeVersion('v1', 1, 'v2'), makeVersion('v2', 2)]
    const pub1: Publication = {
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
    }
    const record = buildAuditRecord({ artifact, versions, approvals: [], publications: [pub1], events: [] })
    const found = publicationsByContentHash(record, 'hash-v1')
    expect(found).toEqual([pub1])
    expect(publicationsByContentHash(record, 'hash-v2')).toEqual([])
  })
})
