/**
 * POST /api/artifact/export/canva
 *
 * Split out of the old monolithic /api/artifact/export (see
 * lib/artifact-export-request.ts header for why). NOT a light function:
 * lib/artifact-export-canva.ts's fallback path (used whenever no Canva
 * brand template is configured) statically imports renderArtifactToPDF
 * from artifact-export-pdf.ts to repackage the artifact as a PDF for
 * Canva's import API — so this route bundles Chromium/puppeteer-core too,
 * same as pdf/route.ts. It's still isolated from pptx's dependency tree,
 * which is the split that mattered for staying under the function-size
 * limit.
 */
import { NextRequest } from 'next/server'
import { parseExportRequest } from '@/lib/artifact-export-request'
import { handleCanvaExport } from '@/lib/artifact-export-canva'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const parsed = await parseExportRequest(req)
  if (!parsed.ok) return parsed.response

  return handleCanvaExport(parsed.value)
}
