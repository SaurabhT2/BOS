/**
 * apps/web — /api/campaigns
 *
 * GET — List workspace campaigns/content rows (paginated, filterable).
 *   Query params:
 *     limit              — default 20, max 100
 *     offset             — default 0
 *     status             — filter by exact status (draft|generated|exported|paid)
 *     format             — filter by exact format
 *     campaign_brief_id  — filter by Campaign Lite brief grouping key (P3 enabled)
 *
 * POST — Create a campaign brief stub for cross-session persistence (P3).
 *   Body: { title, topic, tone?, formats[] }
 *   Returns: { id, campaign_brief_id, ... }
 *
 * CROSS-SESSION PERSISTENCE (Phase Final P3):
 *   campaign_brief_id column now exists (migration: 20260622_campaign_brief_id.sql).
 *   The 501 guard for brief_id filtering has been removed and replaced with
 *   the real filter. POST creates a persistent campaign brief stub that can
 *   be restored across sessions.
 *
 * AUTHENTICATION: requireUser() — workspaceId always from session.
 * WORKSPACE ISOLATION: query scoped to session workspaceId.
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { v4 as uuidv4 } from 'uuid'

const VALID_STATUSES = new Set(['draft', 'generated', 'exported', 'paid'])

export async function GET(req: NextRequest) {
  const { workspaceId, supabase, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const limit           = Math.min(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 100)
  const offset          = Math.max(parseInt(searchParams.get('offset') ?? '0', 10) || 0, 0)
  const status          = searchParams.get('status')
  const format          = searchParams.get('format')
  const campaignBriefId = searchParams.get('campaign_brief_id')

  if (status && !VALID_STATUSES.has(status)) {
    return NextResponse.json(
      { error: `Invalid status. Expected one of: ${[...VALID_STATUSES].join(', ')}` },
      { status: 400 }
    )
  }

  let query = supabase
    .from('campaigns')
    .select(
      'id, title, topic, format, status, qa_score_before, qa_score_after, persona_id, created_at, campaign_brief_id, campaign_brief_title',
      { count: 'exact' }
    )
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status)          query = query.eq('status', status)
  if (format)          query = query.eq('format', format)
  if (campaignBriefId) query = query.eq('campaign_brief_id', campaignBriefId)

  const { data, error, count } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ campaigns: data ?? [], count: count ?? 0, limit, offset })
}

/**
 * POST /api/campaigns — Create a campaign brief stub for cross-session persistence.
 *
 * Creates a lightweight "draft" campaign row that anchors the brief across sessions.
 * When the user generates content, each format's result is linked to this brief via
 * campaign_brief_id. The user can return to /workspace/create?brief=<id> to resume.
 *
 * Body: { title: string, topic: string, tone?: string, formats?: string[] }
 */
export async function POST(req: NextRequest) {
  const { user, workspaceId, supabase, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { title, topic, tone, formats } = body

    if (!title || !topic) {
      return NextResponse.json({ error: 'title and topic are required' }, { status: 400 })
    }

    const campaignBriefId = uuidv4()
    const safeTitle = String(title).slice(0, 120).trim()
    const safeTopic = String(topic).slice(0, 500).trim()

    const { data, error } = await supabase
      .from('campaigns')
      .insert({
        user_id:               user.id,
        workspace_id:          workspaceId,
        title:                 safeTitle,
        topic:                 safeTopic,
        format:                (formats?.[0] ?? 'campaign') as any,
        status:                'draft',
        campaign_brief_id:     campaignBriefId,
        campaign_brief_title:  safeTitle,
        campaign_brief_topic:  safeTopic,
        campaign_brief_tone:   tone ?? 'executive',
        content:               { brief: true, formats: formats ?? [], created_at: new Date().toISOString() },
      })
      .select('id, title, topic, format, status, campaign_brief_id, created_at')
      .single()

    if (error) {
      console.error('[campaigns/POST] DB insert failed:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ campaign: data, campaign_brief_id: campaignBriefId }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to create campaign brief' }, { status: 500 })
  }
}
