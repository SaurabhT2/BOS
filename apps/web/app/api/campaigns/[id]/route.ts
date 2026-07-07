/**
 * apps/web — GET /api/campaigns/[id]
 *
 * GTM Critical Item 2 (2026-06-21): minimal addition required to make
 * Content Repurposing work from the Library Content tab.
 *
 * WHY THIS ROUTE WAS MISSING AND WHY IT'S NEEDED (verified against source,
 * not the delivery-status audit — the audit treated Repurpose as "L1 UI
 * missing, everything else complete," but GET /api/campaigns (the list
 * route) deliberately does not select the `content` column — see that
 * route's SCHEMA NOTE comment — and no GET-by-id route existed anywhere
 * under app/api/campaigns prior to this change, confirmed by directory
 * listing. POST /api/transform requires the caller to supply `sourceText`
 * in the request body — it does not look up a campaign's content itself.
 * So a "Repurpose" button on a Library content card had no way to obtain
 * the text to repurpose without this route.
 *
 * GET — fetch a single campaign row, including its full `content` JSON,
 * scoped to the requesting user's workspace.
 *
 * AUTHENTICATION: requireUser() — workspaceId always from session.
 * WORKSPACE ISOLATION: scoped to session workspaceId, matching the pattern
 * already used in app/api/campaigns/route.ts (list) and
 * app/api/assets/[id]/route.ts.
 *
 * Reuses the existing campaigns table — no new persistence introduced.
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const { workspaceId, supabase, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('campaigns')
    .select(
      'id, title, topic, format, status, content, qa_score_before, qa_score_after, persona_id, created_at'
    )
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single()

  if (error?.code === 'PGRST116') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ campaign: data })
}
