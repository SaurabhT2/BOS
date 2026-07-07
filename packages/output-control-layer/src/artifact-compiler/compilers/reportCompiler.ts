/**
 * @brandos/output-control-layer — artifact-compiler/compilers/reportCompiler.ts
 *
 * OCL Report Compiler — compiles DraftArtifactInput into a canonical ReportArtifact.
 *
 * REFACTOR (2026-05-23):
 *   - Integrated transformToReportSchema() into the compilation pipeline.
 *     Previously, normalizeOutput() called transformToReportSchema() and stored
 *     the result as JSON.stringify(report) in NormalizedOutput.content.rawText,
 *     then compileReportArtifact() ignored the structured form and fell back to
 *     its own inline coercion. Both paths now converge on transformToReportSchema.
 *
 *   - Replaced all hardcoded RichnessMetrics constants (was: all fields = 60)
 *     with computeReportRichnessMetrics() — a real scoring function informed by
 *     section word count, evidence density (data_points / key_findings), and
 *     narrative completeness.
 *
 *   - Fixed generation_trace.governance_outcome from 'passed' → 'bypassed'.
 *     Compile time is before ISkill governance. 'bypassed' is semantically correct.
 *
 *   - NarrativeArc structure is now inferred from section count and content signals
 *     instead of being hardcoded to 'data-driven'.
 *
 * PIPELINE (post-refactor):
 *   rawLLMOutput | DraftArtifactInput
 *     → [string] cleanOutput → extractJSON → transformToReportSchema
 *                → [fallback] text report as single section
 *     → [DraftArtifactInput] transformToReportSchema (via slides/meta)
 *     → coerce to ReportSection[]
 *     → computeReportRichnessMetrics
 *     → inferReportNarrativeArc
 *     → assemble ReportArtifact
 *
 * ARCHITECTURAL RULES (unchanged):
 *   - OCL = deterministic compiler. No LLM calls. No retries. No governance.
 *   - Output is always a typed ReportArtifact. Never a plain object.
 *   - ISkill validates the compiled artifact. OCL does NOT validate.
 *   - governance_outcome starts as 'bypassed'; ISkill writes 'passed' / 'passed_after_repair'.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  ReportArtifact,
  ReportSection,
  ReportMeta,
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
import { transformToReportSchema } from '../transformers/transformToReportSchema';
import type { CanonicalReportSchema, CanonicalReportSlide } from '../transformers/transformToReportSchema';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OCLReportCompileResult {
  artifact: ReportArtifact;
  trace: NormalizationTrace;
  durationMs: number;
}

// ─── RichnessMetrics computation ──────────────────────────────────────────────

/**
 * computeReportRichnessMetrics — real scoring for ReportArtifact.
 *
 * Replaces the prior placeholder (all scores hardcoded to 60).
 *
 * Scoring dimensions:
 *   density_score        — avg words per section vs target
 *   evidence_score       — proportion of sections with data_points or key_findings
 *   persuasion_score     — opening hook + closing resolution presence
 *   cta_quality_score    — CTA word-count specificity
 *   narrative_coherence  — section count completeness (≥3 for balanced report)
 *   hook_strength_score  — first section body richness
 *
 * OCL cannot evaluate audience alignment — remains 60 (ISkill governs this).
 */
function computeReportRichnessMetrics(
  sections: ReportSection[],
  cta: string,
): RichnessMetrics {
  if (sections.length === 0) {
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

  // Word counts
  const sectionWordCounts = sections.map(s =>
    [s.heading, s.subheading ?? '', s.body, ...(s.key_findings ?? [])]
      .join(' ')
      .split(/\s+/)
      .filter(Boolean).length,
  );
  const total_content_words = sectionWordCounts.reduce((a, b) => a + b, 0);
  const avg_words_per_unit = Math.round(total_content_words / sections.length);

  // density_score: scale avg words per section against target of 150 words/section
  const WORDS_TARGET = 150;
  const density_score = Math.min(100, Math.round((avg_words_per_unit / WORDS_TARGET) * 100));

  // evidence_score: proportion of sections containing data_points or key_findings
  const evidenceSections = sections.filter(
    s => (s.data_points?.length ?? 0) > 0 || (s.key_findings?.length ?? 0) >= 2,
  ).length;
  const evidence_score = Math.round((evidenceSections / sections.length) * 100);

  // persuasion_score: does the report have a rich intro (≥30 words) and a non-trivial final section?
  const firstSectionWords = sectionWordCounts[0] ?? 0;
  const lastSectionWords = sectionWordCounts[sectionWordCounts.length - 1] ?? 0;
  const hasRichIntro = firstSectionWords >= 30;
  const hasRichConclusion = lastSectionWords >= 20;
  const persuasion_score = (hasRichIntro ? 50 : 0) + (hasRichConclusion ? 50 : 0);

  // cta_quality_score: CTA word count, targeting ≥6 words for full score
  const ctaWords = cta.trim().split(/\s+/).filter(Boolean).length;
  const cta_quality_score = Math.min(100, Math.round((ctaWords / 6) * 100));

  // narrative_coherence_score: a complete report has ≥3 sections; 10+ is penalised slightly
  const MIN_SECTIONS = 3;
  const IDEAL_SECTIONS = 7;
  const coherenceFraction = sections.length < MIN_SECTIONS
    ? sections.length / MIN_SECTIONS
    : sections.length <= IDEAL_SECTIONS
      ? 1.0
      : Math.max(0.7, 1 - (sections.length - IDEAL_SECTIONS) * 0.02);
  const narrative_coherence_score = Math.round(coherenceFraction * 100);

  // hook_strength_score: first section body word richness vs target 60
  const HOOK_TARGET = 60;
  const hook_strength_score = Math.min(100, Math.round((firstSectionWords / HOOK_TARGET) * 100));

  // overall_score: weighted composite
  const overall_score = Math.round(
    density_score * 0.30 +
    evidence_score * 0.20 +
    persuasion_score * 0.10 +
    cta_quality_score * 0.05 +
    narrative_coherence_score * 0.15 +
    hook_strength_score * 0.20,
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
 * inferReportNarrativeArc — infer arc from section composition.
 *
 * Replaces the prior hardcoded 'data-driven' structure.
 */
function inferReportNarrativeArc(
  sections: ReportSection[],
  title: string,
  hook: string,
  cta: string,
): NarrativeArc {
  // Infer from total word count and section count
  let structure: NarrativeArc['structure'] = 'data-driven';
  const hasDataPoints = sections.some(s => (s.data_points?.length ?? 0) > 0);
  const hasFindingsSections = sections.some(s => (s.key_findings?.length ?? 0) >= 3);

  if (!hasDataPoints && sections.length >= 3) structure = 'problem-solution';
  if (hasFindingsSections) structure = 'data-driven';
  if (sections.length <= 3) structure = 'executive-brief' as NarrativeArc['structure'];

  const pacing: NarrativeArc['pacing'] =
    sections.length <= 3 ? 'tight' : sections.length <= 6 ? 'balanced' : 'expansive';

  const thesis = sections[1]?.heading ?? title;
  const resolution = sections[sections.length - 1]?.heading ?? cta;

  return {
    structure: structure as NarrativeArc['structure'],
    hook_statement: hook,
    thesis,
    resolution,
    pacing,
  };
}

// ─── Section coercion from CanonicalReportSchema ──────────────────────────────

/**
 * coerceSectionsFromCanonicalSchema — maps CanonicalReportSlide[] → ReportSection[].
 *
 * CanonicalReportSlide uses "slides" as its array name (inherited from the
 * transformer's dual-concern design), but each element semantically represents
 * a report section. This function bridges that naming gap.
 */
function coerceSectionsFromCanonicalSchema(schema: CanonicalReportSchema): ReportSection[] {
  return schema.slides.map((slide: CanonicalReportSlide, i: number): ReportSection => {
    const body = slide.bullets.length > 0
      ? slide.bullets.join(' ')
      : '';

    const wordCount = [slide.title, body].join(' ').split(/\s+/).filter(Boolean).length;

    return {
      id: `section-${i + 1}`,
      heading: slide.title,
      body,
      ...(slide.bullets.length > 0 && { key_findings: slide.bullets }),
      ...(slide.stats && slide.stats.length > 0 && {
        data_points: slide.stats.map(st => ({ label: st.label, value: st.value })),
      }),
      word_count: wordCount,
    };
  });
}

/**
 * coerceSectionsFromDraft — maps DraftArtifactInput slides → ReportSection[].
 *
 * Tries transformToReportSchema first; falls back to direct field mapping.
 */
function coerceSectionsFromDraft(draft: DraftArtifactInput): ReportSection[] {
  const rawSlides = draft.slides ?? draft.cards ?? [];

  // Attempt canonical transform over the raw slides array
  if (rawSlides.length > 0) {
    const asParsed = {
      title: draft.meta?.title ?? '',
      slides: rawSlides,
    };
    const canonical = transformToReportSchema(asParsed);
    if (canonical && canonical.slides.length > 0) {
      return coerceSectionsFromCanonicalSchema(canonical);
    }
  }

  // Fallback: direct field mapping
  return rawSlides.map((raw, i): ReportSection => {
    const r = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    const heading = String(r.headline ?? r.title ?? r.heading ?? `Section ${i + 1}`);
    const bullets: string[] = Array.isArray(r.bullets)
      ? (r.bullets as unknown[]).map(String).filter(Boolean)
      : [];
    const body = bullets.length > 0
      ? bullets.join(' ')
      : typeof r.body === 'string' ? r.body : '';
    return {
      id: `section-${i + 1}`,
      heading,
      body,
      ...(bullets.length > 0 && { key_findings: bullets }),
      word_count: body.split(/\s+/).filter(Boolean).length,
    };
  });
}

// ─── Main compiler ────────────────────────────────────────────────────────────

/**
 * compileReportArtifact — OCL deterministic report compiler.
 *
 * Input: raw LLM output string OR already-parsed DraftArtifactInput.
 * Output: canonical ReportArtifact (ArtifactV2 discriminated union member).
 *
 * Never throws. Returns a best-effort artifact even on malformed input.
 * Text-only reports (no JSON structure) produce a single-section artifact.
 * ISkill downstream will validate and reject if the artifact is too weak.
 *
 * Integration of transformToReportSchema (refactor):
 *   For string input: cleanOutput → extractJSON → transformToReportSchema → coerce sections
 *                     [fallback] raw text → single-section report
 *   For DraftArtifactInput: transformToReportSchema(asParsed) → coerce sections (fallback to direct)
 *
 * This unifies the pipeline: both paths now produce structurally identical section
 * shapes, eliminating the divergence between normalizeOutput's transformer path
 * and the compiler's prior inline coercion path.
 */
export function compileReportArtifact(
  input: DraftArtifactInput | string,
  options: {
    topic: string;
    runtimeMode?: string;
    provider?: string;
    requestId?: string;
  },
): OCLReportCompileResult {
  const start = Date.now();
  const steps: string[] = [];
  const warnings: string[] = [];

  let sections: ReportSection[] = [];
  let draftMeta: Record<string, unknown> = {};
  let rawTextFallback: string | undefined;

  // ── Resolve input → sections ──────────────────────────────────────────────

  if (typeof input === 'string') {
    steps.push('clean_raw_string');
    const { cleaned } = cleanOutput(input);

    steps.push('extract_json');
    const parsed = extractJSON(cleaned);

    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      steps.push('json_parse_success');

      // PRIMARY PATH: run transformToReportSchema to normalise LLM shape variants
      const canonical = transformToReportSchema(parsed);

      if (canonical !== null && canonical.slides.length > 0) {
        steps.push('transform_report_schema_success');
        sections = coerceSectionsFromCanonicalSchema(canonical);
        const rawObj = parsed as Record<string, unknown>;
        draftMeta = {
          title: rawObj.title ?? rawObj.name ?? canonical.title,
          hook: rawObj.hook ?? rawObj.intro ?? undefined,
          cta: rawObj.cta ?? rawObj.callToAction ?? undefined,
          audience: rawObj.audience ?? undefined,
        };
      } else {
        // transformToReportSchema returned null: fall back to direct slide mapping
        steps.push('transform_report_schema_fallback_direct');
        warnings.push('transformToReportSchema returned null — using direct section coercion');
        const rawObj = parsed as Record<string, unknown>;
        const rawSlides = Array.isArray(rawObj.slides) ? rawObj.slides :
          Array.isArray(rawObj.sections) ? rawObj.sections :
          Array.isArray(rawObj.pages) ? rawObj.pages : [];

        sections = rawSlides.map((raw: unknown, i: number): ReportSection => {
          const s = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
          const heading = String(s.title ?? s.heading ?? `Section ${i + 1}`);
          const bullets: string[] = Array.isArray(s.bullets)
            ? (s.bullets as unknown[]).map(String).filter(Boolean)
            : [];
          const body = bullets.length > 0
            ? bullets.join(' ')
            : typeof s.body === 'string' ? s.body : '';
          return {
            id: `section-${i + 1}`,
            heading,
            body,
            ...(bullets.length > 0 && { key_findings: bullets }),
            word_count: body.split(/\s+/).filter(Boolean).length,
          };
        });
        draftMeta = {
          title: rawObj.title ?? rawObj.name,
          hook: rawObj.hook ?? undefined,
          cta: rawObj.cta ?? undefined,
        };
      }
    } else {
      // Not parseable JSON: treat the entire cleaned string as a text report
      steps.push('json_parse_failed_text_report');
      warnings.push('Could not parse LLM output as JSON — treating as plain-text report');
      rawTextFallback = input;
    }
  } else {
    // DraftArtifactInput path
    steps.push('draft_input_received');

    if ((input.slides?.length ?? input.cards?.length ?? 0) > 0) {
      sections = coerceSectionsFromDraft(input);
      steps.push('transform_report_schema_via_draft');
    } else if (input.rawText) {
      rawTextFallback = input.rawText;
      steps.push('draft_raw_text_report');
    }
    draftMeta = (input.meta ?? {}) as Record<string, unknown>;
  }

  // ── Text-only report fallback ─────────────────────────────────────────────

  if (sections.length === 0 && rawTextFallback) {
    steps.push('single_section_from_raw_text');
    sections = [{
      id: 'section-1',
      heading: options.topic,
      body: rawTextFallback,
      word_count: rawTextFallback.split(/\s+/).filter(Boolean).length,
    }];
  }

  steps.push('sections_coerced');

  // ── Extract meta fields ────────────────────────────────────────────────────

  const title = String(draftMeta.title ?? options.topic ?? 'Untitled Report');
  const hook = String(draftMeta.hook ?? sections[0]?.heading ?? title);
  const cta = String(draftMeta.cta ?? 'Read the full report');

  // ── Compute metrics ────────────────────────────────────────────────────────

  steps.push('compute_richness_metrics');
  const richness_metrics = computeReportRichnessMetrics(sections, cta);

  // ── Infer narrative arc ────────────────────────────────────────────────────

  steps.push('infer_narrative_arc');
  const narrative_arc = inferReportNarrativeArc(sections, title, hook, cta);

  // ── Build supporting fields ────────────────────────────────────────────────

  const totalWordCount = richness_metrics.total_content_words;

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

  const report_meta: ReportMeta = {
    section_count: sections.length,
    word_count: totalWordCount,
    estimated_read_minutes: Math.max(1, Math.round(totalWordCount / 238)), // avg reading speed
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
    available_formats: ['json', 'pdf'],
    recommended_format: 'pdf',
  };

  // ── Assemble artifact ──────────────────────────────────────────────────────

  const artifact: ReportArtifact = {
    $schema: 'artifact-json@2.0',
    id: uuidv4(),
    artifact_type: 'report',
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
    report_meta,
    sections,
  };

  const trace: NormalizationTrace = {
    steps,
    ...(warnings.length > 0 && { warnings }),
    strategy: 'ocl-report-compiler-v2',
    validationPassed: sections.length > 0,
  };

  return { artifact, trace, durationMs: Date.now() - start };
}


