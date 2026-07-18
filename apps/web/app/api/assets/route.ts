/**
 * apps/web — /api/assets
 *
 * P1 — Asset Vault Evolution.
 * P2 — Storage quota + monthly upload count enforcement.
 *
 * GET  — List workspace assets (paginated, filterable).
 * POST — Upload a file to storage and create a brand_assets row.
 *
 * AUTHENTICATION: requireUser() — workspaceId always from session.
 * WORKSPACE ISOLATION: All queries scoped to session workspaceId.
 *   Never trust client-supplied workspace IDs.
 *
 * STORAGE CONVENTION (P1):
 *   Bucket: brand-assets
 *   Path:   ${workspaceId}/${assetId}/${sanitized_original_filename}
 *
 * STATUS LIFECYCLE:
 *   Images:    POST sets status = 'processing'.
 *              POST /api/assets/:id/analyze transitions to 'indexed' (or 'failed').
 *              analyze is called automatically server-side after successful upload.
 *   Documents: POST sets status = 'processing', then immediately 'indexed'
 *              because documents have no blocking analysis step (analysis is
 *              triggered client-side via the Analyze button like images).
 *              Milestone 3, Phase 1: also fire-and-forget handed off to
 *              IntelligenceOS via ingestWorkspaceKnowledgeAsset() (CPL) for
 *              knowledge extraction. Best-effort — never blocks or fails
 *              the upload; see that function's docblock.
 *
 * P2 QUOTA ENFORCEMENT (enforced before any storage/DB write):
 *   1. Storage quota  — 413 if adding files would exceed tier limit
 *   2. Upload count   — 429 if workspace has hit its monthly upload ceiling
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { requireUser } from '@/lib/supabase-server'
import {
  listAssets,
  createAsset,
  updateAssetStatus,
  recordAssetIntelligenceSync,
  getTotalAssetStorageForWorkspace,
  countMonthlyUploadsForWorkspace,
} from '@brandos/auth'
import {
  resolveWorkspaceSettings,
  resolveTierLimits,
  buildStorageLimitError,
  buildUploadCountLimitError,
  ingestWorkspaceKnowledgeAsset,
} from '@brandos/control-plane-layer'
import type { BrandAssetRow } from '@brandos/contracts'
import { extractDocumentText } from '@/lib/document-extraction'
import { classifyAssetType } from '@/lib/asset-classification'

const MAX_FILE_SIZE       = 50 * 1024 * 1024 // 50 MB per-file hard cap
const MAX_FILES_PER_UPLOAD = 20

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])

// ─── GET /api/assets ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const limit     = Math.min(parseInt(searchParams.get('limit')    ?? '50', 10), 100)
  const offset    = Math.max(parseInt(searchParams.get('offset')   ?? '0',  10), 0)
  const status    = searchParams.get('status') as any ?? undefined
  const mimeCategory = (searchParams.get('mimeCategory') ?? 'all') as 'image' | 'document' | 'all'
  const tag       = searchParams.get('tag')    ?? undefined
  const sortBy    = (searchParams.get('sortBy') ?? 'created_at') as any
  const sortDir   = (searchParams.get('sortDir') ?? 'desc') as 'asc' | 'desc'

  const { data, error, count } = await listAssets(workspaceId, {
    limit,
    offset,
    status,
    mimeCategory,
    tag,
    sortBy,
    sortDir,
  })

  if (error) return NextResponse.json({ error }, { status: 500 })

  return NextResponse.json({ assets: data, count, limit, offset })
}

// ─── POST /api/assets ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { user, workspaceId, supabase, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await req.formData()
    const files = formData.getAll('files') as File[]

    if (!files.length) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }
    if (files.length > MAX_FILES_PER_UPLOAD) {
      return NextResponse.json(
        { error: `Maximum ${MAX_FILES_PER_UPLOAD} files per upload` },
        { status: 400 }
      )
    }

    // ── P2: Resolve tier limits ────────────────────────────────────────────────
    const workspaceSettings = await resolveWorkspaceSettings(workspaceId)
    const tierLimits        = resolveTierLimits(workspaceSettings.plan, workspaceSettings)

    // ── P2: Monthly upload count gate ──────────────────────────────────────────
    if (tierLimits.monthlyUploadCount !== null) {
      const uploadCountResult = await countMonthlyUploadsForWorkspace(workspaceId)
      const currentCount = uploadCountResult.data ?? 0
      if (currentCount + files.length > tierLimits.monthlyUploadCount) {
        const gateError = buildUploadCountLimitError(
          currentCount,
          tierLimits.monthlyUploadCount,
          workspaceSettings.plan,
        )
        return NextResponse.json(
          { error: gateError.reason, tierGate: gateError },
          { status: 429 }
        )
      }
    }

    // ── P2: Storage quota gate ─────────────────────────────────────────────────
    if (tierLimits.assetStorageMb !== null) {
      const storageLimitBytes = tierLimits.assetStorageMb * 1024 * 1024
      const storageResult     = await getTotalAssetStorageForWorkspace(workspaceId)
      const currentBytes      = storageResult.data ?? 0
      const batchBytes = files.reduce((sum, f) => sum + f.size, 0)
      if (currentBytes + batchBytes > storageLimitBytes) {
        const usedMb  = currentBytes / (1024 * 1024)
        const limitMb = tierLimits.assetStorageMb
        const gateError = buildStorageLimitError(usedMb, limitMb, workspaceSettings.plan)
        return NextResponse.json(
          { error: gateError.reason, tierGate: gateError },
          { status: 413 }
        )
      }
    }

    // ── Per-file upload ────────────────────────────────────────────────────────
    const createdAssets: BrandAssetRow[] = []
    const errors: string[] = []

    for (const file of files) {
      // Validation
      if (!ALLOWED_TYPES.has(file.type) && !file.type.startsWith('image/')) {
        errors.push(`${file.name}: unsupported type ${file.type || 'unknown'}`)
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: exceeds 50 MB limit`)
        continue
      }
      if (file.size === 0) {
        errors.push(`${file.name}: file is empty`)
        continue
      }

      const assetId       = uuidv4()
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const storagePath   = `${workspaceId}/${assetId}/${sanitizedName}`

      // Upload to storage
      const bytes  = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)

      const { error: storageError } = await supabase.storage
        .from('brand-assets')
        .upload(storagePath, buffer, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        })

      if (storageError) {
        errors.push(`${file.name}: storage upload failed — ${storageError.message}`)
        continue
      }

      // Insert brand_assets row — status = 'processing'
      const { data: asset, error: dbError } = await createAsset({
        id:                assetId,
        workspace_id:      workspaceId,
        user_id:           user.id,
        name:              file.name,
        original_filename: file.name,
        mime_type:         file.type || 'application/octet-stream',
        size_bytes:        file.size,
        storage_path:      storagePath,
        status:            'processing',
        metadata:          {},
        vlm_analysis:      null,
        tags:              [],
        usage_count:       0,
        archived_at:       null,
      })

      if (dbError || !asset) {
        await supabase.storage.from('brand-assets').remove([storagePath])
        errors.push(`${file.name}: database insert failed — ${dbError ?? 'unknown error'}`)
        continue
      }

      // ── Status transition for non-image assets ─────────────────────────────
      // Documents (PDF, DOCX, PPTX, TXT, MD) have no blocking analysis step
      // that must complete before they are usable. Transition them directly to
      // 'indexed' so they do not stay stuck in 'processing'.
      // Users can still click "Analyze" to run document analysis on demand.
      const isImage = file.type.startsWith('image/')
      if (!isImage) {
        const { data: transitioned } = await updateAssetStatus(assetId, workspaceId, 'indexed')
        createdAssets.push(transitioned ?? asset)

        // ── Milestone 3, Phase 1 / EM-2.1: hand off to IntelligenceOS ───────
        // Fire-and-forget — never blocks the upload response, and a
        // failure here must never fail the upload (matches
        // ingestWorkspaceKnowledgeAsset's own documented contract).
        // Images are intentionally excluded from THIS call: at upload
        // time there is no VLM analysis yet (that happens later, in
        // POST /api/assets/:id/analyze), so there is no real visual
        // content to send. Image knowledge ingestion happens from the
        // analyze route once VLM output exists — see that route's EM-2.2/
        // EM-2.4 handling.
        //
        // EM-2.1 (Cognitive Platform Evolution Program, Milestone 2):
        // previously this only extracted text for the two plain-text
        // types this route already accepted as UTF-8-safe (text/plain,
        // text/markdown); PDF/DOCX/PPTX were ingested with no rawContent
        // at all, only ever gaining real content later if a user
        // happened to click "Analyze." Real extraction now runs here too,
        // via the same shared module the analyze route uses, so the
        // first `/v1/knowledge/ingest` call already carries real content
        // for every format this repo can extract (still just PDF/DOCX/
        // text/markdown — PPTX extraction and scanned-PDF OCR remain
        // unimplemented, see apps/web/lib/document-extraction.ts).
        const rawContent = await extractDocumentText(
          buffer,
          file.type || 'application/octet-stream',
          file.name,
        )
          .then((result) => (result.status === 'extracted' ? result.text : undefined))
          .catch((err: unknown) => {
            console.error(
              `[POST /api/assets] extraction failed for ${file.name} (non-fatal, falling back to no rawContent):`,
              err,
            )
            return undefined
          })

        void ingestWorkspaceKnowledgeAsset(
          {
            ownerType: 'workspace',
            workspaceId,
            userId: user.id,
            assetType: classifyAssetType(file.name, rawContent),
            title: file.name,
            sourceFileRef: storagePath,
          },
          rawContent,
        )
          .then((result) => {
            if (result) return recordAssetIntelligenceSync(assetId, workspaceId, result.assetId)
          })
          .catch((err: unknown) => {
            console.error(
              `[POST /api/assets] knowledge ingestion failed for asset ${assetId} (non-fatal, upload already succeeded):`,
              err,
            )
          })

      } else {
        createdAssets.push(asset)
      }
    }

    if (createdAssets.length === 0) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 400 })
    }

    return NextResponse.json(
      {
        success: true,
        assets: createdAssets,
        errors: errors.length > 0 ? errors : undefined,
      },
      { status: 201 }
    )
  } catch (err: any) {
    console.error('[POST /api/assets]', err)
    return NextResponse.json({ error: err?.message ?? 'Upload failed' }, { status: 500 })
  }
}
