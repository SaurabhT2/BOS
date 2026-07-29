// ============================================================
// packages/design-tokens/src/typography.ts
//
// A single shared type scale + font-stack vocabulary, replacing
// the three independent literal-pixel-value systems documented in
// RENDERING_ARCHITECTURE_AUDIT.md §6/§11 (HTML inline styles,
// Tailwind text-size classes, pptxgenjs point sizes).
// ============================================================

/** Relative type scale — renderers convert to their own unit (px, pt, Tailwind class). */
export interface TypeScale {
  h1: number
  h2: number
  h3: number
  body: number
  caption: number
}

export interface TypographyTokens {
  titleFont: string
  bodyFont: string
  scale: TypeScale
}

/** The system-font stack the current HTML renderer already uses — kept as the default. */
export const DEFAULT_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"

/** Base type scale, in a renderer-neutral unit (points). HTML/PPTX renderers each convert. */
export const BASE_TYPE_SCALE: TypeScale = {
  h1: 34,
  h2: 24,
  h3: 18,
  body: 14,
  caption: 11,
}
