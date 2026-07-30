// ============================================================
// packages/composition-layer/src/layout.ts
//
// resolveLayout() is the ONE place layout_hint is read and
// interpreted. Closes RENDERING_ARCHITECTURE_AUDIT.md Findings
// C-3/P-2. See COMPOSITION_MODEL.md §6 for the strategy design.
//
// IMPORTANT SCHEMA DETAIL (verified directly against
// packages/contracts/src/artifact-v2.ts before writing this file,
// not assumed from the prior audit's summary): carousel and deck
// slides have DIFFERENT layout_hint literal unions, and
// ReportSection/NewsletterSection have NO layout_hint field at
// all. So this is not "read one field, validate against one enum" —
// it is "map each artifact type's own raw vocabulary (or, where none
// exists, the unit's content shape) into the one shared archetype
// set every renderer implements."
// ============================================================

import type { ArtifactType, CarouselRole, DeckSlide, NewsletterSection } from '@brandos/contracts'
import type { ResolvedLayout } from './types'

/**
 * Renderer-agnostic input to layout resolution — built once per unit by
 * compose.ts from whichever artifact-type-specific slide/section shape it's
 * looking at. This is the seam a LayoutResolutionStrategy operates against,
 * so strategies never need to know about ArtifactV2's per-type shapes.
 *
 * PHASE 8 ADDITION: the quantitative fields (headlineLength through
 * statCount) were not needed by StaticLayoutStrategy (Phase 2), which only
 * ever needed to know THAT bullets/stats/etc. exist, not how much of them.
 * HeuristicFitStrategy (see heuristic-layout.ts) needs actual content
 * volume to estimate whether a resolved archetype will visually overflow —
 * a boolean "hasBullets" can't distinguish two bullets from twenty. Adding
 * these fields is backward compatible: StaticLayoutStrategy ignores them
 * entirely, and every compose.ts call site that builds a
 * LayoutResolutionContext already has this data close at hand (it's the
 * same slide/section object compose.ts is already reading to build blocks).
 */
export interface LayoutResolutionContext {
  /** carousel role / deck slide type / report section id / newsletter section type */
  role: string
  /** Present only for carousel/deck (the only two schemas that carry the field). */
  rawLayoutHint?: string
  hasBullets: boolean
  hasStats: boolean
  hasDataPoints: boolean
  hasKeyFindings: boolean
  /** Character length of the unit's primary heading text (0 if none). */
  headlineLength: number
  /** Character length of the unit's body text (0 if none). */
  bodyLength: number
  /** Number of bullet/key-finding items (0 if none). */
  bulletCount: number
  /** Combined character length of all bullet/key-finding items (0 if none). */
  bulletTotalLength: number
  /** Number of stat entries (0 if none; only decks currently produce these). */
  statCount: number
}

export interface LayoutResolutionStrategy {
  resolve(ctx: LayoutResolutionContext, artifactType: ArtifactType): ResolvedLayout
}

// ── Carousel: layout_hint → archetype ──────────────────────────────────────
const CAROUSEL_HINT_MAP: Record<string, ResolvedLayout> = {
  centered: 'centered',
  'headline-only': 'headline-primary',
  'bullets-primary': 'bullets-primary',
  split: 'split',
  'data-callout': 'data-callout',
  'full-bleed': 'full-bleed',
}

const CAROUSEL_ROLE_DEFAULT: Record<CarouselRole, ResolvedLayout> = {
  hook: 'full-bleed',
  problem: 'headline-primary',
  reframe: 'headline-primary',
  framework: 'data-callout',
  evidence: 'bullets-primary',
  insight: 'data-callout',
  cta: 'centered',
}

// ── Deck: layout_hint → archetype ──────────────────────────────────────────
const DECK_HINT_MAP: Record<string, ResolvedLayout> = {
  centered: 'centered',
  'title-top': 'headline-primary',
  'two-column': 'split',
  'image-left': 'split',
  'image-right': 'split',
  'stats-grid': 'stats-grid',
  'big-text': 'full-bleed',
}

const DECK_TYPE_DEFAULT: Record<DeckSlide['type'], ResolvedLayout> = {
  cover: 'full-bleed',
  agenda: 'bullets-primary',
  content: 'headline-primary',
  divider: 'full-bleed',
  stats: 'stats-grid',
  quote: 'centered',
  closing: 'full-bleed',
}

// ── Newsletter: no layout_hint field — content-shape/type-only default ────
const NEWSLETTER_TYPE_DEFAULT: Record<NewsletterSection['type'], ResolvedLayout> = {
  intro: 'headline-primary',
  story: 'headline-primary',
  'quick-takes': 'bullets-primary',
  callout: 'data-callout',
  cta: 'centered',
  sponsor: 'data-callout',
  divider: 'full-bleed',
}

/**
 * Static strategy — Phase 2 scope (COMPOSITION_MODEL.md §6, step 1). Reads
 * the raw hint verbatim when present and recognized; falls back to a
 * per-role/per-type default when absent or unrecognized (never throws on an
 * invalid/unexpected raw value — governance is responsible for schema
 * conformance upstream; this function's job is to always return a valid
 * ResolvedLayout, not to re-validate the artifact).
 */
export class StaticLayoutStrategy implements LayoutResolutionStrategy {
  resolve(ctx: LayoutResolutionContext, artifactType: ArtifactType): ResolvedLayout {
    switch (artifactType) {
      case 'carousel': {
        const fromHint = ctx.rawLayoutHint ? CAROUSEL_HINT_MAP[ctx.rawLayoutHint] : undefined
        return fromHint ?? CAROUSEL_ROLE_DEFAULT[ctx.role as CarouselRole] ?? 'centered'
      }
      case 'deck': {
        const fromHint = ctx.rawLayoutHint ? DECK_HINT_MAP[ctx.rawLayoutHint] : undefined
        return fromHint ?? DECK_TYPE_DEFAULT[ctx.role as DeckSlide['type']] ?? 'centered'
      }
      case 'report': {
        // No layout_hint field exists on ReportSection — the only signal
        // available is the section's own resolved content shape.
        if (ctx.hasDataPoints) return 'data-callout'
        if (ctx.hasKeyFindings || ctx.hasBullets) return 'bullets-primary'
        return 'headline-primary'
      }
      case 'newsletter': {
        return NEWSLETTER_TYPE_DEFAULT[ctx.role as NewsletterSection['type']] ?? 'centered'
      }
      default:
        // landing_page / social_post / thread — no compose() path exists for
        // these yet (see compose.ts's explicit UnsupportedArtifactTypeError).
        // resolveLayout() is never reached for them, but a strategy must
        // still return a total function per its own interface contract.
        return 'centered'
    }
  }
}

export const DEFAULT_LAYOUT_STRATEGY: LayoutResolutionStrategy = new StaticLayoutStrategy()

export function resolveLayout(
  ctx: LayoutResolutionContext,
  artifactType: ArtifactType,
  strategy: LayoutResolutionStrategy = DEFAULT_LAYOUT_STRATEGY
): ResolvedLayout {
  return strategy.resolve(ctx, artifactType)
}
