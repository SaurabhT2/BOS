/**
 * apps/web — __tests__/canva-field-renderer.test.ts
 *
 * Tests for Rendering V2 Phase 6: CanvaFieldRenderer
 * (lib/canva-field-renderer.ts). Covers only what is independently
 * verifiable in this sandbox — isCanvaFieldRendererAvailable() (pure config
 * check) and buildAutofillData() (pure mapping logic). submitAutofillJob()'s
 * actual network request/response cycle against Canva's live servers is
 * explicitly NOT covered here — see the module's own header for why (no
 * registered Connect app, no network path, and no real brand template to
 * validate field names against even if network access existed).
 */

import { describe, it, expect, afterEach } from 'vitest'
import type { CarouselArtifact } from '@brandos/contracts'
import { composeArtifact } from '@brandos/composition-layer'
import { isCanvaFieldRendererAvailable, buildAutofillData } from '../lib/canva-field-renderer'

const ORIGINAL = process.env.CANVA_BRAND_TEMPLATE_ID

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CANVA_BRAND_TEMPLATE_ID
  else process.env.CANVA_BRAND_TEMPLATE_ID = ORIGINAL
})

function makeCarouselArtifact(overrides?: Partial<CarouselArtifact>): CarouselArtifact {
  return {
    $schema: 'artifact-json@2.0',
    id: 'test-001',
    artifact_type: 'carousel',
    title: 'Test Carousel',
    summary: 'A test carousel',
    hook: 'hook',
    cta: 'cta',
    semantic_theme: {},
    audience: { sophistication: 'practitioner' },
    narrative_arc: {
      structure: 'problem-solution',
      hook_statement: 'hook',
      thesis: 'thesis',
      resolution: 'resolution',
      pacing: 'balanced',
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
    slides: [{ slide: 1, role: 'hook', headline: 'Test headline', body: 'Test body.', bullets: ['A', 'B'] }],
    ...overrides,
  }
}

describe('isCanvaFieldRendererAvailable', () => {
  it('is false when CANVA_BRAND_TEMPLATE_ID is unset', () => {
    delete process.env.CANVA_BRAND_TEMPLATE_ID
    expect(isCanvaFieldRendererAvailable()).toBe(false)
  })

  it('is true when CANVA_BRAND_TEMPLATE_ID is set to any non-empty value', () => {
    process.env.CANVA_BRAND_TEMPLATE_ID = 'DAF-example-template-id'
    expect(isCanvaFieldRendererAvailable()).toBe(true)
  })
})

describe('buildAutofillData', () => {
  it('maps each unit\'s heading/body/bullets into named data fields', () => {
    const doc = composeArtifact(makeCarouselArtifact())
    const data = buildAutofillData(doc)
    expect(data.unit_1_heading).toEqual({ type: 'text', text: 'Test headline' })
    expect(data.unit_1_body).toEqual({ type: 'text', text: 'Test body.' })
    expect(data.unit_1_bullets).toEqual({ type: 'text', text: 'A\nB' })
  })

  it('omits fields for blocks that are not present, rather than emitting empty text fields', () => {
    const doc = composeArtifact(makeCarouselArtifact({ slides: [{ slide: 1, role: 'hook', headline: 'Only a headline' }] }))
    const data = buildAutofillData(doc)
    expect(data.unit_1_heading).toBeDefined()
    expect(data.unit_1_body).toBeUndefined()
    expect(data.unit_1_bullets).toBeUndefined()
  })

  it('produces distinct field names for each unit, in order', () => {
    const doc = composeArtifact(
      makeCarouselArtifact({
        slides: [
          { slide: 1, role: 'hook', headline: 'First' },
          { slide: 2, role: 'cta', headline: 'Second' },
        ],
      })
    )
    const data = buildAutofillData(doc)
    expect(data.unit_1_heading?.text).toBe('First')
    expect(data.unit_2_heading?.text).toBe('Second')
  })
})
