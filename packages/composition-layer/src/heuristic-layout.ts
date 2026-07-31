// ============================================================
// packages/composition-layer/src/heuristic-layout.ts
//
// RENDERING V2 — PHASE 8: Layout Intelligence, step 2 (log-only) and
// step 3 (active). See COMPOSITION_MODEL.md §6 and
// RENDERING_ROADMAP_V2.md Phase 8.
//
// This is a STRATEGY for resolveLayout()'s existing pluggable
// LayoutResolutionStrategy seam (Phase 2) — NOT a new architectural layer.
// RENDERING_ARCHITECTURE_V2.md §2.4 explicitly rejects standing up a
// separate "Layout Intelligence subsystem": there is exactly one caller
// (resolveLayout()) whether the strategy is static or heuristic, which
// fails this document set's own "no abstraction without a second live
// caller" test for a standalone subsystem. This file lives inside
// composition-layer, beside layout.ts, not as its own package.
//
// WHAT THIS DOES: estimates whether the STATIC strategy's resolved
// archetype (layout_hint, or its per-role/per-type default) is a good
// content fit, by comparing the unit's actual content volume
// (headline/body length, bullet count, stat count) against each
// archetype's typical capacity. This is a HEIGHT-BUDGET HEURISTIC, not a
// measurement of anything a browser or PowerPoint will actually render —
// same category of honest limitation as Phase 5's PPTX height-budget
// mitigation (Finding M-1): a rough capacity model, tuned by inspection of
// this repo's own renderer implementations (HTML/PDF/PPTX region sizes),
// not derived from any font-metrics calculation.
//
// TWO INDEPENDENT FLAGS, matching the roadmap's explicit two-step sequence:
//   RENDERING_V2_LAYOUT_HEURISTIC_LOG   — compute the heuristic's opinion
//     and log a disagreement with the static choice, but ALWAYS return the
//     static choice unchanged. Validates whether the heuristic would
//     actually help before it's trusted with live output.
//   RENDERING_V2_LAYOUT_HEURISTIC_ACTIVE — additionally ACT on a strong
//     disagreement, returning the heuristic's suggested archetype instead
//     of the static one. Implies logging too (an active override that
//     isn't observable would be worse than the log-only step, not better).
// ============================================================

import type { ArtifactType } from '@brandos/contracts'
import { StaticLayoutStrategy, type LayoutResolutionContext, type LayoutResolutionStrategy } from './layout'
import type { ResolvedLayout } from './types'

export function isLayoutHeuristicLoggingEnabled(): boolean {
  return process.env.RENDERING_V2_LAYOUT_HEURISTIC_LOG === 'true' || isLayoutHeuristicActiveEnabled()
}

export function isLayoutHeuristicActiveEnabled(): boolean {
  return process.env.RENDERING_V2_LAYOUT_HEURISTIC_ACTIVE === 'true'
}

/** A disagreement must exceed this margin to be logged/acted on — avoids noise from marginal scoring differences. */
const DISAGREEMENT_THRESHOLD = 0.2

interface ArchetypeCapacity {
  maxHeadlineLength: number
  maxBodyLength: number
  maxBulletCount: number
  maxBulletTotalLength: number
  supportsStats: boolean
}

/**
 * Capacity model per archetype, tuned by inspection of this repo's own
 * renderer region sizes (apps/web/lib/artifact-export-html.ts's
 * LAYOUT_CARD_STYLE regions, artifact-export-pptx.ts's resolveRegions()) —
 * not derived from font-metrics measurement. See this file's header.
 */
const ARCHETYPE_CAPACITY: Record<ResolvedLayout, ArchetypeCapacity> = {
  centered: { maxHeadlineLength: 60, maxBodyLength: 120, maxBulletCount: 0, maxBulletTotalLength: 0, supportsStats: false },
  'headline-primary': { maxHeadlineLength: 90, maxBodyLength: 280, maxBulletCount: 3, maxBulletTotalLength: 180, supportsStats: false },
  'bullets-primary': { maxHeadlineLength: 90, maxBodyLength: 100, maxBulletCount: 6, maxBulletTotalLength: 420, supportsStats: false },
  split: { maxHeadlineLength: 70, maxBodyLength: 220, maxBulletCount: 5, maxBulletTotalLength: 320, supportsStats: false },
  'data-callout': { maxHeadlineLength: 70, maxBodyLength: 160, maxBulletCount: 3, maxBulletTotalLength: 180, supportsStats: true },
  'full-bleed': { maxHeadlineLength: 40, maxBodyLength: 60, maxBulletCount: 0, maxBulletTotalLength: 0, supportsStats: false },
  'stats-grid': { maxHeadlineLength: 50, maxBodyLength: 80, maxBulletCount: 4, maxBulletTotalLength: 200, supportsStats: true },
}

const ALL_ARCHETYPES: ResolvedLayout[] = [
  'centered', 'headline-primary', 'bullets-primary', 'split', 'data-callout', 'full-bleed', 'stats-grid',
]

/**
 * A ratio-of-capacity-used score for one dimension, clamped so being well
 * UNDER capacity doesn't count as a defect (a 10-character headline in a
 * 90-character-capacity archetype is not a worse fit than one using the
 * full 90) — only exceeding capacity should reduce the score.
 */
function dimensionScore(actual: number, capacity: number): number {
  if (capacity <= 0) return actual > 0 ? 0 : 1 // archetype doesn't support this content at all
  if (actual <= capacity) return 1
  return Math.max(0, capacity / actual) // overflow: score drops proportionally
}

/**
 * Overall fit score for one archetype against one unit's content, in
 * [0, 1]. Uses the WORST dimension, not an average — one badly-overflowing
 * dimension (e.g. way too many bullets) should dominate the score even if
 * every other dimension fits comfortably; averaging would let a bad
 * bullet-overflow hide behind a short headline.
 */
export function fitScore(ctx: LayoutResolutionContext, archetype: ResolvedLayout): number {
  const cap = ARCHETYPE_CAPACITY[archetype]
  const scores = [
    dimensionScore(ctx.headlineLength, cap.maxHeadlineLength),
    dimensionScore(ctx.bodyLength, cap.maxBodyLength),
    ctx.bulletCount > 0 ? dimensionScore(ctx.bulletCount, cap.maxBulletCount) : 1,
    ctx.bulletCount > 0 ? dimensionScore(ctx.bulletTotalLength, cap.maxBulletTotalLength) : 1,
  ]
  if (ctx.statCount > 0 && !cap.supportsStats) scores.push(0.3) // stats present but archetype has no natural place for them
  return Math.min(...scores)
}

/** The archetype with the highest fit score for this unit's content. Ties broken by ALL_ARCHETYPES' declared order (stable, deterministic). */
export function bestFittingArchetype(ctx: LayoutResolutionContext): ResolvedLayout {
  let best: ResolvedLayout = ALL_ARCHETYPES[0]!
  let bestScore = -1
  for (const archetype of ALL_ARCHETYPES) {
    const score = fitScore(ctx, archetype)
    if (score > bestScore) {
      best = archetype
      bestScore = score
    }
  }
  return best
}

export interface LayoutDisagreement {
  role: string
  staticChoice: ResolvedLayout
  staticScore: number
  suggestedChoice: ResolvedLayout
  suggestedScore: number
  scoreDelta: number
}

/**
 * Wraps StaticLayoutStrategy (Phase 2) — never replaces its logic, only
 * evaluates it. `active: false` = log-only (step 2); `active: true` = act
 * on strong disagreements too (step 3). See this file's header for the
 * flag-driven selection between these two.
 */
export class HeuristicFitStrategy implements LayoutResolutionStrategy {
  private readonly staticStrategy = new StaticLayoutStrategy()

  constructor(private readonly options: { active: boolean; onDisagreement?: (d: LayoutDisagreement) => void } = { active: false }) {}

  resolve(ctx: LayoutResolutionContext, artifactType: ArtifactType): ResolvedLayout {
    const staticChoice = this.staticStrategy.resolve(ctx, artifactType)
    const staticScore = fitScore(ctx, staticChoice)
    const suggestedChoice = bestFittingArchetype(ctx)
    const suggestedScore = fitScore(ctx, suggestedChoice)
    const scoreDelta = suggestedScore - staticScore

    if (suggestedChoice !== staticChoice && scoreDelta > DISAGREEMENT_THRESHOLD) {
      const disagreement: LayoutDisagreement = { role: ctx.role, staticChoice, staticScore, suggestedChoice, suggestedScore, scoreDelta }
      if (this.options.onDisagreement) {
        this.options.onDisagreement(disagreement)
      } else {
        console.log('[layout-heuristic] disagreement', JSON.stringify(disagreement))
      }
      if (this.options.active) return suggestedChoice
    }

    return staticChoice
  }
}

/**
 * Selects which strategy resolveLayout() should use by default, based on
 * the two Phase 8 flags. Called by compose.ts when the caller doesn't
 * supply an explicit ComposeOptions.layoutStrategy — see compose.ts's
 * composeArtifact() for the call site.
 */
export function getDefaultLayoutStrategy(): LayoutResolutionStrategy {
  if (isLayoutHeuristicActiveEnabled()) return new HeuristicFitStrategy({ active: true })
  if (isLayoutHeuristicLoggingEnabled()) return new HeuristicFitStrategy({ active: false })
  return new StaticLayoutStrategy()
}
