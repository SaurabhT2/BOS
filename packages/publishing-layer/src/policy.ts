// ============================================================
// packages/publishing-layer/src/policy.ts
//
// §8 Governance: "Publishing is a consumer of governance policy, not its
// author." This module defines the narrow slice of policy Publishing's
// two gated transitions (Approved, Published — §5) actually need, and
// wires it to @brandos/governance-config's ApprovalGatesSchema, which
// already anticipates this exact need
// (`requirePublishingApproval`, `requireApprovalForExternalPublish`).
//
// This package does NOT depend on @brandos/control-plane-layer (which is
// where the live, request-scoped PolicyAdminService currently lives —
// see PUBLISHING_LAYER_NOTES.md for why: CPL sits above publishing-layer
// in the layer-tier registry, and Publishing must not create an upward
// dependency). Instead, an IPublishingPolicyProvider is *injected* by
// whatever composes this package at the application layer (future work —
// §"Boundaries"). This mirrors exactly how a Publisher never reaches for
// its own config (§7) — Publishing-core is handed what it needs, it does
// not go get it.
// ============================================================

import { DEFAULT_POLICY_CONFIG, type ApprovalGates } from '@brandos/governance-config'
import type { WorkspaceId } from './types'

/**
 * The slice of policy Publishing's lifecycle gates need. Deliberately
 * narrower than the full PolicyConfig — Publishing has no business reading
 * scoreThresholds, modelGovernance, etc.
 */
export interface PublishingPolicySnapshot {
  readonly requirePublishingApproval: boolean
  readonly requireApprovalForExternalPublish: boolean
  /**
   * Roles permitted to decide an Approval for this workspace. Not part of
   * governance-config's ApprovalGatesSchema today (that schema has no
   * role-allowlist field) — §13 leaves "what published must mean for
   * compliance" as an open product decision, and an approver role
   * allowlist is squarely inside that decision. DEFAULT_APPROVER_ROLES
   * below is a documented, overridable default, not a guessed-at product
   * requirement baked in silently.
   */
  readonly allowedApproverRoles: readonly string[]
}

/** A conservative, documented default — override via a real IPublishingPolicyProvider. */
export const DEFAULT_APPROVER_ROLES: readonly string[] = ['owner', 'admin', 'approver']

/**
 * IPublishingPolicyProvider — the seam an application layer implements to
 * hand Publishing real, workspace-scoped policy. A Next.js route / CPL
 * proxy (future work, out of this engagement's scope — see
 * PUBLISHING_LAYER_NOTES.md) would implement this by delegating to
 * control-plane-layer's PolicyAdminService or a Supabase-backed
 * equivalent. This package ships one reference implementation
 * (StaticPolicyProvider below) for tests and for callers who have not
 * yet wired a live policy source.
 */
export interface IPublishingPolicyProvider {
  getPolicy(workspaceId: WorkspaceId): Promise<PublishingPolicySnapshot>
}

/**
 * StaticPolicyProvider — returns governance-config's documented defaults
 * (or an explicit override) regardless of workspace. Suitable for tests,
 * local dev, and as a safe fallback; NOT a substitute for a real
 * workspace-scoped policy source in production, since every workspace
 * would otherwise silently share one policy.
 */
export class StaticPolicyProvider implements IPublishingPolicyProvider {
  private readonly snapshot: PublishingPolicySnapshot

  constructor(overrides?: Partial<PublishingPolicySnapshot>) {
    const gates: ApprovalGates = DEFAULT_POLICY_CONFIG.approvalGates
    this.snapshot = {
      requirePublishingApproval: overrides?.requirePublishingApproval ?? gates.requirePublishingApproval,
      requireApprovalForExternalPublish:
        overrides?.requireApprovalForExternalPublish ?? gates.requireApprovalForExternalPublish,
      allowedApproverRoles: overrides?.allowedApproverRoles ?? DEFAULT_APPROVER_ROLES,
    }
  }

  async getPolicy(_workspaceId: WorkspaceId): Promise<PublishingPolicySnapshot> {
    return this.snapshot
  }
}

// ─── Gate evaluation (pure, given a resolved snapshot) ─────────────────────

export interface GateEvaluation {
  readonly allowed: boolean
  readonly reason?: string
}

/**
 * §5 Approved-state gate: "does this workspace require approval before
 * publish; does this approver have the right role."
 */
export function evaluateApprovalGate(
  policy: PublishingPolicySnapshot,
  approverRole: string,
): GateEvaluation {
  if (!policy.allowedApproverRoles.includes(approverRole)) {
    return {
      allowed: false,
      reason: `Role '${approverRole}' is not permitted to approve artifacts for this workspace (allowed: ${policy.allowedApproverRoles.join(', ')})`,
    }
  }
  return { allowed: true }
}

/**
 * §5 Published-state gate: "must be Approved first if the workspace's
 * policy requires it." Destination-level permission checks are a separate,
 * Publisher/Destination-scoped concern (§5) — not evaluated here.
 */
export function evaluatePublishGate(
  policy: PublishingPolicySnapshot,
  hasApproval: boolean,
): GateEvaluation {
  const approvalRequired = policy.requirePublishingApproval || policy.requireApprovalForExternalPublish
  if (approvalRequired && !hasApproval) {
    return {
      allowed: false,
      reason: 'This workspace requires an Approval before an ArtifactVersion may be published, and none exists for this version.',
    }
  }
  return { allowed: true }
}
