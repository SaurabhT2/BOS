/**
 * @brandos/iskill-runtime — contracts/index.ts
 *
 * Canonical ISkill Runtime contracts.
 *
 * DEPENDENCY RULE: imports ONLY from @brandos/contracts. Never from
 * control-plane, artifact-engine implementation, or any other package.
 *
 * These types extend and specialise the contracts in @brandos/contracts,
 * adding the ISkill Runtime's own semantic layer:
 *   - ISkillPersonalizationContext  — structured identity projections per skill
 *   - ISkillExecutionContext        — full per-request execution environment
 *   - ISkillArtifactContract        — typed artifact output contract per skill
 *   - ISkillRepairContract          — repair specification per skill
 *   - IBundleDefinition             — ICP bundle runtime contract
 *   - ISkillRuntimeRegistry         — registration / discovery surface
 *   - ISkillLifecycle               — canonical lifecycle interface
 */

import type {
  ArtifactV2,
  ArtifactType,
  IGovernanceResult,
  SkillContext,
  SkillMetadata,
  SkillResult,
  ISkill,
  ExportFormat,
  RuntimeMode,

  IdentityDimension,
  IIdentityProjection,
  ISkillPersonalizationContext,
  IPersonalizationSnapshot,
  SkillType,
  VisualPersonalizationContext,
} from '@brandos/contracts'


export type {
  IdentityDimension,
  IIdentityProjection,
  ISkillPersonalizationContext,
  IPersonalizationSnapshot,
  SkillType,
  VisualPersonalizationContext,
}
from '@brandos/contracts'

// ─── Personalization ──────────────────────────────────────────────────────────
// IPersonalizationSnapshot is now canonical in @brandos/contracts (v1.2).
// Re-exported above. Local definition removed to eliminate drift risk.

// ─── Execution Context ────────────────────────────────────────────────────────

/**
 * ISkillExecutionContext — the per-request execution environment.
 *
 * Immutable during skill execution. Resolved at the boundary of
 * ISkillRuntime.executeSkill(), passed read-only into the lifecycle.
 */
export interface ISkillExecutionContext {
  /** Trace ID for distributed telemetry */
  requestId: string
  /** Authenticated user */
  userId: string
  /** Workspace scope */
  workspaceId: string
  /** Active persona (optional) */
  personaId?: string
  /** Runtime mode — local | cloud */
  runtimeMode: RuntimeMode
  /** Structured personalization — resolved before execution */
  personalization: ISkillPersonalizationContext
  /** Bundle this execution belongs to (if any) */
  bundleId?: string
  /** Governance overrides from bundle or admin settings */
  governanceOverrides?: IGovernanceOverrides
  /** Skill-level runtime metadata */
  metadata: Record<string, unknown>
  /** ISO timestamp when this context was built */
  builtAt: string
}

export interface IGovernanceOverrides {
  minRichnessScore?: number
  minSlides?: number
  maxSlides?: number
  bannedVocabulary?: string[]
  repairAttempts?: number       // overrides MAX_REPAIR_ATTEMPTS (default 2)
}

// ─── Artifact Contract ────────────────────────────────────────────────────────

/**
 * ISkillArtifactContract — the typed artifact output contract declared by a skill.
 *
 * Skills declare what they produce. The runtime enforces it.
 */
export interface ISkillArtifactContract<TArtifact extends ArtifactV2 = ArtifactV2> {
  /** Artifact type this skill produces */
  artifactType: ArtifactType
  /** Supported export formats */
  supportedFormats: ExportFormat[]
  /** Governance thresholds — skill-level defaults (overridden by bundle/admin) */
  governanceDefaults?: IGovernanceOverrides
  /** Schema of the output used for validation */
  outputSchema?: Record<string, unknown>
}

// ─── Repair Contract ──────────────────────────────────────────────────────────

/**
 * ISkillRepairContract — repair specification per skill.
 *
 * Skills declare how they want their artifacts repaired.
 * The runtime dispatches to ISkillLifecycle.repair() using this spec.
 */
export interface ISkillRepairContract {
  /** Max repair attempts (overrides runtime default if set) */
  maxAttempts?: number
  /**
   * Repair prompt builder. Called by the runtime with the governance
   * violation reason. Returns the LLM repair prompt.
   */
  buildRepairPrompt(
    artifactType: ArtifactType,
    violationReason: string,
    topic: string
  ): string
  /**
   * Whether to re-enter the full lifecycle (validate → prepare → execute)
   * or to call the compiler directly during repair.
   * Defaults to 'compiler-only'.
   */
  repairStrategy?: 'full-lifecycle' | 'compiler-only'
}

// ─── Skill Lifecycle ──────────────────────────────────────────────────────────

/**
 * ISkillLifecycle — canonical lifecycle interface for ISkill Runtime.
 *
 * All phases are typed. Each phase has a clear contract:
 *
 *   validate()  → input schema check (sync, no LLM)
 *   prepare()   → resolve context, inject personalization (no LLM)
 *   execute()   → generation + compilation (may call LLM via callLLM)
 *   repair()    → LLM repair on governance failure (via callLLM)
 *   finalize()  → post-governance enrichment (no LLM)
 *   export()    → artifact packaging for persistence / renderer
 *
 * The runtime orchestrates these phases in order.
 * Skills implement only the phases they need.
 */
export interface ISkillLifecycle<
  TInput = unknown,
  TOutput extends ArtifactV2 = ArtifactV2,
> {
  /** Declared artifact contract for this skill */
  readonly artifactContract: ISkillArtifactContract<TOutput>
  /** Repair contract — optional; runtime falls back to default if absent */
  readonly repairContract?: ISkillRepairContract
  /** Identity dimensions this skill consumes */
  readonly consumedDimensions: IdentityDimension[]

  /**
   * PHASE 1: validate
   * Validate input shape. Throws ISkillValidationError on failure.
   * Pure — no LLM, no I/O.
   */
  validate(input: TInput): ISkillValidationResult

  /**
   * PHASE 2: prepare
   * Prepare execution plan. Inject personalization. Return typed execution plan.
   * No LLM calls. Deterministic.
   */
  prepare(
    input: TInput,
    context: ISkillExecutionContext
  ): Promise<ISkillExecutionPlan<TInput>>

  /**
   * PHASE 3: execute
   * Run the skill — call LLM via callLLM, compile raw output.
   * Returns unverified compiled artifact (governance has not run yet).
   */
  execute(
    plan: ISkillExecutionPlan<TInput>,
    context: ISkillExecutionContext,
    callLLM: (prompt: string) => Promise<string>
  ): Promise<ISkillExecutionResult<TOutput>>

  /**
   * PHASE 4: repair (optional)
   * Called by runtime on governance failure.
   * Returns repaired compiled artifact (governance re-runs after this).
   */
  repair?(
    artifact: TOutput,
    governanceResult: IGovernanceResult<TOutput>,
    context: ISkillExecutionContext,
    callLLM: (prompt: string) => Promise<string>
  ): Promise<ISkillRepairResult<TOutput>>

  /**
   * PHASE 5: finalize (optional)
   * Post-governance enrichment. Add metadata, trace info, export markers.
   * No LLM. Must not modify governed artifact structure.
   */
  finalize?(
    artifact: TOutput,
    context: ISkillExecutionContext
  ): Promise<TOutput>

  /**
   * PHASE 6: export (optional)
   * Package artifact for persistence or handoff.
   * Returns SkillResult<TOutput> for the runtime to return to caller.
   */
  export?(
    artifact: TOutput,
    context: ISkillExecutionContext
  ): Promise<SkillResult<TOutput>>
}

// ─── Execution Plan ───────────────────────────────────────────────────────────

/**
 * ISkillExecutionPlan — the typed execution plan produced by prepare().
 *
 * Contains everything the execute() phase needs.
 * Immutable after prepare() returns.
 */
export interface ISkillExecutionPlan<TInput = unknown> {
  skillId: string
  requestId: string
  input: TInput
  /** Compiled LLM prompt — assembled by prepare() from personalization + input */
  prompt: string
  /** Identity context snapshot used during prompt assembly */
  personalizationSnapshot: IPersonalizationSnapshot
  /** Topic extracted from input */
  topic: string
  /** Tone override (if any) */
  tone?: string
  /** Artifact type being generated */
  artifactType: ArtifactType
  /** Metadata for tracing */
  planMetadata: Record<string, unknown>
  builtAt: string
}

// ─── Execution Result ─────────────────────────────────────────────────────────

export interface ISkillExecutionResult<TOutput extends ArtifactV2 = ArtifactV2> {
  artifact: TOutput
  rawLLMOutput: string
  durationMs: number
  compileDurationMs: number
}

// ─── Repair Result ────────────────────────────────────────────────────────────

export interface ISkillRepairResult<TOutput extends ArtifactV2 = ArtifactV2> {
  artifact: TOutput
  repairPromptUsed: string
  durationMs: number
  attemptNumber: number
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ISkillValidationResult {
  valid: boolean
  errors: ISkillValidationError[]
}

export interface ISkillValidationError {
  field: string
  message: string
  code: string
}

// ─── Registry ─────────────────────────────────────────────────────────────────

/**
 * ISkillRuntimeEntry — a skill as stored in the runtime registry.
 */
export interface ISkillRuntimeEntry {
  skill: ISkill
  lifecycle: ISkillLifecycle
  metadata: ISkillRuntimeMetadata
  registeredAt: string
}

/**
 * ISkillRuntimeMetadata — runtime-specific metadata beyond SkillMetadata.
 */
export interface ISkillRuntimeMetadata extends SkillMetadata {
  /** ICP bundles this skill belongs to */
  bundleIds: string[]
  /** Canonical artifact type produced */
  artifactType: ArtifactType
  /** Identity dimensions consumed */
  consumedDimensions: IdentityDimension[]
  /** Version of the lifecycle contract */
  lifecycleVersion: string
  /** Whether this skill has been validated against a fixture */
  fixtureValidated: boolean
}

// ─── Bundle System ────────────────────────────────────────────────────────────

/**
 * IBundleDefinition — an ICP bundle runtime contract.
 *
 * A bundle is a runtime-registered policy domain that shapes generation
 * for a specific buyer persona. NOT a template. NOT a prompt pack.
 * A governed execution context.
 */
export interface IBundleDefinition {
  /** Unique bundle ID */
  id: string
  /** Human name */
  name: string
  /** ICP description */
  icp: string
  /** Ordered skill IDs composing this bundle's capabilities */
  skillIds: string[]
  /** Bundle-level governance overrides (applied to all skills in bundle) */
  governanceOverrides?: IGovernanceOverrides
  /** Identity dimension weights — emphasises certain dimensions for this ICP */
  identityWeights?: Partial<Record<IdentityDimension, number>>
  /** Prompt library entry IDs relevant to this bundle */
  promptLibraryIds?: string[]
  /** Audience profile descriptor */
  audienceProfile?: IBundleAudienceProfile
  /** Permissions required for bundle execution */
  permissions?: string[]
  /** Bundle version for compatibility */
  version: string
  /** Whether this bundle is active */
  active: boolean
  /** Registration source — 'static' for bootstrap, 'dynamic' for runtime-loaded */
  source: 'static' | 'dynamic'
  registeredAt: string
}

export interface IBundleAudienceProfile {
  role: string
  industry?: string
  companySize?: string
  painPoints?: string[]
  successMetrics?: string[]
}

// ─── Runtime Output ───────────────────────────────────────────────────────────

/**
 * ISkillRuntimeOutput — the governed output returned by ISkillRuntime.executeSkill().
 */
export interface ISkillRuntimeOutput<TOutput extends ArtifactV2 = ArtifactV2> {
  success: boolean
  skillId: string
  requestId: string
  artifact?: TOutput
  governanceResult?: IGovernanceResult<TOutput>
  repaired: boolean
  repairAttempts: number
  totalDurationMs: number
  lifecycleDurations: ILifecycleDurations
  personalizationSnapshot: IPersonalizationSnapshot
  error?: ISkillRuntimeError
}

export interface ILifecycleDurations {
  validateMs: number
  prepareMs: number
  executeMs: number
  governMs: number
  repairMs: number
  finalizeMs: number
  exportMs: number
}

export interface ISkillRuntimeError {
  code: SkillRuntimeErrorCode
  message: string
  phase: 'validate' | 'prepare' | 'execute' | 'govern' | 'repair' | 'finalize' | 'export'
  recoverable: boolean
  details?: Record<string, unknown>
}

export type SkillRuntimeErrorCode =
  | 'VALIDATION_FAILED'
  | 'PREPARE_FAILED'
  | 'EXECUTION_FAILED'
  | 'GOVERNANCE_FAILED'
  | 'REPAIR_EXHAUSTED'
  | 'FINALIZE_FAILED'
  | 'EXPORT_FAILED'
  | 'SKILL_NOT_FOUND'
  | 'BUNDLE_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'CONTEXT_BUILD_FAILED'

// ─── Runtime Interface ────────────────────────────────────────────────────────

/**
 * ISkillRuntime — the canonical public API of @brandos/iskill-runtime.
 *
 * This is what BrandOS core consumes. No internals leak through this surface.
 */
export interface ISkillRuntime {
  // ── Skill Registration ──────────────────────────────────────────────────────
  registerSkill(skill: ISkill, lifecycle: ISkillLifecycle): void
  registerBundle(bundle: IBundleDefinition): void

  // ── Execution ───────────────────────────────────────────────────────────────
  executeSkill<TInput = unknown, TOutput extends ArtifactV2 = ArtifactV2>(
    skillId: string,
    input: TInput,
    context: ISkillExecutionContext
  ): Promise<ISkillRuntimeOutput<TOutput>>

  repairSkillArtifact<TOutput extends ArtifactV2 = ArtifactV2>(
    skillId: string,
    artifact: TOutput,
    governanceResult: IGovernanceResult<TOutput>,
    context: ISkillExecutionContext,
    callLLM: (prompt: string) => Promise<string>
  ): Promise<ISkillRepairResult<TOutput>>

  // ── Context Building ────────────────────────────────────────────────────────
  buildExecutionContext(params: IExecutionContextParams): Promise<ISkillExecutionContext>

  // ── Bundle Resolution ───────────────────────────────────────────────────────
  resolveBundleCapabilities(bundleId: string): IBundleCapabilities
  getBundleSkills(bundleId: string): ISkillRuntimeEntry[]

  // ── Discovery ───────────────────────────────────────────────────────────────
  getSkillMetadata(skillId: string): ISkillRuntimeMetadata | undefined
  listSkills(): ISkillRuntimeMetadata[]
  listBundles(): IBundleDefinition[]

  // ── Versioning ──────────────────────────────────────────────────────────────
  getSkillVersion(skillId: string): string | undefined
  checkCompatibility(skillId: string, requiredVersion: string): boolean
}

export interface IExecutionContextParams {
  requestId: string
  userId: string
  workspaceId: string
  personaId?: string
  runtimeMode: RuntimeMode
  bundleId?: string
  /** Personalization context built by caller (or built via buildPersonalizationContext) */
  personalization: ISkillPersonalizationContext
  governanceOverrides?: IGovernanceOverrides
  metadata?: Record<string, unknown>
}

export interface IBundleCapabilities {
  bundleId: string
  skillIds: string[]
  availableSkills: ISkillRuntimeMetadata[]
  missingSkills: string[]
  governanceOverrides?: IGovernanceOverrides
  identityWeights?: Partial<Record<IdentityDimension, number>>
}


