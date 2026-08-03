// ============================================================
// packages/publishing-layer/src/audit.ts
//
// §4 AuditRecord: "a durable, queryable projection over PublishEvents plus
// Approvals plus lifecycle transitions ... built specifically to answer
// 'who did what, when, to what' without requiring a compliance reviewer
// to reconstruct history from raw events."
//
// This module is the only place an AuditRecord is constructed. It is a
// pure projection (given the raw rows, no I/O) — callers (
// publishing-service.ts) are responsible for fetching artifact, versions,
// approvals, publications, and events from the repositories and handing
// them here.
// ============================================================

import { deriveVersionState } from './lifecycle'
import type {
  Approval,
  Artifact,
  ArtifactVersion,
  AuditRecord,
  Publication,
  PublishEvent,
} from './types'

export function buildAuditRecord(params: {
  artifact: Artifact
  versions: readonly ArtifactVersion[]
  approvals: readonly Approval[]
  publications: readonly Publication[]
  events: readonly PublishEvent[]
}): AuditRecord {
  const { artifact, versions, approvals, publications, events } = params

  const versionSummaries = versions
    .slice()
    .sort((a, b) => a.versionNumber - b.versionNumber)
    .map((version) => ({
      versionId: version.id,
      versionNumber: version.versionNumber,
      contentHash: version.source.contentHash,
      approvals: approvals.filter((a) => a.artifactVersionId === version.id),
      publications: publications.filter((p) => p.artifactVersionId === version.id),
    }))

  const currentVersion = artifact.currentVersionId
    ? versions.find((v) => v.id === artifact.currentVersionId)
    : versions[versions.length - 1]

  const currentState = currentVersion
    ? deriveVersionState({
        version: currentVersion,
        approvals,
        publications,
        events,
      })
    : artifact.currentState

  return {
    artifactId: artifact.id,
    workspaceId: artifact.workspaceId,
    generatedAt: new Date().toISOString(),
    currentState,
    versions: versionSummaries,
    events: events.slice().sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
  }
}

/**
 * Convenience helper: "show me everything published under a given
 * ArtifactVersion's content hash" (§8's "show me everything published
 * under the old logo before the rebrand cutover date" example) — a pure
 * filter over an already-built AuditRecord, not a new query shape.
 */
export function publicationsByContentHash(
  record: AuditRecord,
  contentHash: string,
): readonly Publication[] {
  return record.versions
    .filter((v) => v.contentHash === contentHash)
    .flatMap((v) => v.publications)
}
