/**
 * apps/web — __tests__/artifact-export-image.test.ts
 *
 * Tests for Rendering V2 Phase 9's image renderer
 * (lib/artifact-export-image.ts). Covers buildUnitHtml() — the per-unit
 * standalone HTML this module builds — which is fully testable via string
 * assertions without a browser. renderCarouselToImages()'s actual
 * page.screenshot() capture is NOT exercised here: same disclosed
 * Chromium-unavailability limitation as Phases 4/9's PDF/dispatch tests.
 */

import { describe, it, expect } from 'vitest'
import { buildUnitHtml } from '../lib/artifact-export-image'
import { composeArtifact } from '@brandos/composition-layer'
import type { CarouselArtifact } from '@brandos/contracts'

function makeCarouselArtifact(overrides?: Partial<CarouselArtifact>): CarouselArtifact {
  return {
    $schema: 'artifact-json@2.0',
    id: 'test-001',
    artifact_type: 'carousel',
    title: 'Test Carousel',
    summary: 'A test carousel',
    hook: 'hook',
    cta: 'cta',
    semantic_theme: { visual_preset: 'social' },
    audience: { sophistication: 'practitioner' },
    narrative_arc: {
      structure: 'problem-solution', hook_statement: 'hook', thesis: 'thesis',
      resolution: 'resolution', pacing: 'balanced',
    },
    richness_metrics: {
      overall_score: 80, density_score: 80, evidence_score: 80, persuasion_score: 80,
      cta_quality_score: 80, narrative_coherence_score: 80, hook_strength_score: 80,
      audience_alignment_score: 80, total_content_words: 100, avg_words_per_unit: 50,
    },
    generation_trace: {
      generated_at: '2026-01-01T00:00:00.000Z', ocl_strategy: 'direct',
      governance_outcome: 'passed', repair_attempts: 0, input_type: 'json',
    },
    export_metadata: { available_formats: [] },
    created_at: '2026-01-01T00:00:00.000Z',
    carousel_meta: { palette: [], slide_count: 1 },
    slides: [{ slide: 1, role: 'hook', headline: 'Test headline', body: 'Test body.', bullets: ['One', 'Two'] }],
    ...overrides,
  }
}

describe('buildUnitHtml', () => {
  it('produces a self-contained HTML document sized to the exact target canvas', () => {
    const doc = composeArtifact(makeCarouselArtifact())
    const html = buildUnitHtml(doc.units[0]!, doc.theme, 1080, 1080)
    expect(html).toContain('width: 1080px; height: 1080px;')
  })

  it('includes the unit\'s heading, body, and bullets', () => {
    const doc = composeArtifact(makeCarouselArtifact())
    const html = buildUnitHtml(doc.units[0]!, doc.theme, 1080, 1080)
    expect(html).toContain('Test headline')
    expect(html).toContain('Test body.')
    expect(html).toContain('One')
    expect(html).toContain('Two')
  })

  it('resolves the theme accent color into the CSS custom properties', () => {
    const doc = composeArtifact(makeCarouselArtifact({ semantic_theme: { visual_preset: 'social' } }))
    const html = buildUnitHtml(doc.units[0]!, doc.theme, 1080, 1080)
    expect(html).toContain('--color-accent:#ec4899') // 'social' preset accent
  })

  it('respects a custom (non-default) canvas size', () => {
    const doc = composeArtifact(makeCarouselArtifact())
    const html = buildUnitHtml(doc.units[0]!, doc.theme, 1080, 1350)
    expect(html).toContain('width: 1080px; height: 1350px;')
  })

  it('renders only ONE unit\'s content, not the whole document (no other-slide content leaks in)', () => {
    const doc = composeArtifact(
      makeCarouselArtifact({
        slides: [
          { slide: 1, role: 'hook', headline: 'First slide headline' },
          { slide: 2, role: 'cta', headline: 'Second slide headline' },
        ],
      })
    )
    const htmlForFirst = buildUnitHtml(doc.units[0]!, doc.theme, 1080, 1080)
    expect(htmlForFirst).toContain('First slide headline')
    expect(htmlForFirst).not.toContain('Second slide headline')
  })
})
