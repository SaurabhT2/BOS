// ============================================================
// packages/design-tokens/src/index.ts
//
// Public API of @brandos/design-tokens.
// Zero dependencies (DESIGN_SYSTEM_ARCHITECTURE.md §4).
// Values only — no resolution logic. Resolution (reading
// semantic_theme, applying brand overrides) is
// @brandos/composition-layer's job, not this package's.
// ============================================================

export type { PaletteRoles } from './colors'
export { isValidHexColor, normalizeHexColor } from './colors'

export type { TypeScale, TypographyTokens } from './typography'
export { DEFAULT_FONT_STACK, BASE_TYPE_SCALE } from './typography'

export type { SpacingTokens } from './spacing'
export { BASE_SPACING } from './spacing'

export type { RadiusTokens } from './radii'
export { BASE_RADII } from './radii'

export type { VisualPresetName, DesignPreset } from './presets'
export {
  DESIGN_PRESETS,
  DEFAULT_PRESET_NAME,
  getPreset,
  isVisualPresetName,
} from './presets'
