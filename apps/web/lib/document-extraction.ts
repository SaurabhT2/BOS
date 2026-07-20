/**
 * apps/web/lib/document-extraction.ts
 *
 * Cognitive Platform Evolution Program — Milestone 2 (Knowledge Loop),
 * EM-2.1 (Upload-Time Extraction Pipeline).
 *
 * Extracted from app/api/assets/[id]/analyze/route.ts's inline
 * `analyzeDocument()` text-extraction branch, which is unchanged in
 * substance — same pdf-parse/mammoth calls, same 8000-char cap, same
 * placeholder conventions for unsupported/failed extraction — just moved
 * here so app/api/assets/route.ts (the upload route) can call it too,
 * instead of only ever running when a user later clicks "Analyze."
 *
 * Deliberately extraction-only: this module does not call any LLM, does
 * not classify, does not score. See ./asset-classification.ts (EM-2.3)
 * for classification, and analyze/route.ts for the VLM/LLM summarization
 * step, which stays where it is (it needs the asset record, BYOK key
 * resolution, etc. that this module has no business knowing about).
 *
 * G-19 (Architecture Verification Report, P2) — PPTX text extraction is
 * now implemented here (JSZip + fast-xml-parser — approved approach, see
 * completion report), since it's pure parsing (a PPTX is a ZIP of slide
 * XML) and needs no LLM, staying within this module's boundary. Scanned-
 * PDF OCR does NOT live here — it genuinely needs an LLM/vision call
 * (approved approach: reuse existing VLM provider infra), which this
 * module's own "no LLM" boundary excludes. See
 * ./scanned-pdf-ocr.ts::extractDocumentTextWithOcrFallback() — a thin
 * wrapper around this module's extractDocumentText() that adds the OCR
 * fallback step for the one case this module still can't fully resolve.
 * Callers that want OCR support call that wrapper instead of this
 * function directly; this function's own PDF branch is unchanged.
 */

import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'

export type ExtractionStatus = 'extracted' | 'unsupported' | 'failed' | 'scanned_pdf_needs_ocr'

export interface DocumentExtractionResult {
  readonly text: string
  readonly status: ExtractionStatus
}

const MAX_EXTRACTED_CHARS = 8000

/**
 * Extracts text from a document buffer given its MIME type. Mirrors
 * analyze/route.ts's analyzeDocument() text-extraction branch exactly —
 * same libraries, same cap, same placeholder text for unsupported/failed
 * cases — so callers that already handle those placeholder strings
 * (e.g. the "starts with '[' means not real content" check in
 * analyze/route.ts) keep working unchanged.
 */
export async function extractDocumentText(
  fileBytes: Buffer,
  mimeType: string,
  filename: string,
): Promise<DocumentExtractionResult> {
  const isTextType = mimeType === 'text/plain' || mimeType === 'text/markdown'
  const isPdf = mimeType === 'application/pdf'
  const isDocx =
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  const isPptx =
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mimeType === 'application/vnd.ms-powerpoint'
  const isSvg = mimeType === 'image/svg+xml'

  if (isTextType || isSvg) {
    return { text: fileBytes.toString('utf-8').slice(0, MAX_EXTRACTED_CHARS), status: 'extracted' }
  }

  if (isPdf) {
    try {
      // pdf-parse v2.x exports a named class, not a default function.
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: fileBytes })
      const result = await parser.getText()
      const text = (result.text ?? '').slice(0, MAX_EXTRACTED_CHARS)
      if (!text.trim()) {
        // Scanned PDF — no text layer. G-19: this module still does not
        // do OCR itself (would need an LLM call, outside this module's
        // boundary) — but now reports a status precise enough for a
        // caller to know OCR is exactly what's needed here, rather than
        // a generic 'unsupported' indistinguishable from "we'll never
        // support this format." See ./scanned-pdf-ocr.ts.
        return {
          text: `[Scanned PDF: ${filename}, ${fileBytes.length} bytes — OCR not implemented]`,
          status: 'scanned_pdf_needs_ocr',
        }
      }
      return { text, status: 'extracted' }
    } catch {
      return { text: `[PDF extraction failed: ${filename}]`, status: 'failed' }
    }
  }

  if (isDocx) {
    try {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer: fileBytes })
      const text = (result.value ?? '').slice(0, MAX_EXTRACTED_CHARS)
      return { text, status: text.trim() ? 'extracted' : 'unsupported' }
    } catch {
      return { text: `[DOCX extraction failed: ${filename}]`, status: 'failed' }
    }
  }

  if (isPptx) {
    return extractPptxText(fileBytes, filename)
  }

  return {
    text: `[Binary document: ${filename}, ${mimeType} — format not supported for extraction]`,
    status: 'unsupported',
  }
}

/**
 * G-19 (Architecture Verification Report, P2) — PPTX text extraction.
 *
 * A .pptx file is a ZIP archive; slide content lives at
 * `ppt/slides/slideN.xml` as DrawingML XML, one file per slide. Text runs
 * are `<a:t>` elements nested inside `<a:p>` (paragraph) inside shape
 * text bodies — this walks the parsed XML tree collecting every `<a:t>`
 * text node's content, in document order, per slide, then joins slides
 * with a blank line. This intentionally does NOT attempt to reconstruct
 * layout, formatting, tables, or speaker notes — just the visible text
 * runs, which is what KnowledgeProcessor's downstream vocabulary/
 * framework/pattern extractors actually consume (matching this module's
 * existing PDF/DOCX extractors, which are similarly text-only).
 */
async function extractPptxText(
  fileBytes: Buffer,
  filename: string,
): Promise<DocumentExtractionResult> {
  try {
    const zip = await JSZip.loadAsync(fileBytes)

    const slideFiles = Object.keys(zip.files)
      .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
      .sort((a, b) => {
        const numA = Number(/slide(\d+)\.xml$/.exec(a)?.[1] ?? 0)
        const numB = Number(/slide(\d+)\.xml$/.exec(b)?.[1] ?? 0)
        return numA - numB
      })

    if (slideFiles.length === 0) {
      return {
        text: `[PPTX: ${filename}, ${fileBytes.length} bytes — no slide content found]`,
        status: 'unsupported',
      }
    }

    const parser = new XMLParser({
      ignoreAttributes: true,
      // Text runs can legitimately be numeric-looking ("2024", "50%") —
      // never coerce them to numbers/booleans, this is text extraction.
      parseTagValue: false,
      // A slide with exactly one text run would otherwise parse <a:t> as
      // a single object instead of an array of one, breaking the uniform
      // array-walk below.
      isArray: (tagName) => tagName === 'a:t',
    })

    const slideTexts: string[] = []
    for (const path of slideFiles) {
      const xml = await zip.files[path]!.async('text')
      let parsed: unknown
      try {
        parsed = parser.parse(xml)
      } catch {
        continue // one malformed slide must not fail the whole deck
      }
      const runs: string[] = []
      collectTextRuns(parsed, runs)
      const slideText = runs.map((r) => r.trim()).filter(Boolean).join(' ')
      if (slideText) slideTexts.push(slideText)
    }

    const text = slideTexts.join('\n\n').slice(0, MAX_EXTRACTED_CHARS)
    return {
      text,
      status: text.trim() ? 'extracted' : 'unsupported',
    }
  } catch {
    return { text: `[PPTX extraction failed: ${filename}]`, status: 'failed' }
  }
}

/**
 * Recursively walks a parsed XML tree (fast-xml-parser's plain-object
 * shape) collecting every `a:t` text-run value it finds, in document
 * order. Deliberately structure-agnostic (doesn't assume a specific
 * shape/depth for `<a:p>`/`<a:r>`) — DrawingML nesting varies (grouped
 * shapes, tables, SmartArt all nest differently) and a rigid path-based
 * walk would silently miss text in less-common slide layouts.
 */
function collectTextRuns(node: unknown, out: string[]): void {
  if (node === null || node === undefined) return

  if (Array.isArray(node)) {
    for (const item of node) collectTextRuns(item, out)
    return
  }

  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'a:t') {
        const values = Array.isArray(value) ? value : [value]
        for (const v of values) {
          if (typeof v === 'string') out.push(v)
          else if (v !== null && typeof v === 'object' && '#text' in (v as Record<string, unknown>)) {
            const inner = (v as Record<string, unknown>)['#text']
            if (typeof inner === 'string') out.push(inner)
          }
        }
      } else {
        collectTextRuns(value, out)
      }
    }
  }
}


export function isRealExtractedText(text: string | undefined | null): boolean {
  return typeof text === 'string' && text.trim().length > 0 && !text.trim().startsWith('[')
}
