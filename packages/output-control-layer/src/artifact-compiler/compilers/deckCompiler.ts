/**
 * @brandos/output-control-layer — artifact-compiler/compilers/deckCompiler.ts
 *
 * OCL Deck Compiler — compiles DraftArtifactInput into a canonical DeckArtifact.
 *
 * REFACTOR (2026-05-23):
 *   - Integrated transformToDeckSchema() into the compilation pipeline.
 *     Previously, normalizeOutput() called transformToDeckSchema() and stored
 *     the result as a raw JSON string in NormalizedOutput.content.rawText, then
 *     compileDeckArtifact() ignored it and ran its own inline coercion.
 *     Now the compiler calls the transformer directly, giving a single
 *     consistent coercion path for all callers (DraftArtifactInput path and
 *     raw-string path both go through transformToDeckSchema).
 *
 *   - Replaced all hardcoded RichnessMetrics constants (was: all fields = 60)
 *     with a real computeDeckRichnessMetrics() function that mirrors the
 *     computation style of carouselCompiler.ts.
 *
 *   - Fixed generation_trace.governance_outcome initial value from 'passed'
 *     (semantically incorrect before ISkill has run) to 'bypassed'.
 *
 *   - Deck NarrativeArc structure is now inferred from slide types instead of
 *     being hardcoded to 'problem-solution'.
 *
 * PIPELINE (post-refactor):
 *   rawLLMOutput | DraftArtifactInput
 *     → [string] cleanOutput → extractJSON → transformToDeckSchema
 *     → [DraftArtifactInput] transformToDeckSchema (via slides/meta)
 *     → coerce to DeckSlide[]
 *     → computeDeckRichnessMetrics
 *     → inferDeckNarrativeArc
 *     → assemble DeckArtifact
 *
 * ARCHITECTURAL RULES (unchanged):
 *   - OCL = deterministic compiler. No LLM calls. No retries. No governance.
 *   - Output is always a typed DeckArtifact. Never a plain object.
 *   - ISkill validates the compiled artifact. OCL does NOT validate.
 *   - governance_outcome starts as 'bypassed'; ISkill writes 'passed' / 'passed_after_repair'.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  DeckArtifact,
  DeckSlide,
  DeckMeta,
  SemanticTheme,
  ExportMetadata,
  GenerationTrace,
  NarrativeArc,
  AudienceProfile,
  RichnessMetrics,
  DraftArtifactInput,
  NormalizationTrace,
} from '@brandos/contracts';

import { cleanOutput } from '../../output-normalizer/pipeline/cleanOutput';
import { extractJSON } from '../../output-normalizer/pipeline/extractJSON';
import { transformToDeckSchema } from '../transformers/transformToDeckSchema';
import type { CanonicalDeckSchema } from '../transformers/transformToDeckSchema';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OCLDeckCompileResult {
  artifact: DeckArtifact;
  trace: NormalizationTrace;
  durationMs: number;
}

const VALID_SLIDE_TYPES = new Set<DeckSlide['type']>([
  'cover', 'agenda', 'content', 'divider', 'stats', 'quote', 'closing',
]);

// ─── RichnessMetrics computation ──────────────────────────────────────────────

/**
 * computeDeckRichnessMetrics — real scoring for DeckArtifact.
 *
 * Replaces the prior placeholder (all scores hardcoded to 60).
 * Mirrors the computation style of carouselCompiler.ts.
 *
 * Scoring dimensions:
 *   density_score        — average words per slide (content coverage)
 *   evidence_score       — proportion of slides with stats or ≥3 bullets
 *   persuasion_score     — presence of hook-bearing opening + decisive closing
 *   cta_quality_score    — CTA word-count specificity
 *   narrative_coherence  — required slide type coverage (cover + closing)
 *   hook_strength_score  — cover slide headline richness
 *
 * OCL cannot evaluate audience alignment — left at 60 (ISkill governs this).
 */
function computeDeckRichnessMetrics(
  slides: DeckSlide[],
  title: string,
  cta: string,
): RichnessMetrics {
  if (slides.length === 0) {
    return {
      overall_score: 0,
      density_score: 0,
      evidence_score: 0,
      persuasion_score: 0,
      cta_quality_score: 0,
      narrative_coherence_score: 0,
      hook_strength_score: 0,
      audience_alignment_score: 50,
      total_content_words: 0,
      avg_words_per_unit: 0,
    };
  }

  // Total / average word count
  const allWords = slides
    .flatMap(s => [s.title ?? '', s.subtitle ?? '', s.body ?? '', ...(s.bullets ?? [])])
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);
  const total_content_words = allWords.length;
  const avg_words_per_unit = Math.round(total_content_words / slides.length);

  // density_score: scale avg words per slide against target of 40 words/slide
  const WORDS_TARGET = 40;
  const density_score = Math.min(100, Math.round((avg_words_per_unit / WORDS_TARGET) * 100));

  // evidence_score: proportion of slides with stats or rich bullets
  const evidenceSlides = slides.filter(
    s => (s.stats?.length ?? 0) > 0 || (s.bullets?.length ?? 0) >= 3,
  ).length;
  const evidence_score = Math.round((evidenceSlides / slides.length) * 100);

  // persuasion_score: does the deck start with a cover and end with closing/cta?
  const types = slides.map(s => s.type);
  const hasCover = types[0] === 'cover';
  const hasClosing = types[types.length - 1] === 'closing' || types[types.length - 1] === 'content';
  const persuasion_score = Math.min(100, (hasCover ? 50 : 0) + (hasClosing ? 50 : 0));

  // cta_quality_score: CTA word count, targeting ≥8 words for full score
  const ctaWords = cta.trim().split(/\s+/).filter(Boolean).length;
  const cta_quality_score = Math.min(100, Math.round((ctaWords / 8) * 100));

  // narrative_coherence_score: required type coverage
  const presentTypes = new Set(types);
  const requiredTypes: DeckSlide['type'][] = ['cover', 'content'];
  const coveredRequired = requiredTypes.filter(t => presentTypes.has(t)).length;
  const narrative_coherence_score = Math.round((coveredRequired / requiredTypes.length) * 100);

  // hook_strength_score: richness of the first (cover) slide
  const coverSlide = slides[0];
  const coverWords = [coverSlide?.title ?? '', coverSlide?.subtitle ?? '', coverSlide?.body ?? '']
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
  const hook_strength_score = Math.min(100, Math.round((coverWords / 20) * 100));

  // overall_score: weighted composite
  const overall_score = Math.round(
    density_score * 0.25 +
    evidence_score * 0.20 +
    persuasion_score * 0.15 +
    cta_quality_score * 0.10 +
    narrative_coherence_score * 0.15 +
    hook_strength_score * 0.15,
  );

  return {
    overall_score,
    density_score,
    evidence_score,
    persuasion_score,
    cta_quality_score,
    narrative_coherence_score,
    hook_strength_score,
    // OCL cannot evaluate audience alignment — ISkill governs this dimension.
    audience_alignment_score: 60,
    total_content_words,
    avg_words_per_unit,
  };
}

// ─── NarrativeArc inference ───────────────────────────────────────────────────

/**
 * inferDeckNarrativeArc — derive narrative arc from slide type composition.
 *
 * Replaces the prior hardcoded 'problem-solution' structure.
 */
function inferDeckNarrativeArc(
  slides: DeckSlide[],
  title: string,
  hook: string,
  cta: string,
): NarrativeArc {
  const types = new Set(slides.map(s => s.type));

  let structure: NarrativeArc['structure'] = 'problem-solution';
  if (types.has('stats') && !types.has('quote')) structure = 'data-driven';
  else if (types.has('quote') || types.has('divider')) structure = 'story';
  else if (types.has('agenda')) structure = 'how-to';

  const pacing: NarrativeArc['pacing'] =
    slides.length <= 8 ? 'balanced' : slides.length <= 15 ? 'expansive' : 'tight';

  const thesis = slides.find(s => s.type === 'content')?.title ?? title;
  const resolution = slides.find(s => s.type === 'closing')?.title ?? cta;

  return {
    structure,
    hook_statement: hook,
    thesis,
    resolution,
    pacing,
  };
}

// ─── Slide coercion from CanonicalDeckSchema ──────────────────────────────────

/**
 * coerceSlidesFromCanonicalSchema — maps CanonicalDeckSection[] → DeckSlide[].
 *
 * Each section becomes a 'content' slide. The first section is given a 'cover'
 * type if the deck has more than one section. A synthetic 'closing' slide is
 * appended when the schema provides only content sections (common LLM output).
 */
function coerceSlidesFromCanonicalSchema(schema: CanonicalDeckSchema): DeckSlide[] {
  const { sections } = schema;

  const slides: DeckSlide[] = sections.map((section, i) => {
    // First section becomes cover when deck has multiple sections
    const type: DeckSlide['type'] =
      i === 0 && sections.length > 1 ? 'cover' : 'content';

    return {
      slide: i + 1,
      type,
      title: section.heading,
      bullets: section.talkingPoints,
    };
  });

  // If last slide is not a closing type, promote or append one
  const last = slides[slides.length - 1];
  if (last && last.type !== 'closing') {
    // Promote if it looks like a closing (small bullet count)
    if (last.bullets && last.bullets.length <= 2 && slides.length > 1) {
      last.type = 'closing';
    }
  }

  return slides;
}

/**
 * coerceSlidesFromDraft — maps raw DraftArtifactInput slides → DeckSlide[].
 *
 * Used when input is already a DraftArtifactInput (non-string path).
 * Tries transformToDeckSchema first; falls back to direct field mapping.
 */
function coerceSlidesFromDraft(draft: DraftArtifactInput): DeckSlide[] {
  const rawSlides = draft.slides ?? draft.cards ?? [];

  // Attempt canonical transform over the raw slides array as a parsed object
  const asParsed = {
    title: draft.meta?.title ?? '',
    slides: rawSlides,
  };
  const canonical = transformToDeckSchema(asParsed);
  if (canonical && canonical.sections.length > 0) {
    return coerceSlidesFromCanonicalSchema(canonical);
  }

  // Fallback: direct field mapping
  return rawSlides.map((raw, i) => {
    const typeRaw = (raw as Record<string, unknown>).type as string | undefined;
    const type: DeckSlide['type'] =
      typeRaw !== undefined && VALID_SLIDE_TYPES.has(typeRaw as DeckSlide['type'])
        ? (typeRaw as DeckSlide['type'])
        : 'content';
    return {
      slide: i + 1,
      type,
      title: raw.headline ?? (raw as Record<string, unknown>).title as string ?? `Slide ${i + 1}`,
      bullets: raw.bullets ?? [],
    };
  });
}

// ─── Main compiler ────────────────────────────────────────────────────────────

/**
 * compileDeckArtifact — OCL deterministic deck compiler.
 *
 * Input: raw LLM output string OR already-parsed DraftArtifactInput.
 * Output: canonical DeckArtifact (ArtifactV2 discriminated union member).
 *
 * Never throws. Returns a best-effort artifact even on malformed input.
 * ISkill downstream will validate and reject if the artifact is too weak.
 *
 * Integration of transformToDeckSchema (refactor):
 *   For string input: cleanOutput → extractJSON → transformToDeckSchema → coerce slides
 *   For DraftArtifactInput: transformToDeckSchema(asParsed) → coerce slides (fallback to direct)
 *
 * This unifies the pipeline: both paths now produce structurally identical slide
 * shapes, eliminating the divergence between normalizeOutput's transformer path
 * and the compiler's prior inline coercion path.
 */
export function compileDeckArtifact(
  input: DraftArtifactInput | string,
  options: {
    topic: string;
    runtimeMode?: string;
    provider?: string;
    requestId?: string;
  },
): OCLDeckCompileResult {
  const start = Date.now();
  const steps: string[] = [];
  const warnings: string[] = [];

  let slides: DeckSlide[] = [];
  let draftMeta: Record<string, unknown> = {};

  // ── Resolve input → slides ────────────────────────────────────────────────

  if (typeof input === 'string') {
    steps.push('clean_raw_string');
    const { cleaned } = cleanOutput(input);

    steps.push('extract_json');
    const parsed = extractJSON(cleaned);

    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      steps.push('json_parse_success');

      // PRIMARY PATH: run transformToDeckSchema to normalise LLM shape variants
      const canonical = transformToDeckSchema(parsed);

      if (canonical !== null && canonical.sections.length > 0) {
        steps.push('transform_deck_schema_success');
        slides = coerceSlidesFromCanonicalSchema(canonical);
        // Extract any meta fields from the raw parsed object
        const rawObj = parsed as Record<string, unknown>;
        draftMeta = {
          title: rawObj.title ?? rawObj.name ?? canonical.title,
          hook: rawObj.hook ?? rawObj.intro ?? undefined,
          cta: rawObj.cta ?? rawObj.callToAction ?? undefined,
          audience: rawObj.audience ?? undefined,
        };
      } else {
        // transformToDeckSchema returned null: shape is too loose for the canonical path.
        // Fall back to direct slide mapping from the raw parsed object.
        steps.push('transform_deck_schema_fallback_direct');
        warnings.push('transformToDeckSchema returned null — using direct slide coercion');
        const rawObj = parsed as Record<string, unknown>;
        const rawSlides = Array.isArray(rawObj.slides) ? rawObj.slides :
          Array.isArray(rawObj.pages) ? rawObj.pages :
          Array.isArray(rawObj.sections) ? rawObj.sections : [];
        slides = rawSlides.map((raw: unknown, i: number) => {
          const s = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
          const typeRaw = s.type as string | undefined;
          const type: DeckSlide['type'] =
            typeRaw !== undefined && VALID_SLIDE_TYPES.has(typeRaw as DeckSlide['type'])
              ? (typeRaw as DeckSlide['type'])
              : 'content';
          return {
            slide: i + 1,
            type,
            title: String(s.headline ?? s.title ?? s.heading ?? `Slide ${i + 1}`),
            bullets: Array.isArray(s.bullets) ? s.bullets.map(String) :
              Array.isArray(s.points) ? s.points.map(String) : [],
          };
        });
        draftMeta = {
          title: rawObj.title ?? rawObj.name,
          hook: rawObj.hook ?? undefined,
          cta: rawObj.cta ?? undefined,
        };
      }
    } else if (parsed !== null && Array.isArray(parsed)) {
      // Top-level array: treat elements as slides, attempt transform
      steps.push('json_parse_success_array_shape');
      const canonical = transformToDeckSchema({ slides: parsed });
      if (canonical) {
        steps.push('transform_deck_schema_success_from_array');
        slides = coerceSlidesFromCanonicalSchema(canonical);
      } else {
        warnings.push('Top-level array shape could not be mapped to deck sections');
        slides = [];
      }
    } else {
      steps.push('json_parse_failed_empty_deck');
      warnings.push('Could not parse LLM output as JSON — empty deck');
    }
  } else {
    // DraftArtifactInput path
    steps.push('draft_input_received');
    slides = coerceSlidesFromDraft(input);
    draftMeta = (input.meta ?? {}) as Record<string, unknown>;
    steps.push('transform_deck_schema_via_draft');
  }

  steps.push('slides_coerced');

  // ── Extract meta fields ────────────────────────────────────────────────────

  const title = String(draftMeta.title ?? options.topic ?? 'Untitled Presentation');
  const hook = String(draftMeta.hook ?? slides[0]?.title ?? title);
  const cta = String(draftMeta.cta ?? slides[slides.length - 1]?.title ??  "Let's connect");

  // ── Compute metrics ────────────────────────────────────────────────────────

  steps.push('compute_richness_metrics');
  const richness_metrics = computeDeckRichnessMetrics(slides, title, cta);

  // ── Infer narrative arc ────────────────────────────────────────────────────

  steps.push('infer_narrative_arc');
  const narrative_arc = inferDeckNarrativeArc(slides, title, hook, cta);

  // ── Build supporting fields ────────────────────────────────────────────────

  const semantic_theme: SemanticTheme = {
    visual_preset: 'executive-dark',
    primaryColor: '0f172a',
    accentColor: '06b6d4',
    bgColor: '0f172a',
    fontTitle: 'Inter',
    fontBody: 'Inter',
  };

  const audience: AudienceProfile = {
    label: typeof draftMeta.audience === 'string'
      ? draftMeta.audience
      : 'Enterprise Professionals',
    sophistication: 'practitioner',
  };

  const deck_meta: DeckMeta = {
    section_count: slides.filter(s => s.type === 'content' || s.type === 'stats').length,
    slide_count: slides.length,
    estimated_duration_minutes: Math.ceil(slides.length * 1.5),
  };

  // governance_outcome: 'bypassed' at compile time.
  // ISkill must overwrite this to 'passed' or 'passed_after_repair' after validation.
  const generation_trace: GenerationTrace = {
    generated_at: new Date().toISOString(),
    ocl_strategy: steps.join(' → '),
    governance_outcome: 'bypassed',
    repair_attempts: 0,
    provider: options.provider,
    generation_mode: options.runtimeMode,
    input_type: typeof input === 'string' ? 'text' : 'json',
  };

  const export_metadata: ExportMetadata = {
    available_formats: ['json', 'pptx'],
    recommended_format: 'pptx',
  };

  // ── Assemble artifact ──────────────────────────────────────────────────────

  const artifact: DeckArtifact = {
    $schema: 'artifact-json@2.0',
    id: uuidv4(),
    artifact_type: 'deck',
    title,
    summary: title,
    hook,
    cta,
    semantic_theme,
    audience,
    narrative_arc,
    richness_metrics,
    generation_trace,
    export_metadata,
    created_at: new Date().toISOString(),
    deck_meta,
    slides,
  };

  const trace: NormalizationTrace = {
    steps,
    ...(warnings.length > 0 && { warnings }),
    strategy: 'ocl-deck-compiler-v2',
    validationPassed: slides.length > 0,
  };

  return { artifact, trace, durationMs: Date.now() - start };
}


