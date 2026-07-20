/**
 * apps/web/__tests__/document-extraction.pptx.test.ts
 *
 * G-19 (Architecture Verification Report, P2) — PPTX text extraction.
 *
 * Builds an actual minimal, valid .pptx file in-memory (a real ZIP archive
 * with real DrawingML slide XML, not a mock) and feeds it through
 * `extractDocumentText()`, so this test exercises the real JSZip/
 * fast-xml-parser code path end-to-end rather than asserting against a
 * stub.
 */

import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { extractDocumentText } from '../lib/document-extraction'

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

/** Minimal DrawingML slide XML with two text runs in a text body — the real
 *  shape PowerPoint produces, not a simplified stand-in. */
function slideXml(texts: string[]): string {
  const runs = texts
    .map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          ${runs}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`
}

/** Builds a real, minimal but structurally valid .pptx buffer with the
 *  given per-slide text content. */
async function buildPptx(slidesText: string[][]): Promise<Buffer> {
  const zip = new JSZip()

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`)

  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`)

  slidesText.forEach((texts, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, slideXml(texts))
  })

  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  return buf
}

describe('extractDocumentText — PPTX (G-19)', () => {
  it('extracts text runs from a single-slide PPTX, in document order', async () => {
    const pptx = await buildPptx([['Welcome to Acme', 'Scaling your SaaS startup']])

    const result = await extractDocumentText(pptx, PPTX_MIME, 'deck.pptx')

    expect(result.status).toBe('extracted')
    expect(result.text).toContain('Welcome to Acme')
    expect(result.text).toContain('Scaling your SaaS startup')
    // Document order preserved.
    expect(result.text.indexOf('Welcome to Acme')).toBeLessThan(result.text.indexOf('Scaling your SaaS startup'))
  })

  it('joins multiple slides and preserves slide order', async () => {
    const pptx = await buildPptx([
      ['Slide one heading'],
      ['Slide two heading'],
      ['Slide three heading'],
    ])

    const result = await extractDocumentText(pptx, PPTX_MIME, 'deck.pptx')

    expect(result.status).toBe('extracted')
    const i1 = result.text.indexOf('Slide one heading')
    const i2 = result.text.indexOf('Slide two heading')
    const i3 = result.text.indexOf('Slide three heading')
    expect(i1).toBeGreaterThanOrEqual(0)
    expect(i1).toBeLessThan(i2)
    expect(i2).toBeLessThan(i3)
  })

  it('handles numeric-looking text runs as text, not numbers (parseTagValue: false)', async () => {
    const pptx = await buildPptx([['Q4 2024', '50%', 'Revenue: $2000000']])

    const result = await extractDocumentText(pptx, PPTX_MIME, 'deck.pptx')

    expect(result.status).toBe('extracted')
    expect(result.text).toContain('Q4 2024')
    expect(result.text).toContain('50%')
    expect(result.text).toContain('Revenue: $2000000')
  })

  it('returns unsupported for a PPTX with no slide content', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
    const pptx = await zip.generateAsync({ type: 'nodebuffer' })

    const result = await extractDocumentText(pptx, PPTX_MIME, 'empty.pptx')

    expect(result.status).toBe('unsupported')
  })

  it('returns failed for a corrupt/non-ZIP buffer with a PPTX mime type', async () => {
    const garbage = Buffer.from('this is not a zip file at all')

    const result = await extractDocumentText(garbage, PPTX_MIME, 'corrupt.pptx')

    expect(result.status).toBe('failed')
  })
})
