/**
 * apps/web/lib/scanned-pdf-ocr.ts
 *
 * G-19 (Architecture Verification Report, P2) — scanned-PDF OCR.
 *
 * `document-extraction.ts` is deliberately extraction-only and does not call
 * any LLM (see its own docblock). Scanned-PDF OCR genuinely needs a
 * vision/LLM call, so that step lives here instead, in its own module with
 * its own honest boundary: this file DOES call an LLM.
 *
 * Approved approach (see completion report — this was a technology choice
 * requiring explicit approval, not made unilaterally):
 *   - PDF page rasterization: pdfjs-dist + @napi-rs/canvas, pinned to the
 *     EXACT versions `pdf-parse` (already a dependency here) uses
 *     internally for this same purpose (5.4.296 / 0.1.80) — this combination
 *     is already proven compatible with this repo's Node/pnpm setup, so
 *     reusing it (as an explicit apps/web dependency, not relying on
 *     pdf-parse's internal copy, which is not reliably resolvable from
 *     this package under pnpm's strict linking) is the lowest-risk choice.
 *   - OCR itself: reuse the existing VLM/vision provider infrastructure
 *     (`extractTextFromImageWithVLM()`, ai-runtime-layer) rather than a new
 *     dedicated OCR vendor/library — no new AI provider to configure,
 *     no new API key, no new cost line item; uses whatever cloud provider
 *     is already configured for this workspace.
 *
 * Scope: this is OCR for the "no text layer" case document-extraction.ts
 * already detects (`scanned_pdf_needs_ocr` status) — not a general-purpose
 * PDF rendering utility. Capped to the first few pages (MAX_OCR_PAGES) —
 * OCR is materially slower/costlier per page than text extraction, and the
 * existing MAX_EXTRACTED_CHARS cap elsewhere in this codebase reflects the
 * same "we don't need the whole document, just enough to seed Brand
 * Intelligence" philosophy.
 */

import { createCanvas, type Canvas } from '@napi-rs/canvas'
import { extractTextFromImageWithVLM } from '@brandos/ai-runtime-layer'
import {
  extractDocumentText,
  type DocumentExtractionResult,
} from './document-extraction'

const MAX_OCR_PAGES = 3
const OCR_RENDER_SCALE = 2.0 // higher than 1:1 — meaningfully improves OCR accuracy on small text
const MAX_OCR_TEXT_CHARS = 8000 // matches document-extraction.ts's MAX_EXTRACTED_CHARS

/**
 * pdfjs-dist's `getDocument()`/`page.render()` expect a CanvasFactory with
 * this exact shape (`create`/`reset`/`destroy`) when no DOM Canvas is
 * available (Node). Implemented directly against `@napi-rs/canvas` here —
 * deliberately NOT relying on pdfjs-dist's own internal Node auto-detection
 * (which dynamically `require()`s `@napi-rs/canvas` relative to pdfjs-dist's
 * own install location): under pnpm's strict linking, that dynamic require
 * is not guaranteed to resolve `@napi-rs/canvas` as an apps/web dependency,
 * since pdfjs-dist doesn't declare it as pdfjs-dist's own dependency. This
 * factory sidesteps that resolution question entirely.
 */
interface CanvasAndContext {
  canvas: Canvas
  context: ReturnType<Canvas['getContext']>
}

class NapiCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = createCanvas(width, height)
    return { canvas, context: canvas.getContext('2d') }
  }
  reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
    canvasAndContext.canvas.width = width
    canvasAndContext.canvas.height = height
  }
  destroy(canvasAndContext: CanvasAndContext): void {
    canvasAndContext.canvas.width = 0
    canvasAndContext.canvas.height = 0
  }
}

/**
 * Renders the first `MAX_OCR_PAGES` pages of a PDF to PNG images, returned
 * as raw base64 (no `data:image/png;base64,` prefix — matches what
 * ai-runtime-layer's provider adapters expect for `imageBase64`/attachment
 * `data`, e.g. Anthropic's `source.data`).
 */
async function rasterizePdfPages(fileBytes: Buffer): Promise<string[]> {
  // Lazy import: pdfjs-dist's legacy/Node build is only needed on this one
  // code path (scanned PDFs are the minority case) — no reason to pull it
  // into every route's bundle.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')

  const loadingTask = getDocument({
    data: new Uint8Array(fileBytes),
    CanvasFactory: NapiCanvasFactory as any,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  })

  const doc = await loadingTask.promise
  try {
    const pageCount = Math.min(doc.numPages, MAX_OCR_PAGES)
    const images: string[] = []

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await doc.getPage(pageNum)
      const viewport = page.getViewport({ scale: OCR_RENDER_SCALE })
      const factory = new NapiCanvasFactory()
      const { canvas } = factory.create(viewport.width, viewport.height)

      await page.render({
        canvas: canvas as any,
        viewport,
      }).promise

      images.push(canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''))
      page.cleanup()
    }

    return images
  } finally {
    await doc.destroy()
  }
}

/**
 * OCRs a scanned PDF (no text layer) by rasterizing its first few pages and
 * transcribing each with the VLM. Sequential, not parallel — this already
 * runs off the critical path of the upload response (see G-25's
 * fire-and-forget continuation in apps/web/app/api/assets/route.ts), and
 * sequential calls are gentler on whatever provider rate limits apply than
 * firing several vision calls at once for one document.
 */
async function ocrScannedPdf(fileBytes: Buffer, filename: string): Promise<DocumentExtractionResult> {
  let pageImages: string[]
  try {
    pageImages = await rasterizePdfPages(fileBytes)
  } catch (err) {
    console.error(`[scanned-pdf-ocr] rasterization failed for ${filename}:`, err)
    return { text: `[Scanned PDF: ${filename} — page rendering failed]`, status: 'failed' }
  }

  if (pageImages.length === 0) {
    return { text: `[Scanned PDF: ${filename} — no pages to render]`, status: 'unsupported' }
  }

  const pageTexts: string[] = []
  for (const imageBase64 of pageImages) {
    try {
      const text = await extractTextFromImageWithVLM(imageBase64)
      if (text) pageTexts.push(text)
    } catch (err) {
      console.error(`[scanned-pdf-ocr] OCR call failed for a page of ${filename} (continuing with remaining pages):`, err)
    }
  }

  const combined = pageTexts.join('\n\n').slice(0, MAX_OCR_TEXT_CHARS)
  return {
    text: combined.trim()
      ? combined
      : `[Scanned PDF: ${filename} — OCR produced no legible text]`,
    status: combined.trim() ? 'extracted' : 'failed',
  }
}

/**
 * Drop-in superset of `extractDocumentText()`: identical result for every
 * format that function already handles, and additionally resolves the
 * `scanned_pdf_needs_ocr` case with real OCR'd text instead of leaving it
 * as a placeholder. Callers that want OCR support should call this instead
 * of `extractDocumentText()` directly.
 */
export async function extractDocumentTextWithOcrFallback(
  fileBytes: Buffer,
  mimeType: string,
  filename: string,
): Promise<DocumentExtractionResult> {
  const result = await extractDocumentText(fileBytes, mimeType, filename)
  if (result.status !== 'scanned_pdf_needs_ocr') return result
  return ocrScannedPdf(fileBytes, filename)
}
