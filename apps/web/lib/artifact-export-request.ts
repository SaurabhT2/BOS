/**
 * apps/web — lib/artifact-export-request.ts
 *
 * FUNCTION-SIZE SPLIT (post-mortem: hotfix/vercel-file-tracing-pptxgenjs):
 * /api/artifact/export used to be a single route handling html/json/pdf/
 * pptx/png/canva. Build succeeded every time, but the deployment itself
 * failed right after — Vercel's "Deploying outputs..." step was rejecting
 * the build because the compiled function bundle (Next.js runtime +
 * @sparticuz/chromium ~70MB + puppeteer-core + pptxgenjs/jszip, all forced
 * in together via outputFileTracingIncludes) was landing at or over the
 * platform's 250MB uncompressed Serverless Function limit.
 *
 * Fix: split by format into separate route files (see the sibling pdf/,
 * pptx/, png/, html/, json/, canva/ directories) so each compiled function
 * only bundles what that format actually needs. This module holds the
 * parsing/validation/auth logic every one of those routes shares — it must
 * stay free of chromium/puppeteer/pptxgenjs imports, or importing it would
 * silently drag those back into every route again.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import {
  safeFilenameStem,
  type SupportedHtmlArtifactType,
} from '@/lib/artifact-export-html'

export type ExportFormat = 'html' | 'json' | 'pdf' | 'pptx' | 'canva' | 'png'

// SPRINT1-FIX (F-01): 'newsletter' added — was absent, causing HTTP 400 for
// every newsletter export despite the compiler, governance, and React renderer
// all being production-ready.
export const SUPPORTED_ARTIFACT_TYPES: readonly SupportedHtmlArtifactType[] = [
  'carousel',
  'deck',
  'report',
  'newsletter',
]

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

export const CONTENT_TYPES: Record<Exclude<ExportFormat, 'canva'>, string> = {
  html: 'text/html; charset=utf-8',
  json: 'application/json',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // PNG export produces one image PER SLIDE (RENDERING_ARCHITECTURE_V2.md §4.4) —
  // a single HTTP response can only carry one file, so multiple images are
  // packaged as a zip archive, not raw image/png bytes.
  png: 'application/zip',
}

export type ParsedExportRequest = {
  workspaceId: string
  artifactType: SupportedHtmlArtifactType
  bp: Record<string, unknown>
  safeTitle: string
}

export type ParseResult =
  | { ok: true; value: ParsedExportRequest }
  | { ok: false; response: NextResponse }

/**
 * Shared auth + body + shape validation for every export route. Each
 * format-specific route calls this first, then does its own format-only
 * work (rendering, zipping, Canva import, etc).
 */
export async function parseExportRequest(req: NextRequest): Promise<ParseResult> {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized || !workspaceId) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  let body: { format?: string; artifact?: unknown }
  try {
    body = await req.json()
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  }

  const { artifact } = body

  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Missing or invalid artifact. Must be a carousel, deck, report, or newsletter object.' },
        { status: 400 }
      ),
    }
  }

  const bp = artifact as Record<string, unknown>
  const artifactType = bp.artifact_type

  if (!isSupportedArtifactType(artifactType)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            `Missing or unsupported artifact_type: ${JSON.stringify(artifactType)}. ` +
            `Supported: ${SUPPORTED_ARTIFACT_TYPES.join(', ')}.`,
        },
        { status: 400 }
      ),
    }
  }

  const shapeError = validateArtifactShape(artifactType, bp)
  if (shapeError) {
    return { ok: false, response: NextResponse.json({ error: shapeError }, { status: 422 }) }
  }

  const safeTitle = safeFilenameStem(bp.title, artifactType)
  return { ok: true, value: { workspaceId, artifactType, bp, safeTitle } }
}

/** Uniform error → 500 JSON response, matching the original route's catch block. */
export function exportErrorResponse(fmt: ExportFormat, artifactType: string, error: unknown) {
  console.error(`[artifact/export/${fmt}] artifactType=${artifactType}`, error)
  const message = error instanceof Error ? error.message : undefined
  return NextResponse.json({ error: message || `Export failed for format=${fmt}` }, { status: 500 })
}
