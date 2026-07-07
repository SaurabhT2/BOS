// ============================================================
// @brandos/output-control-layer — artifact-compiler/adapters/weakModelAdapter.ts
//
// OCL Richness Adaptation — Weak / Sparse Model Output Handler
//
// PURPOSE:
//   When a model produces sparse output (only a headline, missing bullets,
//   tiny subtext, no structure), the OCL must:
//     - preserve whatever semantic signal IS present
//     - infer SAFE minimal defaults (not invented meaning)
//     - produce a valid CarouselArtifact / DraftArtifactInput
//     - NEVER hallucinate content, generate fake evidence, or invent claims
//
// ARCHITECTURAL RULES:
//   - No LLM calls. Deterministic only.
//   - No governance. ISkill downstream handles that.
//   - No runtime/provider coupling. Pure transform.
//   - Rich outputs MUST pass through untouched (see richPassthrough).
//
// ============================================================

import type {
  DraftArtifactInput,
  DraftArtifactSlide,
  DraftArtifactMeta,
  NormalizationTrace,
} from '@brandos/contracts';

import { inferRoleFromIndex } from '../utils/inferRoleFromIndex';

// ─── Threshold ────────────────────────────────────────────────────────────────

/**
 * TASK-4 FIX: Raised from 30 → 40.
 * Aligning with ISkill's MIN_RICHNESS_OVERALL=40 eliminates gap where
 * local models scored 31–39 (above 30 but below ISkill floor).
 */
export const WEAK_RICHNESS_THRESHOLD = 40;

// ─── Detection ───────────────────────────────────────────────────────────────

export interface RichnessSignal {
  /** Estimated overall richness 0–100 */
  estimatedScore: number;
  /** True when classified as weak/sparse */
  isWeak: boolean;
  /** Individual signal observations */
  signals: string[];
}

/**
 * detectRichness — lightweight pre-compiler richness probe.
 *
 * Scores: slide count, headline coverage, bullet richness, body text,
 * evidence/insight fields, meta completeness, role diversity.
 */
export function detectRichness(draft: DraftArtifactInput): RichnessSignal {
  const signals: string[] = [];
  let score = 0;

  const slides = draft.slides ?? draft.cards ?? [];

  // Slide count
  if (slides.length >= 6) { score += 20; signals.push('adequate_slide_count'); }
  else if (slides.length >= 3) { score += 10; signals.push('minimal_slide_count'); }
  else { signals.push('insufficient_slides'); }

  // Headline coverage
  const withHeadline = slides.filter(s => !!s.headline || !!s.title).length;
  if (withHeadline === slides.length && slides.length > 0) {
    score += 15;
    signals.push('full_headline_coverage');
  } else {
    signals.push('missing_headlines');
  }

  // Bullet richness
  const avgBullets = slides.length > 0
    ? slides.reduce((acc, s) => acc + (s.bullets?.length ?? 0), 0) / slides.length
    : 0;
  if (avgBullets >= 3) { score += 15; signals.push('rich_bullets'); }
  else if (avgBullets >= 1) { score += 7; signals.push('sparse_bullets'); }
  else { signals.push('no_bullets'); }

  // Body / prose text richness signal
  const withBodyContent = slides.filter(s => {
    const combined = [
      typeof (s as any).body === 'string' ? (s as any).body : '',
      typeof (s as any).subheadline === 'string' ? (s as any).subheadline : '',
      typeof (s as any).insight === 'string' ? (s as any).insight : '',
      typeof (s as any).key_takeaway === 'string' ? (s as any).key_takeaway : '',
      typeof (s as any).subtext === 'string' ? (s as any).subtext : '',
      typeof (s as any).description === 'string' ? (s as any).description : '',
    ].join(' ').trim();
    return combined.length > 20;
  }).length;
  if (slides.length > 0 && withBodyContent >= slides.length * 0.7) {
    score += 15;
    signals.push('body_text_rich');
  } else if (slides.length > 0 && withBodyContent >= slides.length * 0.4) {
    score += 8;
    signals.push('body_text_present');
  }

  // Evidence / insight fields
  const withEvidence = slides.filter(s =>
    s.supporting_evidence?.length || s.insight || s.key_takeaway
  ).length;
  if (slides.length > 0 && withEvidence >= slides.length * 0.5) {
    score += 15;
    signals.push('evidence_present');
  } else if (withEvidence > 0) {
    score += 5;
    signals.push('evidence_sparse');
  } else {
    signals.push('evidence_absent');
  }

  // Meta completeness
  const meta = draft.meta ?? {};
  if (meta.title && meta.hook && meta.cta) { score += 10; signals.push('meta_complete'); }
  else if (meta.title) { score += 3; signals.push('meta_partial'); }
  else { signals.push('meta_absent'); }

  // Role diversity
  const roles = new Set(slides.map(s => s.role).filter(Boolean));
  if (roles.size >= 4) { score += 10; signals.push('rich_role_diversity'); }
  else if (roles.size >= 2) { score += 5; signals.push('partial_role_diversity'); }

  return {
    estimatedScore: Math.min(100, score),
    isWeak: score < WEAK_RICHNESS_THRESHOLD,
    signals,
  };
}

// ─── Weak Output Normaliser ───────────────────────────────────────────────────

export interface WeakAdaptationResult {
  draft: DraftArtifactInput;
  trace: Pick<NormalizationTrace, 'steps' | 'warnings'>;
  wasAdapted: boolean;
}

/**
 * adaptWeakOutput — safe infill for sparse model outputs.
 *
 * GUARANTEES:
 *   - Never invents semantic claims, evidence, or insight text.
 *   - Promotes body prose to bullets when bullets array is absent.
 *   - Derives hook/CTA from richest slides, not just first/last.
 *   - Rich fields that ARE present are always preserved verbatim.
 *   - Output is always a syntactically valid DraftArtifactInput.
 *
 * DOES NOT:
 *   - Call any LLM.
 *   - Generate persuasion copy.
 *   - Validate semantics (ISkill does that).
 */
export function adaptWeakOutput(
  draft: DraftArtifactInput,
  topic: string,
): WeakAdaptationResult {
  const steps: string[] = [];
  const warnings: string[] = [];

  const rawSlides = draft.slides ?? draft.cards ?? [];

  const slides: DraftArtifactSlide[] = rawSlides.length > 0
    ? rawSlides.map((s, i) => normaliseWeakSlide(s, i, rawSlides.length, steps, warnings))
    : buildMinimalScaffold(steps, warnings);

  const meta = normaliseWeakMeta(draft.meta, topic, slides, steps, warnings);

  return {
    draft: { ...draft, slides, meta },
    trace: { steps, warnings },
    wasAdapted: steps.length > 0,
  };
}

// ─── Rich Passthrough ─────────────────────────────────────────────────────────

/**
 * richPassthrough — asserts that rich output is NOT modified.
 *
 * When OCL detects a rich output (overall_score >= WEAK_RICHNESS_THRESHOLD),
 * it calls this instead of adaptWeakOutput. No transformation performed.
 */
export function richPassthrough(draft: DraftArtifactInput): WeakAdaptationResult {
  return {
    draft,
    trace: { steps: ['rich_passthrough_no_transform'], warnings: [] },
    wasAdapted: false,
  };
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function splitBodyToBullets(body: string): string[] | undefined {
  if (!body || body.trim().length < 20) return undefined;
  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
  if (sentences.length >= 2) return sentences;
  const lines = body.split(/[\n;]/).map(s => s.trim()).filter(s => s.length > 10);
  if (lines.length >= 2) return lines;
  return undefined;
}

function normaliseWeakSlide(
  slide: DraftArtifactSlide,
  index: number,
  total: number,
  steps: string[],
  warnings: string[],
): DraftArtifactSlide {
  const result: DraftArtifactSlide = { ...slide };

  if (!result.headline && result.title) {
    result.headline = result.title;
    steps.push(`slide[${index}]:title_to_headline`);
  }
  if (!result.headline) {
    warnings.push(`slide[${index}]:missing_headline_unfillable`);
  }

  if (!result.role) {
    result.role = inferRoleFromIndex(index, total);
    steps.push(`slide[${index}]:role_inferred`);
  }

  if (!result.bullets || result.bullets.length === 0) {
    const bodySource: string = [
      (result as any).body,
      (result as any).subtext,
      (result as any).description,
    ]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .join(' ')
      .trim();

    if (bodySource.length > 0) {
      const derived = splitBodyToBullets(bodySource);
      if (derived && derived.length >= 2) {
        result.bullets = derived;
        steps.push(`slide[${index}]:bullets_derived_from_body`);
      } else {
        result.bullets = [bodySource];
        steps.push(`slide[${index}]:bullet_single_from_body`);
      }
    } else {
      result.bullets = [];
      steps.push(`slide[${index}]:bullets_defaulted_empty`);
    }
  }

  return result;
}

function buildMinimalScaffold(
  steps: string[],
  warnings: string[],
): DraftArtifactSlide[] {
  steps.push('minimal_scaffold_generated');
  warnings.push('model_returned_zero_slides:scaffold_only:expect_iskill_failure');
  return [
    { role: 'hook',    headline: '', bullets: [] },
    { role: 'problem', headline: '', bullets: [] },
    { role: 'solution',headline: '', bullets: [] },
    { role: 'cta',    headline: '', bullets: [] },
  ];
}

function findRichestHeadline(slides: DraftArtifactSlide[]): string | undefined {
  const ranked = [...slides].sort((a, b) => {
    const weight = (s: DraftArtifactSlide) =>
      (s.headline?.length ?? 0) +
      (s.bullets?.join(' ').length ?? 0) +
      ((s as any).body?.length ?? 0);
    return weight(b) - weight(a);
  });
  return ranked[0]?.headline ?? undefined;
}

function normaliseWeakMeta(
  meta: DraftArtifactMeta | undefined,
  topic: string,
  slides: DraftArtifactSlide[],
  steps: string[],
  warnings: string[],
): DraftArtifactMeta {
  const result: DraftArtifactMeta = { ...meta };

  if (!result.topic) {
    result.topic = topic;
    steps.push('meta:topic_from_request_context');
  }

  if (!result.title) {
    result.title = topic;
    steps.push('meta:title_derived_from_topic');
  }

  if (!result.hook) {
    const hookSlide = slides.find(s => s.role === 'hook');
    if (hookSlide?.headline && hookSlide.headline.length >= 8) {
      result.hook = hookSlide.headline;
      steps.push('meta:hook_from_hook_slide');
    } else {
      const richest = findRichestHeadline(slides.filter(s => s.role !== 'cta'));
      if (richest && richest.length >= 8) {
        result.hook = richest;
        steps.push('meta:hook_from_richest_slide');
      } else if (slides[0]?.headline) {
        result.hook = slides[0].headline;
        steps.push('meta:hook_from_first_slide_fallback');
      } else {
        warnings.push('meta:hook_unfillable');
      }
    }
  }

  if (!result.cta) {
    const ctaSlide = slides.find(s => s.role === 'cta');
    if (ctaSlide?.headline && ctaSlide.headline.length >= 5) {
      result.cta = ctaSlide.headline;
      steps.push('meta:cta_from_cta_slide');
    } else {
      const lastSlide = slides[slides.length - 1];
      if (lastSlide?.headline && lastSlide.headline.length >= 5) {
        result.cta = lastSlide.headline;
        steps.push('meta:cta_from_last_slide_fallback');
      } else {
        warnings.push('meta:cta_unfillable');
      }
    }
  }

  return result;
}


