// ============================================================
// packages/publishing-layer/src/lifecycle.ts
//
// §5 Lifecycle engine.
//
// DESIGN DECISION — state is derived, not stored:
//   §6 says "ArtifactVersion ... rows are never updated in place once
//   created," and §5 itself says "'published' is really 'has at least one
//   active Publication' ... not a single boolean." Taking both seriously:
//   this engine does NOT store a mutable `state` field on ArtifactVersion.
//   Instead, deriveVersionState() computes the version's lifecycle state
//   from the immutable evidence that already exists — PublishEvents,
//   Approvals, and Publications — exactly the same "derive from the
//   append-only log, don't trust a mutable flag" posture §4 establishes
//   for the AuditRecord, applied one level down to the state itself.
//
//   The one narrowly-scoped exception is ArtifactVersion.supersededBy,
//   which the architecture explicitly describes as "an explicit, queryable
//   structure" (§6) that must be set when a newer version supersedes an
//   older one — a single write, once, not an ongoing mutable status field.
//
// Draft has no representation here: §5 is explicit that "Publishing does
// not yet have a record" for Draft — this engine's earliest state is
// 'generated', matching an ArtifactVersion's very first fact-of-existence.
// ============================================================

import type {
  Actor,
  Approval,
  ArtifactLifecycleState,
  ArtifactVersion,
  Publication,
  PublishEvent,
} from './types'
import type { GateEvaluation } from './policy'

export class LifecycleError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_action'
      | 'gate_denied'
      | 'version_superseded'
      | 'version_not_found',
  ) {
    super(message)
    this.name = 'LifecycleError'
  }
}

/** Evidence bundle for one ArtifactVersion, used to derive its current state. */
export interface VersionEvidence {
  readonly version: ArtifactVersion
  readonly approvals: readonly Approval[]
  readonly publications: readonly Publication[]
  readonly events: readonly PublishEvent[]
}

/**
 * deriveVersionState — §5, computed rather than stored (see module header).
 * Precedence (highest first) mirrors the lifecycle's own linear order:
 * a version that has been deleted or archived stays there regardless of
 * what earlier evidence it also carries.
 */
export function deriveVersionState(evidence: VersionEvidence): ArtifactLifecycleState {
  const { version, approvals, publications, events } = evidence

  if (events.some((e) => e.type === 'artifact_deleted' && e.artifactVersionId === version.id)) {
    return 'deleted'
  }

  const explicitlyArchived = events.some(
    (e) => e.type === 'artifact_archived' && e.artifactVersionId === version.id,
  )
  if (explicitlyArchived || version.supersededBy !== null) {
    return 'archived'
  }

  const hasActivePublication = publications.some(
    (p) => p.artifactVersionId === version.id && !p.revoked,
  )
  if (hasActivePublication) {
    return 'published'
  }

  const hasApproval = approvals.some(
    (a) => a.artifactVersionId === version.id && a.decision === 'approved',
  )
  if (hasApproval) {
    return 'approved'
  }

  const hasReview = events.some(
    (e) => e.type === 'reviewed' && e.artifactVersionId === version.id,
  )
  if (hasReview) {
    return 'reviewed'
  }

  return 'generated'
}

// ─── Action guards ──────────────────────────────────────────────────────────
//
// Each guard answers "is this action legal given the version's *current*
// derived state" — independent of the governance policy gate (policy.ts),
// which answers a different question ("is this action *permitted by
// workspace policy* right now"). A caller (publishing-service.ts) checks
// both: state legality first (cheap, always-on), then the policy gate
// (may require an I/O call to a policy provider).

const ACTION_ALLOWED_FROM: Record<
  'review' | 'decide_approval' | 'submit_distribution' | 'archive' | 'delete',
  readonly ArtifactLifecycleState[]
> = {
  review: ['generated', 'reviewed'],
  decide_approval: ['generated', 'reviewed', 'approved'],
  submit_distribution: ['approved', 'published', 'generated', 'reviewed'],
  archive: ['generated', 'reviewed', 'approved', 'published'],
  delete: ['generated', 'reviewed', 'approved', 'published', 'archived'],
}
// Notes on the two intentionally-permissive rows above:
//  - decide_approval includes 'approved': §4 "Many Approvals can exist
//    across an artifact's life (re-approval after edits)" — a second
//    approval decision against the same version (e.g. re-approving for a
//    different purpose, or a rejection after a prior approval) is legal.
//  - submit_distribution includes 'generated'/'reviewed': the *lifecycle*
//    guard only checks "has this version been deleted/archived/
//    superseded" — whether an Approval is actually required before
//    publish is entirely policy.ts's job (evaluatePublishGate), not this
//    guard's. A workspace with requirePublishingApproval=false may
//    legitimately publish straight from 'generated'.

export function assertActionLegal(
  action: keyof typeof ACTION_ALLOWED_FROM,
  currentState: ArtifactLifecycleState,
): void {
  if (currentState === 'deleted') {
    throw new LifecycleError(
      `Cannot perform '${action}': this ArtifactVersion has been deleted.`,
      'invalid_action',
    )
  }
  if (currentState === 'archived' && action !== 'delete') {
    throw new LifecycleError(
      `Cannot perform '${action}': this ArtifactVersion is archived (superseded or explicitly retired). Archived versions remain queryable but are inactive — see §5.`,
      'version_superseded',
    )
  }
  if (!ACTION_ALLOWED_FROM[action].includes(currentState)) {
    throw new LifecycleError(
      `Cannot perform '${action}' from state '${currentState}'.`,
      'invalid_action',
    )
  }
}

/** Raised by publishing-service.ts when a governance gate (policy.ts) denies an action. */
export function assertGateAllowed(gate: GateEvaluation): void {
  if (!gate.allowed) {
    throw new LifecycleError(gate.reason ?? 'Denied by governance policy.', 'gate_denied')
  }
}

// ─── PublishEvent construction ──────────────────────────────────────────────
// Centralized so every event carries a consistent shape (§4/§8's evidence
// package depends on every event being structurally uniform).

let eventCounter = 0

/** Deterministic-enough id generator that doesn't require a DB round-trip to construct an event object before persisting it. */
function nextEventId(): string {
  eventCounter += 1
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `evt_${Date.now()}_${eventCounter}`
}

export function buildEvent(
  type: PublishEvent['type'],
  args: {
    artifactId: PublishEvent['artifactId']
    artifactVersionId: PublishEvent['artifactVersionId']
    workspaceId: PublishEvent['workspaceId']
    actor: Actor
    detail?: Record<string, unknown>
  },
): PublishEvent {
  return {
    id: nextEventId(),
    type,
    artifactId: args.artifactId,
    artifactVersionId: args.artifactVersionId,
    workspaceId: args.workspaceId,
    actor: args.actor,
    occurredAt: new Date().toISOString(),
    detail: Object.freeze({ ...(args.detail ?? {}) }),
  }
}
