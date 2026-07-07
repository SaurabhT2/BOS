/**
 * apps/web — GET /api/artifacts/[id]/versions
 *
 * GTM Critical Item 4 (2026-06-21): artifact version history read path.
 *
 * `[id]` is a campaigns.id — campaigns is the persisted "this piece of
 * content" table (see CampaignRow in @brandos/contracts); there is no
 * separate "artifacts" table. Reuses ArtifactVersioningService.getVersions()
 * — does not duplicate version storage or introduce a second versioning
 * mechanism.
 *
 * Workspace isolation: requires the campaign to belong to the requesting
 * user's workspace (checked against `campaigns`, matching the pattern used
 * by /api/assets/[id] et al.), in addition to filtering version rows by
 * workspace_id. A campaign in another workspace returns 404, not version
 * data.
 *
 * NOTE on what this returns today: there is currently no regenerate/edit
 * flow in the product that creates a second version of an existing
 * campaign (confirmed by repo-wide search — every generation is
 * insert-only). So this route will almost always return a single version
 * (v1) per campaign right now. The version count is real (computed via
 * COUNT(*)+1 in the versioning service, not a hardcoded literal) and will
 * correctly grow past 1 the moment any future regenerate flow links
 * additional stamps to the same campaign_id — no further changes to this
 * route or the versioning service will be required when that ships.
 *
 * AUTHENTICATION: requireUser() — workspaceId always from session.
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { globalArtifactVersioning } from '@brandos/control-plane-layer'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id: campaignId } = await params
  const { workspaceId, supabase, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Confirm the campaign exists and belongs to this workspace before
  // returning version data — same isolation pattern as
  // app/api/assets/[id]/analyze's getAsset(id, workspaceId) check.
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, title, format')
    .eq('id', campaignId)
    .eq('workspace_id', workspaceId)
    .single()

  if (campaignError || !campaign) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { versions, source } = await globalArtifactVersioning.getVersions(campaignId, workspaceId)

  return NextResponse.json({
    campaignId,
    title: campaign.title,
    format: campaign.format,
    versions,
    count: versions.length,
    source, // 'supabase' | 'unavailable' — surfaced so the UI can explain a missing/degraded state honestly
  })
}
