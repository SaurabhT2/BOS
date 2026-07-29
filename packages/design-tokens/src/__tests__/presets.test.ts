import { describe, it, expect } from 'vitest'
import {
  DESIGN_PRESETS,
  DEFAULT_PRESET_NAME,
  getPreset,
  isVisualPresetName,
  type VisualPresetName,
} from '../presets'
import { isValidHexColor } from '../colors'

// This exact list must stay in sync with ArtifactV2.SemanticTheme.visual_preset
// (packages/contracts/src/artifact-v2.ts). It is duplicated by design (see
// presets.ts's file-header rationale for why this package has zero deps),
// so this test is the enforcement mechanism that keeps the duplication honest.
const SCHEMA_VISUAL_PRESET_VALUES: VisualPresetName[] = [
  'executive-dark',
  'modern-light',
  'vibrant',
  'minimal',
  'corporate',
  'social',
]

describe('DESIGN_PRESETS', () => {
  it('defines exactly the presets in the schema union — no more, no fewer', () => {
    expect(Object.keys(DESIGN_PRESETS).sort()).toEqual([...SCHEMA_VISUAL_PRESET_VALUES].sort())
  })

  it('every preset has a fully specified, non-partial palette/typography/spacing/radii', () => {
    for (const preset of Object.values(DESIGN_PRESETS)) {
      expect(preset.palette.primary).toBeTruthy()
      expect(preset.palette.accent).toBeTruthy()
      expect(preset.palette.background).toBeTruthy()
      expect(preset.palette.surface).toBeTruthy()
      expect(preset.palette.textPrimary).toBeTruthy()
      expect(preset.palette.textSecondary).toBeTruthy()
      expect(preset.typography.titleFont).toBeTruthy()
      expect(preset.typography.bodyFont).toBeTruthy()
      expect(preset.spacing.unit).toBeGreaterThan(0)
      expect(preset.radii.card).toBeGreaterThanOrEqual(0)
    }
  })

  it('every palette color is a valid hex value', () => {
    for (const preset of Object.values(DESIGN_PRESETS)) {
      for (const color of Object.values(preset.palette)) {
        expect(isValidHexColor(color)).toBe(true)
      }
    }
  })

  it("'executive-dark' matches today's hard-coded export-renderer defaults, to avoid a Phase 3 visual regression", () => {
    // Verified against apps/web/lib/artifact-export-html.ts's current
    // CAROUSEL_ROLE_COLORS/DECK_TYPE_COLORS default fallbacks
    // ('#06b6d4' cyan, '#6366f1' indigo) before writing this test.
    expect(DESIGN_PRESETS['executive-dark'].palette.accent).toBe('#06b6d4')
    expect(DESIGN_PRESETS['executive-dark'].palette.primary).toBe('#6366f1')
  })
})

describe('getPreset', () => {
  it('returns the named preset when valid', () => {
    expect(getPreset('minimal').name).toBe('minimal')
  })

  it('falls back to the default preset when name is undefined', () => {
    expect(getPreset(undefined).name).toBe(DEFAULT_PRESET_NAME)
  })

  it('falls back to the default preset when name is invalid/unrecognized', () => {
    expect(getPreset('not-a-real-preset').name).toBe(DEFAULT_PRESET_NAME)
  })
})

describe('isVisualPresetName', () => {
  it('returns true for every schema-defined preset name', () => {
    for (const name of SCHEMA_VISUAL_PRESET_VALUES) {
      expect(isVisualPresetName(name)).toBe(true)
    }
  })

  it('returns false for an arbitrary string', () => {
    expect(isVisualPresetName('cyberpunk')).toBe(false)
  })
})
