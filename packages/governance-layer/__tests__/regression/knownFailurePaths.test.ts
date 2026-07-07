/**
 * Regression tests — known failure paths and edge cases.
 * These tests protect against regressions in specific scenarios that
 * were found during forensic analysis or reported as issues.
 */

import { describe, it, expect, vi } from 'vitest'
import { evaluateGovernance } from '../../src/governanceEngine'
import { validateCarouselArtifact, runCarouselSemanticGovernance } from '../../src/carousel/validator'
import { validateDeckArtifact } from '../../src/deck/validator'
import { validateReportArtifact } from '../../src/report/validator'
import type { CarouselArtifact, DeckArtifact, ReportArtifact } from '@brandos/contracts'
import { CAROUSEL_GOVERNANCE_THRESHOLDS as CT } from '@brandos/governance-config'

// ─── REGRESSION: Empty string content ────────────────────────────────────────

describe('REGRESSION: evaluateGovernance with edge case inputs', () => {
  it('handles empty string without throwing', () => {
    expect(() => evaluateGovernance({ content: '', taskType: 'post' })).not.toThrow()
  })

  it('handles single character without throwing', () => {
    expect(() => evaluateGovernance({ content: 'x', taskType: 'post' })).not.toThrow()
  })

  it('handles very long content without throwing', () => {
    const longContent = 'This is a normal sentence with specific content. '.repeat(500)
    expect(() => evaluateGovernance({ content: longContent, taskType: 'post' })).not.toThrow()
  })

  it('handles content with only clichés (score does not go below 0)', () => {
    const allCliches = AI_CLICHES_SAMPLE.join(' ')
    const result = evaluateGovernance({ content: allCliches, taskType: 'post' })
    expect(result.score).toBeGreaterThanOrEqual(0)
  })

  it('handles newline-only content without throwing', () => {
    expect(() => evaluateGovernance({ content: '\n\n\n', taskType: 'post' })).not.toThrow()
  })

  it('handles content with unicode characters without throwing', () => {
    const unicode = 'Leadership requires 勇气. 勇気 is the first step. Never stop pursuing 목표.'
    expect(() => evaluateGovernance({ content: unicode, taskType: 'post' })).not.toThrow()
  })

  it('returns passed:boolean even for empty content', () => {
    const result = evaluateGovernance({ content: '', taskType: 'unknown' })
    expect(typeof result.passed).toBe('boolean')
  })
})

const AI_CLICHES_SAMPLE = ['dive into', 'game-changer', 'paradigm shift', 'synergy', 'thought leader', 'move the needle', 'low-hanging fruit', 'circle back']

// ─── REGRESSION: Carousel with malformed slides ───────────────────────────────

describe('REGRESSION: carousel validator with malformed slide data', () => {
  it('rejects carousel where slides is not an array', () => {
    const r = validateCarouselArtifact({ title: 'Test', slides: 'not an array' } as any)
    expect(r.valid).toBe(false)
  })

  it('rejects carousel where a slide has undefined headline', () => {
    const c = makeBase()
    c.slides[0].headline = undefined as any
    expect(validateCarouselArtifact(c).valid).toBe(false)
  })

  it('does not throw on carousel with null slides entries', () => {
    const c = makeBase()
    c.slides.push(null as any)
    expect(() => validateCarouselArtifact(c)).not.toThrow()
  })

  it('rejects carousel with undefined richness_metrics fields', () => {
    const c = makeBase()
    c.richness_metrics = { overall_score: undefined, total_content_words: undefined } as any
    expect(validateCarouselArtifact(c).valid).toBe(false)
  })
})

// ─── REGRESSION: Deck with missing slide type ─────────────────────────────────

describe('REGRESSION: deck validator edge cases', () => {
  it('rejects deck where slide type is undefined', () => {
    const d: DeckArtifact = {
      artifact_type: 'deck',
      title: 'Test Deck',
      slides: [
        { slide: 1, type: undefined as any, title: 'Slide one title' },
        { slide: 2, type: 'content', title: 'Content slide title' },
        { slide: 3, type: 'closing', title: 'Closing slide title' },
      ],
      richness_metrics: {
        overall_score: 50,
        total_content_words: 200,
        density_score: 50,
        evidence_score: 50,
        persuasion_score: 50,
        cta_quality_score: 40,
        narrative_coherence_score: 50,
        hook_strength_score: 50,
      },
    } as unknown as DeckArtifact
    const r = validateDeckArtifact(d)
    expect(r.valid).toBe(false)
  })

  it('rejects deck with null title in slide', () => {
    const d: DeckArtifact = {
      artifact_type: 'deck',
      title: 'Test',
      slides: [
        { slide: 1, type: 'cover', title: null as any },
        { slide: 2, type: 'content', title: 'Valid content title' },
        { slide: 3, type: 'closing', title: 'Valid closing title' },
      ],
      richness_metrics: {
        overall_score: 50,
        total_content_words: 200,
        density_score: 50,
        evidence_score: 50,
        persuasion_score: 50,
        cta_quality_score: 40,
        narrative_coherence_score: 50,
        hook_strength_score: 50,
      },
    } as unknown as DeckArtifact
    expect(validateDeckArtifact(d).valid).toBe(false)
  })
})

// ─── REGRESSION: Report section body edge cases ───────────────────────────────

describe('REGRESSION: report validator edge cases', () => {
  it('rejects report section with null body', () => {
    const r: ReportArtifact = {
      artifact_type: 'report',
      title: 'Test Report',
      sections: [
        { id: 's1', heading: 'Section heading one', body: null as any },
        { id: 's2', heading: 'Section heading two', body: 'Valid body with sufficient words here.' },
      ],
      richness_metrics: {
        overall_score: 50,
        total_content_words: 200,
        density_score: 50,
        evidence_score: 50,
        persuasion_score: 50,
        cta_quality_score: 40,
        narrative_coherence_score: 50,
        hook_strength_score: 50,
      },
    } as unknown as ReportArtifact
    expect(validateReportArtifact(r).valid).toBe(false)
  })
})

// ─── REGRESSION: Repair with markdown-fenced JSON ────────────────────────────

describe('REGRESSION: repair parses markdown-fenced JSON responses', () => {
  it('parses LLM response wrapped in ```json fences', async () => {
    const validCarouselJson = JSON.stringify(makeBase())
    const fencedResponse = `\`\`\`json\n${validCarouselJson}\n\`\`\``
    const callLLM = vi.fn().mockResolvedValue(fencedResponse)
    const invalid = { title: 'T', slides: [] } as unknown as CarouselArtifact
    const result = await runCarouselSemanticGovernance(invalid, 'Topic', callLLM)
    // Parser should strip fences and process JSON
    expect(result).toHaveProperty('artifact')
  })

  it('parses LLM response wrapped in plain ``` fences', async () => {
    const validCarouselJson = JSON.stringify(makeBase())
    const fencedResponse = `\`\`\`\n${validCarouselJson}\n\`\`\``
    const callLLM = vi.fn().mockResolvedValue(fencedResponse)
    const invalid = { title: 'T', slides: [] } as unknown as CarouselArtifact
    const result = await runCarouselSemanticGovernance(invalid, 'Topic', callLLM)
    expect(result).toHaveProperty('artifact')
  })
})

// ─── REGRESSION: Score consistency ───────────────────────────────────────────

describe('REGRESSION: score determinism', () => {
  it('evaluateGovernance is deterministic (same input = same output)', () => {
    const content = 'Dive into this game-changer. In today\'s fast-paced landscape of synergy. Leveraging the power of paradigm shifts.'
    const r1 = evaluateGovernance({ content, taskType: 'post' })
    const r2 = evaluateGovernance({ content, taskType: 'post' })
    expect(r1.score).toBe(r2.score)
    expect(r1.original_score).toBe(r2.original_score)
    expect(r1.passed).toBe(r2.passed)
    expect(r1.violations).toEqual(r2.violations)
  })

  it('validateCarouselArtifact is deterministic', () => {
    const carousel = makeBase()
    const r1 = validateCarouselArtifact(carousel)
    const r2 = validateCarouselArtifact(carousel)
    expect(r1.valid).toBe(r2.valid)
  })
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBase(): CarouselArtifact {
  return {
    artifact_type: 'carousel',
    title: 'The Strategic Founder Mindset',
    hook: 'Most founders optimize for the wrong metric in their first year and pay for it later.',
    cta: 'Save this post and share it with a founder who needs to hear this today.',
    slides: Array.from({ length: CT.minSlides }, (_, i) => ({
      slide: i + 1,
      role: i === 0 ? 'hook' : i === CT.minSlides - 1 ? 'cta' : 'insight',
      headline: `The ${i + 1}th principle separating great founders from good ones permanently`,
      body: 'Deep expertise in your core domain compounds faster than broad generalism in year one.',
      bullets: [
        'Focus creates compounding returns over a 24-month horizon consistently.',
        'Distraction is the primary reason smart founders fail at execution repeatedly.',
      ],
      insight: 'Constraint breeds creativity and focus.',
      key_takeaway: 'Narrow beats broad in year one definitively.',
      semantic_density_score: CT.minSlideDensityScore + 10,
    })),
    richness_metrics: {
      overall_score: CT.minRichnessOverall + 10,
      density_score: 60,
      evidence_score: 55,
      persuasion_score: 50,
      cta_quality_score: 45,
      narrative_coherence_score: 55,
      hook_strength_score: 60,
      total_content_words: CT.minTotalContentWords + 50,
    },
    meta: {},
    generation_trace: {},
  } as unknown as CarouselArtifact
}


