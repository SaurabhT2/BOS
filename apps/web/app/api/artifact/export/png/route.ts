/**
 * POST /api/artifact/export/png
 *
 * Split out of the old monolithic /api/artifact/export (see
 * lib/artifact-export-request.ts header for why). Like pdf/route.ts, this
 * bundles @sparticuz/chromium + puppeteer-core — kept in its own function
 * rather than merged back with pdf so neither route's cold start pays for
 * work the request doesn't need.
 */
import { NextRequest, NextResponse } from 'next/server'
import { parseExportRequest, CONTENT_TYPES, exportErrorResponse } from '@/lib/artifact-export-request'
import { dispatchImageExport } from '@/lib/registry-dispatch-image'
import JSZip from 'jszip'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const parsed = await parseExportRequest(req)
  if (!parsed.ok) return parsed.response

  const { artifactType, bp, safeTitle } = parsed.value

  // RENDERING V2 PHASE 9: carousel only, matching the scope pattern
  // established by Phases 3-8.
  if (artifactType !== 'carousel') {
    return NextResponse.json(
      { error: 'Only carousel artifacts support PNG export in this phase.' },
      { status: 400 }
    )
  }

  try {
    const { images } = await dispatchImageExport(bp, 'carousel')
    const zip = new JSZip()
    images.forEach((image, i) => zip.file(`slide-${i + 1}.png`, image))
    const zipBytes = await zip.generateAsync({ type: 'nodebuffer' })
    return new NextResponse(new Uint8Array(zipBytes), {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPES.png,
        'Content-Disposition': `attachment; filename="${safeTitle}-images.zip"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return exportErrorResponse('png', artifactType, error)
  }
}
