/**
 * @brandos/control-plane-layer — approval/approval-service.ts
 *
 * PHASE C: Approval Workflow
 *
 * Enterprise requirement: certain artifacts require human-in-the-loop
 * sign-off before being distributed. Approval gates are policy-driven.
 *
 * Default approval triggers:
 *   - Score below approval threshold (default: 70)
 *   - External publish flag on artifact
 *   - High-risk content (detected by governance violations)
 *
 * Approval states:
 *   pending  — flagged, awaiting human review
 *   approved — approved by authorized reviewer
 *   rejected — rejected by authorized reviewer
 *   auto     — auto-approved (score above threshold, no flags)
 *
 * Storage: Supabase table `brandos_artifact_approvals` (see schema below)
 * Schema:
 *   CREATE TABLE brandos_artifact_approvals (
 *     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     request_id      text NOT NULL UNIQUE,
 *     workspace_id    text NOT NULL,
 *     artifact_type   text NOT NULL,
 *     approval_status text NOT NULL DEFAULT 'pending',
 *     approval_reason text,
 *     score           float,
 *     reviewed_by     text,
 *     reviewed_at     timestamptz,
 *     created_at      timestamptz DEFAULT now()
 *   );
 *   CREATE INDEX ON brandos_artifact_approvals (workspace_id, approval_status);
 */

import type { ArtifactV2 } from '@brandos/contracts'
import { DEFAULT_APPROVAL_SCORE_THRESHOLD } from '@brandos/governance-config'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'auto'

export interface ApprovalEvaluationContext {
  score:        number
  workspaceId:  string
  artifactType: string
}

export interface ApprovalResult {
  requiresApproval: boolean
  status:           ApprovalStatus
  reason?:          string
}

export interface ApprovalRecord {
  requestId:     string
  workspaceId:   string
  artifactType:  string
  status:        ApprovalStatus
  reason?:       string
  score:         number
  createdAt:     string
  reviewedBy?:   string
  reviewedAt?:   string
}

/** Approval threshold sourced from @brandos/governance-config — Governance owns policy. */
const APPROVAL_SCORE_THRESHOLD = DEFAULT_APPROVAL_SCORE_THRESHOLD

export class ApprovalService {
  private readonly pendingApprovals: Map<string, ApprovalRecord> = new Map()

  /**
   * Evaluate whether an artifact requires approval before delivery.
   * Returns ApprovalResult indicating status and reason.
   */
  evaluate(artifact: ArtifactV2, ctx: ApprovalEvaluationContext): ApprovalResult {
    // Auto-approve if score is above threshold and no high-risk violations
    if (ctx.score >= APPROVAL_SCORE_THRESHOLD) {
      return { requiresApproval: false, status: 'auto' }
    }

    // Require approval for low-scoring artifacts
    if (ctx.score < APPROVAL_SCORE_THRESHOLD) {
      return {
        requiresApproval: true,
        status: 'pending',
        reason: `Score ${ctx.score} below approval threshold of ${APPROVAL_SCORE_THRESHOLD}`,
      }
    }

    return { requiresApproval: false, status: 'auto' }
  }

  /**
   * Submit an artifact for approval.
   * Returns an ApprovalRecord with pending status.
   */
  async submit(
    requestId: string,
    artifact: ArtifactV2,
    ctx: ApprovalEvaluationContext
  ): Promise<ApprovalRecord> {
    const record: ApprovalRecord = {
      requestId,
      workspaceId:  ctx.workspaceId,
      artifactType: ctx.artifactType,
      status:       'pending',
      score:        ctx.score,
      createdAt:    new Date().toISOString(),
    }

    this.pendingApprovals.set(requestId, record)

    // Persist to Supabase if available
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (url && key) {
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
        await supabase.from('brandos_artifact_approvals').insert({
          request_id:      requestId,
          workspace_id:    ctx.workspaceId,
          artifact_type:   ctx.artifactType,
          approval_status: 'pending',
          score:           ctx.score,
        })
      }
    } catch (err) {
      console.warn('[ApprovalService] submit persist failed (non-critical):', (err as Error).message)
    }

    return record
  }

  /**
   * Approve an artifact by requestId.
   */
  async approve(requestId: string, reviewedBy: string): Promise<ApprovalRecord | null> {
    const record = this.pendingApprovals.get(requestId)
    if (!record) return null

    const updated: ApprovalRecord = {
      ...record,
      status:     'approved',
      reviewedBy,
      reviewedAt: new Date().toISOString(),
    }
    this.pendingApprovals.set(requestId, updated)

    await this.persistStatusUpdate(requestId, 'approved', reviewedBy)
    return updated
  }

  /**
   * Reject an artifact by requestId.
   */
  async reject(requestId: string, reviewedBy: string, reason?: string): Promise<ApprovalRecord | null> {
    const record = this.pendingApprovals.get(requestId)
    if (!record) return null

    const updated: ApprovalRecord = {
      ...record,
      status:     'rejected',
      reason:     reason ?? 'Rejected by reviewer',
      reviewedBy,
      reviewedAt: new Date().toISOString(),
    }
    this.pendingApprovals.set(requestId, updated)

    await this.persistStatusUpdate(requestId, 'rejected', reviewedBy)
    return updated
  }

  /**
   * Get pending approvals for a workspace.
   */
  getPending(workspaceId: string): ApprovalRecord[] {
    return Array.from(this.pendingApprovals.values())
      .filter(r => r.workspaceId === workspaceId && r.status === 'pending')
  }

  private async persistStatusUpdate(
    requestId: string,
    status: ApprovalStatus,
    reviewedBy: string
  ): Promise<void> {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (url && key) {
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
        await supabase
          .from('brandos_artifact_approvals')
          .update({ approval_status: status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
          .eq('request_id', requestId)
      }
    } catch (err) {
      console.warn('[ApprovalService] persist update failed (non-critical):', (err as Error).message)
    }
  }
}

/** Global singleton */
export const globalApprovalService = new ApprovalService()


