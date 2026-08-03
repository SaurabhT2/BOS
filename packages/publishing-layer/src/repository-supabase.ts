// ============================================================
// packages/publishing-layer/src/repository-supabase.ts
//
// Supabase-backed PublishingRepositories implementation — the production
// persistence path for §6's "fully persisted, relationally" metadata
// store. Tables are defined in
// supabase/migrations/20260801090000_publishing_layer.sql.
//
// TABLE NAMING — deliberately prefixed `brandos_publishing_*`:
//   control-plane-layer already owns `brandos_artifact_versions` and
//   `brandos_artifact_approvals` (content-generation-time concepts — see
//   the naming note at the top of types.ts). Reusing those names, or even
//   close variants, for Publishing's unrelated post-render entities would
//   be exactly the kind of silent two-sources-of-truth collision §11
//   warns against for the Destination Registry, one level down at the
//   schema layer. Every table here is therefore explicitly namespaced.
//
// ERROR HANDLING — deliberately NOT the "warn and continue" pattern:
//   ArtifactVersioningService / ApprovalService / AuditTrailService in
//   control-plane-layer treat Supabase as a best-effort side write (an
//   in-memory Map or buffer is the real source of truth; a failed
//   Supabase call is swallowed with console.warn). That pattern is wrong
//   for Publishing: Supabase IS the system of record here (§1 "the
//   accumulation of decisions and events over an artifact's life ... is
//   the product"). Silently swallowing a failed Approval or PublishEvent
//   insert would mean an auditor is told about compliance evidence that
//   was never actually durably recorded — the exact failure mode the
//   whole document exists to prevent (§2 Principle 8). Every write here
//   throws on failure; callers (publishing-service.ts) do not treat a
//   persistence failure as success.
//
// isTableMissing()/its warning are kept ONLY for read paths, matching
// this repo's existing UX convention of degrading a list/get to "empty,
// with a clear signal" rather than a hard 500 before the migration has
// been applied — never for writes.
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

type SupabaseClientLike = Awaited<ReturnType<typeof getSupabaseClient>>

let warnedTableMissing = new Set<string>()

async function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Supabase*Repository requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. ' +
        'Use createInMemoryPublishingRepositories() for tests/local dev without Supabase configured.',
    )
  }
  const { createClient } = await import('@supabase/supabase-js')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function isTableMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42P01' || (error.message?.includes('does not exist') ?? false)
}

function warnTableMissingOnce(table: string): void {
  if (warnedTableMissing.has(table)) return
  warnedTableMissing.add(table)
  console.warn(
    `[publishing-layer] Table '${table}' not found. Apply ` +
      'supabase/migrations/20260801090000_publishing_layer.sql to enable Publishing persistence.',
  )
}

// ─── Row <-> domain mappers ─────────────────────────────────────────────────

export function artifactToRow(a: Artifact) {
  return {
    id: a.id,
    workspace_id: a.workspaceId,
    owner_id: a.ownerId,
    title: a.title,
    artifact_type: a.artifactType,
    created_at: a.createdAt,
    current_state: a.currentState,
    current_version_id: a.currentVersionId,
    tags: a.tags,
  }
}
export function rowToArtifact(r: any): Artifact {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerId: r.owner_id,
    title: r.title,
    artifactType: r.artifact_type,
    createdAt: r.created_at,
    currentState: r.current_state,
    currentVersionId: r.current_version_id,
    tags: r.tags ?? [],
  }
}

export function versionToRow(v: ArtifactVersion) {
  return {
    id: v.id,
    artifact_id: v.artifactId,
    workspace_id: v.workspaceId,
    version_number: v.versionNumber,
    source_artifact_type: v.source.artifactType,
    source_content_hash: v.source.contentHash,
    source_payload: v.source.payload ?? null,
    rendered_outputs: v.renderedOutputs,
    created_at: v.createdAt,
    created_by: v.createdBy,
    supersedes: v.supersedes,
    superseded_by: v.supersededBy,
  }
}
export function rowToVersion(r: any): ArtifactVersion {
  return {
    id: r.id,
    artifactId: r.artifact_id,
    workspaceId: r.workspace_id,
    versionNumber: r.version_number,
    source: {
      artifactType: r.source_artifact_type,
      contentHash: r.source_content_hash,
      payload: r.source_payload ?? undefined,
    },
    renderedOutputs: r.rendered_outputs ?? [],
    createdAt: r.created_at,
    createdBy: r.created_by,
    supersedes: r.supersedes,
    supersededBy: r.superseded_by,
  }
}

export function approvalToRow(a: Approval) {
  return {
    id: a.id,
    artifact_version_id: a.artifactVersionId,
    workspace_id: a.workspaceId,
    purpose: a.purpose,
    decision: a.decision,
    reason: a.reason ?? null,
    decided_by: a.decidedBy,
    decided_at: a.decidedAt,
    policy_snapshot: a.policySnapshot,
  }
}
export function rowToApproval(r: any): Approval {
  return {
    id: r.id,
    artifactVersionId: r.artifact_version_id,
    workspaceId: r.workspace_id,
    purpose: r.purpose,
    decision: r.decision,
    reason: r.reason ?? undefined,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    policySnapshot: r.policy_snapshot,
  }
}

export function destinationToRow(d: Destination) {
  return {
    id: d.id,
    workspace_id: d.workspaceId,
    publisher_id: d.publisherId,
    name: d.name,
    config: d.config,
    created_at: d.createdAt,
    created_by: d.createdBy,
    active: d.active,
  }
}
export function rowToDestination(r: any): Destination {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    publisherId: r.publisher_id,
    name: r.name,
    config: r.config ?? {},
    createdAt: r.created_at,
    createdBy: r.created_by,
    active: r.active,
  }
}

export function jobToRow(j: DistributionJob) {
  return {
    id: j.id,
    artifact_version_id: j.artifactVersionId,
    destination_id: j.destinationId,
    workspace_id: j.workspaceId,
    format: j.format,
    status: j.status,
    attempts: j.attempts,
    max_attempts: j.maxAttempts,
    requested_by: j.requestedBy,
    requested_at: j.requestedAt,
    last_attempt_at: j.lastAttemptAt,
    last_error: j.lastError,
    publication_id: j.publicationId,
  }
}
export function rowToJob(r: any): DistributionJob {
  return {
    id: r.id,
    artifactVersionId: r.artifact_version_id,
    destinationId: r.destination_id,
    workspaceId: r.workspace_id,
    format: r.format,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    lastAttemptAt: r.last_attempt_at,
    lastError: r.last_error,
    publicationId: r.publication_id,
  }
}

export function publicationToRow(p: Publication) {
  return {
    id: p.id,
    artifact_version_id: p.artifactVersionId,
    destination_id: p.destinationId,
    distribution_job_id: p.distributionJobId,
    workspace_id: p.workspaceId,
    destination_reference: p.destinationReference,
    published_at: p.publishedAt,
    published_by: p.publishedBy,
    revoked: p.revoked,
    revoked_at: p.revokedAt,
    revoked_reason: p.revokedReason,
  }
}
export function rowToPublication(r: any): Publication {
  return {
    id: r.id,
    artifactVersionId: r.artifact_version_id,
    destinationId: r.destination_id,
    distributionJobId: r.distribution_job_id,
    workspaceId: r.workspace_id,
    destinationReference: r.destination_reference,
    publishedAt: r.published_at,
    publishedBy: r.published_by,
    revoked: r.revoked,
    revokedAt: r.revoked_at,
    revokedReason: r.revoked_reason,
  }
}

export function eventToRow(e: PublishEvent) {
  return {
    id: e.id,
    type: e.type,
    artifact_id: e.artifactId,
    artifact_version_id: e.artifactVersionId,
    workspace_id: e.workspaceId,
    actor: e.actor,
    occurred_at: e.occurredAt,
    detail: e.detail,
  }
}
export function rowToEvent(r: any): PublishEvent {
  return {
    id: r.id,
    type: r.type,
    artifactId: r.artifact_id,
    artifactVersionId: r.artifact_version_id,
    workspaceId: r.workspace_id,
    actor: r.actor,
    occurredAt: r.occurred_at,
    detail: r.detail ?? {},
  }
}

export function retentionToRow(p: RetentionPolicy) {
  return {
    workspace_id: p.workspaceId,
    min_retention_days: p.minRetentionDays,
    hard_delete_allowed: p.hardDeleteAllowed,
    updated_at: p.updatedAt,
    updated_by: p.updatedBy,
  }
}
export function rowToRetention(r: any): RetentionPolicy {
  return {
    workspaceId: r.workspace_id,
    minRetentionDays: r.min_retention_days,
    hardDeleteAllowed: r.hard_delete_allowed,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  }
}

// ─── Repositories ────────────────────────────────────────────────────────────

class SupabaseArtifactRepository implements ArtifactRepository {
  private readonly table = 'brandos_publishing_artifacts'

  async create(artifact: Artifact): Promise<Artifact> {
    const supabase = await getSupabaseClient()
    const { error } = await supabase.from(this.table).insert(artifactToRow(artifact))
    if (error) throw new Error(`ArtifactRepository.create failed: ${error.message}`)
    return artifact
  }

  async get(id: ArtifactId, workspaceId: WorkspaceId): Promise<Artifact | null> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase.from(this.table).select('*').eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
    if (error) {
      if (isTableMissing(error)) { warnTableMissingOnce(this.table); return null }
      throw new Error(`ArtifactRepository.get failed: ${error.message}`)
    }
    return data ? rowToArtifact(data) : null
  }

  async list(workspaceId: WorkspaceId): Promise<readonly Artifact[]> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase.from(this.table).select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false })
    if (error) {
      if (isTableMissing(error)) { warnTableMissingOnce(this.table); return [] }
      throw new Error(`ArtifactRepository.list failed: ${error.message}`)
    }
    return (data ?? []).map(rowToArtifact)
  }

  async updateCurrentVersion(
    id: ArtifactId,
    workspaceId: WorkspaceId,
    patch: { currentVersionId: ArtifactVersionId; currentState: Artifact['currentState'] },
  ): Promise<void> {
    const supabase = await getSupabaseClient()
    const { error } = await supabase
      .from(this.table)
      .update({ current_version_id: patch.currentVersionId, current_state: patch.currentState })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
    if (error) throw new Error(`ArtifactRepository.updateCurrentVersion failed: ${error.message}`)
  }
}

class SupabaseArtifactVersionRepository implements ArtifactVersionRepository {
  private readonly table = 'brandos_publishing_artifact_versions'

  async create(version: ArtifactVersion): Promise<ArtifactVersion> {
    const supabase = await getSupabaseClient()
    const { error } = await supabase.from(this.table).insert(versionToRow(version))
    if (error) throw new Error(`ArtifactVersionRepository.create failed: ${error.message}`)
    return version
  }

  async get(id: ArtifactVersionId, workspaceId: WorkspaceId): Promise<ArtifactVersion | null> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase.from(this.table).select('*').eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
    if (error) {
      if (isTableMissing(error)) { warnTableMissingOnce(this.table); return null }
      throw new Error(`ArtifactVersionRepository.get failed: ${error.message}`)
    }
    return data ? rowToVersion(data) : null
  }

  async listForArtifact(artifactId: ArtifactId, workspaceId: WorkspaceId): Promise<readonly ArtifactVersion[]> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase
      .from(this.table)
      .select('*')
      .eq('artifact_id', artifactId)
      .eq('workspace_id', workspaceId)
      .order('version_number', { ascending: true })
    if (error) {
      if (isTableMissing(error)) { warnTableMissingOnce(this.table); return [] }
      throw new Error(`ArtifactVersionRepository.listForArtifact failed: ${error.message}`)
    }
    return (data ?? []).map(rowToVersion)
  }

  async markSuperseded(id: ArtifactVersionId, workspaceId: WorkspaceId, supersededBy: ArtifactVersionId): Promise<void> {
    const supabase = await getSupabaseClient()
    const { error } = await supabase
      .from(this.table)
      .update({ superseded_by: supersededBy })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .is('superseded_by', null) // enforce write-once at the DB layer too, not just in-memory
    if (error) throw new Error(`ArtifactVersionRepository.markSuperseded failed: ${error.message}`)
  }

  async appendRenderedOutput(id: ArtifactVersionId, workspaceId: WorkspaceId, output: import('./types').RenderedOutputRef): Promise<void> {
    // Read-modify-write: jsonb array append is not atomic without a
    // Postgres function (e.g. jsonb array concat via a stored procedure),
    // which this migration does not define — same last-write-wins caveat
    // already documented for other multi-step operations in this
    // codebase (see supabase/migrations/README.md). Acceptable here
    // because renderedOutputs is per-format-keyed (a concurrent append of
    // two *different* formats loses one under a race); a future
    // `append_rendered_output(version_id, output)` SQL function would
    // close this gap without any change to this method's signature.
    const supabase = await getSupabaseClient()
    const { data, error: fetchError } = await supabase
      .from(this.table)
      .select('rendered_outputs')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (fetchError) throw new Error(`ArtifactVersionRepository.appendRenderedOutput failed to read current outputs: ${fetchError.message}`)
    if (!data) throw new Error(`ArtifactVersion '${id}' not found in workspace '${workspaceId}'`)

    const current: any[] = data.rendered_outputs ?? []
    const next = [...current.filter((r) => r.format !== output.format), output]

    const { error } = await supabase
      .from(this.table)
      .update({ rendered_outputs: next })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
    if (error) throw new Error(`ArtifactVersionRepository.appendRenderedOutput failed: ${error.message}`)
  }
}

class SupabaseApprovalRepository implements ApprovalRepository {
  private readonly table = 'brandos_publishing_approvals'

  async create(approval: Approval): Promise<Approval> {
    const supabase = await getSupabaseClient()
    const { error } = await supabase.from(this.table).insert(approvalToRow(approval))
    if (error) throw new Error(`ApprovalRepository.create failed: ${error.message}`)
    return approval
  }

  async listForVersion(artifactVersionId: ArtifactVersionId, workspaceId: WorkspaceId): Promise<readonly Approval[]> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase
      .from(this.table)
      .select('*')
      .eq('artifact_version_id', artifactVersionId)
      .eq('workspace_id', workspaceId)
      .order('decided_at', { ascending: true })
    if (error) {
      if (isTableMissing(error)) { warnTableMissingOnce(this.table); return [] }
      throw new Error(`ApprovalRepository.listForVersion failed: ${error.message}`)
    }
    return (data ?? []).map(rowToApproval)
  }
}

class SupabaseDestinationRepository implements DestinationRepository {
  private readonly table = 'brandos_publishing_destinations'

  async create(destination: Destination): Promise<Destination> {
    const supabase = await getSupabaseClient()
    const { error } = await supabase.from(this.table).insert(destinationToRow(destination))
    if (error) throw new Error(`DestinationRepository.create failed: ${error.message}`)
    return destination
  }

  async get(id: DestinationId, workspaceId: WorkspaceId): Promise<Destination | null> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase.from(this.table).select('*').eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
    if (error) {
      if (isTableMissing(error)) { warnTableMissingOnce(this.table); return null }
      throw new Error(`DestinationRepository.get failed: ${error.message}`)
    }
    return data ? rowToDestination(data) : null
  }

  async list(workspaceId: WorkspaceId): Promise<readonly Destination[]> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase.from(this.table).select('*').eq('workspace_id', workspaceId)
    if (error) {
      if (isTableMissing(error)) { warnTableMissingOnce(this.table); return [] }
      throw new Error(`DestinationRepository.list failed: ${error.message}`)
    }
    return (data ?? []).map(rowToDestination)
  }

  async setActive(id: DestinationId, workspaceId: WorkspaceId, active: boolean): Promise<void> {
    const supabase = await getSupabaseClient()
    const { error } = await supabase.from(this.table).update({ active }).eq('id', id).eq('workspace_id', workspaceId)
    if (error) throw new Error(`DestinationRepository.setActive failed: ${error.message}`)
  }
}

class SupabaseDistributionJobRepository implements DistributionJobRepository {
  private readonly table = 'brandos_publishing_distribution_jobs'

  async create(job: DistributionJob): Promise<DistributionJob> {
    const supabase = await getSupabaseClient()
    const { error } = await supabase.from(this.table).insert(jobToRow(job))
    if (error) throw new Error(`DistributionJobRepository.create failed: ${error.message}`)
    return job
  }

  async get(id: DistributionJobId, workspaceId: WorkspaceId): Promise<DistributionJob | null> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase.from(this.table).select('*').eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
    if (error) {
      if (isTableMissing(error)) { warnTableMissingOnce(this.table); return null }
      throw new Error(`DistributionJobRepository.get failed: ${error.message}`)
    }
    return data ? rowToJob(data) : null
  }

  async update(
    id: DistributionJobId,
    workspaceId: WorkspaceId,
    patch: Partial<Pick<DistributionJob, 'status' | 'attempts' | 'lastAttemptAt' | 'lastError' | 'publicationId'>>,
  ): Promise<void> {
    const supabase = await getSupabaseClient()
    const row: Record<string, unknown> = {}
    if (patch.status !== undefined) row.status = patch.status
    if (patch.attempts !== undefined) row.attempts = patch.attempts
    if (patch.lastAttemptAt !== undefined) row.last_attempt_at = patch.lastAttemptAt
    if (patch.lastError !== undefined) row.last_error = patch.lastError
    if (patch.publicationId !== undefined) row.publication_id = patch.publicationId
    const { error } = await supabase.from(this.table).update(row).eq('id', id).eq('workspace_id', workspaceId)
    if (error) throw new Error(`DistributionJobRepository.update failed: ${error.message}`)
  }

  async listForVersion(artifactVersionId: ArtifactVersionId, workspaceId: WorkspaceId): Promise<readonly DistributionJob[]> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase
      .from(this.table)
      .select('*')
      .eq('artifact_version_id', artifactVersionId)
      .eq('workspace_id', workspaceId)
      .order('requested_at', { ascending: true })
    if (error) {
      if (isTableMissing(error)) { warnTableMissingOnce(this.table); return [] }
      throw new Error(`DistributionJobRepository.listForVersion failed: ${error.message}`)
    }
    return (data ?? []).map(rowToJob)
  }
}

class SupabasePublicationRepository implements PublicationRepository {
  private readonly table = 'brandos_publishing_publications'
  private readonly versionsTable = 'brandos_publishing_artifact_versions'

  async create(publication: Publication): Promise<Publication> {
    const supabase = await getSupabaseClient()
    const { error } = await supabase.from(this.table).insert(publicationToRow(publication))
    if (error) throw new Error(`PublicationRepository.create failed: ${error.message}`)
    return publication
  }

  async get(id: PublicationId, workspaceId: WorkspaceId): Promise<Publication | null> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase.from(this.table).select('*').eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
    if (error) {
      if (isTableMissing(error)) { warnTableMissingOnce(this.table); return null }
      throw new Error(`PublicationRepository.get failed: ${error.message}`)
    }
    return data ? rowToPublication(data) : null
  }

  async listForVersion(artifactVersionId: ArtifactVersionId, workspaceId: WorkspaceId): Promise<readonly Publication[]> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase
      .from(this.table)
      .select('*')
      .eq('artifact_version_id', artifactVersionId)
      .eq('workspace_id', workspaceId)
    if (error) {
      if (isTableMissing(error)) { warnTableMissingOnce(this.table); return [] }
      throw new Error(`PublicationRepository.listForVersion failed: ${error.message}`)
    }
    return (data ?? []).map(rowToPublication)
  }

  async listForArtifact(artifactId: ArtifactId, workspaceId: WorkspaceId): Promise<readonly Publication[]> {
    // Real join: Publication has no artifact_id column (§4's graph — Publication
    // references exactly one ArtifactVersion, not the Artifact directly), so this
    // resolves the artifact's version ids first, then filters publications by
    // that set. Two round-trips, not a stored procedure — acceptable for a
    // read path this repository's own docstring in repository.ts describes as
    // "query-heavy but small."
    const supabase = await getSupabaseClient()
    const { data: versionRows, error: versionError } = await supabase
      .from(this.versionsTable)
      .select('id')
      .eq('artifact_id', artifactId)
      .eq('workspace_id', workspaceId)
    if (versionError) {
      if (isTableMissing(versionError)) { warnTableMissingOnce(this.versionsTable); return [] }
      throw new Error(`PublicationRepository.listForArtifact failed resolving versions: ${versionError.message}`)
    }
    const versionIds = (versionRows ?? []).map((r: any) => r.id)
    if (versionIds.length === 0) return []

    const { data, error } = await supabase
      .from(this.table)
      .select('*')
      .in('artifact_version_id', versionIds)
      .eq('workspace_id', workspaceId)
    if (error) {
      if (isTableMissing(error)) { warnTableMissingOnce(this.table); return [] }
      throw new Error(`PublicationRepository.listForArtifact failed: ${error.message}`)
    }
    return (data ?? []).map(rowToPublication)
  }

  async revoke(id: PublicationId, workspaceId: WorkspaceId, reason: string | undefined, revokedAt: string): Promise<void> {
    const supabase = await getSupabaseClient()
    const { error } = await supabase
      .from(this.table)
      .update({ revoked: true, revoked_at: revokedAt, revoked_reason: reason ?? null })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
    if (error) throw new Error(`PublicationRepository.revoke failed: ${error.message}`)
  }
}

class SupabasePublishEventRepository implements PublishEventRepository {
  private readonly table = 'brandos_publishing_events'

  async append(event: PublishEvent): Promise<PublishEvent> {
    const supabase = await getSupabaseClient()
    const { error } = await supabase.from(this.table).insert(eventToRow(event))
    if (error) throw new Error(`PublishEventRepository.append failed: ${error.message}`)
    return event
  }

  async listForArtifact(artifactId: ArtifactId, workspaceId: WorkspaceId): Promise<readonly PublishEvent[]> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase
      .from(this.table)
      .select('*')
      .eq('artifact_id', artifactId)
      .eq('workspace_id', workspaceId)
      .order('occurred_at', { ascending: true })
    if (error) {
      if (isTableMissing(error)) { warnTableMissingOnce(this.table); return [] }
      throw new Error(`PublishEventRepository.listForArtifact failed: ${error.message}`)
    }
    return (data ?? []).map(rowToEvent)
  }
}

class SupabaseRetentionPolicyRepository implements RetentionPolicyRepository {
  private readonly table = 'brandos_publishing_retention_policies'

  async get(workspaceId: WorkspaceId): Promise<RetentionPolicy | null> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase.from(this.table).select('*').eq('workspace_id', workspaceId).maybeSingle()
    if (error) {
      if (isTableMissing(error)) { warnTableMissingOnce(this.table); return null }
      throw new Error(`RetentionPolicyRepository.get failed: ${error.message}`)
    }
    return data ? rowToRetention(data) : null
  }

  async upsert(policy: RetentionPolicy): Promise<RetentionPolicy> {
    const supabase = await getSupabaseClient()
    const { error } = await supabase.from(this.table).upsert(retentionToRow(policy), { onConflict: 'workspace_id' })
    if (error) throw new Error(`RetentionPolicyRepository.upsert failed: ${error.message}`)
    return policy
  }
}

export function createSupabasePublishingRepositories(): PublishingRepositories {
  return {
    artifacts: new SupabaseArtifactRepository(),
    versions: new SupabaseArtifactVersionRepository(),
    approvals: new SupabaseApprovalRepository(),
    destinations: new SupabaseDestinationRepository(),
    distributionJobs: new SupabaseDistributionJobRepository(),
    publications: new SupabasePublicationRepository(),
    events: new SupabasePublishEventRepository(),
    retentionPolicies: new SupabaseRetentionPolicyRepository(),
  }
}

/** Exported for tests that need to reset the module-level warn-once cache between cases. */
export function __resetWarnedTableMissingForTests(): void {
  warnedTableMissing = new Set<string>()
}
