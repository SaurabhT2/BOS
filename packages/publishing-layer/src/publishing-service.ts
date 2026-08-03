// ============================================================
// packages/publishing-layer/src/publishing-service.ts
//
// The orchestrating facade — this IS §11's "in-process equivalent" of the
// future HTTP surface sketched in §9: "Core Experience should consume
// Publishing exclusively through its API surface (§9, or in-process
// equivalents while Publishing lives inside BrandOS)." Every method here
// is what a future Next.js route (or a CPL proxy — see
// PUBLISHING_LAYER_NOTES.md for why that wiring is explicitly NOT done in
// this engagement) would call directly.
//
// KNOWN LIMITATION (stated honestly, not silently): versionNumber
// resolution and the "no two concurrent approvals race" invariant are
// both "read count, then write" rather than DB-enforced atomic
// operations. This is the same limitation control-plane-layer's own
// ArtifactVersioningService already has (see its
// linkAndFinalizeVersion()/_insertLinkedVersion() comments) — consistent
// with, not worse than, existing precedent in this codebase — but it is
// not safe under true concurrent writers to the same Artifact without an
// additional DB-level unique constraint + retry loop, which
// supabase/migrations/20260801090000_publishing_layer.sql does add as a
// constraint (UNIQUE(artifact_id, version_number)) so a race at least
// fails loudly instead of silently duplicating a version number, but a
// caller-side retry-on-conflict loop is not implemented here.
// ============================================================

import type { ArtifactType, ArtifactV2 } from '@brandos/contracts'
import { sha256Hex, sha256HexOfJson } from './hash'
import {
  assertActionLegal,
  assertGateAllowed,
  buildEvent,
  deriveVersionState,
} from './lifecycle'
import { evaluateApprovalGate, evaluatePublishGate, type IPublishingPolicyProvider } from './policy'
import type { PublisherRegistry } from './publisher-registry'
import type { PublishingRepositories } from './repository'
import type { RenderedOutputStore } from './storage'
import { buildAuditRecord } from './audit'
import type {
  Actor,
  Approval,
  ApprovalPurpose,
  Artifact,
  ArtifactId,
  ArtifactVersion,
  ArtifactVersionId,
  AuditRecord,
  Destination,
  DestinationId,
  DistributionJob,
  Publication,
  PublicationId,
  PublisherId,
  RenderedOutputRef,
  WorkspaceId,
} from './types'

function newId(): string {
  return crypto.randomUUID()
}

export class PublishingServiceError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'invalid_input') {
    super(message)
    this.name = 'PublishingServiceError'
  }
}

export interface PublishingServiceDeps {
  readonly repositories: PublishingRepositories
  readonly store: RenderedOutputStore
  readonly policyProvider: IPublishingPolicyProvider
  readonly publisherRegistry: PublisherRegistry
}

export class PublishingService {
  constructor(private readonly deps: PublishingServiceDeps) {}

  // ─── §9 bullet 1: "record a new ArtifactVersion (called by Rendering after
  // a successful render, not called by end users directly)" ─────────────────

  async recordGeneratedVersion(params: {
    workspaceId: WorkspaceId
    actor: Actor
    /** Provide an existing artifactId to add a new version to an existing Artifact; omit to create a new Artifact. */
    artifactId?: ArtifactId
    title: string
    artifactType: ArtifactType
    ownerId: string
    source: {
      payload: ArtifactV2
      /** §4: retain a full copy of the governed payload alongside its hash, or hash-only. See types.ts's ArtifactVersion.source doc comment. */
      retainSourcePayload?: boolean
    }
    renderedOutput: {
      format: RenderedOutputRef['format']
      bytes: Uint8Array
      mimeType: string
    }
    tags?: readonly string[]
  }): Promise<{ artifact: Artifact; version: ArtifactVersion }> {
    const { repositories, store } = this.deps

    let artifact: Artifact
    let previousVersionId: ArtifactVersionId | null = null

    if (params.artifactId) {
      const existing = await repositories.artifacts.get(params.artifactId, params.workspaceId)
      if (!existing) {
        throw new PublishingServiceError(`Artifact '${params.artifactId}' not found in workspace '${params.workspaceId}'`, 'not_found')
      }
      artifact = existing
      previousVersionId = existing.currentVersionId
    } else {
      artifact = {
        id: newId(),
        workspaceId: params.workspaceId,
        ownerId: params.ownerId,
        title: params.title,
        artifactType: params.artifactType,
        createdAt: new Date().toISOString(),
        currentState: 'generated',
        currentVersionId: null,
        tags: params.tags ?? [],
      }
      await repositories.artifacts.create(artifact)
      await repositories.events.append(
        buildEvent('artifact_created', {
          artifactId: artifact.id,
          artifactVersionId: null,
          workspaceId: params.workspaceId,
          actor: params.actor,
          detail: { title: params.title, artifactType: params.artifactType },
        }),
      )
    }

    const existingVersions = await repositories.versions.listForArtifact(artifact.id, params.workspaceId)
    const versionNumber = existingVersions.length + 1

    const stored = await store.put({
      artifactId: artifact.id,
      artifactVersionId: 'pending', // versionId assigned below; storage keys are content-addressed by hash, not by this placeholder
      format: params.renderedOutput.format,
      bytes: params.renderedOutput.bytes,
      mimeType: params.renderedOutput.mimeType,
    })

    const sourceHash = await sha256HexOfJson(params.source.payload)
    const versionId = newId()

    const version: ArtifactVersion = {
      id: versionId,
      artifactId: artifact.id,
      workspaceId: params.workspaceId,
      versionNumber,
      source: {
        artifactType: params.artifactType,
        contentHash: sourceHash,
        payload: params.source.retainSourcePayload ? params.source.payload : undefined,
      },
      renderedOutputs: [
        {
          format: params.renderedOutput.format,
          mimeType: params.renderedOutput.mimeType,
          storageKey: stored.storageKey,
          contentHash: stored.contentHash,
          sizeBytes: stored.sizeBytes,
          renderedAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      createdBy: params.actor,
      supersedes: previousVersionId,
      supersededBy: null,
    }
    await repositories.versions.create(version)

    if (previousVersionId) {
      await repositories.versions.markSuperseded(previousVersionId, params.workspaceId, versionId)
      await repositories.events.append(
        buildEvent('version_superseded', {
          artifactId: artifact.id,
          artifactVersionId: previousVersionId,
          workspaceId: params.workspaceId,
          actor: params.actor,
          detail: { supersededBy: versionId },
        }),
      )
    }

    await repositories.events.append(
      buildEvent('version_generated', {
        artifactId: artifact.id,
        artifactVersionId: versionId,
        workspaceId: params.workspaceId,
        actor: params.actor,
        detail: { versionNumber, format: params.renderedOutput.format, contentHash: stored.contentHash },
      }),
    )

    await repositories.artifacts.updateCurrentVersion(artifact.id, params.workspaceId, {
      currentVersionId: versionId,
      currentState: 'generated',
    })

    return {
      artifact: { ...artifact, currentVersionId: versionId, currentState: 'generated' },
      version,
    }
  }

  /** §4: "one version can have multiple rendered formats — HTML, PDF, PPTX — all derived from the same version." */
  async attachRenderedOutput(
    artifactVersionId: ArtifactVersionId,
    workspaceId: WorkspaceId,
    output: { format: RenderedOutputRef['format']; bytes: Uint8Array; mimeType: string },
  ): Promise<RenderedOutputRef> {
    const { repositories, store } = this.deps
    const version = await this.mustGetVersion(artifactVersionId, workspaceId)

    const stored = await store.put({
      artifactId: version.artifactId,
      artifactVersionId,
      format: output.format,
      bytes: output.bytes,
      mimeType: output.mimeType,
    })
    const ref: RenderedOutputRef = {
      format: output.format,
      mimeType: output.mimeType,
      storageKey: stored.storageKey,
      contentHash: stored.contentHash,
      sizeBytes: stored.sizeBytes,
      renderedAt: new Date().toISOString(),
    }

    // ArtifactVersion.renderedOutputs is the one field designed to grow
    // after creation (§4: "one version can have multiple rendered formats
    // ... all derived from the same version") — appendRenderedOutput
    // replaces any existing entry for the same format and leaves every
    // other entry, and every other part of the version, untouched. This
    // keeps §6's immutability guarantee intact for everything else on the
    // row (source, supersedes, createdAt/By never change here).
    await repositories.versions.appendRenderedOutput(artifactVersionId, workspaceId, ref)
    return ref
  }

  // ─── §5 Reviewed ────────────────────────────────────────────────────────

  async submitReview(
    artifactVersionId: ArtifactVersionId,
    workspaceId: WorkspaceId,
    actor: Actor,
    notes?: string,
  ): Promise<void> {
    const { repositories } = this.deps
    const version = await this.mustGetVersion(artifactVersionId, workspaceId)
    const state = await this.deriveState(version)
    assertActionLegal('review', state)

    await repositories.events.append(
      buildEvent('reviewed', {
        artifactId: version.artifactId,
        artifactVersionId,
        workspaceId,
        actor,
        detail: notes ? { notes } : {},
      }),
    )
    await this.refreshArtifactStateCache(version.artifactId, workspaceId, artifactVersionId)
  }

  // ─── §5 Approved ────────────────────────────────────────────────────────

  async decideApproval(params: {
    artifactVersionId: ArtifactVersionId
    workspaceId: WorkspaceId
    actor: Actor
    purpose: ApprovalPurpose
    decision: Approval['decision']
    reason?: string
  }): Promise<Approval> {
    const { repositories, policyProvider } = this.deps
    const version = await this.mustGetVersion(params.artifactVersionId, params.workspaceId)
    const state = await this.deriveState(version)
    assertActionLegal('decide_approval', state)

    const policy = await policyProvider.getPolicy(params.workspaceId)
    if (params.decision === 'approved') {
      assertGateAllowed(evaluateApprovalGate(policy, params.actor.role))
    }

    const approval: Approval = {
      id: newId(),
      artifactVersionId: params.artifactVersionId,
      workspaceId: params.workspaceId,
      purpose: params.purpose,
      decision: params.decision,
      reason: params.reason,
      decidedBy: params.actor,
      decidedAt: new Date().toISOString(),
      policySnapshot: {
        requirePublishingApproval: policy.requirePublishingApproval,
        requireApprovalForExternalPublish: policy.requireApprovalForExternalPublish,
      },
    }
    await repositories.approvals.create(approval)
    await repositories.events.append(
      buildEvent('approval_decided', {
        artifactId: version.artifactId,
        artifactVersionId: params.artifactVersionId,
        workspaceId: params.workspaceId,
        actor: params.actor,
        detail: { decision: params.decision, purpose: params.purpose, reason: params.reason },
      }),
    )
    await this.refreshArtifactStateCache(version.artifactId, params.workspaceId, params.artifactVersionId)
    return approval
  }

  // ─── §5 Published ───────────────────────────────────────────────────────

  async submitPublish(params: {
    artifactVersionId: ArtifactVersionId
    workspaceId: WorkspaceId
    actor: Actor
    destinationId: DestinationId
    /** Which of the version's rendered formats to send; defaults to the first available. */
    format?: RenderedOutputRef['format']
  }): Promise<DistributionJob> {
    const { repositories, policyProvider, publisherRegistry } = this.deps
    const version = await this.mustGetVersion(params.artifactVersionId, params.workspaceId)
    const state = await this.deriveState(version)
    assertActionLegal('submit_distribution', state)

    const approvals = await repositories.approvals.listForVersion(params.artifactVersionId, params.workspaceId)
    const hasApproval = approvals.some((a) => a.decision === 'approved')
    const policy = await policyProvider.getPolicy(params.workspaceId)
    assertGateAllowed(evaluatePublishGate(policy, hasApproval))

    const destination = await repositories.destinations.get(params.destinationId, params.workspaceId)
    if (!destination) {
      throw new PublishingServiceError(`Destination '${params.destinationId}' not found in workspace '${params.workspaceId}'`, 'not_found')
    }
    if (!destination.active) {
      throw new PublishingServiceError(`Destination '${params.destinationId}' is not active`, 'invalid_input')
    }

    const renderedOutput = params.format
      ? version.renderedOutputs.find((r) => r.format === params.format)
      : version.renderedOutputs[0]
    if (!renderedOutput) {
      throw new PublishingServiceError(
        `ArtifactVersion '${params.artifactVersionId}' has no rendered output${params.format ? ` in format '${params.format}'` : ''}`,
        'invalid_input',
      )
    }

    const job: DistributionJob = {
      id: newId(),
      artifactVersionId: params.artifactVersionId,
      destinationId: params.destinationId,
      workspaceId: params.workspaceId,
      format: renderedOutput.format,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      requestedBy: params.actor,
      requestedAt: new Date().toISOString(),
      lastAttemptAt: null,
      lastError: null,
      publicationId: null,
    }
    await repositories.distributionJobs.create(job)
    await repositories.events.append(
      buildEvent('distribution_submitted', {
        artifactId: version.artifactId,
        artifactVersionId: params.artifactVersionId,
        workspaceId: params.workspaceId,
        actor: params.actor,
        detail: { destinationId: params.destinationId, publisherId: destination.publisherId },
      }),
    )

    return this.attemptDistribution(job, version, destination, renderedOutput)
  }

  async retryDistribution(jobId: string, workspaceId: WorkspaceId, actor: Actor): Promise<DistributionJob> {
    const { repositories } = this.deps
    const job = await repositories.distributionJobs.get(jobId, workspaceId)
    if (!job) throw new PublishingServiceError(`DistributionJob '${jobId}' not found`, 'not_found')
    if (job.status === 'succeeded') return job
    if (job.attempts >= job.maxAttempts) {
      throw new PublishingServiceError(`DistributionJob '${jobId}' has exhausted its ${job.maxAttempts} max attempts`, 'invalid_input')
    }

    const version = await this.mustGetVersion(job.artifactVersionId, workspaceId)
    const destination = await repositories.destinations.get(job.destinationId, workspaceId)
    if (!destination) throw new PublishingServiceError(`Destination '${job.destinationId}' not found`, 'not_found')
    // v1.1 fix: reuse the format the job was ORIGINALLY submitted for (job.format),
    // not version.renderedOutputs[0] — a version can carry multiple rendered
    // formats, and a retry must target the same one the original request did,
    // not silently fall back to whichever happens to be first (see
    // PUBLISHING_ARCHITECTURE_V1.md §4, Compliance Review Section 6/8).
    const renderedOutput = version.renderedOutputs.find((r) => r.format === job.format)
    if (!renderedOutput) {
      throw new PublishingServiceError(
        `ArtifactVersion '${job.artifactVersionId}' no longer has a rendered output in format '${job.format}'`,
        'invalid_input',
      )
    }

    await repositories.events.append(
      buildEvent('distribution_retried', {
        artifactId: version.artifactId,
        artifactVersionId: job.artifactVersionId,
        workspaceId,
        actor,
        detail: { jobId, attempt: job.attempts + 1 },
      }),
    )
    return this.attemptDistribution(job, version, destination, renderedOutput)
  }

  private async attemptDistribution(
    job: DistributionJob,
    version: ArtifactVersion,
    destination: Destination,
    renderedOutput: RenderedOutputRef,
  ): Promise<DistributionJob> {
    const { repositories, publisherRegistry } = this.deps
    const attempts = job.attempts + 1
    const attemptedAt = new Date().toISOString()

    const outcome = await publisherRegistry.publish(destination.publisherId, {
      artifactVersionId: version.id,
      destinationId: destination.id,
      renderedOutput,
      requestedBy: job.requestedBy,
      destinationConfig: destination.config,
    })

    if (outcome.kind === 'success') {
      const publication: Publication = {
        id: newId(),
        artifactVersionId: version.id,
        destinationId: destination.id,
        distributionJobId: job.id,
        workspaceId: job.workspaceId,
        destinationReference: outcome.destinationReference,
        publishedAt: attemptedAt,
        publishedBy: job.requestedBy,
        revoked: false,
        revokedAt: null,
        revokedReason: null,
      }
      await repositories.publications.create(publication)
      await repositories.distributionJobs.update(job.id, job.workspaceId, {
        status: 'succeeded',
        attempts,
        lastAttemptAt: attemptedAt,
        lastError: null,
        publicationId: publication.id,
      })
      await repositories.events.append(
        buildEvent('distribution_succeeded', {
          artifactId: version.artifactId,
          artifactVersionId: version.id,
          workspaceId: job.workspaceId,
          actor: job.requestedBy,
          detail: { destinationId: destination.id, publicationId: publication.id },
        }),
      )
      await this.refreshArtifactStateCache(version.artifactId, job.workspaceId, version.id)
      return { ...job, status: 'succeeded', attempts, lastAttemptAt: attemptedAt, lastError: null, publicationId: publication.id }
    }

    const nextStatus = outcome.retryable && attempts < job.maxAttempts ? 'retrying' : 'failed'
    await repositories.distributionJobs.update(job.id, job.workspaceId, {
      status: nextStatus,
      attempts,
      lastAttemptAt: attemptedAt,
      lastError: outcome.reason,
    })
    await repositories.events.append(
      buildEvent('distribution_failed', {
        artifactId: version.artifactId,
        artifactVersionId: version.id,
        workspaceId: job.workspaceId,
        actor: job.requestedBy,
        detail: { destinationId: destination.id, reason: outcome.reason, retryable: outcome.retryable, attempts },
      }),
    )
    return { ...job, status: nextStatus, attempts, lastAttemptAt: attemptedAt, lastError: outcome.reason }
  }

  // ─── §8 Rollback ────────────────────────────────────────────────────────

  async revokePublication(publicationId: PublicationId, workspaceId: WorkspaceId, actor: Actor, reason?: string): Promise<Publication> {
    const { repositories, publisherRegistry } = this.deps
    const publication = await repositories.publications.get(publicationId, workspaceId)
    if (!publication) throw new PublishingServiceError(`Publication '${publicationId}' not found`, 'not_found')
    if (publication.revoked) return publication

    const destination = await repositories.destinations.get(publication.destinationId, workspaceId)
    if (!destination) throw new PublishingServiceError(`Destination '${publication.destinationId}' not found`, 'not_found')

    // §8: rollback is never destructive — the destination-side retraction is
    // attempted, but the local Publication row is marked revoked either way
    // (revoke() returning 'unsupported' or 'failure' does not block the
    // local revocation — it is surfaced in the PublishEvent detail instead).
    const revokeOutcome = await publisherRegistry.revoke(destination.publisherId, {
      destinationReference: publication.destinationReference,
      destinationConfig: destination.config,
      requestedBy: actor,
      reason,
    })

    const revokedAt = new Date().toISOString()
    await repositories.publications.revoke(publicationId, workspaceId, reason, revokedAt)

    const version = await this.mustGetVersion(publication.artifactVersionId, workspaceId)
    await repositories.events.append(
      buildEvent('publication_revoked', {
        artifactId: version.artifactId,
        artifactVersionId: publication.artifactVersionId,
        workspaceId,
        actor,
        detail: { publicationId, reason, destinationSideOutcome: revokeOutcome.kind },
      }),
    )
    await this.refreshArtifactStateCache(version.artifactId, workspaceId, version.id)

    return { ...publication, revoked: true, revokedAt, revokedReason: reason ?? null }
  }

  // ─── §5 Archived / Deleted ──────────────────────────────────────────────

  async archiveVersion(artifactVersionId: ArtifactVersionId, workspaceId: WorkspaceId, actor: Actor, reason?: string): Promise<void> {
    const { repositories } = this.deps
    const version = await this.mustGetVersion(artifactVersionId, workspaceId)
    const state = await this.deriveState(version)
    assertActionLegal('archive', state)

    await repositories.events.append(
      buildEvent('artifact_archived', {
        artifactId: version.artifactId,
        artifactVersionId,
        workspaceId,
        actor,
        detail: reason ? { reason } : {},
      }),
    )
    await this.refreshArtifactStateCache(version.artifactId, workspaceId, artifactVersionId)
  }

  /**
   * §5 "Deleted (optional, and rarely a hard delete)": marks the version
   * deleted (derived state) and, only if the workspace's RetentionPolicy
   * explicitly allows it, removes the underlying bytes from storage. The
   * AuditRecord (PublishEvents, Approvals, Publications) is never removed
   * — §5: "the fact that something *was* published often has to remain
   * provable even after the content itself is gone."
   */
  async deleteVersion(artifactVersionId: ArtifactVersionId, workspaceId: WorkspaceId, actor: Actor, reason?: string): Promise<void> {
    const { repositories, store } = this.deps
    const version = await this.mustGetVersion(artifactVersionId, workspaceId)
    const state = await this.deriveState(version)
    assertActionLegal('delete', state)

    const retention = await repositories.retentionPolicies.get(workspaceId)
    const hardDeleteAllowed = retention?.hardDeleteAllowed ?? false

    if (hardDeleteAllowed) {
      for (const output of version.renderedOutputs) {
        await store.delete(output.storageKey)
      }
    }

    await repositories.events.append(
      buildEvent('artifact_deleted', {
        artifactId: version.artifactId,
        artifactVersionId,
        workspaceId,
        actor,
        detail: { reason, bytesHardDeleted: hardDeleteAllowed },
      }),
    )
    await this.refreshArtifactStateCache(version.artifactId, workspaceId, artifactVersionId)
  }

  // ─── Destinations ───────────────────────────────────────────────────────

  async createDestination(params: {
    workspaceId: WorkspaceId
    actor: Actor
    publisherId: PublisherId
    name: string
    config: Readonly<Record<string, unknown>>
  }): Promise<Destination> {
    const publisher = this.deps.publisherRegistry.resolve(params.publisherId)
    if (!publisher) {
      throw new PublishingServiceError(`No Publisher registered for id '${params.publisherId}'`, 'invalid_input')
    }
    const validation = publisher.validateDestinationConfig(params.config)
    if (!validation.valid) {
      throw new PublishingServiceError(`Invalid destination config: ${validation.errors.join('; ')}`, 'invalid_input')
    }

    const destination: Destination = {
      id: newId(),
      workspaceId: params.workspaceId,
      publisherId: params.publisherId,
      name: params.name,
      config: params.config,
      createdAt: new Date().toISOString(),
      createdBy: params.actor,
      active: true,
    }
    return this.deps.repositories.destinations.create(destination)
  }

  async listDestinations(workspaceId: WorkspaceId): Promise<readonly Destination[]> {
    return this.deps.repositories.destinations.list(workspaceId)
  }

  async setDestinationActive(destinationId: DestinationId, workspaceId: WorkspaceId, active: boolean): Promise<void> {
    const destination = await this.deps.repositories.destinations.get(destinationId, workspaceId)
    if (!destination) {
      throw new PublishingServiceError(`Destination '${destinationId}' not found in workspace '${workspaceId}'`, 'not_found')
    }
    await this.deps.repositories.destinations.setActive(destinationId, workspaceId, active)
  }

  // ─── Reads ──────────────────────────────────────────────────────────────

  async getAuditTrail(artifactId: ArtifactId, workspaceId: WorkspaceId): Promise<AuditRecord> {
    const { repositories } = this.deps
    const artifact = await repositories.artifacts.get(artifactId, workspaceId)
    if (!artifact) throw new PublishingServiceError(`Artifact '${artifactId}' not found`, 'not_found')

    const versions = await repositories.versions.listForArtifact(artifactId, workspaceId)
    const approvals = (
      await Promise.all(versions.map((v) => repositories.approvals.listForVersion(v.id, workspaceId)))
    ).flat()
    const publications = await repositories.publications.listForArtifact(artifactId, workspaceId)
    const events = await repositories.events.listForArtifact(artifactId, workspaceId)

    return buildAuditRecord({ artifact, versions, approvals, publications, events })
  }

  // ─── Internal helpers ───────────────────────────────────────────────────

  private async mustGetVersion(id: ArtifactVersionId, workspaceId: WorkspaceId): Promise<ArtifactVersion> {
    const version = await this.deps.repositories.versions.get(id, workspaceId)
    if (!version) throw new PublishingServiceError(`ArtifactVersion '${id}' not found in workspace '${workspaceId}'`, 'not_found')
    return version
  }

  private async deriveState(version: ArtifactVersion) {
    const { repositories } = this.deps
    const [approvals, publications, events] = await Promise.all([
      repositories.approvals.listForVersion(version.id, version.workspaceId),
      repositories.publications.listForVersion(version.id, version.workspaceId),
      repositories.events.listForArtifact(version.artifactId, version.workspaceId),
    ])
    return deriveVersionState({ version, approvals, publications, events })
  }

  private async refreshArtifactStateCache(
    artifactId: ArtifactId,
    workspaceId: WorkspaceId,
    versionId: ArtifactVersionId,
  ): Promise<void> {
    const version = await this.mustGetVersion(versionId, workspaceId)
    const state = await this.deriveState(version)
    await this.deps.repositories.artifacts.updateCurrentVersion(artifactId, workspaceId, {
      currentVersionId: versionId,
      currentState: state,
    })
  }
}
