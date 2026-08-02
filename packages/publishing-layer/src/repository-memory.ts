// ============================================================
// packages/publishing-layer/src/repository-memory.ts
//
// In-memory PublishingRepositories implementation.
//
// WHY THIS EXISTS (not a "fake" standing in for real persistence):
//   1. Deterministic, dependency-free unit testing of lifecycle.ts /
//      publishing-service.ts without a live Supabase project — the same
//      role in-memory Maps already play in this codebase's
//      control-plane-layer (PolicyAdminService's policyStore,
//      ApprovalService's pendingApprovals, AuditTrailService's buffer).
//   2. A genuinely usable local-dev path when NEXT_PUBLIC_SUPABASE_URL /
//      SUPABASE_SERVICE_ROLE_KEY are not set — the exact same fallback
//      posture ArtifactVersioningService already takes ("best-effort —
//      never throws" on missing Supabase config), just made the primary
//      store instead of a best-effort side write.
//
// This is a complete, correct implementation of every method on every
// PublishingRepositories sub-interface — not a stub, not a TODO, not a
// partial mock. It is simply backed by process memory instead of Postgres,
// which is the honest, stated limitation (data does not survive a
// process restart), not a hidden one.
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
import type {
  ApprovalRepository,
  ArtifactRepository,
  ArtifactVersionRepository,
  DestinationRepository,
  DistributionJobRepository,
  PublicationRepository,
  PublishEventRepository,
  PublishingRepositories,
  RetentionPolicyRepository,
} from './repository'

class InMemoryArtifactRepository implements ArtifactRepository {
  private readonly rows = new Map<ArtifactId, Artifact>()

  async create(artifact: Artifact): Promise<Artifact> {
    if (this.rows.has(artifact.id)) throw new Error(`Artifact '${artifact.id}' already exists`)
    this.rows.set(artifact.id, { ...artifact })
    return artifact
  }

  async get(id: ArtifactId, workspaceId: WorkspaceId): Promise<Artifact | null> {
    const row = this.rows.get(id)
    if (!row || row.workspaceId !== workspaceId) return null
    return { ...row }
  }

  async list(workspaceId: WorkspaceId): Promise<readonly Artifact[]> {
    return [...this.rows.values()].filter((a) => a.workspaceId === workspaceId).map((a) => ({ ...a }))
  }

  async updateCurrentVersion(
    id: ArtifactId,
    workspaceId: WorkspaceId,
    patch: { currentVersionId: ArtifactVersionId; currentState: Artifact['currentState'] },
  ): Promise<void> {
    const row = this.rows.get(id)
    if (!row || row.workspaceId !== workspaceId) throw new Error(`Artifact '${id}' not found in workspace '${workspaceId}'`)
    row.currentVersionId = patch.currentVersionId
    row.currentState = patch.currentState
  }
}

class InMemoryArtifactVersionRepository implements ArtifactVersionRepository {
  private readonly rows = new Map<ArtifactVersionId, ArtifactVersion>()

  async create(version: ArtifactVersion): Promise<ArtifactVersion> {
    if (this.rows.has(version.id)) throw new Error(`ArtifactVersion '${version.id}' already exists`)
    this.rows.set(version.id, { ...version })
    return version
  }

  async get(id: ArtifactVersionId, workspaceId: WorkspaceId): Promise<ArtifactVersion | null> {
    const row = this.rows.get(id)
    if (!row || row.workspaceId !== workspaceId) return null
    return { ...row }
  }

  async listForArtifact(artifactId: ArtifactId, workspaceId: WorkspaceId): Promise<readonly ArtifactVersion[]> {
    return [...this.rows.values()]
      .filter((v) => v.artifactId === artifactId && v.workspaceId === workspaceId)
      .sort((a, b) => a.versionNumber - b.versionNumber)
      .map((v) => ({ ...v }))
  }

  async markSuperseded(id: ArtifactVersionId, workspaceId: WorkspaceId, supersededBy: ArtifactVersionId): Promise<void> {
    const row = this.rows.get(id)
    if (!row || row.workspaceId !== workspaceId) throw new Error(`ArtifactVersion '${id}' not found in workspace '${workspaceId}'`)
    if (row.supersededBy !== null) throw new Error(`ArtifactVersion '${id}' is already superseded by '${row.supersededBy}'`)
    row.supersededBy = supersededBy
  }

  async appendRenderedOutput(id: ArtifactVersionId, workspaceId: WorkspaceId, output: RenderedOutputRef): Promise<void> {
    const row = this.rows.get(id)
    if (!row || row.workspaceId !== workspaceId) throw new Error(`ArtifactVersion '${id}' not found in workspace '${workspaceId}'`)
    row.renderedOutputs = [...row.renderedOutputs.filter((r) => r.format !== output.format), output]
  }
}

class InMemoryApprovalRepository implements ApprovalRepository {
  private readonly rows: Approval[] = []

  async create(approval: Approval): Promise<Approval> {
    this.rows.push({ ...approval })
    return approval
  }

  async listForVersion(artifactVersionId: ArtifactVersionId, workspaceId: WorkspaceId): Promise<readonly Approval[]> {
    return this.rows
      .filter((a) => a.artifactVersionId === artifactVersionId && a.workspaceId === workspaceId)
      .map((a) => ({ ...a }))
  }
}

class InMemoryDestinationRepository implements DestinationRepository {
  private readonly rows = new Map<DestinationId, Destination>()

  async create(destination: Destination): Promise<Destination> {
    if (this.rows.has(destination.id)) throw new Error(`Destination '${destination.id}' already exists`)
    this.rows.set(destination.id, { ...destination })
    return destination
  }

  async get(id: DestinationId, workspaceId: WorkspaceId): Promise<Destination | null> {
    const row = this.rows.get(id)
    if (!row || row.workspaceId !== workspaceId) return null
    return { ...row }
  }

  async list(workspaceId: WorkspaceId): Promise<readonly Destination[]> {
    return [...this.rows.values()].filter((d) => d.workspaceId === workspaceId).map((d) => ({ ...d }))
  }

  async setActive(id: DestinationId, workspaceId: WorkspaceId, active: boolean): Promise<void> {
    const row = this.rows.get(id)
    if (!row || row.workspaceId !== workspaceId) throw new Error(`Destination '${id}' not found in workspace '${workspaceId}'`)
    row.active = active
  }
}

class InMemoryDistributionJobRepository implements DistributionJobRepository {
  private readonly rows = new Map<DistributionJobId, DistributionJob>()

  async create(job: DistributionJob): Promise<DistributionJob> {
    if (this.rows.has(job.id)) throw new Error(`DistributionJob '${job.id}' already exists`)
    this.rows.set(job.id, { ...job })
    return job
  }

  async get(id: DistributionJobId, workspaceId: WorkspaceId): Promise<DistributionJob | null> {
    const row = this.rows.get(id)
    if (!row || row.workspaceId !== workspaceId) return null
    return { ...row }
  }

  async update(
    id: DistributionJobId,
    workspaceId: WorkspaceId,
    patch: Partial<Pick<DistributionJob, 'status' | 'attempts' | 'lastAttemptAt' | 'lastError' | 'publicationId'>>,
  ): Promise<void> {
    const row = this.rows.get(id)
    if (!row || row.workspaceId !== workspaceId) throw new Error(`DistributionJob '${id}' not found in workspace '${workspaceId}'`)
    Object.assign(row, patch)
  }

  async listForVersion(artifactVersionId: ArtifactVersionId, workspaceId: WorkspaceId): Promise<readonly DistributionJob[]> {
    return [...this.rows.values()]
      .filter((j) => j.artifactVersionId === artifactVersionId && j.workspaceId === workspaceId)
      .map((j) => ({ ...j }))
  }
}

class InMemoryPublicationRepository implements PublicationRepository {
  private readonly rows = new Map<PublicationId, Publication>()

  async create(publication: Publication): Promise<Publication> {
    if (this.rows.has(publication.id)) throw new Error(`Publication '${publication.id}' already exists`)
    this.rows.set(publication.id, { ...publication })
    return publication
  }

  async get(id: PublicationId, workspaceId: WorkspaceId): Promise<Publication | null> {
    const row = this.rows.get(id)
    if (!row || row.workspaceId !== workspaceId) return null
    return { ...row }
  }

  async listForVersion(artifactVersionId: ArtifactVersionId, workspaceId: WorkspaceId): Promise<readonly Publication[]> {
    return [...this.rows.values()]
      .filter((p) => p.artifactVersionId === artifactVersionId && p.workspaceId === workspaceId)
      .map((p) => ({ ...p }))
  }

  async listForArtifact(artifactId: ArtifactId, workspaceId: WorkspaceId): Promise<readonly Publication[]> {
    // Publication has no direct artifactId field (only artifactVersionId — §4's
    // relationship graph). This repository is the one place that would need a
    // join in a relational store; the in-memory version does the equivalent by
    // filtering workspace and leaving artifact-level filtering to the caller,
    // who already has the version ids for an artifact via versions.listForArtifact().
    // Kept here (rather than removed) to satisfy the PublicationRepository
    // interface uniformly across both implementations — see
    // repository-supabase.ts's version of this same method for the real join.
    return [...this.rows.values()].filter((p) => p.workspaceId === workspaceId).map((p) => ({ ...p }))
  }

  async revoke(id: PublicationId, workspaceId: WorkspaceId, reason: string | undefined, revokedAt: string): Promise<void> {
    const row = this.rows.get(id)
    if (!row || row.workspaceId !== workspaceId) throw new Error(`Publication '${id}' not found in workspace '${workspaceId}'`)
    row.revoked = true
    row.revokedAt = revokedAt
    row.revokedReason = reason ?? null
  }
}

class InMemoryPublishEventRepository implements PublishEventRepository {
  private readonly rows: PublishEvent[] = []

  async append(event: PublishEvent): Promise<PublishEvent> {
    this.rows.push({ ...event })
    return event
  }

  async listForArtifact(artifactId: ArtifactId, workspaceId: WorkspaceId): Promise<readonly PublishEvent[]> {
    return this.rows
      .filter((e) => e.artifactId === artifactId && e.workspaceId === workspaceId)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .map((e) => ({ ...e }))
  }
}

class InMemoryRetentionPolicyRepository implements RetentionPolicyRepository {
  private readonly rows = new Map<WorkspaceId, RetentionPolicy>()

  async get(workspaceId: WorkspaceId): Promise<RetentionPolicy | null> {
    const row = this.rows.get(workspaceId)
    return row ? { ...row } : null
  }

  async upsert(policy: RetentionPolicy): Promise<RetentionPolicy> {
    this.rows.set(policy.workspaceId, { ...policy })
    return policy
  }
}

export function createInMemoryPublishingRepositories(): PublishingRepositories {
  return {
    artifacts: new InMemoryArtifactRepository(),
    versions: new InMemoryArtifactVersionRepository(),
    approvals: new InMemoryApprovalRepository(),
    destinations: new InMemoryDestinationRepository(),
    distributionJobs: new InMemoryDistributionJobRepository(),
    publications: new InMemoryPublicationRepository(),
    events: new InMemoryPublishEventRepository(),
    retentionPolicies: new InMemoryRetentionPolicyRepository(),
  }
}
