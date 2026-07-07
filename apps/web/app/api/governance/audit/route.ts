/**
 * apps/web — GET /api/governance/audit
 *
 * GTM Critical Item 5 (2026-06-21): Governance audit trail read path.
 *
 * Write path already existed and was complete: globalAuditTrail.record() is
 * called from runPhaseCLifecycle() in @brandos/control-plane-layer's
 * artifact-pipeline.ts on every governed generation. This route is the
 * missing read path — confirmed missing by direct source inspection (no
 * GET route existed under app/api/governance/* prior to this change).
 *
 * Reuses AuditTrailService.queryPersisted() (added alongside this route) —
 * does not duplicate audit storage or introduce a second audit mechanism.
 *
 * ACCESS MODEL (two ways to reach this route — see audit doc requirement
 * "Admin visibility / Executive visibility if already tier-gated"):
 *
 *   1. Platform admin (`users.is_platform_admin`) — may view ANY workspace's
 *      audit trail via `?workspaceId=<id>`. Defaults to the admin's own
 *      workspace if the param is omitted.
 *
 *   2. Non-admin user on an Executive-plan workspace — may view their OWN
 *      workspace's audit trail only (no workspaceId override). Gated via
 *      resolveTierLimits(...).plan === 'executive', matching the existing
 *      tier-check pattern in app/api/workspace/settings/route.ts.
 *
 *   Everyone else (Explorer/Professional, non-admin) — 403. The compliance
 *   audit trail is an Executive-tier / admin capability, consistent with how
 *   the audit doc frames this ("Governance Audit Trail (Executive tier)").
 *
 * AUTHENTICATION: requireUser() — workspaceId always from session for the
 * non-admin path; admin path may override via query param.
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin/require-admin'
import {
  globalAuditTrail,
  resolveWorkspaceSettings,
  resolveTierLimits,
} from '@brandos/control-plane-layer'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 1), 200)
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10) || 0, 0)
  const passedParam = searchParams.get('passed')
  const passed = passedParam === 'true' ? true : passedParam === 'false' ? false : undefined
  const artifactType = searchParams.get('artifactType') ?? undefined
  const requestedWorkspaceId = searchParams.get('workspaceId') ?? undefined

  // ── Try platform admin first (may view any workspace) ──────────────────
  const adminAuth = await requireAdmin(req)

  let targetWorkspaceId: string
  let viewerRole: 'admin' | 'executive'

  if (adminAuth.ok) {
    targetWorkspaceId = requestedWorkspaceId || adminAuth.workspaceId
    viewerRole = 'admin'
  } else {
    // ── Not a platform admin — fall back to Executive-tier self-view ─────
    const { workspaceId, unauthorized } = await requireUser()
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (requestedWorkspaceId && requestedWorkspaceId !== workspaceId) {
      return NextResponse.json(
        { error: 'Forbidden — cannot view another workspace\u2019s audit trail' },
        { status: 403 }
      )
    }

    const resolved = await resolveWorkspaceSettings(workspaceId)
    const tierLimits = resolveTierLimits(resolved.plan, resolved)

    if (tierLimits.plan !== 'executive') {
      return NextResponse.json(
        {
          error: 'Forbidden — governance audit trail requires the Executive plan',
          tierRequired: 'executive',
        },
        { status: 403 }
      )
    }

    targetWorkspaceId = workspaceId
    viewerRole = 'executive'
  }

  const { entries, total, source } = await globalAuditTrail.queryPersisted({
    workspaceId: targetWorkspaceId,
    limit,
    offset,
    passed,
    artifactType,
  })

  const stats = globalAuditTrail.getStats(targetWorkspaceId)

  return NextResponse.json({
    entries,
    total,
    limit,
    offset,
    source, // 'supabase' | 'memory' — surfaced so the UI/admin can tell when running in degraded (migration-not-applied) mode
    stats,
    workspaceId: targetWorkspaceId,
    viewerRole,
  })
}
