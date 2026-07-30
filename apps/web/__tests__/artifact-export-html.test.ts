/**
 * apps/web — __tests__/artifact-export-html.test.ts
 *
 * Tests for the Rendering V2 Phase 3 addition to
 * lib/artifact-export-html.ts: renderCarouselToHTMLComposed(),
 * isCompositionHtmlEnabled(), and renderArtifactToHTML()'s flag-gated
 * dispatch + defensive fallback for the carousel case.
 *
 * Does NOT re-test the legacy renderCarouselToHTML()/renderDeckToHTML()/
 * etc. functions' own behavior — those are unchanged by this phase and
 * had no pre-existing test file (a pre-existing gap, out of scope here).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { CarouselArtifact } from '@brandos/contracts'
import {
  renderArtifactToHTML,
  renderCarouselToHTML,
  renderCarouselToHTMLComposed,
  isCompositionHtmlEnabled,
} from '../lib/artifact-export-html'

const ORIGINAL_FLAG = process.env.RENDERING_V2_COMPOSITION_HTML

function setFlag(value: 'true' | undefined) {
  if (value === undefined) delete process.env.RENDERING_V2_COMPOSITION_HTML
  else process.env.RENDERING_V2_COMPOSITION_HTML = value
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
    semantic_theme: { visual_preset: 'vibrant' },
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
    slides: [
      {
        slide: 1,
        role: 'hook',
        headline: 'Revenue grew 40% this quarter',
        body: 'A strong quarter overall.',
        emphasis_keywords: ['40%'],
      },
    ],
    ...overrides,
  }
}

describe('isCompositionHtmlEnabled', () => {
  it('is false when the env var is unset', () => {
    setFlag(undefined)
    expect(isCompositionHtmlEnabled()).toBe(false)
  })

  it('is true only when the env var is exactly "true"', () => {
    setFlag('true')
    expect(isCompositionHtmlEnabled()).toBe(true)
  })
})

describe('renderCarouselToHTMLComposed', () => {
  it('includes the artifact title, hook, and cta', () => {
    const html = renderCarouselToHTMLComposed(makeCarouselArtifact())
    expect(html).toContain('Test Carousel')
    expect(html).toContain('This is the hook')
    expect(html).toContain('This is the CTA')
  })

  it('emits CSS custom properties from the resolved theme', () => {
    const html = renderCarouselToHTMLComposed(makeCarouselArtifact())
    expect(html).toMatch(/:root\s*\{[^}]*--color-primary:/)
    expect(html).toContain('--color-accent:')
    expect(html).toContain('--radius-card:')
  })

  it("resolves the 'vibrant' preset's palette into the output", () => {
    const html = renderCarouselToHTMLComposed(makeCarouselArtifact({ semantic_theme: { visual_preset: 'vibrant' } }))
    // '#db2777' is the vibrant preset's primary color in @brandos/design-tokens
    expect(html).toContain('--color-primary:#db2777')
  })

  it('wraps emphasis_keywords matches in <mark>, closing the "emphasis is silently dropped" gap', () => {
    const html = renderCarouselToHTMLComposed(makeCarouselArtifact())
    expect(html).toMatch(/<mark[^>]*>40%<\/mark>/)
  })

  it('applies a visibly different layout treatment for a split-resolved slide', () => {
    const html = renderCarouselToHTMLComposed(
      makeCarouselArtifact({
        slides: [{ slide: 1, role: 'framework', headline: 'A framework slide', layout_hint: 'split' }],
      })
    )
    expect(html).toContain('grid-template-columns:1fr 1fr')
  })

  it('renders every slide as a CompositionUnit with role and slide number', () => {
    const html = renderCarouselToHTMLComposed(
      makeCarouselArtifact({
        slides: [
          { slide: 1, role: 'hook', headline: 'First' },
          { slide: 2, role: 'cta', headline: 'Second' },
        ],
      })
    )
    expect(html).toContain('HOOK · Slide 1')
    expect(html).toContain('CTA · Slide 2')
  })
})

describe('content parity — legacy vs composed (text-level proxy for visual regression)', () => {
  // IMPORTANT LIMITATION, documented rather than hidden: this sandbox has no
  // Chromium binary and no network path to fetch one, so a real golden-file
  // *visual* screenshot diff (as called for in RENDERING_ROADMAP_V2.md Phase 3's
  // validation step) could not be performed here. This test is the best
  // available proxy — it strips HTML tags and confirms every piece of visible
  // text content the legacy renderer produces is ALSO present in the composed
  // renderer's output for the same artifact, so no user-facing content is lost
  // in the migration. It does NOT verify pixel-level visual appearance
  // (colors, spacing, font rendering) — that verification remains outstanding
  // and should happen in a real browser environment before this flag is
  // enabled in production.
  function stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }

  it('every piece of visible text in the legacy render also appears in the composed render', () => {
    const artifact = makeCarouselArtifact({
      slides: [
        {
          slide: 1,
          role: 'evidence',
          headline: 'Revenue grew 40% this quarter',
          subheadline: 'A closer look',
          body: 'The details matter here.',
          bullets: ['First point', 'Second point'],
          insight: 'This is the key insight',
          key_takeaway: 'Remember this',
          supporting_evidence: ['Evidence A'],
        },
      ],
    })
    const legacyHtml = renderCarouselToHTML(artifact as unknown as Record<string, unknown>)
    const composedHtml = renderCarouselToHTMLComposed(artifact)
    const composedText = stripTags(composedHtml)

    const expectedFragments = [
      'Revenue grew 40% this quarter',
      'A closer look',
      'The details matter here.',
      'First point',
      'Second point',
      'This is the key insight',
      'Remember this',
      'Evidence A',
    ]
    for (const fragment of expectedFragments) {
      expect(stripTags(legacyHtml)).toContain(fragment) // sanity: legacy actually has it too
      expect(composedText).toContain(fragment)
    }
  })
})

describe('renderArtifactToHTML — carousel dispatch', () => {
  it('uses the legacy renderer when the flag is off (no CSS custom properties in output)', () => {
    setFlag(undefined)
    const html = renderArtifactToHTML(makeCarouselArtifact() as unknown as Record<string, unknown>, 'carousel')
    expect(html).not.toContain(':root {')
    expect(html).not.toContain('--color-primary')
  })

  it('uses the Composition Layer renderer when the flag is on', () => {
    setFlag('true')
    const html = renderArtifactToHTML(makeCarouselArtifact() as unknown as Record<string, unknown>, 'carousel')
    expect(html).toContain('--color-primary')
  })

  it('falls back to the legacy renderer if the Composition Layer path throws, rather than crashing the export', () => {
    setFlag('true')
    // slides: undefined violates CarouselArtifact's real shape — composeArtifact()
    // will throw when it tries to .map() over it. This simulates unvalidated/
    // malformed input reaching renderArtifactToHTML() despite the route's own
    // upstream shape validation (defense in depth, not an expected steady state).
    const malformed = { ...makeCarouselArtifact(), slides: undefined } as unknown as Record<string, unknown>
    expect(() => renderArtifactToHTML(malformed, 'carousel')).not.toThrow()
    const html = renderArtifactToHTML(malformed, 'carousel')
    // Legacy renderer tolerates missing `slides` (defaults to [] via Array.isArray guard)
    // and still produces valid HTML — proving the fallback path actually ran.
    expect(html).toContain('BrandOS Carousel')
  })

  it('deck/report/newsletter dispatch is unaffected by the flag (Phase 3 is carousel-only)', () => {
    setFlag('true')
    // Deck should never see composition-layer output regardless of the flag —
    // there is no renderDeckToHTMLComposed() yet (Phase 5+ territory... actually
    // Phase 3 scope note: only carousel migrates in this slice).
    const deckArtifact = { artifact_type: 'deck', title: 'A Deck', slides: [] }
    const html = renderArtifactToHTML(deckArtifact, 'deck')
    expect(html).not.toContain('--color-primary')
    expect(html).toContain('BrandOS Deck')
  })
})
