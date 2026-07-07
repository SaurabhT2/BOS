// ============================================================
// @brandos/output-control-layer — output-normalizer/parser/parseArtifact.ts
//
// Canonical artifact JSON parsing with recovery.
//
// OUTPUT-CONTROL-LAYER owns:
//   - parseArtifact  : parse raw LLM string → typed result (with auto-repair)
//   - validateArtifactFields : validate required top-level fields
// ============================================================

import { cleanOutput } from '../pipeline/cleanOutput';
import { extractJSON } from '../pipeline/extractJSON';
import { repairJSON } from '../pipeline/repairJSON';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ParseArtifactResult<T> =
  | { ok: true; data: T; repaired?: boolean }
  | { ok: false; error: string; raw: string }

// ─── parseArtifact ───────────────────────────────────────────────────────────

/**
 * parseArtifact — robust artifact JSON parsing with recovery.
 *
 * Three-pass strategy:
 *   1. Direct JSON.parse on raw string
 *   2. cleanOutput (strip fences, preambles) then extractJSON
 *   3. heuristic repairJSON then JSON.parse
 *
 * Never throws to caller — always returns a discriminated union result.
 */
export function parseArtifact<T = unknown>(raw: string): ParseArtifactResult<T> {
  // Pass 1: direct parse (cheapest)
  try {
    return { ok: true, data: JSON.parse(raw) as T }
  } catch {
    // fall through
  }

  // Pass 2: clean then extract
  try {
    const { cleaned } = cleanOutput(raw)
    const extracted = extractJSON(cleaned)
    if (extracted !== null) {
      return { ok: true, data: extracted as T, repaired: true }
    }
  } catch {
    // fall through
  }

  // Pass 3: heuristic repair
  try {
    const { cleaned } = cleanOutput(raw)
    const repaired = repairJSON(cleaned)
    if (repaired !== null) {
      return { ok: true, data: JSON.parse(repaired) as T, repaired: true }
    }
  } catch {
    // fall through
  }

  return {
    ok: false,
    error: `JSON parse failed after all recovery strategies`,
    raw: raw.slice(0, 500),
  }
}

// Backward-compat alias for callers using the old name from parseArtifact.ts
export const parseArtifactJSON = parseArtifact;

// ─── validateArtifactFields ──────────────────────────────────────────────────

/**
 * validateArtifactFields — validate a parsed artifact has required top-level fields.
 *
 * Returns a list of validation error messages (empty = valid).
 */
export function validateArtifactFields(data: unknown, requiredFields: string[]): string[] {
  const errors: string[] = []
  if (typeof data !== 'object' || data === null) {
    return ['Artifact must be a JSON object']
  }
  for (const field of requiredFields) {
    if (!(field in (data as object))) {
      errors.push(`Missing required field: ${field}`)
    }
  }
  return errors
}


