/**
 * @brandos/artifact-engine-layer — tests/eval-compare.unit.test.ts
 *
 * Unit tests for eval/compare.ts utilities.
 *
 * Tests: hashArtifact, compareArtifacts, assertArtifactFields.
 * No external dependencies needed — all functions operate on plain objects.
 */

import {
  hashArtifact,
  compareArtifacts,
  assertArtifactFields,
} from '../eval/compare'
import type { CarouselArtifact, DeckArtifact, ReportArtifact } from '@brandos/contracts'

// ─── Mock artifact factories ───────────────────────────────────────────────────

function makeCarousel(overrides: Partial<CarouselArtifact> = {}): CarouselArtifact {
  return {
    $schema:       'artifact-json@2.0',
    artifact_type: 'carousel',
    title:         'Test Carousel',
    semantic_theme: {
      primaryColor:    '#111111',
      accentColor:     '#eeeeee',
      bgColor:         '#ffffff',
      fontTitle:       'Inter',
      fontBody:        'Inter',
      visual_preset:   'clean',
      voice_archetype: 'professional',
    },
    slides: [
      { slide: 1, headline: 'Hook',    role: 'hook',    layout_hint: 'full-bleed',     bullets: ['Bullet A'] },
      { slide: 2, headline: 'Insight', role: 'insight', layout_hint: 'bullets-primary', bullets: ['Bullet B', 'Bullet C'] },
      { slide: 3, headline: 'CTA',     role: 'cta',     layout_hint: 'data-callout',    bullets: ['CTA bullet'] },
    ],
    ...overrides,
  } as CarouselArtifact
}

function makeDeck(overrides: Partial<DeckArtifact> = {}): DeckArtifact {
  return {
    $schema:       'artifact-json@2.0',
    artifact_type: 'deck',
    title:         'Test Deck',
    semantic_theme: {
      primaryColor:    '#222222',
      accentColor:     '#dddddd',
      bgColor:         '#ffffff',
      fontTitle:       'Roboto',
      fontBody:        'Roboto',
      visual_preset:   'bold',
      voice_archetype: 'authoritative',
    },
    slides: [
      { type: 'title',   title: 'Title Slide',   body: [] },
      { type: 'content', title: 'Content Slide', body: ['Point 1'] },
    ],
    ...overrides,
  } as DeckArtifact
}

function makeReport(overrides: Partial<ReportArtifact> = {}): ReportArtifact {
  return {
    $schema:       'artifact-json@2.0',
    artifact_type: 'report',
    title:         'Test Report',
    semantic_theme: {
      primaryColor:    '#333333',
      accentColor:     '#cccccc',
      bgColor:         '#fafafa',
      fontTitle:       'Georgia',
      fontBody:        'Georgia',
      visual_preset:   'editorial',
      voice_archetype: 'analytical',
    },
    sections: [
      { id: 'intro',   heading: 'Introduction', content: 'Intro text.' },
      { id: 'body-1',  heading: 'Section One',  content: 'Body text.' },
    ],
    ...overrides,
  } as ReportArtifact
}

// ─── hashArtifact ─────────────────────────────────────────────────────────────

describe('hashArtifact()', () => {
  it('returns the same hash for identical carousel artifacts', () => {
    const a = makeCarousel()
    const b = makeCarousel()
    expect(hashArtifact(a)).toBe(hashArtifact(b))
  })

  it('returns different hashes for carousels with different slide counts', () => {
    const a = makeCarousel()
    const b = makeCarousel({
      slides: [...makeCarousel().slides, { slide: 4, headline: 'Extra', role: 'insight', layout_hint: 'bullets-primary', bullets: ['Extra'] }],
    })
    expect(hashArtifact(a)).not.toBe(hashArtifact(b))
  })

  it('returns different hashes for carousels with different slide roles', () => {
    const a = makeCarousel()
    const b = makeCarousel({
      slides: [
        { slide: 1, headline: 'Problem', role: 'problem', layout_hint: 'full-bleed',     bullets: ['Bullet A'] }, // changed role
        { slide: 2, headline: 'Insight', role: 'insight', layout_hint: 'bullets-primary', bullets: ['Bullet B', 'Bullet C'] },
        { slide: 3, headline: 'CTA',     role: 'cta',     layout_hint: 'data-callout',    bullets: ['CTA bullet'] },
      ],
    })
    expect(hashArtifact(a)).not.toBe(hashArtifact(b))
  })

  it('returns different hashes for different artifact types', () => {
    const carousel = makeCarousel()
    const deck     = makeDeck()
    expect(hashArtifact(carousel)).not.toBe(hashArtifact(deck))
  })

  it('returns a non-empty string', () => {
    const hash = hashArtifact(makeCarousel())
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(0)
  })

  it('is deterministic across multiple calls', () => {
    const artifact = makeCarousel()
    const hashes = Array.from({ length: 10 }, () => hashArtifact(artifact))
    expect(new Set(hashes).size).toBe(1)
  })

  it('works for deck artifacts', () => {
    const a = makeDeck()
    const b = makeDeck()
    expect(hashArtifact(a)).toBe(hashArtifact(b))
  })

  it('works for report artifacts', () => {
    const a = makeReport()
    const b = makeReport()
    expect(hashArtifact(a)).toBe(hashArtifact(b))
  })
})

// ─── compareArtifacts ─────────────────────────────────────────────────────────

describe('compareArtifacts()', () => {
  it('returns identical=true for two structurally equal carousel artifacts', () => {
    const diff = compareArtifacts(makeCarousel(), makeCarousel())
    expect(diff.identical).toBe(true)
    expect(diff.differences).toHaveLength(0)
  })

  it('detects title differences', () => {
    const a = makeCarousel({ title: 'Alpha' })
    const b = makeCarousel({ title: 'Beta' })
    const diff = compareArtifacts(a, b)
    expect(diff.identical).toBe(false)
    expect(diff.differences.some(d => d.includes('title'))).toBe(true)
  })

  it('detects artifact_type mismatch and returns early', () => {
    const carousel = makeCarousel()
    const deck     = makeDeck()
    const diff     = compareArtifacts(carousel, deck)
    expect(diff.identical).toBe(false)
    expect(diff.differences.some(d => d.includes('artifact_type'))).toBe(true)
  })

  it('detects slide count differences', () => {
    const a = makeCarousel()
    const b = makeCarousel({
      slides: [...makeCarousel().slides, { slide: 4, headline: 'Extra', role: 'insight', layout_hint: 'bullets-primary', bullets: ['X'] }],
    })
    const diff = compareArtifacts(a, b)
    expect(diff.identical).toBe(false)
    expect(diff.differences.some(d => d.includes('slideCount'))).toBe(true)
  })

  it('detects slide role differences', () => {
    const a = makeCarousel()
    const b = makeCarousel({
      slides: [
        { slide: 1, headline: 'Problem', role: 'problem', layout_hint: 'full-bleed',     bullets: ['Bullet A'] }, // role changed
        { slide: 2, headline: 'Insight', role: 'insight', layout_hint: 'bullets-primary', bullets: ['Bullet B', 'Bullet C'] },
        { slide: 3, headline: 'CTA',     role: 'cta',     layout_hint: 'data-callout',    bullets: ['CTA bullet'] },
      ],
    })
    const diff = compareArtifacts(a, b)
    expect(diff.identical).toBe(false)
    expect(diff.differences.some(d => d.includes('role'))).toBe(true)
  })

  it('detects semantic_theme differences', () => {
    const a = makeCarousel()
    const b = makeCarousel({
      semantic_theme: { ...makeCarousel().semantic_theme, primaryColor: '#ff0000' },
    })
    const diff = compareArtifacts(a, b)
    expect(diff.identical).toBe(false)
    expect(diff.differences.some(d => d.includes('primaryColor'))).toBe(true)
  })

  it('works for deck artifacts', () => {
    const diff = compareArtifacts(makeDeck(), makeDeck())
    expect(diff.identical).toBe(true)
  })

  it('detects deck slide type differences', () => {
    const a = makeDeck()
    const b = makeDeck({
      slides: [
        { type: 'content', title: 'Not a title slide', body: [] }, // type changed
        { type: 'content', title: 'Content Slide',     body: ['Point 1'] },
      ],
    })
    const diff = compareArtifacts(a, b)
    expect(diff.identical).toBe(false)
    expect(diff.differences.some(d => d.includes('slide[0].type'))).toBe(true)
  })

  it('works for report artifacts', () => {
    const diff = compareArtifacts(makeReport(), makeReport())
    expect(diff.identical).toBe(true)
  })

  it('detects report section heading differences', () => {
    const a = makeReport()
    const b = makeReport({
      sections: [
        { id: 'intro',  heading: 'Changed Heading', content: 'Intro text.' },
        { id: 'body-1', heading: 'Section One',     content: 'Body text.'  },
      ],
    })
    const diff = compareArtifacts(a, b)
    expect(diff.identical).toBe(false)
    expect(diff.differences.some(d => d.includes('section[0].heading'))).toBe(true)
  })
})

// ─── assertArtifactFields ─────────────────────────────────────────────────────

describe('assertArtifactFields()', () => {
  it('returns empty array when all required fields are present', () => {
    const data = { $schema: 'artifact-json@2.0', artifact_type: 'carousel', title: 'Test' }
    const errors = assertArtifactFields(data, ['$schema', 'artifact_type', 'title'])
    expect(errors).toHaveLength(0)
  })

  it('returns errors for missing required fields', () => {
    const data = { title: 'Test' }
    const errors = assertArtifactFields(data, ['$schema', 'artifact_type', 'title'])
    expect(errors).toContain('Missing required field: "$schema"')
    expect(errors).toContain('Missing required field: "artifact_type"')
    expect(errors).not.toContain('Missing required field: "title"')
  })

  it('returns a single error when data is null', () => {
    const errors = assertArtifactFields(null, ['$schema'])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/non-null object/)
  })

  it('returns a single error when data is a string', () => {
    const errors = assertArtifactFields('not-an-object', ['$schema'])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/non-null object/)
  })

  it('returns empty array when requiredFields is empty', () => {
    const errors = assertArtifactFields({ any: 'thing' }, [])
    expect(errors).toHaveLength(0)
  })
})


