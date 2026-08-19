/**
 * apps/web — lib/registry-dispatch.ts
 *
 * Backward-compatible barrel. This module used to contain
 * dispatchHtmlExport/dispatchPdfExport/dispatchPptxExport/
 * dispatchImageExport directly, with static imports of
 * artifact-export-html.ts, artifact-export-pdf.ts (puppeteer-core /
 * @sparticuz/chromium), and artifact-export-pptx.ts (pptxgenjs/jszip) all
 * in one file. That combination is exactly what pushed
 * app/api/artifact/export/route.ts over Vercel's 250MB uncompressed
 * function-size limit (see lib/artifact-export-request.ts for the full
 * story) — and simply importing dispatchHtmlExport from here would have
 * quietly recreated the same problem in the split routes, since ES module
 * imports pull in a file's entire static import graph regardless of which
 * export you actually use.
 *
 * The real implementations now live one-per-format in
 * registry-dispatch-html.ts / -pdf.ts / -pptx.ts / -image.ts, each
 * importing only its own renderer. This file just re-exports all four for
 * callers that genuinely want the full set (currently:
 * __tests__/registry-dispatch.test.ts).
 *
 * Route files under app/api/artifact/export/**\/route.ts must import
 * directly from the per-format modules, never from this barrel.
 */
export { isRegistryDispatchEnabled } from './registry-dispatch-shared'
export { dispatchHtmlExport } from './registry-dispatch-html'
export { dispatchPdfExport } from './registry-dispatch-pdf'
export { dispatchPptxExport } from './registry-dispatch-pptx'
export { dispatchImageExport } from './registry-dispatch-image'
