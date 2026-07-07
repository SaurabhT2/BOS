// ============================================================
// @brandos/output-control-layer — output-normalizer/pipeline/transformPipeline.ts
//
// Orchestrates the transform pipeline: clean → extract → repair.
// Does NOT own schema transformation (that is normalizeOutput's coordinator role).
// ============================================================

import type { NormalizationTrace, NormalizeOptions } from '@brandos/contracts';
import { cleanOutput } from './cleanOutput';
import { extractJSON } from './extractJSON';
import { repairJSON, repairWithLLM } from './repairJSON';

export interface PipelineResult {
  parsed: unknown | null;
  trace: Pick<NormalizationTrace, 'cleaningApplied' | 'extractionAttempted' | 'repairAttempted' | 'repairSucceeded' | 'strategy'>;
}

/**
 * runTransformPipeline — executes: clean → extract → heuristic repair → LLM repair.
 *
 * Returns the parsed JS value or null if all strategies fail.
 * Caller (normalizeOutput) owns schema transformation.
 */
export async function runTransformPipeline(
  raw: string,
  options: Pick<NormalizeOptions, 'enableLLMRepair' | 'callLLM'>
): Promise<PipelineResult> {
  let strategy = '';
  let repairAttempted = false;
  let repairSucceeded = false;

  // Step 1: Clean
  const { cleaned, steps: cleaningApplied } = cleanOutput(raw);

  // Step 2: Extract JSON
  const extractionAttempted = true;
  let parsed = extractJSON(cleaned);

  if (parsed !== null) {
    strategy = (cleaningApplied.length === 0 || (cleaningApplied.length === 1 && cleaningApplied[0] === 'trimmed_whitespace'))
      ? 'json_direct'
      : 'json_extracted';
  }

  // Step 3: Heuristic repair
  if (parsed === null) {
    repairAttempted = true;
    const heuristicResult = repairJSON(cleaned);
    if (heuristicResult !== null) {
      parsed = JSON.parse(heuristicResult);
      repairSucceeded = true;
      strategy = 'json_repaired';
    } else if (options.enableLLMRepair && options.callLLM) {
      const llmResult = await repairWithLLM(cleaned, options.callLLM);
      if (llmResult !== null) {
        parsed = JSON.parse(llmResult);
        repairSucceeded = true;
        strategy = 'llm_repaired';
      }
    }
  }

  return {
    parsed,
    trace: {
      cleaningApplied,
      extractionAttempted,
      repairAttempted,
      repairSucceeded,
      strategy,
    },
  };
}


