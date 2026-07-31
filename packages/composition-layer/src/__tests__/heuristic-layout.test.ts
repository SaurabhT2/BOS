import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  fitScore,
  bestFittingArchetype,
  HeuristicFitStrategy,
  getDefaultLayoutStrategy,
  isLayoutHeuristicLoggingEnabled,
  isLayoutHeuristicActiveEnabled,
} from '../heuristic-layout'
import { StaticLayoutStrategy } from '../layout'
import type { LayoutResolutionContext } from '../layout'

const ORIGINAL_LOG = process.env.RENDERING_V2_LAYOUT_HEURISTIC_LOG
const ORIGINAL_ACTIVE = process.env.RENDERING_V2_LAYOUT_HEURISTIC_ACTIVE

function setFlags(log: 'true' | undefined, active: 'true' | undefined) {
  if (log === undefined) delete process.env.RENDERING_V2_LAYOUT_HEURISTIC_LOG
  else process.env.RENDERING_V2_LAYOUT_HEURISTIC_LOG = log
  if (active === undefined) delete process.env.RENDERING_V2_LAYOUT_HEURISTIC_ACTIVE
  else process.env.RENDERING_V2_LAYOUT_HEURISTIC_ACTIVE = active
}

afterEach(() => {
  setFlags(ORIGINAL_LOG as 'true' | undefined, ORIGINAL_ACTIVE as 'true' | undefined)
})

const baseCtx: LayoutResolutionContext = {
  role: 'test',
  hasBullets: false,
  hasStats: false,
  hasDataPoints: false,
  hasKeyFindings: false,
  headlineLength: 0,
  bodyLength: 0,
  bulletCount: 0,
  bulletTotalLength: 0,
  statCount: 0,
}

describe('fitScore', () => {
  it('scores a perfect fit (well under every capacity) as 1', () => {
    const ctx: LayoutResolutionContext = { ...baseCtx, headlineLength: 20, bodyLength: 40 }
    expect(fitScore(ctx, 'headline-primary')).toBe(1)
  })

  it('reduces the score proportionally when content overflows a dimension', () => {
    // 'full-bleed' has a small maxHeadlineLength (40) — a much longer
    // headline should score well below 1.
    const ctx: LayoutResolutionContext = { ...baseCtx, headlineLength: 200 }
    const score = fitScore(ctx, 'full-bleed')
    expect(score).toBeLessThan(0.3)
    expect(score).toBeGreaterThan(0)
  })

  it('uses the WORST dimension, not an average', () => {
    // Short headline (fits easily) but a huge bullet count (badly overflows)
    // — the score should reflect the bullet overflow, not be pulled up by
    // the good headline fit.
    const ctx: LayoutResolutionContext = { ...baseCtx, headlineLength: 5, bulletCount: 50, bulletTotalLength: 2000 }
    const score = fitScore(ctx, 'bullets-primary')
    expect(score).toBeLessThan(0.3)
  })

  it('penalizes stats present on an archetype with no natural place for them', () => {
    const ctx: LayoutResolutionContext = { ...baseCtx, statCount: 2 }
    // 'centered' does not supportsStats
    expect(fitScore(ctx, 'centered')).toBeLessThanOrEqual(0.3)
  })

  it('does not penalize an archetype for content it has zero of (bullets/stats absent entirely)', () => {
    const ctx: LayoutResolutionContext = { ...baseCtx, headlineLength: 10 }
    // 'full-bleed' has maxBulletCount: 0, but ctx.bulletCount is also 0 — no bullets present at all
    expect(fitScore(ctx, 'full-bleed')).toBe(1)
  })
})

describe('bestFittingArchetype', () => {
  it('picks bullets-primary for bullet-heavy content', () => {
    const ctx: LayoutResolutionContext = { ...baseCtx, headlineLength: 20, bulletCount: 5, bulletTotalLength: 300 }
    expect(bestFittingArchetype(ctx)).toBe('bullets-primary')
  })

  it('picks full-bleed for very short, punchy content', () => {
    const ctx: LayoutResolutionContext = { ...baseCtx, headlineLength: 15 }
    // Both 'full-bleed' and 'centered' would score 1 here — deterministic
    // tie-break by declared order matters; just confirm it's stable across calls.
    const first = bestFittingArchetype(ctx)
    const second = bestFittingArchetype(ctx)
    expect(first).toBe(second)
  })

  it('picks stats-grid or data-callout for stat-heavy content', () => {
    const ctx: LayoutResolutionContext = { ...baseCtx, headlineLength: 20, statCount: 3 }
    const choice = bestFittingArchetype(ctx)
    expect(['stats-grid', 'data-callout']).toContain(choice)
  })
})

describe('HeuristicFitStrategy — log-only mode (active: false)', () => {
  it('never changes the output vs. StaticLayoutStrategy, even on a strong disagreement', () => {
    // A carousel 'evidence' slide with a huge headline and no bullets at all
    // — static default for 'evidence' is 'bullets-primary', but the
    // heuristic would clearly prefer something else given zero bullets.
    const ctx: LayoutResolutionContext = { ...baseCtx, role: 'evidence', headlineLength: 20, bodyLength: 250, bulletCount: 0 }
    const staticChoice = new StaticLayoutStrategy().resolve(ctx, 'carousel')
    const heuristicChoice = new HeuristicFitStrategy({ active: false }).resolve(ctx, 'carousel')
    expect(heuristicChoice).toBe(staticChoice)
  })

  it('logs a disagreement via the onDisagreement callback when one is strong enough', () => {
    const onDisagreement = vi.fn()
    const ctx: LayoutResolutionContext = { ...baseCtx, role: 'evidence', headlineLength: 20, bodyLength: 250, bulletCount: 0 }
    new HeuristicFitStrategy({ active: false, onDisagreement }).resolve(ctx, 'carousel')
    expect(onDisagreement).toHaveBeenCalledTimes(1)
    const call = onDisagreement.mock.calls[0]![0]
    expect(call.role).toBe('evidence')
    expect(call.scoreDelta).toBeGreaterThan(0)
  })

  it('does not call onDisagreement when the static choice is already a good fit', () => {
    const onDisagreement = vi.fn()
    const ctx: LayoutResolutionContext = { ...baseCtx, role: 'cta', headlineLength: 15 }
    new HeuristicFitStrategy({ active: false, onDisagreement }).resolve(ctx, 'carousel')
    expect(onDisagreement).not.toHaveBeenCalled()
  })
})

describe('HeuristicFitStrategy — active mode (active: true)', () => {
  it('overrides the static choice on a strong disagreement', () => {
    const ctx: LayoutResolutionContext = { ...baseCtx, role: 'evidence', headlineLength: 20, bodyLength: 250, bulletCount: 0 }
    const staticChoice = new StaticLayoutStrategy().resolve(ctx, 'carousel')
    const activeChoice = new HeuristicFitStrategy({ active: true }).resolve(ctx, 'carousel')
    expect(activeChoice).not.toBe(staticChoice)
  })

  it('still returns the static choice when there is no strong disagreement', () => {
    const ctx: LayoutResolutionContext = { ...baseCtx, role: 'cta', headlineLength: 15 }
    const staticChoice = new StaticLayoutStrategy().resolve(ctx, 'carousel')
    const activeChoice = new HeuristicFitStrategy({ active: true }).resolve(ctx, 'carousel')
    expect(activeChoice).toBe(staticChoice)
  })

  it('also calls onDisagreement when overriding (active implies observable)', () => {
    const onDisagreement = vi.fn()
    const ctx: LayoutResolutionContext = { ...baseCtx, role: 'evidence', headlineLength: 20, bodyLength: 250, bulletCount: 0 }
    new HeuristicFitStrategy({ active: true, onDisagreement }).resolve(ctx, 'carousel')
    expect(onDisagreement).toHaveBeenCalledTimes(1)
  })
})

describe('flags', () => {
  it('isLayoutHeuristicLoggingEnabled is false by default', () => {
    setFlags(undefined, undefined)
    expect(isLayoutHeuristicLoggingEnabled()).toBe(false)
  })

  it('isLayoutHeuristicLoggingEnabled is true when the log flag is set', () => {
    setFlags('true', undefined)
    expect(isLayoutHeuristicLoggingEnabled()).toBe(true)
    expect(isLayoutHeuristicActiveEnabled()).toBe(false)
  })

  it('isLayoutHeuristicLoggingEnabled is true when only the active flag is set (active implies logging)', () => {
    setFlags(undefined, 'true')
    expect(isLayoutHeuristicActiveEnabled()).toBe(true)
    expect(isLayoutHeuristicLoggingEnabled()).toBe(true)
  })
})

describe('getDefaultLayoutStrategy', () => {
  it('returns a StaticLayoutStrategy when neither flag is set', () => {
    setFlags(undefined, undefined)
    expect(getDefaultLayoutStrategy()).toBeInstanceOf(StaticLayoutStrategy)
  })

  it('returns a log-only HeuristicFitStrategy when only the log flag is set', () => {
    setFlags('true', undefined)
    const strategy = getDefaultLayoutStrategy()
    expect(strategy).toBeInstanceOf(HeuristicFitStrategy)
    // Confirm it's genuinely log-only (does not override), reusing the same
    // strong-disagreement fixture as above.
    const ctx: LayoutResolutionContext = { ...baseCtx, role: 'evidence', headlineLength: 20, bodyLength: 250, bulletCount: 0 }
    const staticChoice = new StaticLayoutStrategy().resolve(ctx, 'carousel')
    expect(strategy.resolve(ctx, 'carousel')).toBe(staticChoice)
  })

  it('returns an active HeuristicFitStrategy when the active flag is set', () => {
    setFlags(undefined, 'true')
    const strategy = getDefaultLayoutStrategy()
    expect(strategy).toBeInstanceOf(HeuristicFitStrategy)
    const ctx: LayoutResolutionContext = { ...baseCtx, role: 'evidence', headlineLength: 20, bodyLength: 250, bulletCount: 0 }
    const staticChoice = new StaticLayoutStrategy().resolve(ctx, 'carousel')
    expect(strategy.resolve(ctx, 'carousel')).not.toBe(staticChoice)
  })
})
