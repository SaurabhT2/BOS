import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  createSupabasePublishingRepositories,
  isTableMissing,
  artifactToRow,
  rowToArtifact,
  versionToRow,
  rowToVersion,
  approvalToRow,
  rowToApproval,
  destinationToRow,
  rowToDestination,
  jobToRow,
  rowToJob,
  publicationToRow,
  rowToPublication,
  eventToRow,
  rowToEvent,
  retentionToRow,
  rowToRetention,
  __resetWarnedTableMissingForTests,
} from '../repository-supabase'
import { buildEvent } from '../lifecycle'
import type {
  Actor,
  Approval,
  Artifact,
  ArtifactVersion,
  Destination,
  DistributionJob,
  Publication,
  RetentionPolicy,
} from '../types'

const actor: Actor = { userId: 'u1', role: 'owner', kind: 'human' }

describe('isTableMissing', () => {
  it('returns false for a null error', () => {
    expect(isTableMissing(null)).toBe(false)
  })

  it('returns true for Postgres undefined-table code 42P01', () => {
    expect(isTableMissing({ code: '42P01' })).toBe(true)
  })

  it('returns true when the message mentions "does not exist"', () => {
    expect(isTableMissing({ message: 'relation "brandos_publishing_artifacts" does not exist' })).toBe(true)
  })

  it('returns false for an unrelated error', () => {
    expect(isTableMissing({ code: '23505', message: 'duplicate key value' })).toBe(false)
  })
})

describe('row <-> domain mapper round-trips', () => {
  it('Artifact round-trips through artifactToRow/rowToArtifact', () => {
    const artifact: Artifact = {
      id: 'a1',
      workspaceId: 'w1',
      ownerId: 'u1',
      title: 'Q3 Carousel',
      artifactType: 'carousel',
      createdAt: new Date().toISOString(),
      currentState: 'published',
      currentVersionId: 'v2',
      tags: ['q3', 'growth'],
    }
    expect(rowToArtifact(artifactToRow(artifact))).toEqual(artifact)
  })

  it('ArtifactVersion round-trips, including a null supersededBy', () => {
    const version: ArtifactVersion = {
      id: 'v1',
      artifactId: 'a1',
      workspaceId: 'w1',
      versionNumber: 1,
      source: { artifactType: 'carousel', contentHash: 'hash1' },
      renderedOutputs: [
        { format: 'html', mimeType: 'text/html', storageKey: 'a1/v1/html-abc', contentHash: 'abc', sizeBytes: 100, renderedAt: new Date().toISOString() },
      ],
      createdAt: new Date().toISOString(),
      createdBy: actor,
      supersedes: null,
      supersededBy: null,
    }
    expect(rowToVersion(versionToRow(version))).toEqual(version)
  })

  it('ArtifactVersion round-trips a retained source payload', () => {
    const version: ArtifactVersion = {
      id: 'v1',
      artifactId: 'a1',
      workspaceId: 'w1',
      versionNumber: 1,
      source: { artifactType: 'carousel', contentHash: 'hash1', payload: { artifact_type: 'carousel' } as any },
      renderedOutputs: [],
      createdAt: new Date().toISOString(),
      createdBy: actor,
      supersedes: null,
      supersededBy: null,
    }
    const roundTripped = rowToVersion(versionToRow(version))
    expect(roundTripped.source.payload).toEqual(version.source.payload)
  })

  it('Approval round-trips, including an undefined reason', () => {
    const approval: Approval = {
      id: 'ap1',
      artifactVersionId: 'v1',
      workspaceId: 'w1',
      purpose: 'external_distribution',
      decision: 'approved',
      decidedBy: actor,
      decidedAt: new Date().toISOString(),
      policySnapshot: { requirePublishingApproval: true, requireApprovalForExternalPublish: true },
    }
    expect(rowToApproval(approvalToRow(approval))).toEqual(approval)
  })

  it('Destination round-trips', () => {
    const destination: Destination = {
      id: 'd1',
      workspaceId: 'w1',
      publisherId: 'share-link',
      name: 'My Link',
      config: { signedUrlTtlSeconds: 3600 },
      createdAt: new Date().toISOString(),
      createdBy: actor,
      active: true,
    }
    expect(rowToDestination(destinationToRow(destination))).toEqual(destination)
  })

  it('DistributionJob round-trips', () => {
    const job: DistributionJob = {
      id: 'j1',
      artifactVersionId: 'v1',
      destinationId: 'd1',
      workspaceId: 'w1',
      format: 'html',
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      requestedBy: actor,
      requestedAt: new Date().toISOString(),
      lastAttemptAt: null,
      lastError: null,
      publicationId: null,
    }
    expect(rowToJob(jobToRow(job))).toEqual(job)
  })

  it('Publication round-trips', () => {
    const publication: Publication = {
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
    expect(rowToPublication(publicationToRow(publication))).toEqual(publication)
  })

  it('PublishEvent round-trips', () => {
    const event = buildEvent('reviewed', { artifactId: 'a1', artifactVersionId: 'v1', workspaceId: 'w1', actor, detail: { note: 'ok' } })
    expect(rowToEvent(eventToRow(event))).toEqual(event)
  })

  it('RetentionPolicy round-trips', () => {
    const policy: RetentionPolicy = {
      workspaceId: 'w1',
      minRetentionDays: 90,
      hardDeleteAllowed: false,
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    }
    expect(rowToRetention(retentionToRow(policy))).toEqual(policy)
  })
})

// ─── Missing-credentials guard ──────────────────────────────────────────────
// No live Supabase project is reachable from this sandbox (see
// PUBLISHING_LAYER_NOTES.md's "Known limitations"). What IS genuinely
// testable without one is the guard every method goes through first: a
// clear, immediate error rather than an opaque network failure. This is
// real production code being exercised, not a workaround — it is the
// actual first line of every repository method.

describe('Supabase*Repository — missing credentials guard', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    __resetWarnedTableMissingForTests()
  })

  afterAll(() => {
    if (originalUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
    if (originalKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
  })

  const repos = createSupabasePublishingRepositories()

  it('ArtifactRepository.create throws a clear configuration error, not a network error', async () => {
    await expect(
      repos.artifacts.create({
        id: 'a1',
        workspaceId: 'w1',
        ownerId: 'u1',
        title: 'x',
        artifactType: 'carousel',
        createdAt: new Date().toISOString(),
        currentState: 'generated',
        currentVersionId: null,
        tags: [],
      }),
    ).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('ArtifactVersionRepository.get throws the same clear error', async () => {
    await expect(repos.versions.get('v1', 'w1')).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('ApprovalRepository.listForVersion throws the same clear error', async () => {
    await expect(repos.approvals.listForVersion('v1', 'w1')).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('DestinationRepository.list throws the same clear error', async () => {
    await expect(repos.destinations.list('w1')).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('DistributionJobRepository.get throws the same clear error', async () => {
    await expect(repos.distributionJobs.get('j1', 'w1')).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('PublicationRepository.listForArtifact throws the same clear error', async () => {
    await expect(repos.publications.listForArtifact('a1', 'w1')).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('PublishEventRepository.append throws the same clear error', async () => {
    const event = buildEvent('reviewed', { artifactId: 'a1', artifactVersionId: 'v1', workspaceId: 'w1', actor })
    await expect(repos.events.append(event)).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('RetentionPolicyRepository.get throws the same clear error', async () => {
    await expect(repos.retentionPolicies.get('w1')).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('error message directs the caller to the in-memory alternative', async () => {
    await expect(repos.artifacts.list('w1')).rejects.toThrow(/createInMemoryPublishingRepositories/)
  })
})
