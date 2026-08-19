/**
 * POST /api/artifact/export/html
 *
 * Split out of the old monolithic /api/artifact/export (see
 * lib/artifact-export-request.ts header for why). This route stays
 * deliberately dependency-light — no Chromium, no pptxgenjs — so its
 * function bundle is small regardless of what the pdf/pptx/png routes need.
 */
import { NextRequest, NextResponse } from 'next/server'
import { parseExportRequest, CONTENT_TYPES, exportErrorResponse } from '@/lib/artifact-export-request'
import { dispatchHtmlExport } from '@/lib/registry-dispatch-html'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const parsed = await parseExportRequest(req)
  if (!parsed.ok) return parsed.response

  const { artifactType, bp, safeTitle } = parsed.value
  try {
    const html = await dispatchHtmlExport(bp, artifactType)
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPES.html,
        'Content-Disposition': `attachment; filename="${safeTitle}.html"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return exportErrorResponse('html', artifactType, error)
  }
}
