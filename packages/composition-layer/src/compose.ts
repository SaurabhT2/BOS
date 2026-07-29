// ============================================================
// packages/composition-layer/src/compose.ts
//
// composeArtifact() is the single function that turns a governed
// ArtifactV2 into a CompositionDocument. It is the only caller of
// resolveTheme() and resolveLayout(), and the only place
// emphasis_keywords are folded into block content instead of being
// silently dropped (RENDERING_ARCHITECTURE_AUDIT.md: today only the
// Studio CarouselRenderer notices emphasis_keywords at all; no
// export renderer does). See COMPOSITION_MODEL.md §3.2.
// ============================================================

import {
  isCarouselArtifact,
  isDeckArtifact,
  isReportArtifact,
  isNewsletterArtifact,
  type ArtifactV2,
  type RichCarouselSlide,
  type DeckSlide,
  type ReportSection,
  type NewsletterSection,
} from '@brandos/contracts'
import { resolveTheme, type BrandContextInput } from './theme'
import { resolveLayout, type LayoutResolutionStrategy, type LayoutResolutionContext } from './layout'
import type { CompositionDocument, CompositionUnit, CompositionBlock, PageBreakPolicy } from './types'

export class UnsupportedArtifactTypeError extends Error {
  constructor(artifactType: string) {
    super(
      `@brandos/composition-layer: composeArtifact() has no implementation for artifact_type "${artifactType}". ` +
        `Only carousel, deck, report, and newsletter are currently composed — this mirrors the current export ` +
        `pipeline's own scope (RENDERING_ARCHITECTURE_AUDIT.md §3); landing_page/social_post/thread have no ` +
        `renderer today either, so this is an explicit, honest failure rather than a silent no-op.`
    )
    this.name = 'UnsupportedArtifactTypeError'
  }
}

export interface ComposeOptions {
  brandContext?: BrandContextInput
  layoutStrategy?: LayoutResolutionStrategy
}

/**
 * Finds which keywords appear (case-insensitive substring match) in a given
 * text, assigning each keyword to at most one of the candidate texts — the
 * first one it matches in, in the order the candidates are given. Keywords
 * matching neither candidate still get attached to the FIRST candidate
 * (usually the heading) as a fallback, per COMPOSITION_MODEL.md §3.2's
 * "never silently dropped" requirement — a keyword the LLM flagged as
 * emphasis-worthy that doesn't literally substring-match either field is
 * still a real signal a renderer can use (e.g. bold it in a small caption),
 * not a reason to discard it.
 */
function foldEmphasisKeywords(
  candidates: Array<{ text: string }>,
  keywords: string[] | undefined
): string[][] {
  const result: string[][] = candidates.map(() => [])
  if (!keywords || keywords.length === 0) return result

  for (const keyword of keywords) {
    const lower = keyword.toLowerCase()
    const matchIndex = candidates.findIndex((c) => c.text.toLowerCase().includes(lower))
    const targetIndex = matchIndex >= 0 ? matchIndex : 0
    result[targetIndex]!.push(keyword)
  }
  return result
}

function emphasisOrUndefined(list: string[]): string[] | undefined {
  return list.length > 0 ? list : undefined
}

// ── Carousel ────────────────────────────────────────────────────────────

function composeCarouselBlocks(slide: RichCarouselSlide): CompositionBlock[] {
  const candidates = [{ text: slide.headline }, { text: slide.body ?? '' }]
  const [headlineEmphasis, bodyEmphasis] = foldEmphasisKeywords(candidates, slide.emphasis_keywords)

  const blocks: CompositionBlock[] = [
    { kind: 'heading', level: 1, text: slide.headline, emphasis: emphasisOrUndefined(headlineEmphasis!) },
  ]
  if (slide.subheadline) blocks.push({ kind: 'heading', level: 2, text: slide.subheadline })
  if (slide.body) blocks.push({ kind: 'body', text: slide.body, emphasis: emphasisOrUndefined(bodyEmphasis!) })
  if (slide.bullets?.length) blocks.push({ kind: 'bullets', items: slide.bullets })
  if (slide.insight) blocks.push({ kind: 'callout', variant: 'insight', text: slide.insight })
  if (slide.supporting_evidence?.length) blocks.push({ kind: 'evidence-list', items: slide.supporting_evidence })
  if (slide.key_takeaway) blocks.push({ kind: 'callout', variant: 'takeaway', text: slide.key_takeaway })
  if (slide.speaker_notes) blocks.push({ kind: 'speaker-notes', text: slide.speaker_notes })
  return blocks
}

function composeCarouselUnits(artifact: ArtifactV2 & { artifact_type: 'carousel' }, strategy?: LayoutResolutionStrategy): CompositionUnit[] {
  return artifact.slides.map((slide) => {
    const ctx: LayoutResolutionContext = {
      role: slide.role,
      rawLayoutHint: slide.layout_hint,
      hasBullets: !!slide.bullets?.length,
      hasStats: false,
      hasDataPoints: false,
      hasKeyFindings: false,
    }
    // Every carousel slide is a self-contained visual card — protect it from
    // mid-card page/screen breaks, extending the protection the audit found
    // deck-only today (RENDERING_ARCHITECTURE_AUDIT.md §11, "Page breaks"
    // row) to carousel as well. This is an explicit, documented behavior
    // change for Phase 4 (PDF), not a silent one.
    const pageBreak: PageBreakPolicy = 'avoid'
    return {
      id: `carousel-slide-${slide.slide}`,
      role: slide.role,
      layout: resolveLayout(ctx, 'carousel', strategy),
      blocks: composeCarouselBlocks(slide),
      pageBreak,
    }
  })
}

// ── Deck ────────────────────────────────────────────────────────────────

function composeDeckBlocks(slide: DeckSlide): CompositionBlock[] {
  const blocks: CompositionBlock[] = [{ kind: 'heading', level: 1, text: slide.title }]
  if (slide.subtitle) blocks.push({ kind: 'heading', level: 2, text: slide.subtitle })
  if (slide.body) blocks.push({ kind: 'body', text: slide.body })
  if (slide.bullets?.length) blocks.push({ kind: 'bullets', items: slide.bullets })
  if (slide.stats?.length) blocks.push({ kind: 'stat-row', stats: slide.stats })
  if (slide.speaker_notes) blocks.push({ kind: 'speaker-notes', text: slide.speaker_notes })
  return blocks
}

const DECK_ALWAYS_BREAK_TYPES: ReadonlySet<DeckSlide['type']> = new Set(['cover', 'divider', 'closing'])

function composeDeckUnits(artifact: ArtifactV2 & { artifact_type: 'deck' }, strategy?: LayoutResolutionStrategy): CompositionUnit[] {
  return artifact.slides.map((slide) => {
    const ctx: LayoutResolutionContext = {
      role: slide.type,
      rawLayoutHint: slide.layout_hint,
      hasBullets: !!slide.bullets?.length,
      hasStats: !!slide.stats?.length,
      hasDataPoints: false,
      hasKeyFindings: false,
    }
    const pageBreak: PageBreakPolicy = DECK_ALWAYS_BREAK_TYPES.has(slide.type) ? 'always' : 'avoid'
    return {
      id: `deck-slide-${slide.slide}`,
      role: slide.type,
      layout: resolveLayout(ctx, 'deck', strategy),
      blocks: composeDeckBlocks(slide),
      pageBreak,
    }
  })
}

// ── Report ──────────────────────────────────────────────────────────────

function composeReportBlocks(section: ReportSection): CompositionBlock[] {
  const blocks: CompositionBlock[] = [{ kind: 'heading', level: 1, text: section.heading }]
  if (section.subheading) blocks.push({ kind: 'heading', level: 2, text: section.subheading })
  blocks.push({ kind: 'body', text: section.body })
  if (section.key_findings?.length) blocks.push({ kind: 'bullets', items: section.key_findings })
  if (section.data_points?.length) {
    // ReportSection.data_points is { label, value, source? } — there is no
    // stat-row-shaped equivalent for "source" (stat-row's `delta` means
    // something different: a change indicator, not a citation). Modeling
    // data_points as an evidence-list of formatted strings is the closest
    // honest fit among the existing block kinds, rather than stretching
    // stat-row's `delta` field to mean something it doesn't.
    const items = section.data_points.map((dp) => (dp.source ? `${dp.label}: ${dp.value} (${dp.source})` : `${dp.label}: ${dp.value}`))
    blocks.push({ kind: 'evidence-list', items })
  }
  return blocks
}

function composeReportUnits(artifact: ArtifactV2 & { artifact_type: 'report' }, strategy?: LayoutResolutionStrategy): CompositionUnit[] {
  return artifact.sections.map((section) => {
    const ctx: LayoutResolutionContext = {
      role: section.id,
      hasBullets: !!section.key_findings?.length,
      hasStats: false,
      hasDataPoints: !!section.data_points?.length,
      hasKeyFindings: !!section.key_findings?.length,
    }
    return {
      id: `report-section-${section.id}`,
      role: section.id,
      layout: resolveLayout(ctx, 'report', strategy),
      blocks: composeReportBlocks(section),
      // Reports are a flowing document (RENDERING_ARCHITECTURE_AUDIT.md §3:
      // "a genuinely flowing document layout... unlike carousel/deck's
      // per-unit card stack") — 'avoid' would fight that shape by forcing
      // every section to protect against a break the document doesn't need.
      // 'auto' lets each renderer's own pagination logic decide.
      pageBreak: 'auto',
    }
  })
}

// ── Newsletter ──────────────────────────────────────────────────────────

function composeNewsletterBlocks(section: NewsletterSection): CompositionBlock[] {
  const blocks: CompositionBlock[] = []
  if (section.heading) blocks.push({ kind: 'heading', level: 1, text: section.heading })
  blocks.push({ kind: 'body', text: section.body })
  if (section.bullets?.length) blocks.push({ kind: 'bullets', items: section.bullets })
  if (section.callout) blocks.push({ kind: 'callout', variant: 'quote', text: section.callout })
  return blocks
}

function composeNewsletterUnits(artifact: ArtifactV2 & { artifact_type: 'newsletter' }, strategy?: LayoutResolutionStrategy): CompositionUnit[] {
  return artifact.sections.map((section, index) => {
    const ctx: LayoutResolutionContext = {
      role: section.type,
      hasBullets: !!section.bullets?.length,
      hasStats: false,
      hasDataPoints: false,
      hasKeyFindings: false,
    }
    return {
      id: `newsletter-section-${section.id ?? index}`,
      role: section.type,
      layout: resolveLayout(ctx, 'newsletter', strategy),
      blocks: composeNewsletterBlocks(section),
      pageBreak: section.type === 'divider' ? 'always' : 'auto',
    }
  })
}

// ── Entry point ───────────────────────────────────────────────────────────

export function composeArtifact(artifact: ArtifactV2, options?: ComposeOptions): CompositionDocument {
  // Type-guard dispatch happens BEFORE resolveTheme() is called. Resolving
  // theme first would call into semantic_theme-reading code against a value
  // that isn't actually a valid ArtifactV2 (see the defensive-branch comment
  // below), producing a confusing unrelated crash instead of this function's
  // own clear, named error — caught by compose.test.ts's malformed-input case.
  let buildUnits: () => CompositionUnit[]
  if (isCarouselArtifact(artifact)) {
    buildUnits = () => composeCarouselUnits(artifact, options?.layoutStrategy)
  } else if (isDeckArtifact(artifact)) {
    buildUnits = () => composeDeckUnits(artifact, options?.layoutStrategy)
  } else if (isReportArtifact(artifact)) {
    buildUnits = () => composeReportUnits(artifact, options?.layoutStrategy)
  } else if (isNewsletterArtifact(artifact)) {
    buildUnits = () => composeNewsletterUnits(artifact, options?.layoutStrategy)
  } else {
    // Defensive runtime guard: ArtifactV2's type-level union only has 4
    // members, so TypeScript (correctly) considers this branch unreachable
    // for well-typed input. It is NOT unreachable for a value that arrived
    // here without going through governance/type validation (e.g. straight
    // off an untyped JSON.parse) — keeping it is deliberate defense against
    // that case, not dead code.
    const unknownArtifact = artifact as unknown as { artifact_type: string }
    throw new UnsupportedArtifactTypeError(unknownArtifact.artifact_type)
  }

  const theme = resolveTheme(artifact, options?.brandContext)
  const units = buildUnits()

  return {
    artifactId: artifact.id,
    artifactType: artifact.artifact_type,
    artifactVersion: artifact.created_at,
    theme,
    units,
  }
}
