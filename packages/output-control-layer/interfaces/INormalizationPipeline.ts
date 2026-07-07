// ============================================================
// @brandos/output-control-layer — interfaces/INormalizationPipeline.ts
//
// Defines the normalization pipeline boundary.
//
// PIPELINE STAGES (in order):
//   1. cleanOutput()       — strip fences, preambles, control chars
//   2. extractJSON()       — 3-pass bracket-depth extraction
//   3. repairJSON()        — heuristic repair (trailing commas, unquoted keys)
//   4. repairWithLLM()     — optional LLM repair (gated by enableLLMRepair)
//   5. transformTo*Schema()— schema normalization per artifact type
//
// OWNERSHIP BOUNDARIES:
//   Each stage is independently testable.
//   normalizeOutput() is the coordinator — it does NOT own stage logic.
//   Stages do NOT call each other directly except through the pipeline.
// ============================================================

import type { NormalizeOptions, CleaningStep } from '@brandos/contracts';

// ─── Stage result types ───────────────────────────────────────────────────────

/**
 * ICleanResult — output of cleanOutput() stage.
 */
export interface ICleanResult {
  /** Cleaned text with fences, preambles, and control chars removed */
  cleaned: string;
  /** Ordered list of transformations applied */
  steps: CleaningStep[];
}

/**
 * IParseArtifactResult — output of parseArtifact() with recovery.
 */
export type IParseArtifactResult<T> =
  | { ok: true; data: T; repaired?: boolean }
  | { ok: false; error: string; raw: string };

/**
 * IPipelineResult — output of runTransformPipeline().
 */
export interface IPipelineResult {
  /** Parsed JS value, or null if all strategies failed */
  parsed: unknown | null;
  trace: {
    cleaningApplied: CleaningStep[];
    extractionAttempted: boolean;
    repairAttempted: boolean;
    repairSucceeded: boolean;
    strategy: string;
  };
}

// ─── Stage interfaces ─────────────────────────────────────────────────────────

/**
 * ICleanStage — stage 1: strip noise from raw LLM output.
 *
 * INVARIANT: pure function, no side effects, deterministic.
 * INVARIANT: never mutates input.
 */
export interface ICleanStage {
  clean(raw: string): ICleanResult;
}

/**
 * IExtractStage — stage 2: extract JSON from cleaned text.
 *
 * INVARIANT: no LLM calls.
 * INVARIANT: returns null, never throws.
 */
export interface IExtractStage {
  extract(text: string): unknown | null;
}

/**
 * IRepairStage — stage 3: heuristic repair of malformed JSON.
 *
 * INVARIANT: no LLM calls.
 * INVARIANT: returns repaired string or null (never partial).
 * INVARIANT: returned string always parses with JSON.parse.
 */
export interface IRepairStage {
  repair(text: string): string | null;
}

/**
 * ILLMRepairStage — stage 4: optional LLM-assisted repair.
 *
 * INVARIANT: only invoked when enableLLMRepair=true.
 * INVARIANT: callLLM is injected — never imported directly.
 * INVARIANT: returned string always parses with JSON.parse, or null.
 */
export interface ILLMRepairStage {
  repairWithLLM(
    brokenJSON: string,
    callLLM: (prompt: string) => Promise<string>
  ): Promise<string | null>;
}

/**
 * ITransformPipeline — coordinates all stages in sequence.
 *
 * INVARIANT: never throws. Returns { parsed: null } on complete failure.
 */
export interface ITransformPipeline {
  run(
    raw: string,
    options: Pick<NormalizeOptions, 'enableLLMRepair' | 'callLLM'>
  ): Promise<IPipelineResult>;
}

/**
 * INormalizationPipeline — the full normalization coordinator.
 *
 * Wraps all stages and schema transforms. The single entry point for
 * post-generation output processing.
 */
export interface INormalizationPipeline extends ITransformPipeline {
  readonly stages: {
    clean: ICleanStage;
    extract: IExtractStage;
    repair: IRepairStage;
    llmRepair: ILLMRepairStage;
  };
}


