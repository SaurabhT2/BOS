/**
 * POST /api/artifact/export  (legacy path — kept for backward compatibility)
 *
 * FUNCTION-SIZE SPLIT (post-mortem: hotfix/vercel-file-tracing-pptxgenjs):
 * This used to be the single route for html/json/pdf/pptx/png/canva.
 * Build succeeded every time, but the deployment itself failed right
 * after — Vercel's "Deploying outputs..." step was rejecting the build
 * because the compiled function bundle (Next.js runtime + @sparticuz/
 * chromium ~70MB + puppeteer-core + pptxgenjs/jszip, all forced together
 * via outputFileTracingIncludes) landed at or over the platform's 250MB
 * uncompressed Serverless Function limit.
 *
 * Fix: format-specific routes now live at
 *   /api/artifact/export/{html,json,pdf,pptx,png,canva}
 * each with its own isolated function bundle (see
 * lib/artifact-export-request.ts for the shared parsing logic, and the
 * sibling route.ts files for the per-format handlers).
 *
 * This file only exists so any caller still POSTing to the old bare
 * /api/artifact/export path doesn't break. It deliberately does NOT import
 * dispatchPdfExport / dispatchPptxExport / dispatchImageExport, nor
 * lib/artifact-export-canva.ts (whose Canva fallback path also renders a
 * PDF under the hood) — doing so would drag Chromium and/or pptxgenjs
 * straight back into this function and recreate the exact problem the
 * split fixes. Only html/json are cheap enough to handle inline here;
 * pdf/pptx/png/canva are forwarded with a 308 redirect (which preserves
 * method and body) to their real routes.
 *
 * New code should call the format-specific paths directly — see
 * app/(workspace)/workspace/create/page.tsx's exportArtifact() /
 * exportToCanva(), which already do.
 */
import { NextRequest, NextResponse } from 'next/server'
import { parseExportRequest, CONTENT_TYPES, exportErrorResponse } from '@/lib/artifact-export-request'
import { dispatchHtmlExport } from '@/lib/registry-dispatch-html'

export const runtime = 'nodejs'

// 'canva' is redirected too, not handled inline: its fallback path
// (lib/canva-export.ts) statically imports renderArtifactToPDF, so it
// needs Chromium under the hood just like pdf/png do. Handling it inline
// here would pull Chromium into this shim's bundle for every request,
// including plain html/json ones — the exact bloat this split exists to
// avoid. See app/api/artifact/export/canva/route.ts.
const REDIRECT_FORMATS = new Set(['pdf', 'pptx', 'png', 'canva'])

export async function POST(req: NextRequest) {
  // Format-only peek so pdf/pptx/png can be redirected before we do the
  // full parse (which the target route will do again anyway).
  let rawFormat: unknown
  try {
    rawFormat = (await req.clone().json())?.format
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof rawFormat === 'string' && REDIRECT_FORMATS.has(rawFormat)) {
    return NextResponse.redirect(new URL(`/api/artifact/export/${rawFormat}`, req.url), 308)
  }

  const parsed = await parseExportRequest(req)
  if (!parsed.ok) return parsed.response
  const { artifactType, bp, safeTitle } = parsed.value

  if (rawFormat === 'json' || rawFormat === undefined) {
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

  if (rawFormat === 'html') {
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

  return NextResponse.json(
    { error: `Unsupported export format: ${String(rawFormat)}. Supported: html, json, pdf, pptx, canva, png` },
    { status: 400 }
  )
}
