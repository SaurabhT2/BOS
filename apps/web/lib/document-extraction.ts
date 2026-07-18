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
 */

export type ExtractionStatus = 'extracted' | 'unsupported' | 'failed'

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
        // Scanned PDF — no text layer; OCR remains out of scope (unchanged
        // from the pre-EM-2.1 behavior — see the audit's §2.6 table).
        return {
          text: `[Scanned PDF: ${filename}, ${fileBytes.length} bytes — OCR not implemented]`,
          status: 'unsupported',
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
    // PPTX is a ZIP of slide XML. Still not implemented (unchanged from
    // pre-EM-2.1 — this EM's scope was moving extraction earlier, not
    // adding a new extractor; a real PPTX extractor is a separate,
    // still-open follow-up, now visible in this single shared module
    // instead of buried in the analyze route).
    return {
      text: `[PPTX: ${filename}, ${fileBytes.length} bytes — text extraction not yet implemented]`,
      status: 'unsupported',
    }
  }

  return {
    text: `[Binary document: ${filename}, ${mimeType} — format not supported for extraction]`,
    status: 'unsupported',
  }
}

/**
 * True when a DocumentExtractionResult (or any raw extracted-text string
 * built by this module's conventions) is real content, not one of the
 * placeholder strings above. Centralizes the "starts with '['" check that
 * previously lived inline in analyze/route.ts, so both callers use the
 * same rule.
 */
export function isRealExtractedText(text: string | undefined | null): boolean {
  return typeof text === 'string' && text.trim().length > 0 && !text.trim().startsWith('[')
}
