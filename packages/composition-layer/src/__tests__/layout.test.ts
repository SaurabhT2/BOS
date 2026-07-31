import { describe, it, expect } from 'vitest'
import { resolveLayout, StaticLayoutStrategy } from '../layout'

const emptyCtx = {
  role: 'unknown',
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

describe('resolveLayout — carousel', () => {
  it('maps a valid layout_hint to its archetype', () => {
    expect(resolveLayout({ ...emptyCtx, role: 'hook', rawLayoutHint: 'full-bleed' }, 'carousel')).toBe('full-bleed')
    expect(resolveLayout({ ...emptyCtx, role: 'hook', rawLayoutHint: 'headline-only' }, 'carousel')).toBe(
      'headline-primary'
    )
  })

  it('falls back to the per-role default when layout_hint is absent', () => {
    expect(resolveLayout({ ...emptyCtx, role: 'evidence' }, 'carousel')).toBe('bullets-primary')
    expect(resolveLayout({ ...emptyCtx, role: 'cta' }, 'carousel')).toBe('centered')
  })

  it('falls back to the per-role default when layout_hint is present but unrecognized', () => {
    expect(resolveLayout({ ...emptyCtx, role: 'insight', rawLayoutHint: 'not-a-real-hint' }, 'carousel')).toBe(
      'data-callout'
    )
  })
})

describe('resolveLayout — deck', () => {
  it('maps a valid layout_hint to its archetype', () => {
    expect(resolveLayout({ ...emptyCtx, role: 'content', rawLayoutHint: 'two-column' }, 'deck')).toBe('split')
    expect(resolveLayout({ ...emptyCtx, role: 'content', rawLayoutHint: 'stats-grid' }, 'deck')).toBe('stats-grid')
  })

  it('falls back to the per-type default when layout_hint is absent', () => {
    expect(resolveLayout({ ...emptyCtx, role: 'stats' }, 'deck')).toBe('stats-grid')
    expect(resolveLayout({ ...emptyCtx, role: 'cover' }, 'deck')).toBe('full-bleed')
  })
})

describe('resolveLayout — report (no layout_hint field exists on the schema)', () => {
  it('resolves to data-callout when the section has data_points', () => {
    expect(resolveLayout({ ...emptyCtx, hasDataPoints: true }, 'report')).toBe('data-callout')
  })

  it('resolves to bullets-primary when the section has key_findings but no data_points', () => {
    expect(resolveLayout({ ...emptyCtx, hasKeyFindings: true }, 'report')).toBe('bullets-primary')
  })

  it('resolves to headline-primary when the section has neither', () => {
    expect(resolveLayout({ ...emptyCtx }, 'report')).toBe('headline-primary')
  })

  it('prioritizes data_points over key_findings when a section improbably has both', () => {
    expect(resolveLayout({ ...emptyCtx, hasDataPoints: true, hasKeyFindings: true }, 'report')).toBe('data-callout')
  })
})

describe('resolveLayout — newsletter (no layout_hint field exists on the schema)', () => {
  it('resolves per section type', () => {
    expect(resolveLayout({ ...emptyCtx, role: 'quick-takes' }, 'newsletter')).toBe('bullets-primary')
    expect(resolveLayout({ ...emptyCtx, role: 'divider' }, 'newsletter')).toBe('full-bleed')
    expect(resolveLayout({ ...emptyCtx, role: 'sponsor' }, 'newsletter')).toBe('data-callout')
  })

  it('falls back to centered for an unrecognized section type', () => {
    expect(resolveLayout({ ...emptyCtx, role: 'not-a-real-type' }, 'newsletter')).toBe('centered')
  })
})

describe('StaticLayoutStrategy is used as the default strategy', () => {
  it('resolveLayout without an explicit strategy behaves the same as passing StaticLayoutStrategy explicitly', () => {
    const ctx = { ...emptyCtx, role: 'hook' as const, rawLayoutHint: 'full-bleed' as const }
    expect(resolveLayout(ctx, 'carousel')).toBe(resolveLayout(ctx, 'carousel', new StaticLayoutStrategy()))
  })
})

describe('a custom LayoutResolutionStrategy can be substituted (Phase 8 seam)', () => {
  it('is called instead of the default strategy when provided', () => {
    const alwaysFullBleed = { resolve: () => 'full-bleed' as const }
    expect(resolveLayout({ ...emptyCtx, role: 'cta' }, 'carousel', alwaysFullBleed)).toBe('full-bleed')
  })
})
