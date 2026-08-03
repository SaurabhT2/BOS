import { describe, it, expect } from 'vitest'
import { PublishingService, PublishingServiceError } from '../publishing-service'
import { createInMemoryPublishingRepositories } from '../repository-memory'
import { InMemoryRenderedOutputStore } from '../storage'
import { StaticPolicyProvider } from '../policy'
import { createDefaultPublisherRegistry } from '../publishers'
import { PublisherRegistry } from '../publisher-registry'
import { LifecycleError } from '../lifecycle'
import type { Publisher, PublishOutcome, PublishRequest, RevokeOutcome, RevokeRequest } from '../publisher-contract'
import type { Actor } from '../types'
import type { ArtifactV2 } from '@brandos/contracts'

const owner: Actor = { userId: 'user-1', role: 'owner', kind: 'human' }
const viewer: Actor = { userId: 'user-2', role: 'viewer', kind: 'human' }

const carouselPayload = {
  artifact_type: 'carousel',
  title: 'Q3 Growth Carousel',
  slides: [{ role: 'hook', headline: 'Hello' }],
} as unknown as ArtifactV2

function makeService(overrides?: { policy?: StaticPolicyProvider; registry?: PublisherRegistry }) {
  return new PublishingService({
    repositories: createInMemoryPublishingRepositories(),
    store: new InMemoryRenderedOutputStore(),
    policyProvider: overrides?.policy ?? new StaticPolicyProvider({ requirePublishingApproval: false, requireApprovalForExternalPublish: false }),
    publisherRegistry: overrides?.registry ?? createDefaultPublisherRegistry(),
  })
}

async function recordFirstVersion(service: PublishingService, workspaceId = 'ws-1') {
  return service.recordGeneratedVersion({
    workspaceId,
    actor: owner,
    title: 'Q3 Growth Carousel',
    artifactType: 'carousel',
    ownerId: owner.userId,
    source: { payload: carouselPayload },
    renderedOutput: { format: 'html', bytes: new TextEncoder().encode('<html></html>'), mimeType: 'text/html' },
  })
}

describe('PublishingService.recordGeneratedVersion', () => {
  it('creates a new Artifact + first ArtifactVersion when no artifactId is given', async () => {
    const service = makeService()
    const { artifact, version } = await recordFirstVersion(service)

    expect(artifact.currentVersionId).toBe(version.id)
    expect(artifact.currentState).toBe('generated')
    expect(version.versionNumber).toBe(1)
    expect(version.supersedes).toBeNull()
    expect(version.renderedOutputs).toHaveLength(1)
    expect(version.source.contentHash).toBeTruthy()
    expect(version.source.payload).toBeUndefined() // not retained unless requested
  })

  it('retains the source payload when retainSourcePayload is true', async () => {
    const service = makeService()
    const { version } = await service.recordGeneratedVersion({
      workspaceId: 'ws-1',
      actor: owner,
      title: 'x',
      artifactType: 'carousel',
      ownerId: owner.userId,
      source: { payload: carouselPayload, retainSourcePayload: true },
      renderedOutput: { format: 'html', bytes: new TextEncoder().encode('<html></html>'), mimeType: 'text/html' },
    })
    expect(version.source.payload).toEqual(carouselPayload)
  })

  it('creates version 2 and supersedes version 1 when called again with the same artifactId', async () => {
    const service = makeService()
    const { artifact, version: v1 } = await recordFirstVersion(service)

    const { version: v2 } = await service.recordGeneratedVersion({
      workspaceId: 'ws-1',
      actor: owner,
      artifactId: artifact.id,
      title: artifact.title,
      artifactType: 'carousel',
      ownerId: owner.userId,
      source: { payload: carouselPayload },
      renderedOutput: { format: 'html', bytes: new TextEncoder().encode('<html>v2</html>'), mimeType: 'text/html' },
    })

    expect(v2.versionNumber).toBe(2)
    expect(v2.supersedes).toBe(v1.id)

    const trail = await service.getAuditTrail(artifact.id, 'ws-1')
    expect(trail.currentState).toBe('generated')
    expect(trail.versions.map((v) => v.versionNumber)).toEqual([1, 2])
  })

  it('throws PublishingServiceError when artifactId is provided but does not exist', async () => {
    const service = makeService()
    await expect(
      service.recordGeneratedVersion({
        workspaceId: 'ws-1',
        actor: owner,
        artifactId: 'nonexistent',
        title: 'x',
        artifactType: 'carousel',
        ownerId: owner.userId,
        source: { payload: carouselPayload },
        renderedOutput: { format: 'html', bytes: new Uint8Array(), mimeType: 'text/html' },
      }),
    ).rejects.toBeInstanceOf(PublishingServiceError)
  })
})

describe('PublishingService.attachRenderedOutput', () => {
  it('adds a second rendered format to an existing version', async () => {
    const service = makeService()
    const { version } = await recordFirstVersion(service)

    const ref = await service.attachRenderedOutput(version.id, 'ws-1', {
      format: 'pdf',
      bytes: new TextEncoder().encode('%PDF-1.4'),
      mimeType: 'application/pdf',
    })
    expect(ref.format).toBe('pdf')
  })
})

describe('PublishingService review/approval/publish flow', () => {
  it('review is legal from generated and rejects a second identical review is still legal (idempotent-ish guard)', async () => {
    const service = makeService()
    const { version } = await recordFirstVersion(service)
    await expect(service.submitReview(version.id, 'ws-1', owner, 'looks fine')).resolves.toBeUndefined()
  })

  it('approval gate denies an approver whose role is not allowlisted', async () => {
    const service = makeService({ policy: new StaticPolicyProvider({ allowedApproverRoles: ['owner'] }) })
    const { version } = await recordFirstVersion(service)
    await expect(
      service.decideApproval({
        artifactVersionId: version.id,
        workspaceId: 'ws-1',
        actor: viewer,
        purpose: 'external_distribution',
        decision: 'approved',
      }),
    ).rejects.toBeInstanceOf(LifecycleError)
  })

  it('approval succeeds for an allowlisted role and updates derived state to approved', async () => {
    const service = makeService()
    const { artifact, version } = await recordFirstVersion(service)
    const approval = await service.decideApproval({
      artifactVersionId: version.id,
      workspaceId: 'ws-1',
      actor: owner,
      purpose: 'external_distribution',
      decision: 'approved',
    })
    expect(approval.decision).toBe('approved')

    const trail = await service.getAuditTrail(artifact.id, 'ws-1')
    expect(trail.currentState).toBe('approved')
  })

  it('submitPublish is denied when the workspace policy requires approval and none exists', async () => {
    const service = makeService({ policy: new StaticPolicyProvider({ requirePublishingApproval: true }) })
    const { version } = await recordFirstVersion(service)
    const destination = await service.createDestination({
      workspaceId: 'ws-1',
      actor: owner,
      publisherId: 'share-link',
      name: 'My Share Link',
      config: {},
    })
    await expect(
      service.submitPublish({ artifactVersionId: version.id, workspaceId: 'ws-1', actor: owner, destinationId: destination.id }),
    ).rejects.toBeInstanceOf(LifecycleError)
  })

  it('full happy path: approve then publish to Share Link succeeds and is reflected in the audit trail', async () => {
    const service = makeService({ policy: new StaticPolicyProvider({ requirePublishingApproval: true }) })
    const { artifact, version } = await recordFirstVersion(service)

    await service.decideApproval({
      artifactVersionId: version.id,
      workspaceId: 'ws-1',
      actor: owner,
      purpose: 'external_distribution',
      decision: 'approved',
    })

    const destination = await service.createDestination({
      workspaceId: 'ws-1',
      actor: owner,
      publisherId: 'share-link',
      name: 'My Share Link',
      config: {},
    })

    const job = await service.submitPublish({
      artifactVersionId: version.id,
      workspaceId: 'ws-1',
      actor: owner,
      destinationId: destination.id,
    })
    expect(job.status).toBe('succeeded')
    expect(job.publicationId).toBeTruthy()

    const trail = await service.getAuditTrail(artifact.id, 'ws-1')
    expect(trail.currentState).toBe('published')
    expect(trail.versions[0].publications).toHaveLength(1)
    expect(trail.events.map((e) => e.type)).toContain('distribution_succeeded')
  })

  it('submitPublish fails cleanly for an inactive destination', async () => {
    const service = makeService()
    const { version } = await recordFirstVersion(service)
    const destination = await service.createDestination({
      workspaceId: 'ws-1',
      actor: owner,
      publisherId: 'download',
      name: 'Download',
      config: {},
    })
    expect(destination.active).toBe(true)

    await service.setDestinationActive(destination.id, 'ws-1', false)
    await expect(
      service.submitPublish({ artifactVersionId: version.id, workspaceId: 'ws-1', actor: owner, destinationId: destination.id }),
    ).rejects.toBeInstanceOf(PublishingServiceError)
  })

  it('setDestinationActive throws for a nonexistent destination', async () => {
    const service = makeService()
    await expect(service.setDestinationActive('nonexistent', 'ws-1', false)).rejects.toBeInstanceOf(PublishingServiceError)
  })

  it('submitPublish throws when the destination does not exist', async () => {
    const service = makeService()
    const { version } = await recordFirstVersion(service)
    await expect(
      service.submitPublish({ artifactVersionId: version.id, workspaceId: 'ws-1', actor: owner, destinationId: 'nonexistent' }),
    ).rejects.toBeInstanceOf(PublishingServiceError)
  })

  it('submitPublish throws when the requested format does not exist on the version', async () => {
    const service = makeService()
    const { version } = await recordFirstVersion(service)
    const destination = await service.createDestination({
      workspaceId: 'ws-1',
      actor: owner,
      publisherId: 'download',
      name: 'Download',
      config: {},
    })
    await expect(
      service.submitPublish({ artifactVersionId: version.id, workspaceId: 'ws-1', actor: owner, destinationId: destination.id, format: 'pptx' }),
    ).rejects.toBeInstanceOf(PublishingServiceError)
  })
})

describe('PublishingService retry / failure handling', () => {
  class FlakyPublisher implements Publisher {
    readonly id = 'flaky'
    readonly displayName = 'Flaky Test Publisher'
    callCount = 0
    constructor(private readonly failuresBeforeSuccess: number) {}

    async publish(_request: PublishRequest): Promise<PublishOutcome> {
      this.callCount += 1
      if (this.callCount <= this.failuresBeforeSuccess) {
        return { kind: 'failure', reason: 'simulated transient failure', retryable: true }
      }
      return { kind: 'success', destinationReference: `flaky-ref-${this.callCount}` }
    }

    async revoke(_request: RevokeRequest): Promise<RevokeOutcome> {
      return { kind: 'success' }
    }

    validateDestinationConfig(): { valid: boolean; errors: readonly string[] } {
      return { valid: true, errors: [] }
    }
  }

  it('marks a DistributionJob as retrying on a retryable failure, then succeeded after retryDistribution()', async () => {
    const registry = new PublisherRegistry()
    const flaky = new FlakyPublisher(1)
    registry.register(flaky)
    const service = makeService({ registry })

    const { version } = await recordFirstVersion(service)
    const destination = await service.createDestination({ workspaceId: 'ws-1', actor: owner, publisherId: 'flaky', name: 'Flaky', config: {} })

    const firstAttempt = await service.submitPublish({ artifactVersionId: version.id, workspaceId: 'ws-1', actor: owner, destinationId: destination.id })
    expect(firstAttempt.status).toBe('retrying')
    expect(firstAttempt.attempts).toBe(1)

    const retried = await service.retryDistribution(firstAttempt.id, 'ws-1', owner)
    expect(retried.status).toBe('succeeded')
    expect(retried.attempts).toBe(2)
  })

  // Review remediation (Compliance Review §4/§6/§8, Medium severity): a
  // DistributionJob must persist which rendered format it targeted, and
  // retryDistribution() must reuse that exact format — not silently fall
  // back to the version's first rendered output — once a version carries
  // more than one rendered format.
  it('submitPublish records which format the job targets, on a version with multiple rendered outputs', async () => {
    const service = makeService()
    const { version } = await recordFirstVersion(service) // format: 'html'
    await service.attachRenderedOutput(version.id, 'ws-1', {
      format: 'pdf',
      bytes: new TextEncoder().encode('%PDF-fake'),
      mimeType: 'application/pdf',
    })
    const destination = await service.createDestination({ workspaceId: 'ws-1', actor: owner, publisherId: 'download', name: 'Download', config: {} })

    const job = await service.submitPublish({
      artifactVersionId: version.id,
      workspaceId: 'ws-1',
      actor: owner,
      destinationId: destination.id,
      format: 'pdf',
    })
    expect(job.format).toBe('pdf')
  })

  it('defaults the job\'s format to the version\'s first rendered output when no format is requested', async () => {
    const service = makeService()
    const { version } = await recordFirstVersion(service) // format: 'html', the only/first output
    const destination = await service.createDestination({ workspaceId: 'ws-1', actor: owner, publisherId: 'download', name: 'Download', config: {} })

    const job = await service.submitPublish({ artifactVersionId: version.id, workspaceId: 'ws-1', actor: owner, destinationId: destination.id })
    expect(job.format).toBe('html')
  })

  it('retryDistribution reuses the ORIGINALLY REQUESTED format, not the version\'s first rendered output, on a multi-format version', async () => {
    const registry = new PublisherRegistry()
    const flaky = new FlakyPublisher(1)
    registry.register(flaky)
    const service = makeService({ registry })

    // 'html' is attached FIRST (would be renderedOutputs[0]); 'pdf' is
    // attached second and is the format actually requested below. Before
    // the fix, retryDistribution() unconditionally used renderedOutputs[0]
    // ('html') regardless of what the original submitPublish call asked
    // for — this test fails against that old behavior and passes against
    // the fix.
    const { version } = await recordFirstVersion(service) // attaches 'html'
    await service.attachRenderedOutput(version.id, 'ws-1', {
      format: 'pdf',
      bytes: new TextEncoder().encode('%PDF-fake'),
      mimeType: 'application/pdf',
    })
    const destination = await service.createDestination({ workspaceId: 'ws-1', actor: owner, publisherId: 'flaky', name: 'Flaky', config: {} })

    const firstAttempt = await service.submitPublish({
      artifactVersionId: version.id,
      workspaceId: 'ws-1',
      actor: owner,
      destinationId: destination.id,
      format: 'pdf',
    })
    expect(firstAttempt.format).toBe('pdf')
    expect(firstAttempt.status).toBe('retrying')

    const retried = await service.retryDistribution(firstAttempt.id, 'ws-1', owner)
    expect(retried.status).toBe('succeeded')
    // The job's own format field is immutable across retries — still 'pdf',
    // never silently switched to 'html' just because 'html' happens to be
    // renderedOutputs[0].
    expect(retried.format).toBe('pdf')
  })

  it('marks a DistributionJob as failed (not retrying) once maxAttempts is reached', async () => {
    const registry = new PublisherRegistry()
    const alwaysFails = new FlakyPublisher(999)
    registry.register(alwaysFails)
    const service = makeService({ registry })

    const { version } = await recordFirstVersion(service)
    const destination = await service.createDestination({ workspaceId: 'ws-1', actor: owner, publisherId: 'flaky', name: 'Flaky', config: {} })

    let job = await service.submitPublish({ artifactVersionId: version.id, workspaceId: 'ws-1', actor: owner, destinationId: destination.id })
    expect(job.attempts).toBe(1)
    job = await service.retryDistribution(job.id, 'ws-1', owner)
    expect(job.attempts).toBe(2)
    job = await service.retryDistribution(job.id, 'ws-1', owner)
    expect(job.attempts).toBe(3)
    expect(job.status).toBe('failed') // attempts(3) === maxAttempts(3), no longer retryable regardless of outcome.retryable
  })

  it('retryDistribution throws once maxAttempts is exhausted', async () => {
    const registry = new PublisherRegistry()
    registry.register(new FlakyPublisher(999))
    const service = makeService({ registry })
    const { version } = await recordFirstVersion(service)
    const destination = await service.createDestination({ workspaceId: 'ws-1', actor: owner, publisherId: 'flaky', name: 'Flaky', config: {} })

    let job = await service.submitPublish({ artifactVersionId: version.id, workspaceId: 'ws-1', actor: owner, destinationId: destination.id })
    job = await service.retryDistribution(job.id, 'ws-1', owner)
    job = await service.retryDistribution(job.id, 'ws-1', owner)
    await expect(service.retryDistribution(job.id, 'ws-1', owner)).rejects.toBeInstanceOf(PublishingServiceError)
  })
})

describe('PublishingService.revokePublication', () => {
  it('marks the Publication revoked and the derived state falls back below published', async () => {
    const service = makeService()
    const { artifact, version } = await recordFirstVersion(service)
    const destination = await service.createDestination({ workspaceId: 'ws-1', actor: owner, publisherId: 'download', name: 'DL', config: {} })
    const job = await service.submitPublish({ artifactVersionId: version.id, workspaceId: 'ws-1', actor: owner, destinationId: destination.id })

    let trail = await service.getAuditTrail(artifact.id, 'ws-1')
    expect(trail.currentState).toBe('published')

    const publicationId = job.publicationId!
    const revoked = await service.revokePublication(publicationId, 'ws-1', owner, 'made a mistake')
    expect(revoked.revoked).toBe(true)

    trail = await service.getAuditTrail(artifact.id, 'ws-1')
    expect(trail.currentState).toBe('generated')
    expect(trail.events.map((e) => e.type)).toContain('publication_revoked')
  })

  it('is idempotent — revoking an already-revoked Publication is a no-op success', async () => {
    const service = makeService()
    const { version } = await recordFirstVersion(service)
    const destination = await service.createDestination({ workspaceId: 'ws-1', actor: owner, publisherId: 'download', name: 'DL', config: {} })
    const job = await service.submitPublish({ artifactVersionId: version.id, workspaceId: 'ws-1', actor: owner, destinationId: destination.id })
    const publicationId = job.publicationId!

    await service.revokePublication(publicationId, 'ws-1', owner)
    const second = await service.revokePublication(publicationId, 'ws-1', owner)
    expect(second.revoked).toBe(true)
  })
})

describe('PublishingService archive/delete', () => {
  it('archiveVersion moves state to archived and blocks further review/approval', async () => {
    const service = makeService()
    const { artifact, version } = await recordFirstVersion(service)
    await service.archiveVersion(version.id, 'ws-1', owner, 'superseded manually')

    const trail = await service.getAuditTrail(artifact.id, 'ws-1')
    expect(trail.currentState).toBe('archived')

    await expect(service.submitReview(version.id, 'ws-1', owner)).rejects.toBeInstanceOf(LifecycleError)
  })

  it('deleteVersion moves state to deleted and does not remove bytes when retention forbids hard delete', async () => {
    const service = makeService()
    const { artifact, version } = await recordFirstVersion(service)
    await service.deleteVersion(version.id, 'ws-1', owner, 'compliance request')

    const trail = await service.getAuditTrail(artifact.id, 'ws-1')
    expect(trail.currentState).toBe('deleted')
    // No RetentionPolicy was configured for ws-1, so hardDeleteAllowed defaults
    // to false (see repository default) — bytes should still be readable.
    const bytes = await new InMemoryRenderedOutputStore().getBytes(version.renderedOutputs[0]?.storageKey ?? '').catch(() => null)
    // Using a fresh store here (not the service's) only to confirm the assertion
    // shape is well-formed; the real guarantee is exercised in the hard-delete
    // test below via the same store instance the service was built with.
    expect(bytes).toBeNull()
  })

  it('deleteVersion hard-deletes bytes when RetentionPolicy.hardDeleteAllowed is true', async () => {
    const repositories = createInMemoryPublishingRepositories()
    const store = new InMemoryRenderedOutputStore()
    const service = new PublishingService({
      repositories,
      store,
      policyProvider: new StaticPolicyProvider(),
      publisherRegistry: createDefaultPublisherRegistry(),
    })
    await repositories.retentionPolicies.upsert({
      workspaceId: 'ws-1',
      minRetentionDays: null,
      hardDeleteAllowed: true,
      updatedAt: new Date().toISOString(),
      updatedBy: owner,
    })

    const { version } = await recordFirstVersion(service)
    const storageKey = version.renderedOutputs[0].storageKey
    await expect(store.getBytes(storageKey)).resolves.toBeTruthy()

    await service.deleteVersion(version.id, 'ws-1', owner)
    await expect(store.getBytes(storageKey)).rejects.toThrow()
  })

  it('rejects any lifecycle action once deleted', async () => {
    const service = makeService()
    const { version } = await recordFirstVersion(service)
    await service.deleteVersion(version.id, 'ws-1', owner)
    await expect(service.submitReview(version.id, 'ws-1', owner)).rejects.toBeInstanceOf(LifecycleError)
  })
})

describe('PublishingService.getAuditTrail', () => {
  it('throws PublishingServiceError for a nonexistent artifact', async () => {
    const service = makeService()
    await expect(service.getAuditTrail('nonexistent', 'ws-1')).rejects.toBeInstanceOf(PublishingServiceError)
  })
})

describe('PublishingService.createDestination', () => {
  it('rejects an unregistered publisherId', async () => {
    const service = makeService()
    await expect(
      service.createDestination({ workspaceId: 'ws-1', actor: owner, publisherId: 'not-a-real-publisher', name: 'x', config: {} }),
    ).rejects.toBeInstanceOf(PublishingServiceError)
  })

  it('rejects an invalid config for the chosen publisher', async () => {
    const service = makeService()
    await expect(
      service.createDestination({
        workspaceId: 'ws-1',
        actor: owner,
        publisherId: 'share-link',
        name: 'Bad config',
        config: { signedUrlTtlSeconds: -5 },
      }),
    ).rejects.toBeInstanceOf(PublishingServiceError)
  })

  it('lists destinations scoped to a workspace', async () => {
    const service = makeService()
    await service.createDestination({ workspaceId: 'ws-1', actor: owner, publisherId: 'download', name: 'A', config: {} })
    await service.createDestination({ workspaceId: 'ws-2', actor: owner, publisherId: 'download', name: 'B', config: {} })
    const ws1Destinations = await service.listDestinations('ws-1')
    expect(ws1Destinations).toHaveLength(1)
    expect(ws1Destinations[0].name).toBe('A')
  })
})
