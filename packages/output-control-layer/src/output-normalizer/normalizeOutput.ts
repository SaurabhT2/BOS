// ============================================================
// @brandos/output-control-layer — output-normalizer/normalizeOutput.ts
//
// Coordinator — delegates to pipeline and parser sub-modules.
//
// Pipeline:
//   Raw output
//     ↓
//   parseArtifact()  [output-normalizer/parser]
//     ↓
//   transform pipeline [output-normalizer/pipeline]
//     ↓
//   schema transform [artifact-compiler/transformers]
//     ↓
//   Normalized output (structured DraftArtifactInput — never a raw JSON blob)
//
// This module owns ONLY coordination. It does NOT own:
//   - role inference (artifact-compiler)
//   - weak model adaptation (artifact-compiler)
//   - artifact building (artifact-compiler)
//   - richness scoring (artifact-compiler)
//   - narrative inference (artifact-compiler)
//
// REFACTOR (2026-05-23):
//   Prior: normalizeOutput returned raw JSON strings for deck/report in
//   NormalizedOutput.content.rawText. compile*Artifact() then re-parsed these
//   strings, ran its OWN coercion, and discarded the transformer's work.
//   Two divergent coercion paths produced structurally different intermediates.
//
//   Now: normalizeOutput returns a fully structured DraftArtifactInput for
//   ALL three types (carousel, deck, report):
//     - carousel: content.slides[] (unchanged)
//     - deck:     content.slides[] + content.meta (populated from CanonicalDeckSchema)
//     - report:   content.slides[] + content.meta (populated from CanonicalReportSchema)
//
//   compile*Artifact() receives a DraftArtifactInput and enters its non-string
//   branch directly — no double parse, no transformer re-invocation, single path.
//
//   The compile*Artifact() compilers still call transformToXxxSchema internally
//   when they receive a DraftArtifactInput, which is intentional: the transform
//   functions are idempotent and cheap, and keeping the internal compile path
//   self-contained means the compilers remain callable standalone (e.g. from
//   ArtifactEngine or tests) without requiring normalizeOutput() as a prerequisite.
// ============================================================

import type {
  AIRuntimeOutput,
  NormalizedOutput,
  NormalizationTrace,
  NormalizeOptions,
  DraftArtifactInput,
  DraftArtifactSlide,
  DraftArtifactMeta,
} from '@brandos/contracts';

import { runTransformPipeline } from './pipeline/transformPipeline';
import { parseArtifact } from './parser/parseArtifact';
import { transformToCarouselSchema } from '../artifact-compiler/transformers/transformToCarouselSchema';
import { transformToDeckSchema } from '../artifact-compiler/transformers/transformToDeckSchema';
import { transformToReportSchema } from '../artifact-compiler/transformers/transformToReportSchema';

// Task types that require structured JSON output.
const STRUCTURED_TASK_TYPES = new Set(['carousel', 'deck', 'report']);

function emptyDraft(rawText?: string): DraftArtifactInput {
  return { rawText: rawText ?? '' };
}

// ─── Deck helpers ─────────────────────────────────────────────────────────────

/**
 * buildDeckDraftFromCanonical — converts a CanonicalDeckSchema into a
 * DraftArtifactInput so the downstream compileDeckArtifact() receives a
 * typed object instead of a raw JSON string.
 *
 * Each CanonicalDeckSection maps to one DraftArtifactSlide:
 *   heading       → headline
 *   talkingPoints → bullets
 *
 * The title and any envelope fields (hook, cta) travel in meta.
 */
function buildDeckDraftFromCanonical(
  canonical: ReturnType<typeof transformToDeckSchema>,
  parsedObj: Record<string, unknown>,
): DraftArtifactInput {
  if (!canonical) return emptyDraft();

  const slides: DraftArtifactSlide[] = canonical.sections.map(section => ({
    headline: section.heading,
    bullets: section.talkingPoints,
  }));

  const meta: DraftArtifactMeta = {
    title: canonical.title,
    hook: (parsedObj.hook ?? parsedObj.intro ?? undefined) as string | undefined,
    cta: (parsedObj.cta ?? parsedObj.callToAction ?? undefined) as string | undefined,
    audience: (parsedObj.audience ?? undefined) as string | undefined,
  };

  return { slides, meta };
}

// ─── Report helpers ───────────────────────────────────────────────────────────

/**
 * buildReportDraftFromCanonical — converts a CanonicalReportSchema into a
 * DraftArtifactInput so the downstream compileReportArtifact() receives a
 * typed object instead of a raw JSON string.
 *
 * Each CanonicalReportSlide maps to one DraftArtifactSlide:
 *   title   → headline
 *   bullets → bullets
 *   stats   → preserved as-is on the raw object for compiler pickup
 *
 * The title and envelope fields travel in meta.
 */
function buildReportDraftFromCanonical(
  canonical: ReturnType<typeof transformToReportSchema>,
  parsedObj: Record<string, unknown>,
): DraftArtifactInput {
  if (!canonical) return emptyDraft();

  const slides: DraftArtifactSlide[] = canonical.slides.map(slide => ({
    headline: slide.title,
    bullets: slide.bullets,
    // Carry stats through so compileReportArtifact can map them to data_points
    ...(slide.stats && slide.stats.length > 0 && { _stats: slide.stats } as Record<string, unknown>),
  }));

  const meta: DraftArtifactMeta = {
    title: canonical.title,
    hook: (parsedObj.hook ?? parsedObj.intro ?? undefined) as string | undefined,
    cta: (parsedObj.cta ?? parsedObj.callToAction ?? undefined) as string | undefined,
    audience: (parsedObj.audience ?? undefined) as string | undefined,
  };

  return { slides, meta };
}

// ─── Main normalizer ──────────────────────────────────────────────────────────

/**
 * normalizeOutput — the single entry point for Output Control.
 *
 * Accepts raw LLM output and returns NormalizedOutput, which is either:
 *   • { success: true,  content: DraftArtifactInput } — ready for compile*Artifact()
 *   • { success: false, content: emptyDraft }         — trigger retry in orchestrator
 *
 * The compile*Artifact() compilers MUST only receive NormalizedOutput.content,
 * never rawContent. The CPL pipeline must NOT reshape or re-parse this content.
 *
 * Post-refactor: content is always a structured DraftArtifactInput for all three
 * artifact types. The CPL can treat it as an immutable, pre-structured payload
 * and forward it directly to compile*Artifact() without inspection or mutation.
 *
 * @deprecated Since the 2026-05-23 refactor, normalization sub-steps
 * (cleanOutput, extractJSON, transformTo*Schema) are called directly inside
 * each compile*Artifact() compiler. This coordinator function is no longer
 * called in production. The 12 integration tests that cover it exercise the
 * real sub-modules and remain valid. This function will be removed in the next
 * cleanup sprint. Do NOT add new call sites — call compile*Artifact() directly
 * via ArtifactEngine.compileAndGovern() instead.
 */
export async function normalizeOutput(
  input: AIRuntimeOutput,
  options: NormalizeOptions,
): Promise<NormalizedOutput> {
  const trace: NormalizationTrace = {
    steps: [],
    strategy: '...',
    cleaningApplied: [],
    extractionAttempted: false,
    repairAttempted: false,
    repairSucceeded: false,
    validationPassed: false,
  };

  // Text-only tasks: no JSON processing needed — pass straight through
  if (!STRUCTURED_TASK_TYPES.has(options.taskType)) {
    return {
      success: true,
      type: 'report',
      content: emptyDraft(input.content ?? ''),
      trace: {
        ...trace,
        strategy: 'text_passthrough',
        validationPassed: true,
      },
    };
  }

  const raw = input.content ?? '';

  // ── Step 1: Try fast parse via parseArtifact (3-pass: direct, clean+extract, repair) ──
  const parseResult = parseArtifact(raw);
  let parsed: unknown | null = parseResult.ok ? parseResult.data : null;

  let pipelineTrace = {
    cleaningApplied: [] as string[],
    extractionAttempted: false,
    repairAttempted: false,
    repairSucceeded: false,
    strategy: '',
  };

  // ── Step 2: If fast parse failed, run the full transform pipeline ──────────
  if (parsed === null) {
    const pipelineResult = await runTransformPipeline(raw, options);
    parsed = pipelineResult.parsed;
    pipelineTrace = pipelineResult.trace as typeof pipelineTrace;
  } else {
    pipelineTrace = {
      cleaningApplied: [],
      extractionAttempted: true,
      repairAttempted: parseResult.ok && parseResult.repaired === true,
      repairSucceeded: parseResult.ok && parseResult.repaired === true,
      strategy: parseResult.ok && parseResult.repaired ? 'json_repaired' : 'json_direct',
    };
  }

  // Merge pipeline trace
  trace.cleaningApplied = pipelineTrace.cleaningApplied;
  trace.extractionAttempted = pipelineTrace.extractionAttempted;
  trace.repairAttempted = pipelineTrace.repairAttempted;
  trace.repairSucceeded = pipelineTrace.repairSucceeded;
  trace.strategy = pipelineTrace.strategy || 'fallback_empty';

  // ── Step 3: Schema transform → structured DraftArtifactInput ──────────────
  //
  // All three paths now return a DraftArtifactInput (never a raw JSON string).
  // compile*Artifact() receives an already-structured object and takes the
  // non-string branch, so the transformer runs exactly once per request.

  if (parsed !== null) {
    const parsedObj = (typeof parsed === 'object' && !Array.isArray(parsed))
      ? (parsed as Record<string, unknown>)
      : {};

    if (options.taskType === 'carousel') {
      // ── Carousel ──────────────────────────────────────────────────────────
      const carousel = transformToCarouselSchema(parsed);
      if (carousel !== null) {
        trace.validationPassed = true;
        return {
          success: true,
          type: 'carousel',
          content: {
            slides: carousel.slides as unknown as DraftArtifactSlide[],
            meta: {
              title: carousel.title,
              hook: carousel.hook,
              cta: carousel.cta,
            },
          },
          trace,
        };
      }
      trace.errorMessage =
        'transformToCarouselSchema returned null — missing required fields (slides)';

    } else if (options.taskType === 'deck') {
      // ── Deck ──────────────────────────────────────────────────────────────
      //
      // POST-REFACTOR: returns structured DraftArtifactInput (not rawText).
      // compileDeckArtifact() receives this directly and calls transformToDeckSchema
      // internally (idempotent), entering its DraftArtifactInput branch.
      const deck = transformToDeckSchema(parsed);
      if (deck !== null) {
        trace.validationPassed = true;
        const draftContent = buildDeckDraftFromCanonical(deck, parsedObj);
        return {
          success: true,
          type: 'deck',
          content: draftContent,
          trace,
        };
      }
      trace.errorMessage =
        'transformToDeckSchema returned null — missing required fields (title or sections)';

    } else if (options.taskType === 'report') {
      // ── Report ────────────────────────────────────────────────────────────
      //
      // POST-REFACTOR: returns structured DraftArtifactInput (not rawText).
      // If transformToReportSchema returns null (pure text report), falls back
      // to passing the raw text so the compiler can create a single-section artifact.
      const report = transformToReportSchema(parsed);
      if (report !== null) {
        trace.validationPassed = true;
        const draftContent = buildReportDraftFromCanonical(report, parsedObj);
        return {
          success: true,
          type: 'report',
          content: draftContent,
          trace: { ...trace, strategy: pipelineTrace.strategy || 'json_direct', validationPassed: true },
        };
      }
      // Report text fallback: pass through as rawText — compileReportArtifact
      // handles rawText by creating a single-section report.
      trace.validationPassed = true;
      return {
        success: true,
        type: 'report',
        content: emptyDraft(raw),
        trace: { ...trace, strategy: pipelineTrace.strategy || 'text_passthrough', validationPassed: true },
      };
    }
  }

  // ── Failure ────────────────────────────────────────────────────────────────
  trace.strategy = 'fallback_empty';
  if (!trace.errorMessage) {
    trace.errorMessage = parsed === null
      ? 'JSON extraction and all repair strategies failed'
      : 'JSON parsed but schema transformation failed';
  }

  return {
    success: false,
    type: options.taskType as 'carousel' | 'deck' | 'report',
    content: emptyDraft(),
    trace,
  };
}


