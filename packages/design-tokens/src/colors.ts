// ============================================================
// packages/design-tokens/src/colors.ts
//
// Color ROLE tokens — not literal artifact colors.
//
// This file defines the closed set of palette *roles* every
// renderer and every resolved theme is built from. It does not
// know what "executive-dark" looks like — that mapping lives in
// presets.ts, which is a values file, not a decision file.
//
// All hex values here include the leading '#' (CSS/pptxgenjs-hex-
// string conversion is a renderer concern, not a token concern —
// see RENDERER_CONTRACT.md §2). Note that ArtifactV2's
// SemanticTheme.primaryColor/accentColor/bgColor are documented as
// "6-char hex, no #" — callers resolving those into a PaletteRoles
// override are responsible for normalizing the '#' prefix; this
// package does not accept raw semantic_theme input at all (that is
// @brandos/composition-layer's resolveTheme() responsibility).
// ============================================================

/** The closed set of color roles every ResolvedTheme carries. */
export interface PaletteRoles {
  primary: string
  accent: string
  background: string
  surface: string
  textPrimary: string
  textSecondary: string
}

export function isValidHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(value)
}

/** Normalizes a hex color to include a leading '#'. Accepts values with or without one. */
export function normalizeHexColor(value: string): string {
  const withHash = value.startsWith('#') ? value : `#${value}`
  if (!isValidHexColor(withHash)) {
    throw new Error(`design-tokens: invalid hex color "${value}"`)
  }
  return withHash
}
