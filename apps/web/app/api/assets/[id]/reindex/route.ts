/**
 * apps/web — /api/assets/[id]/reindex
 *
 * P1 — Asset Vault Evolution.
 *
 * POST — Reset a failed asset back to 'processing' so it can be re-analyzed.
 *
 * Only assets with status='failed' or status='processing' (stuck) are eligible.
 * The actual re-analysis is triggered client-side by calling
 * POST /api/assets/:id/analyze after reindex returns 200.
 *
 * AUTHENTICATION: requireUser() — workspaceId always from session.
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { getAsset, updateAssetStatus } from '@brandos/auth'

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Verify ownership and check eligibility ─────────────────────────────
  const { data: asset, error: fetchError } = await getAsset(id, workspaceId)
  if (fetchError) return NextResponse.json({ error: fetchError }, { status: 500 })
  if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (asset.status === 'indexed') {
    return NextResponse.json(
      { error: 'Asset is already indexed. Use /analyze to re-run analysis.' },
      { status: 422 }
    )
  }
  if (asset.status === 'archived') {
    return NextResponse.json(
      { error: 'Cannot reindex an archived asset' },
      { status: 422 }
    )
  }
  if (!asset.mime_type.startsWith('image/')) {
    return NextResponse.json(
      { error: 'Reindex is only available for image assets' },
      { status: 422 }
    )
  }

  // ── Reset status to 'processing' ────────────────────────────────────────
  // Client should follow up immediately with POST /api/assets/:id/analyze
  const { data: updatedAsset, error: updateError } = await updateAssetStatus(id, workspaceId, 'processing')
  if (updateError) return NextResponse.json({ error: updateError }, { status: 500 })

  return NextResponse.json({
    success: true,
    asset: updatedAsset,
    message: 'Asset reset to processing. Trigger analysis via POST /api/assets/:id/analyze.',
  })
}
