// ============================================================
// packages/composition-layer/src/index.ts
//
// Public API of @brandos/composition-layer.
// See COMPOSITION_MODEL.md for the full design.
// ============================================================

export type {
  CompositionDocument,
  CompositionUnit,
  CompositionBlock,
  ResolvedTheme,
  ResolvedLayout,
  PageBreakPolicy,
} from './types'

export { resolveTheme, isValidHexColor, type BrandContextInput } from './theme'

export {
  resolveLayout,
  StaticLayoutStrategy,
  DEFAULT_LAYOUT_STRATEGY,
  type LayoutResolutionContext,
  type LayoutResolutionStrategy,
} from './layout'

export { composeArtifact, UnsupportedArtifactTypeError, type ComposeOptions } from './compose'

export type { Renderer, RenderOptions, RenderOutput } from './renderer-contract'
