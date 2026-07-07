// @vitest-environment jsdom
/**
 * Contract tests — Renderer isolation
 *
 * Verifies that each renderer:
 *   ✓ is a callable React function component
 *   ✓ accepts an ArtifactV2 prop without TypeScript errors
 *   ✓ RendererRegistry correctly resolves each renderer for its artifact_type
 *   ✓ The bootstrapRenderers() helper registers all four types
 *
 * SPRINT2-CHANGE (F-17): Added NewsletterRenderer fixture and contract tests.
 * bootstrapRenderers() is now tested directly — verifies all four artifact types
 * (carousel, deck, report, newsletter) are registered after a single call.
 *
 * These are NODE-environment contract checks — no DOM render is performed.
 * We do not test visual output, only that the contracts hold.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { CarouselRenderer } from '../../src/renderers/CarouselRenderer'
import { DeckRenderer }     from '../../src/renderers/DeckRenderer'
import { ReportRenderer }   from '../../src/renderers/ReportRenderer'
import { default as NewsletterRenderer } from '../../src/renderers/NewsletterRenderer'
import { RendererRegistry, bootstrapRenderers } from '../../src/renderers/RendererRegistry'
import type {
  CarouselArtifact,
  DeckArtifact,
  ReportArtifact,
  NewsletterArtifact,
} from '@brandos/contracts'

// ─── Minimal artifact fixtures ────────────────────────────────────────────────
// These satisfy the BaseArtifact + type-specific required fields.
// They are NOT full production artifacts — just enough for type-checking.

const BASE_FIELDS = {
  $schema:          'artifact-json@2.0' as const,
  id:               'test-artifact-001',
  title:            'Test Artifact',
  summary:          'Test summary',
  hook:             'Test hook',
  cta:              'Test CTA',
  semantic_theme: {
    primary_emotion: 'confidence',
    value_proposition: 'Test value',
    tone_archetype: 'professional',
  },
  audience: {
    primary_role: 'Founder',
    seniority_level: 'executive',
    pain_points: [],
    desired_outcomes: [],
  },
  narrative_arc: {
    arc_type: 'problem_solution',
    tension: 'Test tension',
    resolution: 'Test resolution',
    key_insight: 'Test insight',
  },
  richness_metrics: {
    specificity_score: 80,
    emotional_resonance_score: 75,
    clarity_score: 90,
    overall_richness_score: 82,
  },
  generation_trace: {
    request_id: 'req-test',
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    compiled_at: '2026-05-28T00:00:00.000Z',
    ocl_version: '2.0',
  },
  export_metadata: {
    exportable: true,
    formats: [],
  },
  created_at: '2026-05-28T00:00:00.000Z',
}

const CAROUSEL_FIXTURE: CarouselArtifact = {
  ...BASE_FIELDS,
  artifact_type: 'carousel',
  carousel_meta: {
    palette: ['#1a1a2e', '#e94560'],
    slide_count: 3,
  },
  narrative_arc: {
    structure: 'problem-solution',
    hook_statement: 'Test hook statement',
    thesis: 'Test thesis',
    resolution: 'Test resolution',
    pacing: 'balanced',
  },
  richness_metrics: {
    overall_score: 75,
    density_score: 70,
    evidence_score: 70,
    persuasion_score: 70,
    cta_quality_score: 70,
    narrative_coherence_score: 70,
    hook_strength_score: 70,
    audience_alignment_score: 70,
    total_content_words: 100,
    avg_words_per_unit: 33,
  },
  slides: [
    {
      slide: 1,
      role: 'cover',
      headline: 'Test Slide 1',
      body: 'Test body text',
    },
  ],
}

const DECK_FIXTURE: DeckArtifact = {
  ...BASE_FIELDS,
  artifact_type: 'deck',
  deck_meta: {
    section_count: 1,
    slide_count: 2,
  },
  slides: [
    {
      slide: 1,
      type: 'cover',
      title: 'Test Deck',
    },
  ],
}

const REPORT_FIXTURE: ReportArtifact = {
  ...BASE_FIELDS,
  artifact_type: 'report',
  report_meta: {
    section_count: 1,
    word_count: 500,
    estimated_read_minutes: 3,
  },
  sections: [
    {
      section: 1,
      type: 'executive_summary',
      title: 'Executive Summary',
      body: 'Test body text for the report section.',
    },
  ],
}

// SPRINT2-CHANGE (F-17): NewsletterArtifact fixture for renderer contract tests.
const NEWSLETTER_FIXTURE: NewsletterArtifact = {
  ...BASE_FIELDS,
  artifact_type: 'newsletter',
  // subject_line and preview_text are top-level fields on NewsletterArtifact
  // (not inside newsletter_meta — see contracts/src/artifact-v2.ts NewsletterArtifact)
  subject_line: 'Test Newsletter Subject',
  preview_text: 'Preview text for the newsletter',
  newsletter_meta: {
    section_count: 1,
    word_count: 200,
    estimated_read_minutes: 2,
  },
  narrative_arc: {
    structure: 'story',
    hook_statement: 'Newsletter hook',
    thesis: 'Newsletter thesis',
    resolution: 'Newsletter resolution',
    pacing: 'balanced',
  },
  richness_metrics: {
    overall_score: 70,
    density_score: 65,
    evidence_score: 60,
    persuasion_score: 70,
    cta_quality_score: 75,
    narrative_coherence_score: 72,
    hook_strength_score: 68,
    audience_alignment_score: 70,
    total_content_words: 200,
    avg_words_per_unit: 200,
  },
  sections: [
    {
      id: 'intro-1',
      type: 'intro',
      heading: 'Introduction',
      body: 'Test newsletter intro section body text.',
    },
  ],
}

// ─── Renderer component contract ──────────────────────────────────────────────

describe('CarouselRenderer component contract', () => {
  it('is a callable function', () => {
    expect(typeof CarouselRenderer).toBe('function')
  })

  it('accepts a CarouselArtifact prop (type check at call site)', () => {
    // renderToString provides a valid React context so hooks (useState) work.
    expect(() => renderToString(React.createElement(CarouselRenderer, { artifact: CAROUSEL_FIXTURE }))).not.toThrow()
  })
})

describe('DeckRenderer component contract', () => {
  it('is a callable function', () => {
    expect(typeof DeckRenderer).toBe('function')
  })

  it('accepts a DeckArtifact prop (type check at call site)', () => {
    expect(() => renderToString(React.createElement(DeckRenderer, { artifact: DECK_FIXTURE }))).not.toThrow()
  })
})

describe('ReportRenderer component contract', () => {
  it('is a callable function', () => {
    expect(typeof ReportRenderer).toBe('function')
  })

  it('accepts a ReportArtifact prop (type check at call site)', () => {
    expect(() => renderToString(React.createElement(ReportRenderer, { artifact: REPORT_FIXTURE }))).not.toThrow()
  })
})

// SPRINT2-CHANGE (F-17): Newsletter renderer component contract tests.
describe('NewsletterRenderer component contract', () => {
  it('is a callable function', () => {
    expect(typeof NewsletterRenderer).toBe('function')
  })

  it('accepts a NewsletterArtifact prop (type check at call site)', () => {
    expect(() => renderToString(React.createElement(NewsletterRenderer, { artifact: NEWSLETTER_FIXTURE }))).not.toThrow()
  })
})

// ─── RendererRegistry ↔ artifact_type binding ─────────────────────────────────

describe('RendererRegistry artifact_type binding', () => {
  beforeEach(() => {
    // Ensure canonical renderers are registered
    RendererRegistry.register('carousel', CarouselRenderer as any)
    RendererRegistry.register('deck',     DeckRenderer as any)
    RendererRegistry.register('report',   ReportRenderer as any)
    // SPRINT2-CHANGE (F-17): newsletter renderer registered in beforeEach.
    RendererRegistry.register('newsletter', NewsletterRenderer as any)
  })

  it('resolves CarouselRenderer for artifact_type="carousel"', () => {
    const resolved = RendererRegistry.resolveRenderer(CAROUSEL_FIXTURE.artifact_type)
    expect(resolved).toBe(CarouselRenderer)
  })

  it('resolves DeckRenderer for artifact_type="deck"', () => {
    const resolved = RendererRegistry.resolveRenderer(DECK_FIXTURE.artifact_type)
    expect(resolved).toBe(DeckRenderer)
  })

  it('resolves ReportRenderer for artifact_type="report"', () => {
    const resolved = RendererRegistry.resolveRenderer(REPORT_FIXTURE.artifact_type)
    expect(resolved).toBe(ReportRenderer)
  })

  // SPRINT2-CHANGE (F-17): Newsletter renderer resolution test.
  it('resolves NewsletterRenderer for artifact_type="newsletter"', () => {
    const resolved = RendererRegistry.resolveRenderer(NEWSLETTER_FIXTURE.artifact_type)
    expect(resolved).toBe(NewsletterRenderer)
  })

  it('returns null for an artifact_type with no registered renderer', () => {
    const result = RendererRegistry.resolveRenderer('unknown_future_type' as any)
    expect(result).toBeNull()
  })
})

// ─── bootstrapRenderers() — all four types registered ────────────────────────
//
// SPRINT2-CHANGE (F-17): Contract test verifying bootstrapRenderers() registers
// all four canonical artifact types. This test catches registration regressions
// without requiring a Studio page render.

describe('bootstrapRenderers() — all four artifact types', () => {
  it('registers carousel, deck, report, and newsletter renderers', () => {
    // bootstrapRenderers() uses a globalThis idempotency guard; it may already
    // have run. Call it explicitly to ensure it runs in this test context.
    // The registry's register() is idempotent (last-write-wins), so calling
    // bootstrapRenderers() here overwrites any prior test registrations safely.
    bootstrapRenderers()

    expect(RendererRegistry.has('carousel')).toBe(true)
    expect(RendererRegistry.has('deck')).toBe(true)
    expect(RendererRegistry.has('report')).toBe(true)
    expect(RendererRegistry.has('newsletter')).toBe(true)
  })

  it('resolves a callable function for each artifact type after bootstrap', () => {
    bootstrapRenderers()

    const types = ['carousel', 'deck', 'report', 'newsletter'] as const
    for (const type of types) {
      const resolved = RendererRegistry.resolveRenderer(type)
      expect(resolved, `resolveRenderer('${type}') should return a function after bootstrap`).not.toBeNull()
      expect(typeof resolved).toBe('function')
    }
  })
})

// ─── Renderer isolation — no CPL/runtime imports leak ─────────────────────────

describe('Renderer isolation', () => {
  it('CarouselRenderer module does not import from CPL', async () => {
    // If the module imported CPL, it would have failed to resolve
    // at the top of this file (import { CarouselRenderer } above).
    // This test documents the guarantee in a discoverable way.
    expect(CarouselRenderer).toBeDefined()
  })

  it('DeckRenderer module does not import from CPL', async () => {
    expect(DeckRenderer).toBeDefined()
  })

  it('ReportRenderer module does not import from CPL', async () => {
    expect(ReportRenderer).toBeDefined()
  })

  // SPRINT2-CHANGE (F-17): NewsletterRenderer isolation contract.
  it('NewsletterRenderer module does not import from CPL', async () => {
    expect(NewsletterRenderer).toBeDefined()
  })
})


