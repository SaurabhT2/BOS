/**
 * apps/web — /api/control-plane/score-history
 *
 * Score history read/write API.
 *
 * PERSISTENCE UPGRADE (Phase Final):
 *   GET now reads from Supabase via globalScoreHistory.queryAsync() with
 *   automatic fallback to in-memory buffer when the table isn't provisioned.
 *   The `source` field in the response indicates which path was used, so the
 *   UI can surface an honest degraded-state message if needed.
 *
 * POST records a score snapshot (fire-and-forget Supabase persist + memory).
 *
 * WORKSPACE ISOLATION: scoped to session workspaceId — client-supplied
 * workspace_id query params are ignored (auth fix retained from prior version).
 */

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { globalScoreHistory } from '@brandos/control-plane-layer'
import { requireUser } from '@/lib/supabase-server'

export async function GET(req: Request) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const taskType   = searchParams.get('task_type')   ?? undefined
  const modelId    = searchParams.get('model_id')    ?? undefined
  const from       = searchParams.get('from')        ?? undefined
  const to         = searchParams.get('to')          ?? undefined
  const granularity = (searchParams.get('granularity') as 'day' | 'week' | 'month') ?? 'day'
  const aggregate  = searchParams.get('aggregate') === 'true'
  const limit      = parseInt(searchParams.get('limit') ?? '500', 10)

  const { entries, source } = await globalScoreHistory.queryAsync({
    workspace_id: workspaceId,
    ...(taskType ? { task_type: taskType } : {}),
    ...(modelId  ? { model_id:  modelId  } : {}),
    ...(from     ? { from }                : {}),
    ...(to       ? { to }                  : {}),
    limit,
  })

  if (aggregate) {
    return NextResponse.json({ data: globalScoreHistory.aggregate(entries, granularity), source })
  }

  return NextResponse.json({ data: entries, source })
}

export async function POST(req: Request) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const entry = globalScoreHistory.record(
      { ...body, workspace_id: workspaceId },
      {
        campaignId:   body.campaign_id   ?? undefined,
        artifactType: body.artifact_type ?? undefined,
        version:      body.version       ?? undefined,
      }
    )
    return NextResponse.json(entry)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
