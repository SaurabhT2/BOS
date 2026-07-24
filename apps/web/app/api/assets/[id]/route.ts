/**
 * apps/web — /api/assets/[id]
 *
 * Cognitive Platform Evolution Program — Knowledge Lifecycle Completion
 * (2026-07-23), Objective 3 (Fix Library UI).
 *
 * GET    — Fetch a single asset (workspace-scoped).
 * PATCH  — Update user-editable fields (name, tags). Documented as the
 *          intended contract since @brandos/contracts's BrandAssetRow.name
 *          docblock ("user-editable via PATCH /api/assets/:id") and backed
 *          by a fully-implemented dbService.updateAsset() — this route was
 *          simply never wired up to call it. The Library page's Save
 *          action (apps/web/app/(workspace)/workspace/library/page.tsx's
 *          handleSave) has been calling this exact method/path since it
 *          was written; the 405 Next.js returns for an unhandled method
 *          has an empty body, and handleSave's `await res.json()` throwing
 *          on that empty body is the "PATCH returns 405 → frontend
 *          exception → processing UI freezes" failure in the architecture
 *          review's bug report.
 * DELETE — Soft-archive (dbService.archiveAsset() — status='archived',
 *          archived_at=now(); storage object is not deleted). Same
 *          previously-unwired-route situation as PATCH: the Library
 *          page's handleArchive already calls DELETE on this path.
 *
 * Both PATCH and DELETE were previously shadowed by a duplicate, stale
 * copy of the VLM/document-analysis POST handler that belongs only in
 * ./analyze/route.ts (see that file's "Visual identity now flows to
 * IntelligenceOS" comment block — it already documents itself as owning
 * this logic exclusively; the copy that was here predated EM-1.4/EM-2.1/
 * EM-2.2/EM-2.4/EM-2.6 and was never deleted when analyze/route.ts became
 * the real implementation). Confirmed via full-codebase search that no
 * caller — frontend or server-side — ever POSTs to this exact path
 * (`/api/assets/${id}`, not `/api/assets/${id}/analyze`); it was dead
 * code, not a second, intentionally-parallel entry point. Removed rather
 * than kept, per this program's "avoid duplicated logic" instruction.
 *
 * AUTHENTICATION: requireUser() — workspaceId always from session, exactly
 * as every other route under /api/assets does.
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { getAsset, updateAsset, archiveAsset } from '@brandos/auth'
import type { AssetUpdateFields } from '@brandos/auth'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: asset, error } = await getAsset(id, workspaceId)
  if (error) return NextResponse.json({ error }, { status: 500 })
  if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ asset })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { name?: unknown; tags?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Only the two fields AssetUpdateFields actually declares — mirrors
  // dbService.updateAsset()'s own "immutable fields are not accepted here"
  // contract rather than forwarding the request body as-is.
  const updates: AssetUpdateFields = {}
  if (typeof body.name === 'string') {
    const trimmed = body.name.trim()
    if (!trimmed) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    updates.name = trimmed
  }
  if (Array.isArray(body.tags)) {
    if (!body.tags.every((t) => typeof t === 'string')) {
      return NextResponse.json({ error: 'tags must be an array of strings' }, { status: 400 })
    }
    updates.tags = body.tags as string[]
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided (name, tags)' }, { status: 400 })
  }

  const { data: asset, error } = await updateAsset(id, workspaceId, updates)
  if (error === 'Asset not found') return NextResponse.json({ error }, { status: 404 })
  if (error) return NextResponse.json({ error }, { status: 500 })

  return NextResponse.json({ asset })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: asset, error } = await archiveAsset(id, workspaceId)
  if (error === 'Asset not found') return NextResponse.json({ error }, { status: 404 })
  if (error) return NextResponse.json({ error }, { status: 500 })

  return NextResponse.json({ success: true, asset })
}
