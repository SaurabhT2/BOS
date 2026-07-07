/**
 * apps/web — /api/assets/[id]/download
 *
 * P1 — Asset Vault Evolution.
 *
 * GET — Generate a short-lived Supabase Storage signed URL for asset download.
 *
 * Returns a signed URL with a 15-minute TTL (900 seconds).
 * The client opens this URL directly to download or preview the asset.
 *
 * AUTHENTICATION: requireUser() — workspaceId always from session.
 * WORKSPACE ISOLATION: Asset ownership verified before URL generation.
 *   A user cannot obtain a signed URL for an asset in another workspace.
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { getAsset } from '@brandos/auth'

const SIGNED_URL_TTL_SECONDS = 900 // 15 minutes

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const { workspaceId, supabase, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Verify asset ownership ────────────────────────────────────────────────
  const { data: asset, error: assetError } = await getAsset(id, workspaceId)
  if (assetError) return NextResponse.json({ error: assetError }, { status: 500 })
  if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!asset.storage_path) {
    return NextResponse.json({ error: 'Asset has no storage path' }, { status: 422 })
  }

  if (asset.status === 'archived') {
    return NextResponse.json({ error: 'Cannot download an archived asset' }, { status: 410 })
  }

  // ── Generate signed URL ───────────────────────────────────────────────────
  const { data, error: signError } = await supabase.storage
    .from('brand-assets')
    .createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SECONDS)

  if (signError || !data?.signedUrl) {
    console.error('[GET /api/assets/:id/download] signed URL error:', signError)
    return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 })
  }

  return NextResponse.json({
    signedUrl: data.signedUrl,
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    filename: asset.original_filename,
    mimeType: asset.mime_type,
    sizeBytes: asset.size_bytes,
  })
}
