/**
 * POST /api/artifact/export/json
 *
 * Split out of the old monolithic /api/artifact/export (see
 * lib/artifact-export-request.ts header for why).
 */
import { NextRequest, NextResponse } from 'next/server'
import { parseExportRequest, CONTENT_TYPES } from '@/lib/artifact-export-request'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const parsed = await parseExportRequest(req)
  if (!parsed.ok) return parsed.response

  const { bp, safeTitle } = parsed.value
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
