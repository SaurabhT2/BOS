/**
 * @brandos/output-control-layer — artifact-compiler/compilers/carouselCompiler.ts
 *
 * OCL Carousel Compiler
 *
 * PIPELINE:
 *   rawLLMOutput (string)
 *     → clean (strip fences, preamble, etc.)
 *     → parse (JSON extraction / markdown parse)
 *     → coerce (fill missing fields with semantic inference)
 *     → score (compute richness metrics)
 *     → compile → CarouselArtifact
 *
 * ARCHITECTURAL RULES:
 *   - OCL = deterministic compiler. No LLM calls. No retries. No governance.
 *   - Output is always a typed CarouselArtifact. Never a plain object.
 *   - ISkill validates the compiled artifact. OCL does NOT validate.
 *   - ArtifactV2 = canonical. Never return CarouselBlueprint from this layer.
 *
 * @module output-control-layer/artifact-compiler/compilers/carouselCompiler
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  CarouselArtifact,
  RichCarouselSlide,
  CarouselMeta,
  RichnessMetrics,
  GenerationTrace,
  NarrativeArc,
  AudienceProfile,
  SemanticTheme,
  ExportMetadata,
  CarouselRole,
  DraftArtifactInput,
  DraftArtifactMeta,
  DraftArtifactSlide,
  NormalizationTrace,
} from '@brandos/contracts';

import { cleanOutput } from '../../output-normalizer/pipeline/cleanOutput';
import { extractJSON } from '../../output-normalizer/pipeline/extractJSON';
import { detectRichness, adaptWeakOutput, richPassthrough } from '../adapters/weakModelAdapter';
import { normalizeRawSlideObject } from '../utils/normalizeRawSlideObject';
import { CAROUSEL_STRUCTURAL_CONSTRAINTS } from '@brandos/contracts';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PALETTE = ['#0f172a', '#1e293b', '#06b6d4', '#8b5cf6', '#f8fafc'];

// ─── Compute richness metrics ─────────────────────────────────────────────────

function computeRichnessMetrics(slides: RichCarouselSlide[], cta: string): RichnessMetrics {
  if (slides.length === 0) {
    return {
      overall_score: 0, density_score: 0, evidence_score: 0, persuasion_score: 0,
      cta_quality_score: 0, narrative_coherence_score: 0, hook_strength_score: 0,
      audience_alignment_score: 50, total_content_words: 0, avg_words_per_unit: 0,
    };
  }

  const densities = slides.map(s => s.semantic_density_score ?? 0);
  const persuasions = slides.map(s => s.persuasion_score ?? 0);
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const density_score = Math.round(avg(densities));
  const persuasion_score = Math.round(avg(persuasions));

  const slidesWithEvidence = slides.filter(s =>
    (s.supporting_evidence?.length ?? 0) > 0 ||
    (s.bullets?.length ?? 0) >= 3
  ).length;
  const evidence_score = Math.round((slidesWithEvidence / slides.length) * 100);

  const ctaWords = cta.trim().split(/\s+/).filter(Boolean).length;
  const cta_quality_score = Math.min(100, Math.round((ctaWords / 12) * 100));

  const presentRoles = new Set(slides.map(s => s.role));
  const requiredRoles: CarouselRole[] = ['hook', 'evidence', 'cta'];
  const roleCoverage = requiredRoles.filter(r => presentRoles.has(r)).length / requiredRoles.length;
  const narrative_coherence_score = Math.round(roleCoverage * 100);

  const hookSlide = slides.find(s => s.role === 'hook');
  const hook_strength_score = hookSlide
    ? Math.round(((hookSlide.semantic_density_score ?? 0) + (hookSlide.persuasion_score ?? 0)) / 2)
    : 30;

  const allWords = slides.flatMap(s => [
    s.headline ?? '', s.subheadline ?? '', s.body ?? '',
    ...(s.bullets ?? []), s.insight ?? '', s.key_takeaway ?? '',
  ]).join(' ').split(/\s+/).filter(Boolean);
  const total_content_words = allWords.length;
  const avg_words_per_unit = slides.length > 0 ? Math.round(total_content_words / slides.length) : 0;

  const overall_score = Math.round(
    density_score * 0.25 +
    evidence_score * 0.20 +
    persuasion_score * 0.20 +
    cta_quality_score * 0.10 +
    narrative_coherence_score * 0.15 +
    hook_strength_score * 0.10
  );

  return {
    overall_score, density_score, evidence_score, persuasion_score,
    cta_quality_score, narrative_coherence_score, hook_strength_score,
    audience_alignment_score: 60, // OCL cannot evaluate this — ISkill does
    total_content_words, avg_words_per_unit,
  };
}

// ─── Infer narrative arc ──────────────────────────────────────────────────────

function inferNarrativeArc(slides: RichCarouselSlide[], title: string, cta: string): NarrativeArc {
  const hookSlide = slides.find(s => s.role === 'hook');
  const ctaSlide = slides.find(s => s.role === 'cta');
  const problemSlide = slides.find(s => s.role === 'problem');

  const roles = new Set(slides.map(s => s.role));
  let structure: NarrativeArc['structure'] = 'problem-solution';
  if (roles.has('framework')) structure = 'framework';
  if (roles.has('evidence') && !roles.has('problem')) structure = 'data-driven';

  return {
    structure,
    hook_statement: hookSlide?.headline ?? title,
    thesis: problemSlide?.headline ?? title,
    resolution: ctaSlide?.headline ?? cta,
    pacing: slides.length <= 5 ? 'tight' : slides.length <= 8 ? 'balanced' : 'expansive',
  };
}

// ─── Main compiler ────────────────────────────────────────────────────────────

export interface OCLCompileResult {
  artifact: CarouselArtifact;
  trace: NormalizationTrace;
  durationMs: number;
}

/**
 * compileCarouselArtifact — OCL deterministic compiler.
 *
 * Input: raw LLM output string OR already-parsed DraftArtifactInput.
 * Output: canonical CarouselArtifact (ArtifactV2 discriminated union member).
 *
 * Never throws. Returns a best-effort artifact even on malformed input.
 * ISkill downstream will validate and reject if the artifact is too weak.
 */
export function compileCarouselArtifact(
  input: DraftArtifactInput | string,
  options: {
    topic: string;
    tone?: string;
    runtimeMode?: string;
    provider?: string;
    requestId?: string;
  }
): OCLCompileResult {
  const start = Date.now();
  const steps: string[] = [];
  const warnings: string[] = [];

  // ── Step 1: Resolve to DraftArtifactInput ────────────────────────────────
  let draft: DraftArtifactInput;

  if (typeof input === 'string') {
    steps.push('clean_raw_string');
    const { cleaned } = cleanOutput(input);
    const parsed = extractJSON(cleaned);

    if (parsed && typeof parsed === 'object') {
      steps.push('json_parse_success');
      const obj = parsed as Record<string, unknown>;

      if (Array.isArray(obj)) {
        draft = { slides: obj as DraftArtifactSlide[], meta: { topic: options.topic } };
      } else if (Array.isArray((obj as Record<string, unknown>).slides)) {
        const slides = (obj as Record<string, unknown>).slides as DraftArtifactSlide[];
        draft = { slides, meta: obj as DraftArtifactMeta };
      } else if (Array.isArray((obj as Record<string, unknown>).cards)) {
        const cards = (obj as Record<string, unknown>).cards as DraftArtifactSlide[];
        draft = { cards, meta: obj as DraftArtifactMeta };
      } else {
        warnings.push('Unexpected JSON shape — treating as meta');
        draft = { meta: obj as DraftArtifactMeta };
      }
    } else {
      steps.push('json_parse_failed_using_empty');
      warnings.push('Could not parse LLM output as JSON — empty carousel');
      draft = { meta: { topic: options.topic } };
    }
  } else {
    steps.push('draft_input_received');
    draft = input;
  }

  // ── Step 2: Richness detection + adaptation ──────────────────────────────
  steps.push('richness_detection');
  const richnessSignal = detectRichness(draft);

  let adaptationResult;
  if (richnessSignal.isWeak) {
    steps.push('weak_output_adaptation');
    warnings.push(`weak_output_detected:score=${richnessSignal.estimatedScore}:signals=${richnessSignal.signals.join(',')}`);
    adaptationResult = adaptWeakOutput(draft, options.topic);
  } else {
    steps.push('rich_output_passthrough');
    adaptationResult = richPassthrough(draft);
  }

  draft = adaptationResult.draft;
  steps.push(...adaptationResult.trace.steps);
  if (adaptationResult.trace.warnings?.length) {
    warnings.push(...adaptationResult.trace.warnings);
  }

  // ── Step 3: Coerce slides ────────────────────────────────────────────────
  steps.push('coerce_slides');
  const rawSlides = draft.slides ?? draft.cards ?? [];
  const slides: RichCarouselSlide[] = rawSlides.map((raw, i) => normalizeRawSlideObject(raw, i));

  // ── SPRINT1-CHANGE-B: Structural pre-repair — pad to minimum slide count deterministically.
  // This ensures structural violations (too few slides) are corrected BEFORE governance
  // validation runs. Structural violations must never consume LLM repair quota.
  // The canonical minimum is sourced from @brandos/contracts (single source of truth for OCL).
  // Skeleton slides are injected; governance will then evaluate richness on the full set.
  // If richness is too low, that is a SEMANTIC violation and LLM repair applies.
  const MIN_CAROUSEL_SLIDES = CAROUSEL_STRUCTURAL_CONSTRAINTS.minSlides; // derived — do not hardcode
  while (slides.length < MIN_CAROUSEL_SLIDES) {
    const idx = slides.length;
    // Insert before the last slide if the last one is role=cta; otherwise append.
    const lastSlide = slides[slides.length - 1];
    const insertBeforeCta = lastSlide?.role === 'cta' && slides.length >= 2;
    // BUGFIX (trace mislabeling): the step/warning must reflect the slide's
    // FINAL 1-indexed position, not `idx + 1` (its position before the
    // insertBeforeCta splice below). When insertBeforeCta is true the skeleton
    // is spliced in *before* the trailing CTA slide, so its true final number
    // is one less than `idx + 1` — e.g. logs previously said
    // "structural_pad_slide_6" for a skeleton that governance would go on to
    // report as "Slide 5", making the generated_at trace actively misleading
    // during incident triage (this file was written by RCA against exactly
    // that mismatch).
    const finalSlideNumber = insertBeforeCta ? idx : idx + 1;
    steps.push(`structural_pad_slide_${finalSlideNumber}`);
    warnings.push(`structural_repair: padded slide ${finalSlideNumber} (carousel had ${rawSlides.length} slides, minimum ${MIN_CAROUSEL_SLIDES})`);
    // BUGFIX (Slide-N density=0): this skeleton was previously built as a raw
    // object literal with semantic_density_score/persuasion_score hardcoded to 0,
    // bypassing normalizeRawSlideObject()/scoreSlide() entirely. That is
    // orthogonal to whether the slide actually has content — a hardcoded 0
    // does not reflect the real (still-thin) score and silently drifts out of
    // sync if the skeleton's fields ever change. Route the skeleton through
    // normalizeRawSlideObject() like every other slide so its density/persuasion
    // scores are always the actual computed values, not a magic constant.
    const skeletonSlide: RichCarouselSlide = normalizeRawSlideObject(
      {
        role: 'insight',
        headline: `Key Insight ${finalSlideNumber}`,
        subheadline: '',
        body: '',
        bullets: [],
      },
      idx,
    );
    if (insertBeforeCta) {
      slides.splice(slides.length - 1, 0, skeletonSlide);
    } else {
      slides.push(skeletonSlide);
    }
    // Re-number slides in insertion order
    slides.forEach((s, i) => { s.slide = i + 1; });
  }

  // ── Step 4: Extract meta ─────────────────────────────────────────────────
  steps.push('extract_meta');
  const meta = draft.meta ?? {};
  const title = String(meta.title ?? options.topic ?? 'Untitled');
  const hook = String(meta.hook ?? slides[0]?.headline ?? title);
  const cta = String(meta.cta ?? slides.find(s => s.role === 'cta')?.headline ?? 'Learn more');
  const palette: string[] = Array.isArray(meta.palette) ? meta.palette : DEFAULT_PALETTE;
  const font_style = typeof meta.font_style === 'string' ? meta.font_style : 'modern';

  // ── Step 5: Compute metrics ──────────────────────────────────────────────
  steps.push('compute_richness_metrics');
  const richness_metrics = computeRichnessMetrics(slides, cta);

  // ── Step 6: Infer narrative arc ──────────────────────────────────────────
  steps.push('infer_narrative_arc');
  const narrative_arc = inferNarrativeArc(slides, title, cta);

  // ── Step 7: Build AudienceProfile ───────────────────────────────────────
  // OCL is a pure compiler. It must not invent audience values.
  // If the supplied meta carries no audience, label is omitted —
  // Brand Intelligence owns any defaulting decisions downstream.
  const audience: AudienceProfile = {
    ...(typeof meta.audience === 'string' ? { label: meta.audience } : {}),
    sophistication: 'practitioner',
  };

  // ── Step 8: Build SemanticTheme ─────────────────────────────────────────
  const semantic_theme: SemanticTheme = {
    visual_preset: 'executive-dark',
    primaryColor: palette[0]?.replace('#', '') ?? '0f172a',
    accentColor: palette[2]?.replace('#', '') ?? '06b6d4',
    bgColor: palette[0]?.replace('#', '') ?? '0f172a',
    fontTitle: 'Inter',
    fontBody: 'Inter',
  };

  // ── Step 9: Build carousel meta ──────────────────────────────────────────
  const carousel_meta: CarouselMeta = {
    palette,
    font_style,
    slide_count: slides.length,
    estimated_read_seconds: slides.length * 8,
  };

  // ── Step 10: Build generation trace ──────────────────────────────────────
  const generation_trace: GenerationTrace = {
    generated_at: new Date().toISOString(),
    ocl_strategy: steps.join(' → '),
    governance_outcome: 'bypassed',
    repair_attempts: 0,
    provider: options.provider,
    generation_mode: options.runtimeMode,
    input_type: typeof input === 'string' ? 'text' : 'json',
  };

  // ── Step 11: Build export metadata ──────────────────────────────────────
  const export_metadata: ExportMetadata = {
    available_formats: ['json', 'html', 'pptx'],
    recommended_format: 'json',
  };

  // ── Assemble canonical artifact ──────────────────────────────────────────
  const artifact: CarouselArtifact = {
    $schema: 'artifact-json@2.0',
    id: uuidv4(),
    artifact_type: 'carousel',
    title,
    summary: typeof meta.topic === 'string' ? meta.topic : title,
    hook,
    cta,
    semantic_theme,
    audience,
    narrative_arc,
    richness_metrics,
    generation_trace,
    export_metadata,
    created_at: new Date().toISOString(),
    carousel_meta,
    slides,
  };

  const trace: NormalizationTrace = {
    steps,
    ...(warnings.length > 0 && { warnings }),
    strategy: 'ocl-carousel-compiler-v2',
    validationPassed: slides.length > 0,
  };

  return {
    artifact,
    trace,
    durationMs: Date.now() - start,
  };
}


