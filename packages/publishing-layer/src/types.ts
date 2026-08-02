// ============================================================
// packages/publishing-layer/src/types.ts
//
// Canonical Publishing domain model — PUBLISHING_ARCHITECTURE_V1.md §4.
// Entities and relationships only. No persistence mechanics here
// (see repository.ts) and no HTTP/request shapes (§9 of the
// architecture is explicitly future/interfaces-only and is not
// implemented by this package — see PUBLISHING_LAYER_NOTES.md).
//
// NAMING NOTE — read before touching this file:
//   @brandos/control-plane-layer already exports an unrelated
//   `ArtifactVersion` (src/versioning/artifact-versioning.ts) and an
//   unrelated `ApprovalRecord`/`ApprovalService` (src/approval/approval-service.ts).
//   Those are a *content-generation-time* concept: "stamp this AI
//   generation with a regeneration-lineage version number for a
//   campaign" and "gate low-scoring AI output behind human review before
//   it is even shown to the requesting user." They operate on a raw
//   ArtifactV2 payload keyed by campaign_id, are mutated in place
//   (status column updated), and know nothing about rendering,
//   destinations, or distribution.
//
//   The types below are a *post-render, post-existence* concept: "this
//   exact rendered ArtifactVersion was approved for external
//   distribution and sent to this exact Destination" — immutable,
//   append-only, keyed by Artifact/Destination identity, and the
//   system of record Rendering V2 explicitly does not attempt to be
//   (§1/§3 of the architecture). They are different concerns that
//   happen to rhyme in name. Do not import CPL's ArtifactVersion here,
//   do not import these types into CPL's generation pipeline, and do
//   not merge the two models — see §3's "boundary test" for why they
//   must stay separate.
// ============================================================

import type { ArtifactType, ArtifactV2 } from '@brandos/contracts'

// ─── Identity aliases (opaque strings; branded for clarity, not enforced at runtime) ───

export type ArtifactId = string
export type ArtifactVersionId = string
export type ApprovalId = string
export type DestinationId = string
export type PublicationId = string
export type DistributionJobId = string
export type PublishEventId = string
export type WorkspaceId = string
export type UserId = string

// ─── Lifecycle (§5) ────────────────────────────────────────────────────────

/**
 * ArtifactLifecycleState — §5's linear lifecycle.
 *
 * "Published" is a derived convenience for callers who just want a coarse
 * status; the source of truth for "where did this go" is always the set of
 * Publications (§5: "'published' is really 'has at least one active
 * Publication', not a single boolean"). See lifecycle.ts for how this state
 * is computed/transitioned rather than stored as an independent field that
 * could drift from the Publication set.
 */
export type ArtifactLifecycleState =
  | 'draft'
  | 'generated'
  | 'reviewed'
  | 'approved'
  | 'published'
  | 'archived'
  | 'deleted'

/** Who/what triggered a lifecycle transition — for the audit trail (§8). */
export interface Actor {
  readonly userId: UserId
  /**
   * Role at the moment of the action, not looked up later (§8: "roles can
   * change later; the record reflects the role at approval time").
   */
  readonly role: string
  /**
   * Distinguishes a human actor from an automated one (e.g. a future
   * scheduler triggering distribution — §8: "a common real-world pattern:
   * one person approves, an automated scheduler ... actually triggers
   * distribution"). Defaults are the caller's responsibility; this package
   * makes no assumption about which is more common.
   */
  readonly kind: 'human' | 'system'
}

// ─── Artifact (§4) ─────────────────────────────────────────────────────────

/**
 * Artifact — the durable identity of "a thing BrandOS produced." Stable
 * across versions. Does not itself hold rendered content.
 */
export interface Artifact {
  readonly id: ArtifactId
  readonly workspaceId: WorkspaceId
  readonly ownerId: UserId
  title: string
  readonly artifactType: ArtifactType
  readonly createdAt: string
  /** Denormalized for cheap "what state is this artifact in" reads (§5). */
  currentState: ArtifactLifecycleState
  /** Denormalized pointer to the version currently governing `currentState`. */
  currentVersionId: ArtifactVersionId | null
  tags: readonly string[]
}

// ─── ArtifactVersion (§4) ──────────────────────────────────────────────────

/**
 * A pointer to where one rendered output of an ArtifactVersion lives.
 * Publishing persists the pointer + hash, not a second copy of the bytes
 * as "truth" — see §6 and storage.ts.
 */
export interface RenderedOutputRef {
  readonly format: 'html' | 'pdf' | 'pptx' | 'png' | 'email'
  readonly mimeType: string
  /** Opaque locator resolved by a RenderedOutputStore (storage.ts). Not a public URL by itself. */
  readonly storageKey: string
  /** SHA-256 of the bytes at storage time — §6's "content hash ... audit primitive." */
  readonly contentHash: string
  readonly sizeBytes: number
  readonly renderedAt: string
}

/**
 * ArtifactVersion — one immutable snapshot of an Artifact at a point in
 * time (§4). Immutable in content after creation — a correction is a new
 * version (§2 Principle 6, §6 "immutability enforced at the model level")
 * — with exactly two narrow, explicitly-sanctioned exceptions:
 * `supersededBy` (a single write-once pointer edge, set when a later
 * version supersedes this one) and `renderedOutputs` (designed to grow —
 * "one version can have multiple rendered formats," see that field's own
 * doc comment). Every other field is set once at construction and never
 * changes.
 */
export interface ArtifactVersion {
  readonly id: ArtifactVersionId
  readonly artifactId: ArtifactId
  readonly workspaceId: WorkspaceId
  /** Monotonically increasing per Artifact, starting at 1. */
  readonly versionNumber: number
  /**
   * Reference to the governed source this version was rendered from — not
   * a duplicate copy of CompositionDocument (§6: "Publishing references an
   * ArtifactVersion's source ... does not duplicate the Composition
   * Layer's own caching concerns"). Stored so a render can be reproduced
   * exactly if ever needed.
   */
  readonly source: {
    readonly artifactType: ArtifactType
    /** Hash of the governed ArtifactV2 payload + theme/composition inputs used (§6). */
    readonly contentHash: string
    /**
     * The governed payload itself, retained only if the caller opted in
     * (`recordGeneratedVersion({ retainSourcePayload: true })`) — this
     * package does not force a second full copy of every ArtifactV2 to be
     * stored by default; the hash alone is sufficient to prove "this exact
     * content" without necessarily retaining the payload. See §6 and
     * PUBLISHING_LAYER_NOTES.md for why this is a caller-provided flag,
     * not a hardcoded policy this package should not be guessing at.
     */
    readonly payload?: ArtifactV2
  }
  /** One version can have multiple rendered formats, all derived from the same version (§4). Mutable field (elements are individually immutable) — the one content field this type intentionally grows after creation; see repository.ts's appendRenderedOutput. */
  renderedOutputs: readonly RenderedOutputRef[]
  readonly createdAt: string
  readonly createdBy: Actor
  /**
   * Which prior version this supersedes, if any — an explicit graph edge,
   * not inferred from timestamps (§6). Null for a version's own first
   * ancestor-free creation (including the first version of an Artifact,
   * and A/B/parallel variants per §12 that don't supersede anything).
   */
  readonly supersedes: ArtifactVersionId | null
  /** Set by the lifecycle engine when a newer version supersedes this one; never unset. */
  supersededBy: ArtifactVersionId | null
}

// ─── Approval (§4) ─────────────────────────────────────────────────────────

export type ApprovalPurpose = 'external_distribution' | 'internal_review'
export type ApprovalDecision = 'approved' | 'rejected'

/**
 * Approval — a record that a specific person approved a specific
 * ArtifactVersion for a specific purpose, under a specific policy
 * evaluation (§4, §8). Immutable once created; re-approval after edits is
 * a *new* Approval against a *new* ArtifactVersion, never an edit to this
 * one (§5's Approved-state description).
 */
export interface Approval {
  readonly id: ApprovalId
  readonly artifactVersionId: ArtifactVersionId
  readonly workspaceId: WorkspaceId
  readonly purpose: ApprovalPurpose
  readonly decision: ApprovalDecision
  readonly reason?: string
  readonly decidedBy: Actor
  readonly decidedAt: string
  /**
   * Which policy config produced the gate this Approval satisfies (or
   * overrides, for a rejection) — §8: "Approval ... under what policy
   * version" is part of the evidence package.
   */
  readonly policySnapshot: {
    readonly requirePublishingApproval: boolean
    readonly requireApprovalForExternalPublish: boolean
  }
}

// ─── Destination (§4, §7) ──────────────────────────────────────────────────

/**
 * PublisherId — names which Publisher plugin (publisher-registry.ts)
 * handles a Destination. Only the two implemented in this engagement are
 * enumerated as concrete values; the union is deliberately left open via
 * `(string & {})` so the Destination Registry can register a future
 * plugin's id (LinkedIn, Email, CMS, Canva — §7) without a type change
 * here, mirroring how GovernedArtifactType is extended (governance-layer's
 * IGovernanceLayer.ts) rather than how a closed enum would force a change
 * in this file for every new plugin.
 */
export type PublisherId = 'share-link' | 'download' | (string & {})

/**
 * Destination — a configured place an artifact can go. Configuration +
 * credentials + a reference to which Publisher handles it — never
 * delivery logic itself (§4, §7).
 */
export interface Destination {
  readonly id: DestinationId
  readonly workspaceId: WorkspaceId
  readonly publisherId: PublisherId
  name: string
  /**
   * Publisher-specific configuration, opaque to Publishing core. A
   * Publisher implementation is responsible for validating its own shape
   * (mirrors §7: "A Publisher never touches CompositionDocument ... those
   * are Publishing-core concerns"; the inverse holds too — Publishing-core
   * never inspects `config`'s Publisher-specific contents).
   */
  readonly config: Readonly<Record<string, unknown>>
  readonly createdAt: string
  readonly createdBy: Actor
  active: boolean
}

// ─── DistributionJob + Publication (§4) ────────────────────────────────────

export type DistributionJobStatus = 'pending' | 'succeeded' | 'failed' | 'retrying'

/**
 * DistributionJob — the (possibly async, possibly retried) unit of work
 * that attempts to create a Publication (§4). The job is the attempt; the
 * Publication is the confirmed outcome.
 */
export interface DistributionJob {
  readonly id: DistributionJobId
  readonly artifactVersionId: ArtifactVersionId
  readonly destinationId: DestinationId
  readonly workspaceId: WorkspaceId
  status: DistributionJobStatus
  attempts: number
  readonly maxAttempts: number
  readonly requestedBy: Actor
  readonly requestedAt: string
  lastAttemptAt: string | null
  lastError: string | null
  /** Set once status becomes 'succeeded'. */
  publicationId: PublicationId | null
}

/**
 * Publication — the durable record that "this ArtifactVersion was sent to
 * this Destination" (§4). Never deleted, even on rollback (§8).
 */
export interface Publication {
  readonly id: PublicationId
  readonly artifactVersionId: ArtifactVersionId
  readonly destinationId: DestinationId
  readonly distributionJobId: DistributionJobId
  readonly workspaceId: WorkspaceId
  /** The destination's own reference back — a share-link token, a LinkedIn post id, an ESP send id (§4). */
  readonly destinationReference: string
  readonly publishedAt: string
  readonly publishedBy: Actor
  /**
   * §8 "Rollback": never destructive. A revoked Publication row is never
   * deleted — only marked revoked, with the revocation itself recorded as
   * a PublishEvent.
   */
  revoked: boolean
  revokedAt: string | null
  revokedReason: string | null
}

// ─── PublishEvent + AuditRecord (§4, §8) ───────────────────────────────────

export type PublishEventType =
  | 'artifact_created'
  | 'version_generated'
  | 'version_superseded'
  | 'reviewed'
  | 'approval_submitted'
  | 'approval_decided'
  | 'distribution_submitted'
  | 'distribution_retried'
  | 'distribution_succeeded'
  | 'distribution_failed'
  | 'publication_revoked'
  | 'artifact_archived'
  | 'artifact_deleted'

/**
 * PublishEvent — an append-only event describing something that happened
 * (§4). The audit trail is built entirely from these; nothing is ever
 * inferred from mutable state alone. Never updated or deleted once
 * written (§6).
 */
export interface PublishEvent {
  readonly id: PublishEventId
  readonly type: PublishEventType
  readonly artifactId: ArtifactId
  readonly artifactVersionId: ArtifactVersionId | null
  readonly workspaceId: WorkspaceId
  readonly actor: Actor
  readonly occurredAt: string
  /** Event-specific structured detail (e.g. rejection reason, destination id, error message). Never free-form PII. */
  readonly detail: Readonly<Record<string, unknown>>
}

/**
 * AuditRecord — a durable, queryable projection over PublishEvents plus
 * Approvals plus lifecycle transitions (§4), built to answer "who did
 * what, when, to what" without requiring a reviewer to reconstruct history
 * from raw events. Built by audit.ts; never hand-constructed by callers.
 */
export interface AuditRecord {
  readonly artifactId: ArtifactId
  readonly workspaceId: WorkspaceId
  readonly generatedAt: string
  readonly currentState: ArtifactLifecycleState
  readonly versions: readonly {
    readonly versionId: ArtifactVersionId
    readonly versionNumber: number
    readonly contentHash: string
    readonly approvals: readonly Approval[]
    readonly publications: readonly Publication[]
  }[]
  readonly events: readonly PublishEvent[]
}

// ─── RetentionPolicy (§4, §13) ──────────────────────────────────────────────

/**
 * RetentionPolicy — §4's shape only. §13 explicitly lists the actual
 * retention *numbers* (and whether hard-deletion is ever offered) as an
 * unresolved product/legal decision, not an engineering one — this
 * package therefore defines the type and a conservative, non-destructive
 * default (retain indefinitely, no auto-archival, no hard-delete) rather
 * than guessing at compliance-specific windows. See
 * PUBLISHING_LAYER_NOTES.md §"What was deliberately not built."
 */
export interface RetentionPolicy {
  readonly workspaceId: WorkspaceId
  /** Null = retain indefinitely (the default). */
  readonly minRetentionDays: number | null
  /** Whether a 'deleted' Artifact may ever hard-delete content vs. access-revoke only (§5, §13). */
  readonly hardDeleteAllowed: boolean
  readonly updatedAt: string
  readonly updatedBy: Actor
}

export const DEFAULT_RETENTION_POLICY = (
  workspaceId: WorkspaceId,
  actor: Actor,
): RetentionPolicy => ({
  workspaceId,
  minRetentionDays: null,
  hardDeleteAllowed: false,
  updatedAt: new Date().toISOString(),
  updatedBy: actor,
})
