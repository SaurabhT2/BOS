/**
 * @brandos/output-control-layer — artifact-compiler/compilers/newsletterCompiler.ts
 *
 * OCL Newsletter Compiler — compiles raw LLM output into a canonical NewsletterArtifact.
 *
 * PIPELINE:
 *   rawLLMOutput → cleanOutput → extractJSON → coerce sections → metrics → assemble
 *
 * ARCHITECTURAL RULES:
 *   - Deterministic compiler. No LLM calls. No retries. No governance.
 *   - Output is always a typed NewsletterArtifact.
 *   - ISkill validates the compiled artifact. OCL does NOT validate.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  NewsletterArtifact,
  NewsletterSection,
  NewsletterMeta,
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
import { extractJSON } from '@brandos/shared-utils';

export interface OCLNewsletterCompileResult {
  artifact:       NewsletterArtifact;
  trace:          NormalizationTrace;
  durationMs:     number;
  /**
   * SPRINT1-FIX (F-06): true when the LLM returned parseable JSON; false when
   * extractJSON() failed and the compiler silently fell back to a placeholder
   * artifact. Consumers should warn on false — the artifact may contain filler
   * content rather than genuine LLM output. runNewsletterPipeline() logs a
   * console.warn when this is false.
   */
  parsedFromJson: boolean;
}

// ─── Richness metrics ─────────────────────────────────────────────────────────

function wordCount(text?: string): number {
  return (text ?? '').split(/\s+/).filter(Boolean).length;
}

function computeNewsletterRichnessMetrics(
  sections: NewsletterSection[],
  subjectLine: string,
  cta: string,
): RichnessMetrics {
  if (sections.length === 0) {
    return {
      overall_score: 0, density_score: 0, evidence_score: 0, persuasion_score: 0,
      cta_quality_score: 0, narrative_coherence_score: 0, hook_strength_score: 0,
      audience_alignment_score: 50, total_content_words: 0, avg_words_per_unit: 0,
    };
  }

  const totalWords = sections.reduce((acc, s) => {
    const bodyWc   = wordCount(s.body);
    const bulletWc = (s.bullets ?? []).reduce((a, b) => a + wordCount(b), 0);
    return acc + bodyWc + bulletWc;
  }, 0);

  const avgPerSection   = sections.length > 0 ? totalWords / sections.length : 0;
  const densityScore    = Math.min(100, Math.round((avgPerSection / 120) * 100));
  const hasSubstantive  = sections.filter(s => wordCount(s.body) > 20 || (s.bullets ?? []).length >= 2).length;
  const evidenceScore   = Math.min(100, Math.round((hasSubstantive / sections.length) * 100));
  const hasIntro        = sections.some(s => s.type === 'intro');
  const hasCta          = sections.some(s => s.type === 'cta');
  const hasStory        = sections.some(s => s.type === 'story');
  const persuasionScore = Math.min(100, (hasIntro ? 30 : 0) + (hasCta ? 30 : 0) + (hasStory ? 40 : 0));
  const ctaWords        = wordCount(cta);
  const ctaQuality      = ctaWords >= 10 ? Math.min(100, 50 + ctaWords * 3) : ctaWords * 5;
  const coherence       = sections.length >= 4 ? 85 : sections.length >= 3 ? 70 : 50;
  const introSection    = sections.find(s => s.type === 'intro');
  const hookStrength    = introSection ? Math.min(100, Math.round((wordCount(introSection.body) / 80) * 100)) : 0;
  const subjectScore    = subjectLine.length >= 20 && subjectLine.length <= 60 ? 80 : 50;

  const overall = Math.round(
    densityScore    * 0.20 + evidenceScore  * 0.15 + persuasionScore * 0.25 +
    ctaQuality      * 0.10 + coherence      * 0.15 + hookStrength    * 0.10 +
    subjectScore    * 0.05
  );

  return {
    overall_score:             Math.max(0, Math.min(100, overall)),
    density_score:             Math.max(0, Math.min(100, densityScore)),
    evidence_score:            Math.max(0, Math.min(100, evidenceScore)),
    persuasion_score:          Math.max(0, Math.min(100, persuasionScore)),
    cta_quality_score:         Math.max(0, Math.min(100, ctaQuality)),
    narrative_coherence_score: Math.max(0, Math.min(100, coherence)),
    hook_strength_score:       Math.max(0, Math.min(100, hookStrength)),
    audience_alignment_score:  60,
    total_content_words:       totalWords,
    avg_words_per_unit:        Math.round(avgPerSection),
  };
}

// ─── Section coercion ─────────────────────────────────────────────────────────

const VALID_TYPES = new Set(['intro', 'story', 'quick-takes', 'callout', 'cta', 'sponsor', 'divider']);

function coerceSection(raw: unknown, index: number): NewsletterSection {
  const s = (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? raw as Record<string, unknown> : {};

  const rawType = String(s.type ?? '').toLowerCase();
  const type    = VALID_TYPES.has(rawType)
    ? rawType as NewsletterSection['type']
    : index === 0 ? 'intro' : 'story';

  const body    = String(s.body ?? s.content ?? s.text ?? '').trim();
  const heading = s.heading ? String(s.heading).trim() : undefined;
  const callout = s.callout ? String(s.callout).trim() : undefined;
  const bullets = Array.isArray(s.bullets)
    ? (s.bullets as unknown[]).map(b => String(b).trim()).filter(Boolean) : [];
  const wc      = wordCount(body) + bullets.reduce((a, b) => a + wordCount(b), 0);
  const id      = String(s.id ?? `section-${index + 1}`).toLowerCase().replace(/\s+/g, '-');

  return {
    id,
    type,
    ...(heading          ? { heading }       : {}),
    body: body || (type === 'quick-takes' ? '' : `Section ${index + 1}`),
    ...(bullets.length   ? { bullets }       : {}),
    ...(callout          ? { callout }       : {}),
    ...(wc > 0           ? { word_count: wc } : {}),
  };
}

function extractSections(parsed: Record<string, unknown>): NewsletterSection[] {
  const raw = Array.isArray(parsed.sections) ? parsed.sections
    : Array.isArray(parsed.blocks) ? parsed.blocks
    : Array.isArray(parsed.parts)  ? parsed.parts
    : [];

  if (raw.length === 0) {
    const body = String(parsed.body ?? parsed.content ?? parsed.text ?? '').trim();
    if (body) {
      return [
        { id: 'intro', type: 'intro', body },
        { id: 'cta',   type: 'cta',   body: String(parsed.cta ?? 'Reply to share your thoughts.') },
      ];
    }
    return [];
  }
  return raw.map((s, i) => coerceSection(s, i));
}

// ─── Narrative arc inference ──────────────────────────────────────────────────

function inferNarrativeArc(sections: NewsletterSection[], hook: string): NarrativeArc {
  const types = sections.map(s => s.type);
  return {
    structure:     types.includes('story') ? 'story' : types.includes('quick-takes') ? 'framework' : 'how-to',
    hook_statement: (hook || sections[0]?.body?.slice(0, 100)) ?? '',
    thesis:         sections.find(s => s.type === 'story')?.heading ?? sections[1]?.heading ?? 'Main insight',
    resolution:     sections.find(s => s.type === 'cta')?.body?.slice(0, 100) ?? '',
    pacing:         sections.length >= 5 ? 'expansive' : sections.length >= 3 ? 'balanced' : 'tight',
  };
}

// ─── Main compiler function ───────────────────────────────────────────────────

export function compileNewsletterArtifact(
  raw: string | DraftArtifactInput | object,
  opts: { topic?: string; provider?: string; requestId?: string; tone?: string } = {}
): OCLNewsletterCompileResult {
  const start = Date.now();

  // ── Parse ─────────────────────────────────────────────────────────────────
  let parsed: Record<string, unknown> = {};
  let rawText = '';
  // SPRINT1-FIX (F-06): track whether extractJSON() succeeded so callers can
  // detect the silent fallback path (placeholder artifact, not real LLM output).
  let parsedFromJson = false;

  if (typeof raw === 'string') {
    const cleanResult = cleanOutput(raw);
    rawText = cleanResult.cleaned;
    const jsonResult = extractJSON(rawText);
    if (jsonResult && typeof jsonResult === 'object' && !Array.isArray(jsonResult)) {
      parsed = jsonResult as Record<string, unknown>;
      parsedFromJson = true;
    } else {
      // Treat as plain text — FALLBACK PATH.
      // parsedFromJson remains false; the caller (runNewsletterPipeline) logs a
      // warning so this silent degradation is surfaced in server logs.
      parsed = {
        title:        opts.topic ?? 'Newsletter',
        subject_line: opts.topic ?? 'Newsletter',
        preview_text: 'Read the latest update.',
        hook:         rawText.split('\n')[0]?.slice(0, 120) ?? '',
        cta:          'Reply to share your thoughts.',
        sections: [
          { id: 'intro', type: 'intro', body: rawText.slice(0, 1000) },
          { id: 'cta',   type: 'cta',   body: 'Reply to share your thoughts.' },
        ],
      };
    }
  } else if (raw && typeof raw === 'object') {
    parsed = raw as Record<string, unknown>;
    parsedFromJson = true;
  }

  // ── Extract root fields ───────────────────────────────────────────────────
  const title       = String(parsed.title ?? opts.topic ?? 'Newsletter').trim();
  const subjectLine = String(parsed.subject_line ?? parsed.subjectLine ?? parsed.subject ?? title).trim();
  const previewText = String(parsed.preview_text ?? parsed.previewText ?? parsed.preview ?? '').trim();
  const hook        = String(parsed.hook ?? '').trim();
  const cta         = String(parsed.cta ?? '').trim();

  let sections = extractSections(parsed);

  if (sections.length === 0) {
    sections = [
      { id: 'intro', type: 'intro', body: opts.topic ?? 'Introduction' },
      { id: 'cta',   type: 'cta',   body: 'Reply to share your thoughts.' },
    ];
  }
  if (!sections.some(s => s.type === 'cta')) {
    sections.push({ id: 'cta', type: 'cta', body: cta || 'Reply to share your thoughts.' });
  }

  // ── Compute ───────────────────────────────────────────────────────────────
  const richness     = computeNewsletterRichnessMetrics(sections, subjectLine, cta);
  const totalWords   = sections.reduce((acc, s) => acc + (s.word_count ?? 0), 0);
  const now          = new Date().toISOString();

  const newsletterMeta: NewsletterMeta = {
    section_count:           sections.length,
    word_count:              totalWords,
    estimated_read_minutes:  Math.max(1, Math.ceil(totalWords / 200)),
    cadence:                 'weekly',
    audience_type:           'b2b',
  };

  const semanticTheme: SemanticTheme = {
    visual_preset:      'modern-light',
    voice_archetype:    opts.tone ?? 'authority',
    emotional_register: 'credibility',
  };

  const audience: AudienceProfile = {
    sophistication: 'practitioner',
    label:          'Newsletter subscribers',
  };

  const exportMeta: ExportMetadata = {
    available_formats:  ['json', 'html', 'pdf'],
    recommended_format: 'json',
  };

  const generationTrace: GenerationTrace = {
    generated_at:       now,
    ocl_strategy:       'json-parse',
    governance_outcome: 'bypassed',
    repair_attempts:    0,
    input_type:         typeof raw === 'string' ? 'text' : 'json',
    ...(opts.provider ? { provider: opts.provider } : {}),
  };

  const trace: NormalizationTrace = {
    steps:    ['cleanOutput', 'extractJSON', 'coerceSections'],
    warnings: [],
    strategy: 'json',
  };

  const artifact: NewsletterArtifact = {
    $schema:          'artifact-json@2.0',
    id:               uuidv4(),
    artifact_type:    'newsletter',
    title,
    summary:          previewText || sections[0]?.body?.slice(0, 200) || title,
    hook:             hook || sections[0]?.body?.slice(0, 80) || title,
    cta:              cta || sections.find(s => s.type === 'cta')?.body?.slice(0, 100) || '',
    subject_line:     subjectLine,
    preview_text:     previewText,
    semantic_theme:   semanticTheme,
    audience,
    narrative_arc:    inferNarrativeArc(sections, hook),
    richness_metrics: richness,
    generation_trace: generationTrace,
    export_metadata:  exportMeta,
    newsletter_meta:  newsletterMeta,
    sections,
    created_at:       now,
  };

  return { artifact, trace, durationMs: Date.now() - start, parsedFromJson };
}
