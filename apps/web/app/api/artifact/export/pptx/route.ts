/**
 * POST /api/artifact/export/pptx
 *
 * Split out of the old monolithic /api/artifact/export (see
 * lib/artifact-export-request.ts header for why). This is the only export
 * route whose function bundle includes pptxgenjs + jszip's full dependency
 * tree — isolated so it never has to share a function with the Chromium
 * binary that pdf/png need.
 */
import { NextRequest, NextResponse } from 'next/server'
import { parseExportRequest, CONTENT_TYPES, exportErrorResponse } from '@/lib/artifact-export-request'
import { dispatchPptxExport } from '@/lib/registry-dispatch-pptx'
import type { SupportedPptxArtifactType } from '@/lib/artifact-export-pptx'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const parsed = await parseExportRequest(req)
  if (!parsed.ok) return parsed.response

  const { artifactType, bp, safeTitle } = parsed.value

  // Newsletter is an email format — PPTX (slide deck) export is not
  // applicable. html, json, and pdf are all supported for newsletter exports.
  if (artifactType === 'newsletter') {
    return NextResponse.json(
      { error: 'Newsletter artifacts do not support PPTX export. Use html, pdf, or json instead.' },
      { status: 400 }
    )
  }

  try {
    const { bytes } = await dispatchPptxExport(bp, artifactType as SupportedPptxArtifactType)
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPES.pptx,
        'Content-Disposition': `attachment; filename="${safeTitle}.pptx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return exportErrorResponse('pptx', artifactType, error)
  }
}
