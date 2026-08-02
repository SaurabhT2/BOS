// ============================================================
// packages/publishing-layer/src/repository.ts
//
// §6 Persistence Strategy — "Metadata (Artifact, ArtifactVersion,
// Approval, Destination, Publication records): fully persisted,
// relationally ... small, structured, query-heavy." These interfaces are
// the persistence abstraction; repository-memory.ts and
// repository-supabase.ts are the two implementations this engagement
// ships (in-memory for tests/dev, Supabase for production — see each
// file's header for why both exist rather than only one).
//
// Split by entity (interface segregation) rather than one god-interface,
// matching how §4 itself describes each entity as an independently
// queryable thing ("list all Approved-but-not-Published artifacts; list
// all Publications to a given Destination in the last 90 days").
// ============================================================

import type {
  Approval,
  Artifact,
  ArtifactId,
  ArtifactVersion,
  ArtifactVersionId,
  Destination,
  DestinationId,
  DistributionJob,
  DistributionJobId,
  Publication,
  PublicationId,
  PublishEvent,
  RenderedOutputRef,
  RetentionPolicy,
  WorkspaceId,
} from './types'

export interface ArtifactRepository {
  create(artifact: Artifact): Promise<Artifact>
  get(id: ArtifactId, workspaceId: WorkspaceId): Promise<Artifact | null>
  list(workspaceId: WorkspaceId): Promise<readonly Artifact[]>
  /** Updates only the two denormalized cache fields (§4 Artifact doc-comment) — never the immutable identity fields. */
  updateCurrentVersion(
    id: ArtifactId,
    workspaceId: WorkspaceId,
    patch: { currentVersionId: ArtifactVersionId; currentState: Artifact['currentState'] },
  ): Promise<void>
}

export interface ArtifactVersionRepository {
  create(version: ArtifactVersion): Promise<ArtifactVersion>
  get(id: ArtifactVersionId, workspaceId: WorkspaceId): Promise<ArtifactVersion | null>
  listForArtifact(artifactId: ArtifactId, workspaceId: WorkspaceId): Promise<readonly ArtifactVersion[]>
  /** The one pointer field ArtifactVersion is allowed to have set after creation (§6 — see lifecycle.ts module header). */
  markSuperseded(id: ArtifactVersionId, workspaceId: WorkspaceId, supersededBy: ArtifactVersionId): Promise<void>
  /**
   * The one *content* field ArtifactVersion is designed to grow after
   * creation (§4: "one version can have multiple rendered formats — HTML,
   * PDF, PPTX — all derived from the same version"). Replaces any existing
   * entry for the same `format` (re-rendering the same format is a
   * replacement, not a second entry) and leaves every other entry
   * untouched — additive, never a rewrite of the version's other content.
   */
  appendRenderedOutput(id: ArtifactVersionId, workspaceId: WorkspaceId, output: RenderedOutputRef): Promise<void>
}

export interface ApprovalRepository {
  create(approval: Approval): Promise<Approval>
  listForVersion(artifactVersionId: ArtifactVersionId, workspaceId: WorkspaceId): Promise<readonly Approval[]>
}

export interface DestinationRepository {
  create(destination: Destination): Promise<Destination>
  get(id: DestinationId, workspaceId: WorkspaceId): Promise<Destination | null>
  list(workspaceId: WorkspaceId): Promise<readonly Destination[]>
  setActive(id: DestinationId, workspaceId: WorkspaceId, active: boolean): Promise<void>
}

export interface DistributionJobRepository {
  create(job: DistributionJob): Promise<DistributionJob>
  get(id: DistributionJobId, workspaceId: WorkspaceId): Promise<DistributionJob | null>
  update(
    id: DistributionJobId,
    workspaceId: WorkspaceId,
    patch: Partial<Pick<DistributionJob, 'status' | 'attempts' | 'lastAttemptAt' | 'lastError' | 'publicationId'>>,
  ): Promise<void>
  listForVersion(artifactVersionId: ArtifactVersionId, workspaceId: WorkspaceId): Promise<readonly DistributionJob[]>
}

export interface PublicationRepository {
  create(publication: Publication): Promise<Publication>
  get(id: PublicationId, workspaceId: WorkspaceId): Promise<Publication | null>
  listForVersion(artifactVersionId: ArtifactVersionId, workspaceId: WorkspaceId): Promise<readonly Publication[]>
  listForArtifact(artifactId: ArtifactId, workspaceId: WorkspaceId): Promise<readonly Publication[]>
  revoke(id: PublicationId, workspaceId: WorkspaceId, reason: string | undefined, revokedAt: string): Promise<void>
}

export interface PublishEventRepository {
  /** Append-only — no update/delete method exists on this interface by design (§6). */
  append(event: PublishEvent): Promise<PublishEvent>
  listForArtifact(artifactId: ArtifactId, workspaceId: WorkspaceId): Promise<readonly PublishEvent[]>
}

export interface RetentionPolicyRepository {
  get(workspaceId: WorkspaceId): Promise<RetentionPolicy | null>
  upsert(policy: RetentionPolicy): Promise<RetentionPolicy>
}

/** Composite bag — the shape publishing-service.ts (and application wiring) depends on. */
export interface PublishingRepositories {
  readonly artifacts: ArtifactRepository
  readonly versions: ArtifactVersionRepository
  readonly approvals: ApprovalRepository
  readonly destinations: DestinationRepository
  readonly distributionJobs: DistributionJobRepository
  readonly publications: PublicationRepository
  readonly events: PublishEventRepository
  readonly retentionPolicies: RetentionPolicyRepository
}
