/**
 * POST /api/extract-from-url
 * Extracts readable text content from a URL for use as generation context.
 * Referenced by studio page but was previously missing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { createAsset, recordAssetIntelligenceSync } from '@brandos/auth'
import { ingestWorkspaceKnowledgeAsset } from '@brandos/control-plane-layer'
import { classifyAssetType } from '@/lib/asset-classification'

export const runtime = 'nodejs'

const MAX_CONTENT_CHARS = 3000
const TIMEOUT_MS = 10_000

export async function POST(req: NextRequest) {
  const { user, workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { url } = body

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid URL' }, { status: 400 })
    }

    // Validate URL
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return NextResponse.json({ error: 'Only HTTP/HTTPS URLs are supported' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
    }

    // Fetch the page
    const fetchRes = await fetch(parsedUrl.toString(), {
      headers: {
        'User-Agent': 'BrandOS/1.0 (content extractor)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!fetchRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL: ${fetchRes.status} ${fetchRes.statusText}` },
        { status: 422 }
      )
    }

    const contentType = fetchRes.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return NextResponse.json(
        { error: 'URL does not return HTML content' },
        { status: 422 }
      )
    }

    const html = await fetchRes.text()

    // Simple but robust text extraction without DOM parser
    const stripped = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, MAX_CONTENT_CHARS)

    if (stripped.length < 50) {
      return NextResponse.json({ error: 'Could not extract readable content from URL' }, { status: 422 })
    }

    // ── EM-2.5 (Cognitive Platform Evolution Program, Milestone 2 — Website
    // Extraction Persistence): previously this content was returned to the
    // client and never persisted anywhere — every URL a user extracted was
    // knowledge acquisition that improved exactly one generation and then
    // evaporated (see the audit's §2.5). Give it a brand_assets row (for
    // assetId correlation consistency with file uploads, EM-2.6) and send
    // it through the same, unchanged /v1/knowledge/ingest path EM-2.1 uses.
    // Fire-and-forget — must never slow down or fail the extraction
    // response the studio page is waiting on.
    void (async () => {
      try {
        const { randomUUID } = await import('node:crypto')
        const assetId = randomUUID()
        const { data: assetRow, error: createError } = await createAsset({
          id: assetId,
          workspace_id: workspaceId,
          user_id: user!.id,
          name: parsedUrl.hostname,
          original_filename: parsedUrl.toString(),
          mime_type: 'text/html',
          size_bytes: Buffer.byteLength(stripped, 'utf8'),
          storage_path: null,
          status: 'indexed',
          metadata: { source_url: parsedUrl.toString() },
          vlm_analysis: null,
          tags: ['url-extraction'],
          usage_count: 0,
          archived_at: null,
        })
        if (createError || !assetRow) {
          console.error('[extract-from-url] failed to create brand_assets row (non-fatal):', createError)
          return
        }

        const result = await ingestWorkspaceKnowledgeAsset(
          {
            // See apps/web/app/api/assets/[id]/analyze/route.ts for the
            // full explanation — ownerType: 'workspace' requires userId to
            // stay null; BrandOS's user.id is meaningless to IntelligenceOS
            // and sending both together violates the owner-consistency
            // invariant (knowledge_assets_owner_consistency_chk).
            ownerType: 'workspace',
            workspaceId,
            userId: null,
            assetType: classifyAssetType(parsedUrl.toString(), stripped),
            title: parsedUrl.toString(),
            sourceFileRef: parsedUrl.toString(),
          },
          stripped,
        )
        if (result) {
          await recordAssetIntelligenceSync(assetRow.id, workspaceId, result.assetId)
        }
      } catch (persistErr) {
        console.error('[extract-from-url] knowledge persistence failed (non-fatal):', persistErr)
      }
    })()

    return NextResponse.json({
      success: true,
      content: stripped,
      url: parsedUrl.toString(),
      charCount: stripped.length,
    })
  } catch (error: any) {
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    if (isTimeout) {
      return NextResponse.json({ error: 'URL fetch timed out after 10 seconds' }, { status: 408 })
    }
    console.error('[extract-from-url]', error)
    return NextResponse.json({ error: error?.message || 'Extraction failed' }, { status: 500 })
  }
}


