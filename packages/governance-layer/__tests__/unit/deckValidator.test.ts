/**
 * Unit tests — deck/validator.ts
 */

import { describe, it, expect, vi } from 'vitest'
import { validateDeckArtifact, runDeckSemanticGovernance } from '../../src/deck/validator'
import type { DeckArtifact } from '@brandos/contracts'
import { DECK_GOVERNANCE_THRESHOLDS as T } from '@brandos/governance-config'

function makeMinimalDeck(overrides: Partial<DeckArtifact> = {}): DeckArtifact {
  const slides = [
    { slide: 1, type: 'cover',   title: 'The Execution Framework for High-Performance Teams', subtitle: 'How elite operators consistently deliver at scale', body: 'A proven model for consistent delivery under pressure.' },
    { slide: 2, type: 'content', title: 'Clarity Beats Complexity in Every High-Stakes Delivery', body: 'Teams with a single clear priority outperform multi-objective teams by 3x. Clarity is a leadership output, not a team input.', bullets: ['Single priority per sprint eliminates decision fatigue and context switching.', 'Teams with one clear goal outperform multi-objective teams consistently.', 'Clarity is a leadership output — it must be engineered, not assumed.'], speaker_notes: 'Emphasize the compounding effect of sustained clarity over 12 weeks.' },
    { slide: 3, type: 'content', title: 'Most Execution Failures Trace to the Planning Stage', body: 'Post-mortems across 47 teams show that 89% of execution failures originated in scope decisions made 6–8 weeks earlier — not in the delivery sprint itself.', bullets: ['Scope instability in week 1 predicts delivery failure in week 8 with 74% accuracy.', 'Teams that lock scope by day 3 of planning deliver on time 2.4x more often.', 'The cost of a planning error compounds at every subsequent sprint.'], speaker_notes: 'Reference the 47-team study. Audience has likely felt this firsthand.' },
    { slide: 4, type: 'stats',   title: '3x Faster Delivery When Teams Operate From a Single Priority', stats: [{ value: '3x', label: 'Delivery speed vs. multi-objective teams', delta: 'Consistent across 6 industries' }, { value: '89%', label: 'Of failures traced to planning decisions', delta: 'From 47-team post-mortem study' }, { value: '74%', label: 'Prediction accuracy of early scope instability', delta: 'Leading indicator of delivery failure' }], speaker_notes: 'Let these numbers land before moving on.' },
    { slide: 5, type: 'content', title: 'The Three-Phase Execution Model That Eliminates Drift', body: 'Phase 1: Lock. Phase 2: Run. Phase 3: Review. Each phase has one owner, one output, and one decision gate. Teams that skip Phase 1 spend 40% of Phase 2 re-making Phase 1 decisions.', bullets: ['Phase 1 Lock: single owner, scope document signed off in 72 hours.', 'Phase 2 Run: daily standup limited to blockers — no scope discussion permitted.', 'Phase 3 Review: structured retrospective with documented decision log.'] },
    { slide: 6, type: 'content', title: 'Implementation Requires One Structural Change and Two Habits', body: 'Structural change: designate a single execution owner per initiative. Habits: daily written priority broadcast, weekly scope freeze confirmation. Teams that adopted all three components sustained 3x delivery rate for 6+ months.', bullets: ['Designate one execution owner — not a committee — per initiative.', 'Daily written priority broadcast takes 3 minutes and eliminates 4 hours of alignment meetings.', 'Weekly scope freeze confirmation prevents 74% of mid-sprint scope changes.'] },
    { slide: 7, type: 'closing', title: 'One Question That Changes How Your Team Executes This Week', body: 'What is the one thing your team must accomplish this week for everything else to be easier or unnecessary? Answer that question in writing before your next planning session.' },
  ]
  return {
    artifact_type: 'deck',
    title: 'The Execution Framework for High-Performance Teams',
    hook: 'Elite teams do not work harder — they make fewer decisions at execution time.',
    cta: 'Share this with your leadership team before your next quarterly planning.',
    slides,
    richness_metrics: {
      overall_score: T.minRichnessOverall + 10,
      density_score: 68,
      evidence_score: 65,
      persuasion_score: 60,
      cta_quality_score: 50,
      narrative_coherence_score: 65,
      hook_strength_score: 70,
      total_content_words: T.minTotalContentWords + 150,
    },
    meta: {},
    generation_trace: {},
    ...overrides,
  } as unknown as DeckArtifact
}

describe('validateDeckArtifact', () => {
  it('rejects null', () => {
    expect(validateDeckArtifact(null as unknown as DeckArtifact).valid).toBe(false)
  })

  it('rejects empty slides', () => {
    const d = makeMinimalDeck()
    d.slides = []
    expect(validateDeckArtifact(d).valid).toBe(false)
  })

  it(`rejects fewer than ${T.minSlides} slides`, () => {
    const d = makeMinimalDeck()
    d.slides = d.slides.slice(0, T.minSlides - 1)
    const r = validateDeckArtifact(d)
    expect(r.valid).toBe(false)
    expect(r.valid === false && r.reason).toContain('too few slides')
  })

  it('rejects missing title', () => {
    const d = makeMinimalDeck()
    d.title = ''
    expect(validateDeckArtifact(d).valid).toBe(false)
  })

  it('rejects missing richness_metrics', () => {
    const d = makeMinimalDeck()
    d.richness_metrics = undefined as unknown as DeckArtifact['richness_metrics']
    expect(validateDeckArtifact(d).valid).toBe(false)
  })

  it(`rejects total_content_words < ${T.minTotalContentWords}`, () => {
    const d = makeMinimalDeck()
    d.richness_metrics.total_content_words = T.minTotalContentWords - 1
    expect(validateDeckArtifact(d).valid).toBe(false)
  })

  it(`rejects overall_score < ${T.minRichnessOverall}`, () => {
    const d = makeMinimalDeck()
    d.richness_metrics.overall_score = T.minRichnessOverall - 1
    expect(validateDeckArtifact(d).valid).toBe(false)
  })

  it('rejects slide with short title', () => {
    const d = makeMinimalDeck()
    d.slides[0].title = 'Hi'
    expect(validateDeckArtifact(d).valid).toBe(false)
  })

  it('rejects deck missing cover slide', () => {
    const d = makeMinimalDeck()
    d.slides.forEach((s: any) => { if (s.type === 'cover') s.type = 'content' })
    const r = validateDeckArtifact(d)
    expect(r.valid).toBe(false)
    expect(r.valid === false && r.reason).toContain('cover')
  })

  it('rejects deck missing content/closing slide', () => {
    const d = makeMinimalDeck()
    d.slides.forEach((s: any) => { s.type = 'cover' })
    expect(validateDeckArtifact(d).valid).toBe(false)
  })

  it('accepts valid deck', () => {
    expect(validateDeckArtifact(makeMinimalDeck()).valid).toBe(true)
  })

  it('returns slideCount', () => {
    const r = validateDeckArtifact(makeMinimalDeck())
    if (r.valid) expect(r.slideCount).toBe(7)
  })
})

describe('runDeckSemanticGovernance', () => {
  it('success for valid deck without LLM call', async () => {
    const callLLM = vi.fn()
    const r = await runDeckSemanticGovernance(makeMinimalDeck(), 'Topic', callLLM)
    expect(r.success).toBe(true)
    expect(callLLM).not.toHaveBeenCalled()
  })

  it('attempts repair on invalid deck', async () => {
    // SPRINT1-FIX (F-02): runDeckSemanticGovernance is now a single-attempt helper.
    // Engine (ArtifactEngine.govern()) owns the retry loop (MAX_REPAIR_ATTEMPTS = 3).
    // This function makes exactly 1 LLM call and returns attempts = 1.
    // T.maxRepairAttempts is deprecated — it is no longer read by this function.
    const callLLM = vi.fn().mockResolvedValue('invalid json')
    const d = makeMinimalDeck()
    d.slides = []
    const r = await runDeckSemanticGovernance(d, 'Topic', callLLM)
    expect(r.success).toBe(false)
    expect(r.attempts).toBe(1) // single-attempt: engine owns retry loop
    expect(callLLM).toHaveBeenCalledTimes(1)
  })

  it('handles LLM error gracefully', async () => {
    const callLLM = vi.fn().mockRejectedValue(new Error('timeout'))
    const d = makeMinimalDeck()
    d.slides = []
    const r = await runDeckSemanticGovernance(d, 'Topic', callLLM)
    expect(r.success).toBe(false)
    expect(r.attempts).toBeGreaterThan(0)
  })

  it('always returns artifact and validationOutcome', async () => {
    const callLLM = vi.fn().mockResolvedValue('bad')
    const d = makeMinimalDeck()
    d.slides = []
    const r = await runDeckSemanticGovernance(d, 'Topic', callLLM)
    expect(r).toHaveProperty('artifact')
    expect(r).toHaveProperty('validationOutcome')
  })
})


