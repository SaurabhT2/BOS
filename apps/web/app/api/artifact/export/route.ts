/**
 * POST /api/artifact/export
 *
 * P0-G: Canonical artifact export endpoint.
 *
 * Consumes: ArtifactV2 (CarouselArtifact | DeckArtifact | ReportArtifact)
 *           posted as JSON body, dispatched on the artifact's own
 *           `artifact_type` discriminator — no new request param needed,
 *           every ArtifactV2 already carries this field.
 * Produces: HTML, JSON, PDF, or PPTX download.
 *
 * Architecture:
 *   - This endpoint remains the SOLE export authority (unchanged from the
 *     original P0-G doc comment).
 *   - Rendering logic itself now lives in lib/artifact-export-html.ts,
 *     lib/artifact-export-pdf.ts, and lib/artifact-export-pptx.ts — this
 *     route is a thin dispatcher (format × artifact_type → renderer call),
 *     matching the existing apps/web convention of route-as-dispatcher
 *     with logic in lib/ (see lib/repurpose.ts).
 *   - Renderer logic is pure: it only consumes the posted artifact.
 *     No LLM calls. No inference. No reconstruction of structure.
 *     (P0-F law, unchanged.)
 *   - PRIOR GAP CLOSED: this route previously only validated/rendered the
 *     carousel shape (`slides`/`cards`), even though the UI's exportArtifact()
 *     in create/page.tsx already called this route for deck and report
 *     results too. Deck export worked by accident (decks also have `slides`,
 *     so they passed the old shape check, but rendered with carousel-only
 *     field names — headline/role/bullets — producing a blank or malformed
 *     HTML/JSON). Report export was completely broken (reports have
 *     `sections`, not `slides`, so they always hit the "no slides" 422).
 *     Both are now rendered correctly via their own dedicated renderers.
 *
 * Body:
 *   { format: 'html' | 'json' | 'pdf' | 'pptx', artifact: ArtifactV2 }
 *
 * Returns:
 *   - format=json: application/json download
 *   - format=html: text/html download (self-contained, themed per type)
 *   - format=pdf:  application/pdf download (prints the same HTML)
 *   - format=pptx: application/vnd...presentation download (native slides)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import {
  renderArtifactToHTML,
  safeFilenameStem,
  type SupportedHtmlArtifactType,
} from '@/lib/artifact-export-html'
import { renderArtifactToPDF } from '@/lib/artifact-export-pdf'
import { renderArtifactToPPTX, type SupportedPptxArtifactType } from '@/lib/artifact-export-pptx'
import { importArtifactToCanva } from '@/lib/canva-export'
import {
  getCanvaOAuthConfig,
  refreshCanvaToken,
  decryptCanvaAccessToken,
  decryptCanvaRefreshToken,
  encryptCanvaTokens,
  expiresAtFromExpiresIn,
} from '@/lib/canva-oauth'
import { getWorkspaceOAuthConnection, refreshWorkspaceOAuthConnection } from '@brandos/auth'

export const runtime = 'nodejs'

// PDF/PPTX rendering (headless Chromium launch, pptxgenjs file assembly) can
// exceed the Next.js default route timeout on larger decks/reports — this
// mirrors the existing pattern of explicit runtime tuning for heavier routes
// elsewhere in apps/web (see /api/generate-with-progress).
export const maxDuration = 60

type ExportFormat = 'html' | 'json' | 'pdf' | 'pptx' | 'canva'

// SPRINT1-FIX (F-01): 'newsletter' added — was absent, causing HTTP 400 for
// every newsletter export despite the compiler, governance, and React renderer
// all being production-ready.
const SUPPORTED_ARTIFACT_TYPES: readonly SupportedHtmlArtifactType[] = ['carousel', 'deck', 'report', 'newsletter']

function isSupportedArtifactType(value: unknown): value is SupportedHtmlArtifactType {
  return typeof value === 'string' && (SUPPORTED_ARTIFACT_TYPES as readonly string[]).includes(value)
}

/**
 * Per-type minimal shape validation before rendering.
 * Mirrors the original route's "no slides → 422" guard, generalized to
 * each artifact type's actual required collection (slides vs sections).
 *
 * SPRINT1-FIX (F-01): newsletter case added — newsletters use `sections`, not `slides`.
 */
function validateArtifactShape(
  artifactType: SupportedHtmlArtifactType,
  bp: Record<string, unknown>
): string | null {
  if (artifactType === 'report' || artifactType === 'newsletter') {
    const sections = Array.isArray(bp.sections) ? bp.sections : []
    if (sections.length === 0) {
      return `${artifactType === 'report' ? 'Report' : 'Newsletter'} has no sections — cannot export an empty ${artifactType}.`
    }
    return null
  }
  // carousel and deck both use `slides` (carousel also accepted legacy `cards`)
  const slides = Array.isArray(bp.slides) ? bp.slides : Array.isArray(bp.cards) ? bp.cards : []
  if (slides.length === 0) {
    return `${artifactType === 'carousel' ? 'Carousel' : 'Deck'} has no slides — cannot export an empty ${artifactType}.`
  }
  return null
}

const CONTENT_TYPES: Record<Exclude<ExportFormat, 'canva'>, string> = {
  html: 'text/html; charset=utf-8',
  json: 'application/json',
  pdf:  'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/**
 * Resolve a usable (non-expired) Canva access token for this workspace,
 * refreshing it first if it's expired or about to expire. Returns null
 * with a reason if there's no connection, no Canva config, or refresh
 * fails — callers turn that into the appropriate HTTP response.
 */
async function resolveCanvaAccessToken(
  workspaceId: string
): Promise<{ token: string } | { error: string; status: number }> {
  const config = getCanvaOAuthConfig()
  if (!config) {
    return { error: 'Canva integration is not configured on this server.', status: 503 }
  }

  const { data: connection, error } = await getWorkspaceOAuthConnection(workspaceId, 'canva')
  if (error) return { error, status: 500 }
  if (!connection) {
    return { error: 'Canva is not connected for this workspace. Connect it in Settings → Integrations.', status: 409 }
  }

  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : null
  const isExpiredOrSoon = expiresAt !== null && expiresAt - Date.now() < 60_000 // refresh 60s early

  if (!isExpiredOrSoon) {
    const token = decryptCanvaAccessToken(connection)
    if (!token) return { error: 'Failed to decrypt stored Canva access token.', status: 500 }
    return { token }
  }

  const refreshToken = decryptCanvaRefreshToken(connection)
  if (!refreshToken) {
    return { error: 'Canva access token expired and no refresh token is available. Please reconnect Canva.', status: 409 }
  }

  const refreshed = await refreshCanvaToken(config, refreshToken)
  if (!refreshed.ok || !refreshed.tokens) {
    return { error: refreshed.error ?? 'Failed to refresh Canva access token. Please reconnect Canva.', status: 502 }
  }

  const encrypted = encryptCanvaTokens(refreshed.tokens)
  if ('error' in encrypted) return { error: encrypted.error, status: 500 }

  const { error: updateError } = await refreshWorkspaceOAuthConnection(workspaceId, 'canva', {
    encrypted_access_token: encrypted.encrypted_access_token,
    access_token_iv: encrypted.access_token_iv,
    access_token_auth_tag: encrypted.access_token_auth_tag,
    // Canva may or may not rotate the refresh token on refresh — keep the
    // existing one encrypted-as-is if a new one wasn't issued.
    encrypted_refresh_token: encrypted.encrypted_refresh_token ?? connection.encrypted_refresh_token,
    refresh_token_iv: encrypted.refresh_token_iv ?? connection.refresh_token_iv,
    refresh_token_auth_tag: encrypted.refresh_token_auth_tag ?? connection.refresh_token_auth_tag,
    expires_at: expiresAtFromExpiresIn(refreshed.tokens.expires_in),
  })
  if (updateError) return { error: `Refreshed token but failed to persist it: ${updateError}`, status: 500 }

  return { token: refreshed.tokens.access_token }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { format?: string; artifact?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { format = 'json', artifact } = body

  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return NextResponse.json(
      { error: 'Missing or invalid artifact. Must be a carousel, deck, report, or newsletter object.' },
      { status: 400 }
    )
  }

  const bp = artifact as Record<string, unknown>
  const artifactType = bp.artifact_type

  if (!isSupportedArtifactType(artifactType)) {
    return NextResponse.json(
      {
        error: `Missing or unsupported artifact_type: ${JSON.stringify(artifactType)}. ` +
               `Supported: ${SUPPORTED_ARTIFACT_TYPES.join(', ')}.`,
      },
      { status: 400 }
    )
  }

  const shapeError = validateArtifactShape(artifactType, bp)
  if (shapeError) {
    return NextResponse.json({ error: shapeError }, { status: 422 })
  }

  if (!['html', 'json', 'pdf', 'pptx', 'canva'].includes(format)) {
    return NextResponse.json(
      { error: `Unsupported export format: ${format}. Supported: html, json, pdf, pptx, canva` },
      { status: 400 }
    )
  }

  const fmt = format as ExportFormat
  const safeTitle = safeFilenameStem(bp.title, artifactType)

  try {
    if (fmt === 'html') {
      const html = renderArtifactToHTML(bp, artifactType)
      return new NextResponse(html, {
        status: 200,
        headers: {
          'Content-Type': CONTENT_TYPES.html,
          'Content-Disposition': `attachment; filename="${safeTitle}.html"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    if (fmt === 'json') {
      const json = JSON.stringify(bp, null, 2)
      return new NextResponse(json, {
        status: 200,
        headers: {
          'Content-Type': CONTENT_TYPES.json,
          'Content-Disposition': `attachment; filename="${safeTitle}.json"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    if (fmt === 'pdf') {
      const { bytes } = await renderArtifactToPDF(bp, artifactType)
      return new NextResponse(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'Content-Type': CONTENT_TYPES.pdf,
          'Content-Disposition': `attachment; filename="${safeTitle}.pdf"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    if (fmt === 'pptx') {
      // Newsletter is an email format — PPTX (slide deck) export is not applicable.
      // html, json, and pdf are all supported for newsletter exports.
      if (artifactType === 'newsletter') {
        return NextResponse.json(
          { error: 'Newsletter artifacts do not support PPTX export. Use html, pdf, or json instead.' },
          { status: 400 }
        )
      }
      const { bytes } = await renderArtifactToPPTX(bp, artifactType as SupportedPptxArtifactType)
      return new NextResponse(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'Content-Type': CONTENT_TYPES.pptx,
          'Content-Disposition': `attachment; filename="${safeTitle}.pptx"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    // fmt === 'canva' — returns a JSON result (design URL), not a file
    // download. Reuses renderArtifactToPDF under the hood (see
    // lib/canva-export.ts header) — no separate Canva rendering path.
    const tokenResult = await resolveCanvaAccessToken(workspaceId)
    if ('error' in tokenResult) {
      return NextResponse.json({ error: tokenResult.error }, { status: tokenResult.status })
    }

    const importResult = await importArtifactToCanva({
      accessToken: tokenResult.token,
      artifact: bp,
      artifactType,
    })

    if (!importResult.ok) {
      return NextResponse.json({ error: importResult.error ?? 'Canva import failed' }, { status: 502 })
    }

    return NextResponse.json({
      designId: importResult.designId,
      editUrl: importResult.editUrl,
      viewUrl: importResult.viewUrl,
    })
  } catch (error: any) {
    console.error(`[artifact/export] format=${fmt} artifactType=${artifactType}`, error)
    return NextResponse.json(
      { error: error?.message || `Export failed for format=${fmt}` },
      { status: 500 }
    )
  }
}
