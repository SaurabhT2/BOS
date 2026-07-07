// ============================================================
// packages/ai-runtime-layer/src/validator-engine/index.ts
//
// VALIDATOR ENGINE — Output Schema Validation
//
// Stateless. Validates raw model output against an OutputSchema.
// The same ValidatorEngine instance is safe to share across all requests.
//
// VALIDATION MODES:
//
//   No schema (schema undefined):
//     Always valid. schema_valid flag added.
//
//   Text schema (schema.type === 'text'):
//     Validates only that content is non-empty. Truncation check applied.
//
//   JSON schema (schema.type === 'json' or 'array'):
//     1. Attempt to parse content as JSON (strips ```json ... ``` fences first).
//     2. If strict: false and parsing fails → degraded success (schema_invalid flag,
//        valid:true). The content is returned as-is for the caller to handle.
//     3. If strict: true and parsing fails → validation failure (valid:false).
//     4. Array check: if type is 'array', parsed value must be an array.
//     5. Shape check: if schema.shape is provided, verify all required keys are present.
//        Strict mode fails on missing keys; non-strict degrades.
//
// QUALITY FLAGS:
//   schema_valid   — output passed all schema checks
//   schema_invalid — output failed at least one schema check
//   truncated      — output length approaches max_tokens limit (potential truncation)
//   empty          — output is empty or whitespace only
//
// FENCE STRIPPING:
//   Models frequently wrap JSON in ```json ... ``` despite instructions not to.
//   tryParseJson() strips these fences before attempting JSON.parse().
//   This is a resilience measure — providers should not produce fenced JSON.
// ============================================================

import { IValidatorEngine, OutputSchema, QualityFlag, ValidationResult } from '@brandos/contracts'

export class ValidatorEngine implements IValidatorEngine {

  /**
   * Validate raw model output against an optional OutputSchema.
   *
   * @param raw    - Raw string content from the provider adapter.
   * @param schema - Optional output schema specifying type, shape, max_tokens, strict.
   * @returns ValidationResult with valid flag, quality flags, reason, and parsed value.
   */
  validate(raw: string, schema?: OutputSchema): ValidationResult {
    const flags: QualityFlag[] = []

    // Empty content check — applies regardless of schema type.
    // Empty outputs are never valid; they indicate a provider failure.
    if (!raw || raw.trim().length === 0) {
      flags.push('empty')
      return { valid: false, flags, reason: 'Empty response from provider' }
    }

    // Corruption check — applies regardless of schema type.
    // These strings indicate a rendering defect, serialisation bug, or
    // incomplete generation. They must never pass governance.
    const CORRUPTION_PATTERNS: RegExp[] = [
      /\[object Object\]/,
      /^undefined$/i,
      /^null$/i,
      /\bTODO\b/,
      /\bTBD\b/,
      /Lorem ipsum/i,
      /\bplaceholder\b/i,
      /INSERT_\w+_HERE/,
      /FIXME/,
    ]
    const corruptionMatch = CORRUPTION_PATTERNS.find(p => p.test(raw))
    if (corruptionMatch) {
      flags.push('corrupted')
      return {
        valid:  false,
        flags,
        reason: `Artifact contains rendering defect (matched: ${corruptionMatch.source})`,
      }
    }

    // No schema — any non-empty, non-corrupted content is valid.
    if (!schema) {
      flags.push('schema_valid')
      return { valid: true, flags }
    }

    // Truncation detection — approximate (characters / 4 ≈ tokens).
    // Triggers at 95% of max_tokens to catch near-truncation states.
    if (schema.max_tokens) {
      const approxTokens = Math.ceil(raw.length / 4)
      if (approxTokens >= schema.max_tokens * 0.95) flags.push('truncated')
    }

    // JSON / Array schema validation.
    if (schema.type === 'json' || schema.type === 'array') {
      const parsed = this.tryParseJson(raw)

      // JSON parse failed.
      if (parsed === null) {
        flags.push('schema_invalid')
        return {
          valid:  schema.strict ? false : true, // Degrade (not fail) when non-strict
          flags,
          reason: 'Response is not valid JSON',
        }
      }

      // Array type: parsed value must be an array.
      if (schema.type === 'array' && !Array.isArray(parsed)) {
        flags.push('schema_invalid')
        return {
          valid:  schema.strict ? false : true,
          parsed,
          flags,
          reason: 'Response is not a JSON array',
        }
      }

      // Shape check: verify required keys are present.
      if (schema.shape && typeof parsed === 'object' && parsed !== null) {
        const missing = this.checkShape(parsed as Record<string, unknown>, schema.shape)
        if (missing.length > 0) {
          flags.push('schema_invalid')
          if (schema.strict) {
            return {
              valid:  false,
              parsed,
              flags,
              reason: `Missing keys: ${missing.join(', ')}`,
            }
          }
          // Non-strict: degraded success — content passes with schema_invalid flag.
        }
      }

      flags.push('schema_valid')
      return { valid: true, parsed, flags }
    }

    // Text schema (or any unrecognised type) — non-empty content is sufficient.
    flags.push('schema_valid')
    return { valid: true, flags }
  }

  /**
   * Attempt to parse content as JSON, stripping markdown code fences first.
   *
   * Models frequently produce ```json\n{...}\n``` despite instructions to respond
   * with raw JSON. Stripping fences prevents unnecessary validation failures.
   *
   * @param raw - Raw string content from the provider.
   * @returns Parsed JSON value, or null if parsing fails.
   */
  private tryParseJson(raw: string): unknown | null {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()
    try {
      return JSON.parse(cleaned)
    } catch {
      return null
    }
  }

  /**
   * Check that all required keys from schema.shape are present in parsed.
   *
   * @param parsed - Parsed JSON object from the model response.
   * @param shape  - Required key descriptor (key presence check only, not value types).
   * @returns Array of missing key names. Empty array = all keys present.
   */
  private checkShape(
    parsed: Record<string, unknown>,
    shape:  Record<string, unknown>,
  ): string[] {
    return Object.keys(shape).filter(key => !(key in parsed))
  }
}


