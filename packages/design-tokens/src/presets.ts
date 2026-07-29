// ============================================================
// packages/design-tokens/src/presets.ts
//
// Named visual presets, keyed by the exact literal union already
// defined on ArtifactV2.SemanticTheme.visual_preset
// (packages/contracts/src/artifact-v2.ts) — verified against the
// current schema before writing this file:
//
//   'executive-dark' | 'modern-light' | 'vibrant' | 'minimal' |
//   'corporate' | 'social'
//
// This file owns *values* — what each preset name looks like.
// It does NOT decide which preset an artifact should use, nor how
// missing/partial semantic_theme data falls back to one of these —
// that resolution logic lives in @brandos/composition-layer's
// resolveTheme() (see COMPOSITION_MODEL.md §3.4/§5). Duplicating
// this string union locally (rather than importing it from
// @brandos/contracts) is deliberate: this package has zero
// dependencies by design (DESIGN_SYSTEM_ARCHITECTURE.md §4), and
// the literal set is small, stable, and schema-owned — a type-only
// duplication, not a runtime one, checked by the exhaustiveness test
// in __tests__/presets.test.ts.
// ============================================================

import type { PaletteRoles } from './colors'
import { DEFAULT_FONT_STACK, BASE_TYPE_SCALE, type TypographyTokens } from './typography'
import { BASE_SPACING, type SpacingTokens } from './spacing'
import { BASE_RADII, type RadiusTokens } from './radii'

export type VisualPresetName =
  | 'executive-dark'
  | 'modern-light'
  | 'vibrant'
  | 'minimal'
  | 'corporate'
  | 'social'

export interface DesignPreset {
  name: VisualPresetName
  palette: PaletteRoles
  typography: TypographyTokens
  spacing: SpacingTokens
  radii: RadiusTokens
}

const typography = (titleFont = DEFAULT_FONT_STACK, bodyFont = DEFAULT_FONT_STACK): TypographyTokens => ({
  titleFont,
  bodyFont,
  scale: BASE_TYPE_SCALE,
})

/**
 * House-default palette values. 'executive-dark' intentionally matches
 * the current hard-coded export-renderer defaults (dark background,
 * cyan/indigo accents) documented in RENDERING_ARCHITECTURE_AUDIT.md §11,
 * so that migrating a renderer onto ResolvedTheme (Phase 3) does not, by
 * itself, cause a visual regression for artifacts using the default preset —
 * any visual difference after migration should come from finally *applying*
 * semantic_theme overrides (Finding C-2), not from the base preset changing.
 */
export const DESIGN_PRESETS: Record<VisualPresetName, DesignPreset> = {
  'executive-dark': {
    name: 'executive-dark',
    palette: {
      primary: '#6366f1',
      accent: '#06b6d4',
      background: '#0f172a',
      surface: '#1e293b',
      textPrimary: '#f8fafc',
      textSecondary: '#94a3b8',
    },
    typography: typography(),
    spacing: BASE_SPACING,
    radii: BASE_RADII,
  },
  'modern-light': {
    name: 'modern-light',
    palette: {
      primary: '#4f46e5',
      accent: '#0891b2',
      background: '#ffffff',
      surface: '#f8fafc',
      textPrimary: '#0f172a',
      textSecondary: '#475569',
    },
    typography: typography(),
    spacing: BASE_SPACING,
    radii: BASE_RADII,
  },
  vibrant: {
    name: 'vibrant',
    palette: {
      primary: '#db2777',
      accent: '#f59e0b',
      background: '#18181b',
      surface: '#27272a',
      textPrimary: '#fafafa',
      textSecondary: '#d4d4d8',
    },
    typography: typography(),
    spacing: BASE_SPACING,
    radii: BASE_RADII,
  },
  minimal: {
    name: 'minimal',
    palette: {
      primary: '#18181b',
      accent: '#71717a',
      background: '#ffffff',
      surface: '#fafafa',
      textPrimary: '#18181b',
      textSecondary: '#71717a',
    },
    typography: typography(),
    spacing: BASE_SPACING,
    radii: { card: 8, pill: 999 },
  },
  corporate: {
    name: 'corporate',
    palette: {
      primary: '#1e3a8a',
      accent: '#0369a1',
      background: '#ffffff',
      surface: '#f1f5f9',
      textPrimary: '#0f172a',
      textSecondary: '#475569',
    },
    typography: typography(),
    spacing: BASE_SPACING,
    radii: { card: 4, pill: 999 },
  },
  social: {
    name: 'social',
    palette: {
      primary: '#7c3aed',
      accent: '#ec4899',
      background: '#0f0f12',
      surface: '#1c1c22',
      textPrimary: '#ffffff',
      textSecondary: '#a1a1aa',
    },
    typography: typography(),
    spacing: BASE_SPACING,
    radii: { card: 20, pill: 999 },
  },
}

export const DEFAULT_PRESET_NAME: VisualPresetName = 'executive-dark'

export function getPreset(name?: string): DesignPreset {
  if (name && isVisualPresetName(name)) {
    return DESIGN_PRESETS[name]
  }
  return DESIGN_PRESETS[DEFAULT_PRESET_NAME]
}

export function isVisualPresetName(value: string): value is VisualPresetName {
  return value in DESIGN_PRESETS
}
