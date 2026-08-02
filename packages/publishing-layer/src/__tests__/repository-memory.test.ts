import { describe, it, expect } from 'vitest'
import { createInMemoryPublishingRepositories } from '../repository-memory'
import type { Actor, Artifact, ArtifactVersion, DistributionJob, Publication } from '../types'

const actor: Actor = { userId: 'u1', role: 'owner', kind: 'human' }

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'a1',
    workspaceId: 'w1',
    ownerId: 'u1',
    title: 'Test',
    artifactType: 'carousel',
    createdAt: new Date().toISOString(),
    currentState: 'generated',
    currentVersionId: null,
    tags: [],
    ...overrides,
  }
}

function makeVersion(overrides: Partial<ArtifactVersion> = {}): ArtifactVersion {
  return {
    id: 'v1',
    artifactId: 'a1',
    workspaceId: 'w1',
    versionNumber: 1,
    source: { artifactType: 'carousel', contentHash: 'h1' },
    renderedOutputs: [],
    createdAt: new Date().toISOString(),
    createdBy: actor,
    supersedes: null,
    supersededBy: null,
    ...overrides,
  }
}

describe('InMemoryArtifactRepository', () => {
  it('create() rejects a duplicate id', async () => {
    const repos = createInMemoryPublishingRepositories()
    await repos.artifacts.create(makeArtifact())
    await expect(repos.artifacts.create(makeArtifact())).rejects.toThrow()
  })

  it('get() returns null for a different workspaceId (workspace isolation)', async () => {
    const repos = createInMemoryPublishingRepositories()
    await repos.artifacts.create(makeArtifact())
    expect(await repos.artifacts.get('a1', 'other-workspace')).toBeNull()
  })

  it('updateCurrentVersion() throws for a nonexistent artifact', async () => {
    const repos = createInMemoryPublishingRepositories()
    await expect(
      repos.artifacts.updateCurrentVersion('nonexistent', 'w1', { currentVersionId: 'v1', currentState: 'generated' }),
    ).rejects.toThrow()
  })

  it('list() only returns artifacts in the given workspace', async () => {
    const repos = createInMemoryPublishingRepositories()
    await repos.artifacts.create(makeArtifact({ id: 'a1', workspaceId: 'w1' }))
    await repos.artifacts.create(makeArtifact({ id: 'a2', workspaceId: 'w2' }))
    expect(await repos.artifacts.list('w1')).toHaveLength(1)
  })
})

describe('InMemoryArtifactVersionRepository', () => {
  it('markSuperseded() throws when the version is already superseded', async () => {
    const repos = createInMemoryPublishingRepositories()
    await repos.versions.create(makeVersion({ id: 'v1' }))
    await repos.versions.markSuperseded('v1', 'w1', 'v2')
    await expect(repos.versions.markSuperseded('v1', 'w1', 'v3')).rejects.toThrow()
  })

  it('markSuperseded() throws for a nonexistent version', async () => {
    const repos = createInMemoryPublishingRepositories()
    await expect(repos.versions.markSuperseded('nonexistent', 'w1', 'v2')).rejects.toThrow()
  })

  it('appendRenderedOutput() replaces an existing entry for the same format rather than duplicating it', async () => {
    const repos = createInMemoryPublishingRepositories()
    await repos.versions.create(makeVersion({ id: 'v1' }))
    await repos.versions.appendRenderedOutput('v1', 'w1', {
      format: 'html',
      mimeType: 'text/html',
      storageKey: 'key-1',
      contentHash: 'h1',
      sizeBytes: 10,
      renderedAt: new Date().toISOString(),
    })
    await repos.versions.appendRenderedOutput('v1', 'w1', {
      format: 'html',
      mimeType: 'text/html',
      storageKey: 'key-2',
      contentHash: 'h2',
      sizeBytes: 20,
      renderedAt: new Date().toISOString(),
    })
    const version = await repos.versions.get('v1', 'w1')
    expect(version?.renderedOutputs).toHaveLength(1)
    expect(version?.renderedOutputs[0].storageKey).toBe('key-2')
  })

  it('listForArtifact() returns versions sorted by versionNumber', async () => {
    const repos = createInMemoryPublishingRepositories()
    await repos.versions.create(makeVersion({ id: 'v2', versionNumber: 2 }))
    await repos.versions.create(makeVersion({ id: 'v1', versionNumber: 1 }))
    const versions = await repos.versions.listForArtifact('a1', 'w1')
    expect(versions.map((v) => v.id)).toEqual(['v1', 'v2'])
  })
})

describe('InMemoryDestinationRepository', () => {
  it('setActive() throws for a nonexistent destination', async () => {
    const repos = createInMemoryPublishingRepositories()
    await expect(repos.destinations.setActive('nonexistent', 'w1', false)).rejects.toThrow()
  })
})

describe('InMemoryDistributionJobRepository', () => {
  it('update() applies a partial patch without clobbering unrelated fields', async () => {
    const repos = createInMemoryPublishingRepositories()
    const job: DistributionJob = {
      id: 'j1',
      artifactVersionId: 'v1',
      destinationId: 'd1',
      workspaceId: 'w1',
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      requestedBy: actor,
      requestedAt: new Date().toISOString(),
      lastAttemptAt: null,
      lastError: null,
      publicationId: null,
    }
    await repos.distributionJobs.create(job)
    await repos.distributionJobs.update('j1', 'w1', { status: 'succeeded', attempts: 1 })
    const updated = await repos.distributionJobs.get('j1', 'w1')
    expect(updated?.status).toBe('succeeded')
    expect(updated?.attempts).toBe(1)
    expect(updated?.destinationId).toBe('d1') // untouched
  })
})

describe('InMemoryPublicationRepository', () => {
  it('revoke() throws for a nonexistent publication', async () => {
    const repos = createInMemoryPublishingRepositories()
    await expect(repos.publications.revoke('nonexistent', 'w1', 'reason', new Date().toISOString())).rejects.toThrow()
  })

  it('listForVersion() scopes correctly to a single version', async () => {
    const repos = createInMemoryPublishingRepositories()
    const pub: Publication = {
      id: 'p1',
      artifactVersionId: 'v1',
      destinationId: 'd1',
      distributionJobId: 'j1',
      workspaceId: 'w1',
      destinationReference: 'ref',
      publishedAt: new Date().toISOString(),
      publishedBy: actor,
      revoked: false,
      revokedAt: null,
      revokedReason: null,
    }
    await repos.publications.create(pub)
    expect(await repos.publications.listForVersion('v1', 'w1')).toHaveLength(1)
    expect(await repos.publications.listForVersion('v2', 'w1')).toHaveLength(0)
  })
})

describe('InMemoryRetentionPolicyRepository', () => {
  it('get() returns null when no policy has been set for a workspace', async () => {
    const repos = createInMemoryPublishingRepositories()
    expect(await repos.retentionPolicies.get('w1')).toBeNull()
  })

  it('upsert() then get() round-trips correctly', async () => {
    const repos = createInMemoryPublishingRepositories()
    await repos.retentionPolicies.upsert({
      workspaceId: 'w1',
      minRetentionDays: 90,
      hardDeleteAllowed: true,
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    })
    const policy = await repos.retentionPolicies.get('w1')
    expect(policy?.minRetentionDays).toBe(90)
    expect(policy?.hardDeleteAllowed).toBe(true)
  })
})
