/**
 * apps/web — __tests__/artifact-export-pdf-template.test.ts
 *
 * Tests for Rendering V2 Phase 4: the independent print-specific PDF
 * template (lib/artifact-export-pdf-template.ts) and
 * lib/artifact-export-pdf.ts's flag-gated dispatch between it and the
 * pre-Phase-4 shared-HTML-plus-@media-print path.
 *
 * IMPORTANT LIMITATION (see both modules' header comments): this sandbox
 * has no Chromium binary, so renderArtifactToPDF()'s actual browser launch
 * and PDF byte output are NOT exercised here — only the HTML STRING each
 * path produces is checked. Real page-break/pagination behavior as
 * rendered by a real browser is unverified in this environment.
 */

import { describe, it, expect, afterEach } from 'vitest'
import type { CarouselArtifact } from '@brandos/contracts'
import { isCompositionPdfEnabled, renderCarouselToPrintHTML } from '../lib/artifact-export-pdf-template'
import { resolvePdfHtml } from '../lib/artifact-export-pdf'

const ORIGINAL_FLAG = process.env.RENDERING_V2_COMPOSITION_PDF

function setFlag(value: 'true' | undefined) {
  if (value === undefined) delete process.env.RENDERING_V2_COMPOSITION_PDF
  else process.env.RENDERING_V2_COMPOSITION_PDF = value
}

afterEach(() => {
  setFlag(ORIGINAL_FLAG as 'true' | undefined)
})

function makeCarouselArtifact(overrides?: Partial<CarouselArtifact>): CarouselArtifact {
  return {
    $schema: 'artifact-json@2.0',
    id: 'test-001',
    artifact_type: 'carousel',
    title: 'Test Carousel',
    summary: 'A test carousel',
    hook: 'This is the hook',
    cta: 'This is the CTA',
    semantic_theme: { visual_preset: 'corporate' },
    audience: { sophistication: 'practitioner' },
    narrative_arc: {
      structure: 'problem-solution',
      hook_statement: 'hook',
      thesis: 'thesis',
      resolution: 'resolution',
      pacing: 'balanced',
    },
    richness_metrics: {
      overall_score: 80,
      density_score: 80,
      evidence_score: 80,
      persuasion_score: 80,
      cta_quality_score: 80,
      narrative_coherence_score: 80,
      hook_strength_score: 80,
      audience_alignment_score: 80,
      total_content_words: 100,
      avg_words_per_unit: 50,
    },
    generation_trace: {
      generated_at: '2026-01-01T00:00:00.000Z',
      ocl_strategy: 'direct',
      governance_outcome: 'passed',
      repair_attempts: 0,
      input_type: 'json',
    },
    export_metadata: { available_formats: [] },
    created_at: '2026-01-01T00:00:00.000Z',
    carousel_meta: { palette: [], slide_count: 1 },
    slides: [{ slide: 1, role: 'hook', headline: 'Test headline', body: 'Test body.' }],
    ...overrides,
  }
}

describe('isCompositionPdfEnabled', () => {
  it('is false when unset, true only when exactly "true"', () => {
    setFlag(undefined)
    expect(isCompositionPdfEnabled()).toBe(false)
    setFlag('true')
    expect(isCompositionPdfEnabled()).toBe(true)
  })

  it('is independent of RENDERING_V2_COMPOSITION_HTML', () => {
    setFlag(undefined)
    process.env.RENDERING_V2_COMPOSITION_HTML = 'true'
    expect(isCompositionPdfEnabled()).toBe(false)
    delete process.env.RENDERING_V2_COMPOSITION_HTML
  })
})

describe('renderCarouselToPrintHTML', () => {
  it('sets @page size:A4 and uses pt-based type scale, not the screen template\'s px', () => {
    const html = renderCarouselToPrintHTML(makeCarouselArtifact())
    expect(html).toContain('@page { size: A4;')
    expect(html).toMatch(/--type-h1:\d+pt/)
    expect(html).not.toMatch(/--type-h1:\d+px/)
  })

  it('includes title, hook, and cta', () => {
    const html = renderCarouselToPrintHTML(makeCarouselArtifact())
    expect(html).toContain('Test Carousel')
    expect(html).toContain('This is the hook')
    expect(html).toContain('This is the CTA')
  })

  it("applies break-inside:avoid for every carousel unit (compose.ts hardcodes pageBreak:'avoid' for all carousel units)", () => {
    const html = renderCarouselToPrintHTML(
      makeCarouselArtifact({
        slides: [
          { slide: 1, role: 'hook', headline: 'First' },
          { slide: 2, role: 'cta', headline: 'Second' },
        ],
      })
    )
    // pageBreakStyle('avoid') emits BOTH 'break-inside:avoid' and the legacy
    // 'page-break-inside:avoid' per unit (defensive dual-property CSS — see
    // artifact-export-pdf-template.ts's pageBreakStyle()), and the latter
    // string ends with the former as a substring — so match the full
    // combined pair, not the bare property name, to count units correctly.
    const matches = html.match(/break-inside:avoid;page-break-inside:avoid;/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('resolves theme colors into the print CSS variables', () => {
    const html = renderCarouselToPrintHTML(makeCarouselArtifact({ semantic_theme: { visual_preset: 'corporate' } }))
    // 'corporate' preset's primary color in @brandos/design-tokens
    expect(html).toContain('--color-primary:#1e3a8a')
  })

  it('never renders speaker_notes in the print output', () => {
    const html = renderCarouselToPrintHTML(
      makeCarouselArtifact({
        slides: [{ slide: 1, role: 'hook', headline: 'H', speaker_notes: 'SECRET_PRESENTER_NOTES' }],
      })
    )
    expect(html).not.toContain('SECRET_PRESENTER_NOTES')
  })
})

describe('resolvePdfHtml — dispatch (pure function, no browser launch required)', () => {
  it('uses the legacy shared-HTML path when the flag is off, for any artifact type', () => {
    setFlag(undefined)
    const html = resolvePdfHtml(makeCarouselArtifact() as unknown as Record<string, unknown>, 'carousel')
    // Legacy path is renderArtifactToHTML's screen template — no @page rule.
    expect(html).not.toContain('@page { size: A4;')
  })

  it('uses the new print template for carousel when the flag is on', () => {
    setFlag('true')
    const html = resolvePdfHtml(makeCarouselArtifact() as unknown as Record<string, unknown>, 'carousel')
    expect(html).toContain('@page { size: A4;')
  })

  it('does not affect deck/report/newsletter even when the flag is on (carousel-only scope)', () => {
    setFlag('true')
    const deckHtml = resolvePdfHtml({ artifact_type: 'deck', title: 'A Deck', slides: [] }, 'deck')
    expect(deckHtml).not.toContain('@page { size: A4;')
  })

  it('falls back to the legacy path if the print template throws on malformed input', () => {
    setFlag('true')
    const malformed = { ...makeCarouselArtifact(), slides: undefined } as unknown as Record<string, unknown>
    expect(() => resolvePdfHtml(malformed, 'carousel')).not.toThrow()
    const html = resolvePdfHtml(malformed, 'carousel')
    expect(html).toContain('BrandOS Carousel') // legacy renderer's own <title> suffix
  })

  it('RENDERING_V2_COMPOSITION_HTML being on does not turn on the PDF path (flags are independent)', () => {
    setFlag(undefined)
    process.env.RENDERING_V2_COMPOSITION_HTML = 'true'
    const html = resolvePdfHtml(makeCarouselArtifact() as unknown as Record<string, unknown>, 'carousel')
    expect(html).not.toContain('@page { size: A4;')
    delete process.env.RENDERING_V2_COMPOSITION_HTML
  })
})
