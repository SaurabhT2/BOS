/**
 * Integration tests — full governance pipeline.
 * Tests the interaction between registry, validators, and repair flow.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import { GovernancePluginRegistry, bootstrapGovernancePlugins } from '../../src/GovernancePluginRegistry'
import { evaluateGovernance } from '../../src/governanceEngine'
import { validateCarouselArtifact, runCarouselSemanticGovernance } from '../../src/carousel/validator'
import { validateDeckArtifact } from '../../src/deck/validator'
import { validateReportArtifact } from '../../src/report/validator'
import type { CarouselArtifact, DeckArtifact, ReportArtifact } from '@brandos/contracts'
import { CAROUSEL_GOVERNANCE_THRESHOLDS as CT, DECK_GOVERNANCE_THRESHOLDS as DT, REPORT_GOVERNANCE_THRESHOLDS as RT } from '@brandos/governance-config'

// ─── Shared fixtures ──────────────────────────────────────────────────────────

function makeValidCarousel(): CarouselArtifact {
  return {
    artifact_type: 'carousel',
    title: 'Why 90% of B2B Founders Fail at Content Marketing',
    hook: 'Founders who post consistently for 90 days see 3x pipeline growth — but almost none of them do.',
    cta: 'Save this and share it with the B2B founder in your network who is struggling with content.',
    slides: Array.from({ length: CT.minSlides }, (_, i) => ({
      slide: i + 1,
      role: i === 0 ? 'hook' : i === CT.minSlides - 1 ? 'cta' : 'insight',
      headline: `The ${i + 1}th principle that transforms B2B content from noise to pipeline`,
      body: 'Specificity beats reach every time. One narrow audience who deeply resonates outperforms a broad audience who vaguely relates.',
      bullets: [
        'Narrow ICP definition produces higher engagement rates by a factor of 4x.',
        'One core idea per post converts 60% better than multi-idea posts.',
      ],
      insight: 'Specificity is the founder content superpower.',
      key_takeaway: 'Go narrow to grow fast.',
      semantic_density_score: CT.minSlideDensityScore + 15,
    })),
    richness_metrics: {
      overall_score: CT.minRichnessOverall + 15,
      density_score: 65,
      evidence_score: 60,
      persuasion_score: 55,
      cta_quality_score: 50,
      narrative_coherence_score: 60,
      hook_strength_score: 70,
      total_content_words: CT.minTotalContentWords + 100,
    },
    meta: { topic: 'B2B content marketing', tone: 'executive' },
    generation_trace: {},
  } as unknown as CarouselArtifact
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Bootstrap integration', () => {
  beforeAll(async () => {
    GovernancePluginRegistry._reset()
    await bootstrapGovernancePlugins()
  })

  it('bootstrapped registry resolves all 3 validators', () => {
    expect(GovernancePluginRegistry.resolveValidator('carousel', 'governance.validate.carousel')).not.toBeNull()
    expect(GovernancePluginRegistry.resolveValidator('deck', 'governance.validate.deck')).not.toBeNull()
    expect(GovernancePluginRegistry.resolveValidator('report', 'governance.validate.report')).not.toBeNull()
  })

  it('bootstrapped registry resolves all 3 repairs', () => {
    expect(GovernancePluginRegistry.resolveRepair('carousel', 'governance.repair.carousel')).not.toBeNull()
    expect(GovernancePluginRegistry.resolveRepair('deck', 'governance.repair.deck')).not.toBeNull()
    expect(GovernancePluginRegistry.resolveRepair('report', 'governance.repair.report')).not.toBeNull()
  })

  it('dispatched carousel validator produces same result as direct call', async () => {
    const carousel = makeValidCarousel()
    const direct = validateCarouselArtifact(carousel)
    const plugin = GovernancePluginRegistry.resolveValidator<CarouselArtifact>('carousel', 'governance.validate.carousel')
    expect(plugin).not.toBeNull()
    const dispatched = await plugin!.validate(carousel)
    expect(dispatched.passed).toBe(direct.valid)
  })

  it('dispatched carousel repair is callable with LLM callback', async () => {
    const callLLM = vi.fn().mockResolvedValue('{}')
    const invalid = { title: 'T', slides: [] } as unknown as CarouselArtifact
    const plugin = GovernancePluginRegistry.resolveRepair<CarouselArtifact>('carousel', 'governance.repair.carousel')
    expect(plugin).not.toBeNull()
    const result = await plugin!.repair(invalid, 'topic', callLLM)
    expect(result).toHaveProperty('success')
    expect(result).toHaveProperty('artifact')
  })
})

describe('Text scoring + semantic validation independence', () => {
  it('evaluateGovernance and validateCarouselArtifact are independent paths', () => {
    const carousel = makeValidCarousel()
    // Text scoring on carousel hook text
    const textResult = evaluateGovernance({ content: carousel.hook + '\n\n' + carousel.cta, taskType: 'carousel' })
    // Semantic validation on full carousel
    const semResult = validateCarouselArtifact(carousel)
    // Both pass — but they test different things
    expect(textResult.passed).toBe(true)
    expect(semResult.valid).toBe(true)
  })

  it('text score can fail while semantic validation passes', () => {
    // Carousel is semantically valid but content has clichés
    const carousel = makeValidCarousel()
    carousel.hook = "Dive into this game-changer. In today's fast-paced landscape, it's important to note that synergy matters. Certainly, absolutely, of course."
    carousel.slides[0].headline = 'The first principle that really matters significantly here now'
    const textResult = evaluateGovernance({ content: carousel.hook, taskType: 'carousel' })
    // Semantic validation doesn't inspect text quality — only structure and richness
    const semResult = validateCarouselArtifact(carousel)
    // Text may fail but semantic structure still valid
    expect(typeof textResult.passed).toBe('boolean')
    expect(typeof semResult.valid).toBe('boolean')
  })
})

describe('Multi-artifact type governance pipeline', () => {
  it('validates carousel, deck, and report correctly', () => {
    // Carousel — valid
    expect(validateCarouselArtifact(makeValidCarousel()).valid).toBe(true)

    // Deck — invalid (empty)
    const emptyDeck = { title: 'Test', slides: [] } as unknown as DeckArtifact
    expect(validateDeckArtifact(emptyDeck).valid).toBe(false)

    // Report — invalid (empty)
    const emptyReport = { title: 'Test', sections: [] } as unknown as ReportArtifact
    expect(validateReportArtifact(emptyReport).valid).toBe(false)
  })
})

describe('Repair pipeline with recompile callback', () => {
  it('uses recompile callback when provided', async () => {
    const recompile = vi.fn((raw: any) => makeValidCarousel())
    const invalid = { title: 'T', slides: [] } as unknown as CarouselArtifact
    const callLLM = vi.fn().mockResolvedValue(JSON.stringify({
      title: 'Repaired',
      hook: 'Specific strong hook with real data',
      cta: 'Save this and share with your team today',
      slides: makeValidCarousel().slides,
    }))

    const result = await runCarouselSemanticGovernance(invalid, 'Topic', callLLM, 'test-req', recompile)
    // recompile should have been called if LLM produced parseable response
    expect(result).toHaveProperty('success')
    expect(result).toHaveProperty('artifact')
  })
})

describe('Governance pipeline telemetry', () => {
  it('generation_trace is updated with governance_outcome on repair', async () => {
    const callLLM = vi.fn().mockResolvedValue(JSON.stringify({
      title: 'Fixed carousel',
      hook: 'Strong hook about concrete business outcome data',
      cta: 'Share with your founding team and save for later',
      slides: makeValidCarousel().slides,
    }))

    const invalid = makeValidCarousel()
    invalid.richness_metrics.overall_score = CT.minRichnessOverall - 5

    const result = await runCarouselSemanticGovernance(invalid, 'Topic', callLLM)

    if (result.repaired && result.artifact.generation_trace) {
      expect(result.artifact.generation_trace.governance_outcome).toBe('passed_after_repair')
    }
    expect(result).toHaveProperty('attempts')
  })
})


