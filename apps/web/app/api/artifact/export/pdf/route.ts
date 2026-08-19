/**
 * POST /api/artifact/export/pdf
 *
 * Split out of the old monolithic /api/artifact/export (see
 * lib/artifact-export-request.ts header for why). This is the only export
 * route whose function bundle includes @sparticuz/chromium + puppeteer-core
 * (~76MB) — keeping it isolated from html/json/pptx/canva is the whole
 * point of the split, since bundling all of them together is what pushed
 * the old single function over Vercel's 250MB uncompressed function limit.
 */
import { NextRequest, NextResponse } from 'next/server'
import { parseExportRequest, CONTENT_TYPES, exportErrorResponse } from '@/lib/artifact-export-request'
import { dispatchPdfExport } from '@/lib/registry-dispatch-pdf'

export const runtime = 'nodejs'

// Headless Chromium launch + page render can exceed the Next.js default
// route timeout on larger decks/reports — mirrors the original route's
// explicit runtime tuning.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const parsed = await parseExportRequest(req)
  if (!parsed.ok) return parsed.response

  const { artifactType, bp, safeTitle } = parsed.value
  try {
    const { bytes } = await dispatchPdfExport(bp, artifactType)
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPES.pdf,
        'Content-Disposition': `attachment; filename="${safeTitle}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return exportErrorResponse('pdf', artifactType, error)
  }
}
