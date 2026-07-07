/**
 * apps/web — /api/workspace/providers/usage
 *
 * P3 — Provider Usage & Health: Per-workspace provider observability summary.
 *
 * GET — Returns combined usage stats and health snapshots for all providers
 *       this workspace has used or configured.
 *
 * Response shape:
 *   {
 *     usage: Array<{ provider, request_count, total_tokens }>
 *     health: Array<WorkspaceProviderHealthRow>
 *   }
 *
 * AUTHENTICATION: requireUser() — workspaceId always from session.
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import {
  getWorkspaceProviderUsageSummary,
  listWorkspaceProviderHealth,
} from '@brandos/auth'

// ─── GET /api/workspace/providers/usage ──────────────────────────────────────

export async function GET(_req: NextRequest) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [usageResult, healthResult] = await Promise.all([
    getWorkspaceProviderUsageSummary(workspaceId),
    listWorkspaceProviderHealth(workspaceId),
  ])

  if (usageResult.error) {
    return NextResponse.json({ error: usageResult.error }, { status: 500 })
  }
  if (healthResult.error) {
    return NextResponse.json({ error: healthResult.error }, { status: 500 })
  }

  return NextResponse.json({
    usage:  usageResult.data  ?? [],
    health: healthResult.data ?? [],
  })
}
