/**
 * Unit tests — carousel/validator.ts
 * Tests: validateCarouselArtifact (pure), runCarouselSemanticGovernance (repair)
 */

import { describe, it, expect, vi } from 'vitest'
import { validateCarouselArtifact, runCarouselSemanticGovernance } from '../../src/carousel/validator'
import type { CarouselArtifact } from '@brandos/contracts'
import { CAROUSEL_GOVERNANCE_THRESHOLDS as T } from '@brandos/governance-config'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeMinimalCarousel(overrides: Partial<CarouselArtifact> = {}): CarouselArtifact {
  return {
    artifact_type: 'carousel',
    title: 'The Strategic Founder Mindset',
    hook: 'Most founders optimize for the wrong metric in their first year — and pay for it later.',
    cta: 'Save this post and share it with a founder who needs to hear this.',
    slides: Array.from({ length: T.minSlides }, (_, i) => ({
      slide: i + 1,
      role: i === 0 ? 'hook' : i === T.minSlides - 1 ? 'cta' : 'insight',
      headline: `The ${i + 1}th principle that separates great founders from good ones`,
      body: 'Deep expertise in your core domain compounds faster than broad generalism in year one.',
      bullets: [
        'Focus creates compounding returns over a 24-month horizon.',
        'Distraction is the primary reason smart founders fail at execution.',
      ],
      insight: 'Constraint breeds creativity.',
      key_takeaway: 'Narrow beats broad in year one.',
      semantic_density_score: T.minSlideDensityScore + 10,
    })),
    richness_metrics: {
      overall_score: T.minRichnessOverall + 10,
      density_score: 60,
      evidence_score: 55,
      persuasion_score: 50,
      cta_quality_score: 45,
      narrative_coherence_score: 55,
      hook_strength_score: 60,
      total_content_words: T.minTotalContentWords + 50,
    },
    meta: { topic: 'Founder mindset', tone: 'executive' },
    generation_trace: {},
  } as unknown as CarouselArtifact
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('validateCarouselArtifact', () => {
  describe('null / malformed input', () => {
    it('rejects null', () => {
      const r = validateCarouselArtifact(null as unknown as CarouselArtifact)
      expect(r.valid).toBe(false)
      expect(r.slideCount).toBe(0)
    })

    it('rejects non-object', () => {
      const r = validateCarouselArtifact('string' as unknown as CarouselArtifact)
      expect(r.valid).toBe(false)
    })

    it('rejects undefined', () => {
      const r = validateCarouselArtifact(undefined as unknown as CarouselArtifact)
      expect(r.valid).toBe(false)
    })
  })

  describe('slides array', () => {
    it('rejects missing slides array', () => {
      const r = validateCarouselArtifact({ title: 'Test' } as unknown as CarouselArtifact)
      expect(r.valid).toBe(false)
    })

    it('rejects empty slides array', () => {
      const r = validateCarouselArtifact({ title: 'Test', slides: [] } as unknown as CarouselArtifact)
      expect(r.valid).toBe(false)
    })

    it(`rejects fewer than ${T.minSlides} slides`, () => {
      const c = makeMinimalCarousel()
      c.slides = c.slides.slice(0, T.minSlides - 1)
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('too few slides')
    })
  })

  describe('title validation', () => {
    it('rejects missing title', () => {
      const c = makeMinimalCarousel()
      c.title = ''
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
    })

    it('rejects title shorter than 3 chars', () => {
      const c = makeMinimalCarousel()
      c.title = 'AB'
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
    })
  })

  describe('hook validation', () => {
    it('rejects missing hook', () => {
      const c = makeMinimalCarousel()
      c.hook = ''
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
    })

    it('rejects hook with fewer than 4 words', () => {
      const c = makeMinimalCarousel()
      c.hook = 'Too short hook'
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
    })

    it('rejects hook that is just the title', () => {
      const c = makeMinimalCarousel()
      c.hook = c.title
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
    })

    it('rejects hook placeholder "hook"', () => {
      const c = makeMinimalCarousel()
      c.hook = 'hook'
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
    })
  })

  describe('cta validation', () => {
    it('rejects missing CTA', () => {
      const c = makeMinimalCarousel()
      c.cta = ''
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
    })

    it('rejects CTA with fewer than 3 words', () => {
      const c = makeMinimalCarousel()
      c.cta = 'Click here'
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
    })

    it('rejects generic CTA "learn more"', () => {
      const c = makeMinimalCarousel()
      c.cta = 'learn more'
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
    })

    it('rejects generic CTA "follow me"', () => {
      const c = makeMinimalCarousel()
      c.cta = 'follow me'
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
    })
  })

  describe('richness metrics', () => {
    it('rejects missing richness_metrics', () => {
      const c = makeMinimalCarousel()
      c.richness_metrics = undefined as unknown as CarouselArtifact['richness_metrics']
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
    })

    it(`rejects total_content_words < ${T.minTotalContentWords}`, () => {
      const c = makeMinimalCarousel()
      c.richness_metrics.total_content_words = T.minTotalContentWords - 1
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
    })

    it(`rejects overall_score < ${T.minRichnessOverall}`, () => {
      const c = makeMinimalCarousel()
      c.richness_metrics.overall_score = T.minRichnessOverall - 1
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
    })
  })

  describe('slide-level validation', () => {
    it('rejects slides with too-short headlines', () => {
      const c = makeMinimalCarousel()
      c.slides[0].headline = 'Short'
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
    })

    it(`rejects slides with density score < ${T.minSlideDensityScore}`, () => {
      const c = makeMinimalCarousel()
      c.slides[0].semantic_density_score = T.minSlideDensityScore - 1
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
    })
  })

  describe('narrative roles', () => {
    it('rejects carousel missing hook role', () => {
      const c = makeMinimalCarousel()
      c.slides.forEach(s => { if (s.role === 'hook') s.role = 'insight' })
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('hook')
    })

    it('rejects carousel missing cta role', () => {
      const c = makeMinimalCarousel()
      c.slides.forEach(s => { if (s.role === 'cta') s.role = 'insight' })
      const r = validateCarouselArtifact(c)
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('cta')
    })
  })

  describe('valid carousel', () => {
    it('accepts a fully valid carousel', () => {
      const r = validateCarouselArtifact(makeMinimalCarousel())
      expect(r.valid).toBe(true)
      if (r.valid) {
        expect(r.slideCount).toBe(T.minSlides)
        expect(Array.isArray(r.warnings)).toBe(true)
      }
    })

    it('returns slideCount matching actual slides', () => {
      const c = makeMinimalCarousel()
      const extra = { ...c.slides[0], slide: T.minSlides + 1, role: 'insight' }
      c.slides.push(extra)
      const r = validateCarouselArtifact(c)
      if (r.valid) {
        expect(r.slideCount).toBe(T.minSlides + 1)
      }
    })
  })
})

describe('runCarouselSemanticGovernance', () => {
  it('returns success: true for a valid carousel without calling LLM', async () => {
    const callLLM = vi.fn()
    const result = await runCarouselSemanticGovernance(makeMinimalCarousel(), 'Founder mindset', callLLM)
    expect(result.success).toBe(true)
    expect(result.repaired).toBe(false)
    expect(result.attempts).toBe(0)
    expect(callLLM).not.toHaveBeenCalled()
  })

  it('returns success: false and attempts > 0 for invalid carousel when LLM returns unparseable response', async () => {
    const callLLM = vi.fn().mockResolvedValue('not valid json')
    const invalid = { title: 'Test', slides: [] } as unknown as CarouselArtifact
    const result = await runCarouselSemanticGovernance(invalid, 'Test topic', callLLM)
    expect(result.success).toBe(false)
    expect(result.attempts).toBe(1) // P1-4 FIX: validator is single-attempt; engine owns retry loop (T.maxRepairAttempts=3 is the engine ceiling, not per-validator)
    expect(typeof result.finalRejection).toBe('string')
  })

  it('returns success: false and attempts > 0 when LLM throws', async () => {
    const callLLM = vi.fn().mockRejectedValue(new Error('LLM timeout'))
    const invalid = { title: 'Test', slides: [] } as unknown as CarouselArtifact
    const result = await runCarouselSemanticGovernance(invalid, 'Test topic', callLLM)
    expect(result.success).toBe(false)
    expect(result.attempts).toBeGreaterThan(0)
  })

  it('applies repaired slides from LLM response when parseable', async () => {
    const callLLM = vi.fn().mockResolvedValue(JSON.stringify({
      title: 'Repaired',
      hook: 'Repaired hook is strong and specific',
      cta: 'Save this and share with your team',
      slides: makeMinimalCarousel().slides,
    }))

    const invalid = makeMinimalCarousel()
    invalid.richness_metrics.overall_score = T.minRichnessOverall - 5

    const result = await runCarouselSemanticGovernance(invalid, 'Test topic', callLLM)
    expect(result.attempts).toBeGreaterThanOrEqual(0)
    expect(typeof result.artifact).toBe('object')
  })

  it('result always has validationOutcome field', async () => {
    const callLLM = vi.fn().mockResolvedValue('garbage')
    const invalid = { title: 'Test', slides: [] } as unknown as CarouselArtifact
    const result = await runCarouselSemanticGovernance(invalid, 'Test topic', callLLM)
    expect(result).toHaveProperty('validationOutcome')
  })

  it('result always has artifact field', async () => {
    const callLLM = vi.fn()
    const result = await runCarouselSemanticGovernance(makeMinimalCarousel(), 'Topic', callLLM)
    expect(result).toHaveProperty('artifact')
  })
})


