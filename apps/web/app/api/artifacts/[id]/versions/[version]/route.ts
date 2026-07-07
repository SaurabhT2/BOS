/**
 * apps/web — GET /api/artifacts/[id]/versions/[version]
 *
 * Retrieve the full stored ArtifactV2 snapshot for a specific version of a campaign.
 *
 * This enables:
 *   - "Show me version 2 of this carousel" — exact prior content retrieval
 *   - Version comparison (UI diff views)
 *   - Rollback/restore (re-opening a prior version in the Create flow)
 *
 * [id]      — campaigns.id (same as the parent /versions route)
 * [version] — integer version number (1-based)
 *
 * WORKSPACE ISOLATION: same pattern as GET /api/artifacts/[id]/versions —
 * confirms campaign belongs to requesting user's workspace before returning.
 *
 * Returns 404 if:
 *   - Campaign not found in this workspace
 *   - Version does not exist
 *   - stored_artifact is null (old row predating stored_artifact column)
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { globalArtifactVersioning } from '@brandos/control-plane-layer'

type Params = { params: Promise<{ id: string; version: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id: campaignId, version: versionStr } = await params
  const { workspaceId, supabase, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const version = parseInt(versionStr, 10)
  if (isNaN(version) || version < 1) {
    return NextResponse.json({ error: 'Invalid version number' }, { status: 400 })
  }

  // Workspace isolation check
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, title, format')
    .eq('id', campaignId)
    .eq('workspace_id', workspaceId)
    .single()

  if (campaignError || !campaign) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { artifact, source } = await globalArtifactVersioning.getVersionArtifact(
    campaignId,
    version,
    workspaceId
  )

  if (!artifact) {
    if (source === 'unavailable') {
      return NextResponse.json(
        { error: 'Version history unavailable — versioning table not provisioned' },
        { status: 503 }
      )
    }
    return NextResponse.json(
      { error: `Version ${version} not found for this campaign` },
      { status: 404 }
    )
  }

  return NextResponse.json({
    campaignId,
    title:    campaign.title,
    format:   campaign.format,
    version,
    artifact,
    source,
  })
}
