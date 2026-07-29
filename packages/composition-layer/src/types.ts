// ============================================================
// packages/composition-layer/src/types.ts
//
// The CompositionDocument type family — see COMPOSITION_MODEL.md §4.
// This is the only render target every format renderer consumes.
// No format-specific geometry, no I/O, no artifact-shaped fields —
// by the time this type is populated, every presentation decision
// has already been made once, upstream, by theme.ts/layout.ts/compose.ts.
// ============================================================

import type { PaletteRoles, TypographyTokens, SpacingTokens, RadiusTokens } from '@brandos/design-tokens'
import type { ArtifactType } from '@brandos/contracts'

/** Fully resolved theme — no optional fields. Built once per (artifact, brandContext) pair by resolveTheme(). */
export interface ResolvedTheme {
  palette: PaletteRoles
  typography: TypographyTokens
  spacing: SpacingTokens
  radii: RadiusTokens
}

/**
 * The closed set of renderer-agnostic layout archetypes. Deliberately NOT a
 * free-form layout description language (see COMPOSITION_MODEL.md §4) — each
 * renderer implements its own concrete geometry for each archetype name.
 */
export type ResolvedLayout =
  | 'centered'
  | 'headline-primary'
  | 'bullets-primary'
  | 'split'
  | 'data-callout'
  | 'full-bleed'
  | 'stats-grid'

export type CompositionBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string; emphasis?: string[] }
  | { kind: 'body'; text: string; emphasis?: string[] }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'callout'; variant: 'insight' | 'takeaway' | 'quote'; text: string }
  | { kind: 'stat-row'; stats: Array<{ value: string; label: string; delta?: string }> }
  | { kind: 'evidence-list'; items: string[] }
  | { kind: 'speaker-notes'; text: string }

export type PageBreakPolicy = 'auto' | 'always' | 'avoid'

export interface CompositionUnit {
  /** Stable across re-composition (same artifact + same unit index), for caching/diffing. */
  id: string
  /** Carousel role / deck slide type / report section id / newsletter section type. */
  role: string
  layout: ResolvedLayout
  blocks: CompositionBlock[]
  pageBreak: PageBreakPolicy
}

export interface CompositionDocument {
  artifactId: string
  artifactType: ArtifactType
  /** Mirrors BaseArtifact.created_at at composition time — part of the cache key (COMPOSITION_MODEL.md §8). */
  artifactVersion: string
  theme: ResolvedTheme
  units: CompositionUnit[]
}
