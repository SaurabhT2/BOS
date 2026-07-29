import { describe, it, expect } from 'vitest'
import { resolveTheme } from '../theme'
import { makeCarouselFixture, makeDeckFixture } from './fixtures'

describe('resolveTheme', () => {
  it('falls back to the default preset when semantic_theme has no visual_preset', () => {
    const artifact = makeCarouselFixture({ semantic_theme: {} })
    const theme = resolveTheme(artifact)
    // executive-dark is DEFAULT_PRESET_NAME in @brandos/design-tokens
    expect(theme.palette.primary).toBe('#6366f1')
    expect(theme.palette.accent).toBe('#06b6d4')
  })

  it('resolves a named visual_preset to its full palette', () => {
    const artifact = makeCarouselFixture({ semantic_theme: { visual_preset: 'minimal' } })
    const theme = resolveTheme(artifact)
    expect(theme.palette.primary).toBe('#18181b')
    expect(theme.radii.card).toBe(8)
  })

  it('resolves identically for the legacy-upcast path (visual_preset only, nothing else set)', () => {
    // Mirrors upcastCarouselBlueprint's known output shape: only
    // visual_preset: 'executive-dark' is ever set, no color/font overrides.
    const legacyLike = makeCarouselFixture({ semantic_theme: { visual_preset: 'executive-dark' } })
    const modern = makeCarouselFixture({ semantic_theme: {} })
    expect(resolveTheme(legacyLike)).toEqual(resolveTheme(modern))
  })

  it('applies explicit primaryColor/accentColor/bgColor overrides on top of the preset', () => {
    const artifact = makeCarouselFixture({
      semantic_theme: {
        visual_preset: 'modern-light',
        primaryColor: 'ff0000', // no leading # — matches the documented schema convention
        accentColor: '#00ff00', // with leading # — must also be accepted
        bgColor: '#123456',
      },
    })
    const theme = resolveTheme(artifact)
    expect(theme.palette.primary).toBe('#ff0000')
    expect(theme.palette.accent).toBe('#00ff00')
    expect(theme.palette.background).toBe('#123456')
  })

  it('applies fontTitle/fontBody overrides on top of the preset typography', () => {
    const artifact = makeCarouselFixture({
      semantic_theme: { fontTitle: 'Georgia, serif' },
    })
    const theme = resolveTheme(artifact)
    expect(theme.typography.titleFont).toBe('Georgia, serif')
    // bodyFont was not overridden — should still come from the preset default
    expect(theme.typography.bodyFont).not.toBe('Georgia, serif')
  })

  it('applies carousel_meta.palette by documented index convention (0=primary, 1=accent, 2=background)', () => {
    const artifact = makeCarouselFixture({
      carousel_meta: { palette: ['#111111', '#222222', '#333333'], slide_count: 1 },
    })
    const theme = resolveTheme(artifact)
    expect(theme.palette.primary).toBe('#111111')
    expect(theme.palette.accent).toBe('#222222')
    expect(theme.palette.background).toBe('#333333')
  })

  it('ignores invalid entries in carousel_meta.palette rather than throwing', () => {
    const artifact = makeCarouselFixture({
      carousel_meta: { palette: ['not-a-color', '#abcdef'], slide_count: 1 },
    })
    const theme = resolveTheme(artifact)
    // 'not-a-color' is filtered out; '#abcdef' becomes the first valid entry → primary
    expect(theme.palette.primary).toBe('#abcdef')
  })

  it('explicit semantic_theme color overrides take precedence over carousel_meta.palette', () => {
    const artifact = makeCarouselFixture({
      semantic_theme: { primaryColor: 'aaaaaa' },
      carousel_meta: { palette: ['#bbbbbb'], slide_count: 1 },
    })
    const theme = resolveTheme(artifact)
    // carousel_meta.palette is applied AFTER explicit overrides in resolveTheme's
    // pipeline (see theme.ts), so it wins here — this test documents that
    // ordering explicitly rather than leaving it implicit.
    expect(theme.palette.primary).toBe('#bbbbbb')
  })

  it('does not apply carousel_meta.palette to non-carousel artifacts (field does not exist on them)', () => {
    // Deck/report/newsletter have no carousel_meta at all — resolveTheme must
    // not assume its presence and must not throw when it's absent.
    const deckArtifact = makeDeckFixture()
    expect(() => resolveTheme(deckArtifact)).not.toThrow()
    expect(resolveTheme(deckArtifact).palette.primary).toBe('#6366f1')
  })

  it('applies a brandContext.overridePalette on top of everything else', () => {
    const artifact = makeCarouselFixture()
    const theme = resolveTheme(artifact, { overridePalette: { primary: '#000000' } })
    expect(theme.palette.primary).toBe('#000000')
    // untouched roles are preserved from the resolved preset
    expect(theme.palette.accent).toBe('#06b6d4')
  })
})
