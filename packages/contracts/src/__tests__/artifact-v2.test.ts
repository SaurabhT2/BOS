/**
 * @brandos/contracts — artifact-v2.test.ts
 *
 * Tests for ArtifactV2 type guards, the upcastCarouselBlueprint migration
 * helper, and CAROUSEL_ROLES / CAROUSEL_SCHEMA_INSTRUCTION invariants.
 *
 * These tests verify the runtime logic that lives in this package —
 * the type guards and the upcast function. All other exports are
 * pure type-level and tested via TypeScript compilation.
 */

import { describe, it, expect } from 'vitest'
import {
  isCarouselArtifact,
  isDeckArtifact,
  isReportArtifact,
  upcastCarouselBlueprint,
  CAROUSEL_ROLES,
  CAROUSEL_SCHEMA_INSTRUCTION,
  type ArtifactV2,
  type CarouselArtifact,
  type DeckArtifact,
  type ReportArtifact,
  type CarouselBlueprint,
} from '../artifact-v2'

// ─────────────────────────────────────────────────────────────────────────────
// Minimal fixture builders
// ─────────────────────────────────────────────────────────────────────────────

function makeCarousel(): CarouselArtifact {
  return {
    $schema: 'artifact-json@2.0',
    id: 'test-carousel-1',
    artifact_type: 'carousel',
    title: 'Test Carousel',
    summary: 'A test carousel artifact',
    hook: 'This is the hook',
    cta: 'Follow for more insights',
    semantic_theme: { visual_preset: 'executive-dark' },
    audience: { label: 'Founders', sophistication: 'expert' },
    narrative_arc: {
      structure: 'problem-solution',
      hook_statement: 'The hook',
      thesis: 'The thesis',
      resolution: 'The resolution',
      pacing: 'balanced',
    },
    richness_metrics: {
      overall_score: 75,
      density_score: 70,
      evidence_score: 65,
      persuasion_score: 80,
      cta_quality_score: 85,
      narrative_coherence_score: 78,
      hook_strength_score: 82,
      audience_alignment_score: 76,
      total_content_words: 350,
      avg_words_per_unit: 50,
    },
    generation_trace: {
      generated_at: new Date().toISOString(),
      ocl_strategy: 'json-direct',
      governance_outcome: 'passed',
      repair_attempts: 0,
      input_type: 'json',
    },
    export_metadata: { available_formats: ['json', 'html', 'pptx'] },
    created_at: new Date().toISOString(),
    carousel_meta: { palette: ['#111111', '#ffffff'], slide_count: 7 },
    slides: [
      { slide: 1, role: 'hook', headline: 'Hook Slide', body: 'Body copy.' },
      { slide: 7, role: 'cta', headline: 'Call to Action', body: 'Do the thing.' },
    ],
  }
}

function makeDeck(): DeckArtifact {
  return {
    $schema: 'artifact-json@2.0',
    id: 'test-deck-1',
    artifact_type: 'deck',
    title: 'Test Deck',
    summary: 'A test deck',
    hook: 'Hook',
    cta: 'CTA',
    semantic_theme: {},
    audience: { label: 'Investors', sophistication: 'executive' },
    narrative_arc: {
      structure: 'data-driven',
      hook_statement: 'Hook',
      thesis: 'Thesis',
      resolution: 'Resolution',
      pacing: 'tight',
    },
    richness_metrics: {
      overall_score: 70, density_score: 68, evidence_score: 72,
      persuasion_score: 75, cta_quality_score: 80, narrative_coherence_score: 73,
      hook_strength_score: 71, audience_alignment_score: 74,
      total_content_words: 1200, avg_words_per_unit: 150,
    },
    generation_trace: {
      generated_at: new Date().toISOString(),
      ocl_strategy: 'json-direct',
      governance_outcome: 'passed',
      repair_attempts: 0,
      input_type: 'json',
    },
    export_metadata: { available_formats: ['pptx', 'pdf'] },
    created_at: new Date().toISOString(),
    deck_meta: { section_count: 4, slide_count: 12 },
    slides: [{ slide: 1, type: 'cover', title: 'Cover Slide' }],
  }
}

function makeReport(): ReportArtifact {
  return {
    $schema: 'artifact-json@2.0',
    id: 'test-report-1',
    artifact_type: 'report',
    title: 'Test Report',
    summary: 'A test report',
    hook: 'Hook',
    cta: 'CTA',
    semantic_theme: {},
    audience: { label: 'Analysts', sophistication: 'practitioner' },
    narrative_arc: {
      structure: 'data-driven',
      hook_statement: 'Hook',
      thesis: 'Thesis',
      resolution: 'Resolution',
      pacing: 'expansive',
    },
    richness_metrics: {
      overall_score: 80, density_score: 82, evidence_score: 85,
      persuasion_score: 70, cta_quality_score: 65, narrative_coherence_score: 79,
      hook_strength_score: 68, audience_alignment_score: 77,
      total_content_words: 3000, avg_words_per_unit: 500,
    },
    generation_trace: {
      generated_at: new Date().toISOString(),
      ocl_strategy: 'json-direct',
      governance_outcome: 'passed',
      repair_attempts: 0,
      input_type: 'json',
    },
    export_metadata: { available_formats: ['pdf', 'html'] },
    created_at: new Date().toISOString(),
    report_meta: { section_count: 6, word_count: 3000 },
    sections: [{ id: 's1', heading: 'Introduction', body: 'Intro body.' }],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Type guards
// ─────────────────────────────────────────────────────────────────────────────

describe('isCarouselArtifact', () => {
  it('returns true for a carousel artifact', () => {
    expect(isCarouselArtifact(makeCarousel())).toBe(true)
  })

  it('returns false for a deck', () => {
    expect(isCarouselArtifact(makeDeck() as ArtifactV2)).toBe(false)
  })

  it('returns false for a report', () => {
    expect(isCarouselArtifact(makeReport() as ArtifactV2)).toBe(false)
  })
})

describe('isDeckArtifact', () => {
  it('returns true for a deck artifact', () => {
    expect(isDeckArtifact(makeDeck())).toBe(true)
  })

  it('returns false for a carousel', () => {
    expect(isDeckArtifact(makeCarousel() as ArtifactV2)).toBe(false)
  })

  it('returns false for a report', () => {
    expect(isDeckArtifact(makeReport() as ArtifactV2)).toBe(false)
  })
})

describe('isReportArtifact', () => {
  it('returns true for a report artifact', () => {
    expect(isReportArtifact(makeReport())).toBe(true)
  })

  it('returns false for a carousel', () => {
    expect(isReportArtifact(makeCarousel() as ArtifactV2)).toBe(false)
  })

  it('returns false for a deck', () => {
    expect(isReportArtifact(makeDeck() as ArtifactV2)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// upcastCarouselBlueprint
// ─────────────────────────────────────────────────────────────────────────────

describe('upcastCarouselBlueprint', () => {
  const legacyBlueprintWithSubtext: CarouselBlueprint = {
    slides: [
      { slide: 1, role: 'hook', headline: 'Hook Headline', subtext: 'Subtext copy', visual_direction: 'dark background' },
      { slide: 2, role: 'problem', headline: 'Problem Slide' },
      { slide: 3, role: 'cta', headline: 'Join the movement' },
    ],
    carousel_meta: {
      palette: ['#333333', '#eeeeee'],
      font_style: 'modern',
    },
  }

  const legacyBlueprintMinimal: CarouselBlueprint = {
    slides: [
      { slide: 1, role: 'hook', headline: 'Minimal Hook' },
      { slide: 2, role: 'cta', headline: 'Minimal CTA' },
    ],
    carousel_meta: { palette: [] },
  }

  it('produces a valid CarouselArtifact', () => {
    const result = upcastCarouselBlueprint(legacyBlueprintWithSubtext, 'Test Topic')
    expect(isCarouselArtifact(result)).toBe(true)
  })

  it('sets $schema to artifact-json@2.0', () => {
    const result = upcastCarouselBlueprint(legacyBlueprintWithSubtext, 'Test Topic')
    expect(result.$schema).toBe('artifact-json@2.0')
  })

  it('sets artifact_type to carousel', () => {
    const result = upcastCarouselBlueprint(legacyBlueprintWithSubtext, 'Test Topic')
    expect(result.artifact_type).toBe('carousel')
  })

  it('uses the topic as title and summary', () => {
    const result = upcastCarouselBlueprint(legacyBlueprintWithSubtext, 'My Topic')
    expect(result.title).toBe('My Topic')
    expect(result.summary).toBe('My Topic')
  })

  it('maps slide count correctly', () => {
    const result = upcastCarouselBlueprint(legacyBlueprintWithSubtext, 'Topic')
    expect(result.carousel_meta.slide_count).toBe(3)
    expect(result.slides.length).toBe(3)
  })

  it('maps subtext → body field', () => {
    const result = upcastCarouselBlueprint(legacyBlueprintWithSubtext, 'Topic')
    expect(result.slides[0].body).toBe('Subtext copy')
  })

  it('maps visual_direction field', () => {
    const result = upcastCarouselBlueprint(legacyBlueprintWithSubtext, 'Topic')
    expect(result.slides[0].visual_direction).toBe('dark background')
  })

  it('does not set body when subtext is absent', () => {
    const result = upcastCarouselBlueprint(legacyBlueprintWithSubtext, 'Topic')
    // slide[1] has no subtext
    expect(result.slides[1].body).toBeUndefined()
  })

  it('sets generation_trace.ocl_strategy to legacy-upcast', () => {
    const result = upcastCarouselBlueprint(legacyBlueprintWithSubtext, 'Topic')
    expect(result.generation_trace.ocl_strategy).toBe('legacy-upcast')
  })

  it('sets governance_outcome to bypassed (legacy paths skip governance)', () => {
    const result = upcastCarouselBlueprint(legacyBlueprintWithSubtext, 'Topic')
    expect(result.generation_trace.governance_outcome).toBe('bypassed')
  })

  it('sets hook from first slide headline', () => {
    const result = upcastCarouselBlueprint(legacyBlueprintWithSubtext, 'Topic')
    expect(result.hook).toBe('Hook Headline')
  })

  it('sets cta from the cta-role slide headline', () => {
    const result = upcastCarouselBlueprint(legacyBlueprintWithSubtext, 'Topic')
    expect(result.cta).toBe('Join the movement')
  })

  it('handles empty carousel_meta.font_style gracefully', () => {
    const result = upcastCarouselBlueprint(legacyBlueprintMinimal, 'Topic')
    // font_style should be absent (not set to undefined explicitly)
    expect('font_style' in result.carousel_meta).toBe(false)
  })

  it('preserves the palette', () => {
    const result = upcastCarouselBlueprint(legacyBlueprintWithSubtext, 'Topic')
    expect(result.carousel_meta.palette).toEqual(['#333333', '#eeeeee'])
  })

  it('sets low richness scores (legacy content has no scoring data)', () => {
    const result = upcastCarouselBlueprint(legacyBlueprintMinimal, 'Topic')
    expect(result.richness_metrics.overall_score).toBeLessThanOrEqual(50)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CAROUSEL_ROLES
// ─────────────────────────────────────────────────────────────────────────────

describe('CAROUSEL_ROLES', () => {
  it('includes hook and cta (required roles)', () => {
    expect(CAROUSEL_ROLES).toContain('hook')
    expect(CAROUSEL_ROLES).toContain('cta')
  })

  it('has no duplicate values', () => {
    expect(new Set(CAROUSEL_ROLES).size).toBe(CAROUSEL_ROLES.length)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CAROUSEL_SCHEMA_INSTRUCTION
// ─────────────────────────────────────────────────────────────────────────────

describe('CAROUSEL_SCHEMA_INSTRUCTION', () => {
  it('is a non-empty string', () => {
    expect(typeof CAROUSEL_SCHEMA_INSTRUCTION).toBe('string')
    expect(CAROUSEL_SCHEMA_INSTRUCTION.length).toBeGreaterThan(100)
  })

  it('contains the required JSON shape keys', () => {
    expect(CAROUSEL_SCHEMA_INSTRUCTION).toContain('"title"')
    expect(CAROUSEL_SCHEMA_INSTRUCTION).toContain('"hook"')
    expect(CAROUSEL_SCHEMA_INSTRUCTION).toContain('"cta"')
    expect(CAROUSEL_SCHEMA_INSTRUCTION).toContain('"slides"')
    expect(CAROUSEL_SCHEMA_INSTRUCTION).toContain('"role"')
    expect(CAROUSEL_SCHEMA_INSTRUCTION).toContain('"headline"')
  })

  it('specifies min/max slide count constraints', () => {
    expect(CAROUSEL_SCHEMA_INSTRUCTION).toContain('6 slides')
    expect(CAROUSEL_SCHEMA_INSTRUCTION).toContain('10 slides')
  })

  it('does not instruct the LLM to include $schema (prevents validator false positives)', () => {
    // The instruction explicitly says: "Do NOT include $schema, metadata, or any wrapper object"
    // This prevents the LLM from including $schema in its output, which would then
    // be duplicated when the OCL compiler adds the real $schema field.
    expect(CAROUSEL_SCHEMA_INSTRUCTION).toContain('Do NOT include $schema')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases for upcastCarouselBlueprint — coverage for lines 440-465
// ─────────────────────────────────────────────────────────────────────────────

describe('upcastCarouselBlueprint — edge cases', () => {
  it('handles empty slides array gracefully (hook defaults to topic)', () => {
    const blueprint: CarouselBlueprint = {
      slides: [],
      carousel_meta: { palette: [] },
    }
    const result = upcastCarouselBlueprint(blueprint, 'Empty Topic')
    expect(result.hook).toBe('Empty Topic') // hook defaults to topic when no slides
    expect(result.cta).toBe('') // cta defaults to empty string when no cta-role slide
  })

  it('handles blueprint with no cta-role slide', () => {
    const blueprint: CarouselBlueprint = {
      slides: [
        { slide: 1, role: 'hook', headline: 'Hook headline' },
        { slide: 2, role: 'problem', headline: 'Problem slide' },
      ],
      carousel_meta: { palette: ['#000'] },
    }
    const result = upcastCarouselBlueprint(blueprint, 'No CTA')
    expect(result.cta).toBe('') // no cta-role slide → empty string
    expect(result.hook).toBe('Hook headline')
  })

  it('total_content_words is sum of headline word counts', () => {
    const blueprint: CarouselBlueprint = {
      slides: [
        { slide: 1, role: 'hook', headline: 'One two three' },    // 3 words
        { slide: 2, role: 'cta', headline: 'Four five' },         // 2 words
      ],
      carousel_meta: { palette: [] },
    }
    const result = upcastCarouselBlueprint(blueprint, 'Word Count Test')
    expect(result.richness_metrics.total_content_words).toBe(5)
  })

  it('narrative_arc.resolution uses cta-role headline', () => {
    const blueprint: CarouselBlueprint = {
      slides: [
        { slide: 1, role: 'hook', headline: 'The Hook' },
        { slide: 5, role: 'cta', headline: 'Join now' },
      ],
      carousel_meta: { palette: [] },
    }
    const result = upcastCarouselBlueprint(blueprint, 'Arc Topic')
    expect(result.narrative_arc.resolution).toBe('Join now')
    expect(result.narrative_arc.hook_statement).toBe('The Hook')
  })
})

  it('handles slides with no headline (null-safe word count)', () => {
    const blueprint: CarouselBlueprint = {
      slides: [
        { slide: 1, role: 'hook' }, // no headline
        { slide: 2, role: 'cta', headline: 'Follow me' },
      ],
      carousel_meta: { palette: [] },
    }
    const result = upcastCarouselBlueprint(blueprint, 'No Headline Test')
    // slide 1 has no headline → contributes 0 words; slide 2 → 2 words
    expect(result.richness_metrics.total_content_words).toBe(2)
  })


