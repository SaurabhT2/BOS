/**
 * @brandos/governance-layer — src/contracts.ts
 *
 * Canonical semantic governance contracts used internally across all src/ modules.
 * These types are re-exported through src/index.ts for external consumers.
 *
 * DESIGN RULES:
 *   - No Next.js imports
 *   - No app-layer imports
 *   - No circular deps
 *   - Minimal, production-focused interfaces
 *   - All interfaces align with IGovernanceLayer.ts (interfaces/ directory)
 */

// ─── Core result type ─────────────────────────────────────────────────────────

export interface SemanticGovernanceResult {
  passed: boolean
  score?: number
  violations?: string[]
  repaired?: boolean
  repairAttempts?: number
}

// ─── Validator interface ──────────────────────────────────────────────────────

/** Pure, deterministic — no I/O, no LLM calls */
export interface SemanticValidator<T = unknown> {
  validate(input: T, requestId?: string): Promise<SemanticGovernanceResult>
}

// ─── Scorer interface ─────────────────────────────────────────────────────────

/** Must return a number in [0, 100] */
export interface SemanticScorer<T = unknown> {
  score(input: T, requestId?: string): Promise<number>
}

// ─── Repair interface ─────────────────────────────────────────────────────────

/**
 * SemanticRepair is intentionally separate from SemanticValidator.
 * Repair requires an LLM call. Validation is pure.
 * LLM MUST be injected — never imported directly.
 */
export interface SemanticRepair<T = unknown> {
  repair(
    input: T,
    topic: string,
    callLLM: (prompt: string) => Promise<string>,
    requestId?: string
  ): Promise<SemanticRepairResult<T>>
}

export interface SemanticRepairResult<T = unknown> {
  success: boolean
  artifact: T
  repaired: boolean
  attempts: number
  finalRejection?: string
}

// ─── Governance pipeline result ───────────────────────────────────────────────

/**
 * GovernanceResult — the unified output of runXxxSemanticGovernance().
 * Merges validation + repair into a single result for callers.
 */
export interface GovernanceResult<T = unknown> extends SemanticRepairResult<T> {
  validationOutcome: SemanticValidationOutcome
}

// ─── Validation detail ────────────────────────────────────────────────────────

export type SemanticValidationOutcome =
  | { valid: true; slideCount: number; warnings: string[] }
  | { valid: false; reason: string; details: string[]; slideCount: number }

// ─── Artifact type discriminator ─────────────────────────────────────────────

export type GovernedArtifactType = 'carousel' | 'deck' | 'report' | 'webpage' | 'social'


