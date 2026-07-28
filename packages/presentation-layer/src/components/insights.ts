/**
 * insights.ts — pure data shaping for the Inspect panel.
 *
 * Iteration 3 (Artifact-first redesign): technical/implementation detail that
 * used to be rendered inline inside each renderer (richness scores, per-slide
 * density badges, the generation_trace footer) moves out of the renderer tree
 * entirely and into a single, consolidated inspection experience.
 *
 * This module holds ONLY pure data shaping — no React, no fetch, no side
 * effects — so it can be unit tested in isolation and reused identically by
 * every artifact type instead of each renderer reimplementing its own
 * "how do I read a score out of this artifact" logic (that duplication is
 * exactly what shipped in Iteration 1: the same richness/trace block,
 * hand-copied into CarouselRenderer, DeckRenderer, and ReportRenderer).
 *
 * I-1 (no semantic inference) still applies: these functions reshape data
 * that already exists on the artifact or was already tracked by the caller
 * (apps/web) — they never invent or infer a judgment the system didn't make.
 */

import type { GenerationTrace, RichnessMetrics } from '@brandos/contracts'

// ─── Pillar shapes ──────────────────────────────────────────────────────────

export interface ExecutionInsight {
  generatedAt?: string
  provider?: string
  generationMode?: string
  governanceOutcome?: GenerationTrace['governance_outcome']
  repairAttempts?: number
  oclStrategy?: string
}

export interface QualityScore {
  label: string
  value: number
}

export interface QualityInsight {
  overallScore?: number
  scores: QualityScore[]
  totalWords?: number
  avgWordsPerUnit?: number
}

export interface KnowledgeItem {
  label: string
  value?: string
  source?: string
}

export interface IdentityInsight {
  /** Whether Brand Memory was applied for this generation. Sourced from the
   *  request-time toggle the user already sees on the compose screen — this
   *  is a real, known value, not an inferred one. */
  brandMemoryApplied?: boolean
}

export interface LearningInsight {
  feedbackSubmitted?: 'useful' | 'generic' | null
  onSubmitFeedback?: (label: 'useful' | 'generic') => void
  /** ISkill violations that were resolved via governance repair, when any. */
  resolvedViolations?: string[]
}

export interface ArtifactInsightSections {
  execution?: ExecutionInsight
  quality?: QualityInsight
  knowledge?: KnowledgeItem[]
  identity?: IdentityInsight
  learning?: LearningInsight
}

// ─── Builders ───────────────────────────────────────────────────────────────

const SCORE_LABEL_OVERRIDES: Record<string, string> = {
  cta_quality_score: 'CTA Quality',
}

function scoreLabel(key: string): string {
  if (SCORE_LABEL_OVERRIDES[key]) return SCORE_LABEL_OVERRIDES[key]
  return key
    .replace(/_score$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Every canonical ArtifactV2 already carries a `generation_trace` — this
 * builder just reshapes it for display. No new data source required.
 */
export function buildExecutionInsight(trace?: GenerationTrace): ExecutionInsight | undefined {
  if (!trace) return undefined
  return {
    generatedAt: trace.generated_at,
    provider: trace.provider,
    generationMode: trace.generation_mode,
    governanceOutcome: trace.governance_outcome,
    repairAttempts: trace.repair_attempts,
    oclStrategy: trace.ocl_strategy,
  }
}

/**
 * Every canonical ArtifactV2 already carries `richness_metrics` in the same
 * shape (see @brandos/contracts RichnessMetrics) — one builder covers
 * carousel, deck, report, and newsletter without per-type branching.
 */
export function buildQualityInsight(metrics?: RichnessMetrics): QualityInsight | undefined {
  if (!metrics) return undefined
  const scores: QualityScore[] = (
    ['density_score', 'evidence_score', 'persuasion_score', 'cta_quality_score',
      'narrative_coherence_score', 'hook_strength_score', 'audience_alignment_score'] as const
  )
    .filter((key) => typeof metrics[key] === 'number')
    .map((key) => ({ label: scoreLabel(key), value: metrics[key] as number }))

  return {
    overallScore: metrics.overall_score,
    scores,
    totalWords: metrics.total_content_words,
    avgWordsPerUnit: metrics.avg_words_per_unit,
  }
}

/**
 * Learning is the one pillar with no artifact-level data source — it's
 * captured per session by apps/web (the "Useful? / Generic" feedback
 * control). The builder just normalizes whatever the caller already tracked.
 */
export function buildLearningInsight(input: LearningInsight | undefined): LearningInsight | undefined {
  if (!input) return undefined
  return input
}
