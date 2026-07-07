/**
 * @brandos/governance-layer — IGovernanceLayer.ts
 *
 * Formal interface contract for the governance-layer package.
 *
 * L5 REQUIREMENT: This file is the authoritative machine-readable definition
 * of what @brandos/governance-layer exposes. All implementations in src/ must
 * satisfy these interfaces. No implementation detail leaks through here.
 *
 * DESIGN RULES:
 *   - No implementation imports
 *   - No circular dependencies
 *   - No class instances — only interfaces and type aliases
 *   - Typed contracts only; all fields must be typed
 *   - Future extension via GovernedArtifactType union extension only
 */

// ─── Core result types ────────────────────────────────────────────────────────

/**
 * SemanticGovernanceResult — output of a single validator run.
 * Used internally and by GovernancePluginRegistry validator resolution.
 */
export interface ISemanticGovernanceResult {
  readonly passed: boolean
  readonly score?: number
  readonly violations?: readonly string[]
  readonly repaired?: boolean
  readonly repairAttempts?: number
}

/**
 * SemanticRepairResult — output of a repair + re-validation cycle.
 */
export interface ISemanticRepairResult<T = unknown> {
  readonly success: boolean
  readonly artifact: T
  readonly repaired: boolean
  readonly attempts: number
  readonly finalRejection?: string
}

/**
 * GovernanceResult — unified output of a full governance pipeline run.
 * Merges validation + repair into a single result for callers (artifact-engine-layer, CPL).
 */
export interface IGovernanceResult<T = unknown> extends ISemanticRepairResult<T> {
  readonly validationOutcome: ISemanticValidationOutcome
}

/**
 * SemanticValidationOutcome — discriminated union describing validation result.
 * The `slideCount` field is present in both branches for structured logging.
 */
export type ISemanticValidationOutcome =
  | { readonly valid: true; readonly slideCount: number; readonly warnings: readonly string[] }
  | { readonly valid: false; readonly reason: string; readonly details: readonly string[]; readonly slideCount: number }

// ─── Plugin interfaces ────────────────────────────────────────────────────────

/** A callable validator — pure, deterministic, no I/O */
export interface ISemanticValidator<T = unknown> {
  validate(input: T, requestId?: string): Promise<ISemanticGovernanceResult>
}

/** A callable scorer — returns a number in [0, 100] */
export interface ISemanticScorer<T = unknown> {
  score(input: T, requestId?: string): Promise<number>
}

/**
 * A callable repair function — MUST accept callLLM as an injected callback.
 * Repair functions MUST NOT import or call LLM SDKs directly.
 */
export interface ISemanticRepair<T = unknown> {
  repair(
    input: T,
    topic: string,
    callLLM: (prompt: string) => Promise<string>,
    requestId?: string
  ): Promise<ISemanticRepairResult<T>>
}

// ─── Plugin registry contract ─────────────────────────────────────────────────

export type GovernanceCapabilityKey = string

export interface IGovernanceValidatorPlugin<T = unknown> {
  readonly capabilityKey: GovernanceCapabilityKey
  readonly artifactType: string
  readonly validator: ISemanticValidator<T>
}

export interface IGovernanceScorerPlugin<T = unknown> {
  readonly capabilityKey: GovernanceCapabilityKey
  readonly artifactType: string
  readonly scorer: ISemanticScorer<T>
}

export interface IGovernanceRepairPlugin<T = unknown> {
  readonly capabilityKey: GovernanceCapabilityKey
  readonly artifactType: string
  readonly repair: ISemanticRepair<T>
}

/**
 * IGovernancePluginRegistry — registry contract.
 * Implementation is a singleton (GovernancePluginRegistry).
 * This interface allows callers to depend on the contract, not the class.
 */
export interface IGovernancePluginRegistry {
  registerValidator<T>(plugin: IGovernanceValidatorPlugin<T>): void
  registerScorer<T>(plugin: IGovernanceScorerPlugin<T>): void
  registerRepair<T>(plugin: IGovernanceRepairPlugin<T>): void

  resolveValidator<T>(artifactType: string, capabilityKey: GovernanceCapabilityKey): ISemanticValidator<T> | null
  resolveScorer<T>(artifactType: string, capabilityKey: GovernanceCapabilityKey): ISemanticScorer<T> | null
  resolveRepair<T>(artifactType: string, capabilityKey: GovernanceCapabilityKey): ISemanticRepair<T> | null

  listCapabilities(): {
    readonly validators: readonly string[]
    readonly scorers: readonly string[]
    readonly repairs: readonly string[]
  }

  hasValidator(artifactType: string, capabilityKey: GovernanceCapabilityKey): boolean
  hasRepair(artifactType: string, capabilityKey: GovernanceCapabilityKey): boolean
}

// ─── Text scoring contract ────────────────────────────────────────────────────

export interface IGovernanceContext {
  readonly tone?: string
  readonly engineBadge?: string
  readonly workspaceId?: string
}

export interface IGovernanceEvaluationInput {
  readonly content: string
  readonly taskType: string
  readonly context?: IGovernanceContext
}

export interface IGovernanceEvaluationResult {
  readonly passed: boolean
  readonly score: number
  readonly original_score: number
  readonly annotations: readonly string[]
  readonly recommendations: readonly string[]
  readonly violations: readonly string[]
  readonly flags_remaining: readonly string[]
  readonly approved_output: string
  readonly engine_badge: string
}

/**
 * IGoveranceTextScorer — contract for the text-quality scoring path.
 * evaluateGovernance() is the canonical implementation.
 */
export interface IGovernanceTextScorer {
  evaluate(input: IGovernanceEvaluationInput): IGovernanceEvaluationResult
}

// ─── Governed artifact type ───────────────────────────────────────────────────

/**
 * GovernedArtifactType — artifact types that have governance implementations.
 * Adding a new type requires:
 *   1. A validator in src/<type>/validator.ts
 *   2. Registration in bootstrapGovernancePlugins()
 *   3. Extending this union
 */
export type GovernedArtifactType = 'carousel' | 'deck' | 'report' | 'webpage' | 'social'

// ─── Policy violation handler ─────────────────────────────────────────────────

export type PolicyViolationType = 'score_below_threshold' | 'cliche_density' | 'weak_hook'

export type PolicyViolationHandler = (
  type: PolicyViolationType,
  score: number,
  details: string
) => void

// ─── Package self-validation ──────────────────────────────────────────────────

export interface IPackageHealthCheck {
  readonly name: string
  readonly passed: boolean
  readonly detail: string
}

export interface IPackageHealthReport {
  readonly package: string
  readonly version: string
  readonly level: string
  readonly healthy: boolean
  readonly checks: readonly IPackageHealthCheck[]
  readonly checkedAt: string
}


