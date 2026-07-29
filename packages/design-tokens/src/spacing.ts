// ============================================================
// packages/design-tokens/src/spacing.ts
//
// One shared spacing unit, replacing the three independent numeric
// systems documented in RENDERING_ARCHITECTURE_AUDIT.md §11
// (literal HTML pixels, literal PPTX inch offsets, Tailwind classes).
// Renderers derive their own unit (px, inches, rem) from `unit`.
// ============================================================

export interface SpacingTokens {
  /** Base spacing unit, in a renderer-neutral unit (px-equivalent). */
  unit: number
  cardPadding: number
  sectionGap: number
}

export const BASE_SPACING: SpacingTokens = {
  unit: 8,
  cardPadding: 24,
  sectionGap: 32,
}
