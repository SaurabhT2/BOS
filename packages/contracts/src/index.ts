// ============================================================
// @brandos/contracts — index.ts
//
// ARCHITECTURAL RULES:
//   1. Zero runtime dependencies.
//   2. Two tiers: semantic primitives + execution-layer interface contracts.
//   3. Dependency direction enforced by boundary scripts.
// ============================================================

import type {
  InvocationType,
  ProviderName,
  AIRuntimeOutput,
  RoutingHint,
} from './airuntime-types';
import type { IGovernanceFeedback } from './governance-feedback';

import type { ISemanticIdentity, ArtifactVisualMetadata } from './identity-types';

// ─────────────────────────────────────────────────────────────
// TIER 2 — EXECUTION-LAYER INTERFACE CONTRACTS
// ─────────────────────────────────────────────────────────────
export type {
  ExecutionMode, InvocationType, ProviderName, OutputStatus, QualityFlag, ErrorCode,
  FallbackTrigger, RoutingHint, RuntimeMode,
  IProviderAdapter, ProviderCapabilityStatus, ProviderInvokeRequest, ProviderInvokeResult,
  CapabilityResult, CapabilityCheckOptions, ICapabilityEngine, InvocationRequest,
  OutputSchema, FallbackRule, RetryBudget, ExecutionPlan, IRouterEngine,
  ValidationResult, IValidatorEngine, AIRuntimePolicy, AIRuntimeError, IPolicyEngine,
  TelemetrySnapshot, TelemetrySink, TelemetryStats, ITelemetryEngine, AIRuntimeOutput,
  IAIRuntime, IPluginRegistry, HookEvent, HookHandler, ICircuitBreaker,
  RateLimitResult, IRateLimiter, CostSummary, ICostTracker, AIRuntimeConfig,
  ProviderConfig, IPromptBuilder, BuiltPrompt, IStreamable, StreamChunk, HookContext,
  RuntimeExecutionProfile,
} from './airuntime-types';

export {
  runtimeModeToExecutionMode,
  fromLegacyToRuntimeMode,
  RUNTIME_MODE_LABELS,
} from './airuntime-types';

export * from './generation-contract';
// ContractAssembler and getContractAssembler live in @brandos/output-control-layer
export * from './provider-registry';

// ─────────────────────────────────────────────────────────────
// TIER 1 — CANONICAL SEMANTIC PRIMITIVES
// ─────────────────────────────────────────────────────────────

export type {
  SemanticTheme,
  AudienceProfile,
  NarrativeArc,
  RichnessMetrics,
  GenerationTrace,
  ExportMetadata,
  ExportFormat,
  BaseArtifact,
  ArtifactType,
  CarouselRole,
  RichCarouselSlide,
  CarouselMeta,
  CarouselArtifact,
  DeckSlide,
  DeckMeta,
  DeckArtifact,
  ReportSection,
  ReportMeta,
  ReportArtifact,
  NewsletterSection,
  NewsletterMeta,
  NewsletterArtifact,
  ArtifactV2,
  CarouselBlueprint,
  LegacyCarouselSlide,
  LegacyCarouselMeta,
} from './artifact-v2';

export {
  CAROUSEL_ROLES,
  CAROUSEL_SCHEMA_INSTRUCTION,
  DECK_SCHEMA_INSTRUCTION,
  REPORT_SCHEMA_INSTRUCTION,
  NEWSLETTER_SCHEMA_INSTRUCTION,
  CAROUSEL_SCHEMA_CONSTRAINTS,
  DECK_SCHEMA_CONSTRAINTS,
  REPORT_SCHEMA_CONSTRAINTS,
  NEWSLETTER_SCHEMA_CONSTRAINTS,
  CAROUSEL_STRUCTURAL_CONSTRAINTS,
  DECK_STRUCTURAL_CONSTRAINTS,
  REPORT_STRUCTURAL_CONSTRAINTS,
  isCarouselArtifact,
  isDeckArtifact,
  isReportArtifact,
  isNewsletterArtifact,
  isArtifactV2,
  upcastCarouselBlueprint,
} from './artifact-v2';
export type {
  CarouselStructuralConstraints,
  DeckStructuralConstraints,
  ReportStructuralConstraints,
} from './artifact-v2';

// ─────────────────────────────────────────────────────────────
// ARTIFACT ENGINE CONTRACTS
// ─────────────────────────────────────────────────────────────

import type {
  ArtifactV2,
  ArtifactType,
  SemanticTheme,
  CarouselArtifact,
  ExportFormat,
} from './artifact-v2';
export type { ArtifactTheme } from './artifact-v2-compat';

export interface CompileOptions {
  theme?: string | Partial<SemanticTheme>;
  maxSlides?: number;
  targetFormat?: ExportFormat;
  ctaText?: string;
  addCta?: boolean;
  title?: string;
}

export interface ExportOptions {
  outputPath?: string;
  format: ExportFormat;
}

export interface ExportResult {
  format: ExportFormat;
  outputPath?: string;
  data?: unknown;
  sizeBytes?: number;
  slideCount: number;
  durationMs: number;
  success?: boolean;
  error?: string;
}

export interface CompileResult {
  artifact: ArtifactV2;
  durationMs: number;
  inputType: 'markdown' | 'json' | 'text' | 'unknown';
  slideCount: number;
}

/**
 * IArtifactExecutionContext — per-request execution environment passed through
 * compile → govern → export without mutation.
 * Canonical definition; implemented by artifact-engine-layer callers.
 */
export interface IArtifactExecutionContext {
  /** Unique request trace ID (UUID v4). */
  requestId: string;
  /** Authenticated user ID. */
  userId: string;
  /** Active workspace / organisation ID. */
  workspaceId?: string;
  /** Generation mode tag (e.g. 'standard', 'fast', 'quality'). */
  runtimeMode: string;
  /** Live Supabase client. Typed as any to avoid importing supabase types here. */
  supabase?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Skill execution context forwarded to ISkill.execute(). */
  skillContext: SkillContext;
  /** Pre-resolved SemanticIdentity for this workspace/persona. */
  identity?: ISemanticIdentity;
}

/**
 * IArtifactRegistry — runtime lookup surface for compiler, governance,
 * exporter, and renderer adapters.
 * Canonical definition; implemented by artifact-engine-layer.
 */
export interface IArtifactRegistry {
  listArtifactTypes(): ArtifactType[];
  isFullyRegistered(artifactType: ArtifactType): boolean;
}

/**
 * IArtifactEngine — canonical orchestration entry point for all artifact execution.
 *
 * Promoted from @brandos/artifact-engine-layer/src/interfaces.ts.
 * The authoritative implementation lives in ArtifactEngine (artifact-engine-layer).
 *
 * ARCHITECTURE LAWS (enforced by ArtifactEngine):
 *   LAW 1 — compile() always runs before govern().
 *   LAW 2 — repair re-enters OCL via recompile callback.
 *   LAW 3 — no artifact-type branching in the engine (registry dispatch only).
 *   LAW 4 — LLM is always injected, never called directly.
 *   LAW 5 — MAX_REPAIR_ATTEMPTS = 2.
 *
 * PIPELINE ENTRY POINTS (preference order):
 *   1. compileAndGovern()  — compile + govern (canonical production path)
 *   2. compileAndExport()  — compile + govern + export
 *   3. compile()           — compile only (testing / pre-validation)
 *   4. govern()            — govern only (artifact already compiled)
 *   5. export()            — export only (artifact already governed)
 *   6. remix()             — modify existing artifact (NOT YET IMPLEMENTED — throws)
 */
export interface IArtifactEngine {
  /** Access the underlying registry for registration and introspection. */
  readonly registry: IArtifactRegistry;

  /**
   * Compile raw input into a canonical ArtifactV2 via the registered ICompiler.
   * Prefer compileAndGovern() in production.
   */
  compile(
    artifactType: ArtifactType,
    input: string | DraftArtifactInput | object,
    options?: CompileOptions & { requestId?: string; topic?: string; tone?: string }
  ): Promise<CompileResult>;

  /**
   * Run semantic governance on a pre-compiled ArtifactV2.
   * Prefer compileAndGovern() in production.
   */
  govern(
    artifact: ArtifactV2,
    context: IArtifactExecutionContext,
    repairLLM?: (prompt: string) => Promise<string>
  ): Promise<IGovernanceResult<ArtifactV2>>;

  /**
   * Compile and govern in one call. THE CANONICAL PIPELINE ENTRY.
   * @throws ArtifactEngineRejection if governance fails after all repair attempts.
   */
  compileAndGovern(
    artifactType: ArtifactType,
    input: string | DraftArtifactInput | object,
    context: IArtifactExecutionContext,
    options?: CompileOptions,
    repairLLM?: (prompt: string) => Promise<string>
  ): Promise<{ artifact: ArtifactV2; governanceResult: IGovernanceResult<ArtifactV2> }>;

  /**
   * Export a governed artifact to the target format.
   */
  export(artifact: ArtifactV2, options: ExportOptions): Promise<ExportResult>;

  /**
   * Compile, govern, and export in one call.
   * NOTE: Wave 2 implementation runs governance between compile and export.
   */
  compileAndExport(
    artifactType: ArtifactType,
    input: string | DraftArtifactInput | object,
    compileOptions: CompileOptions,
    exportOptions: ExportOptions,
    context: IArtifactExecutionContext
  ): Promise<{ compile: CompileResult; export: ExportResult }>;

  /**
   * Remix an existing artifact with a natural language instruction.
   * STATUS: NOT YET IMPLEMENTED — current engine throws NotImplemented.
   * @planned Implementation pending LLM callback injection via skillContext.
   */
  remix(
    artifact: ArtifactV2,
    instruction: string,
    context: IArtifactExecutionContext
  ): Promise<ArtifactV2>;

  /**
   * List available export formats, optionally filtered by artifact type.
   */
  availableFormats(artifactType?: ArtifactType): ExportFormat[];
}

export interface DraftArtifactSlide {
  headline?: string;
  title?: string;
  body?: string;
  subtext?: string;
  bullets?: string[];
  role?: string;
  stat?: { value: string; label: string };
  visual_direction?: string;
  subheadline?: string;
  insight?: string;
  supporting_evidence?: string[];
  key_takeaway?: string;
  emphasis_keywords?: string[];
  speaker_notes?: string;
}

export interface DraftArtifactMeta {
  title?: string;
  hook?: string;
  cta?: string;
  palette?: string[];
  font_style?: string;
  topic?: string;
  tone?: string;
  summary?: string;
  audience?: string;
  narrative_structure?: string;
  [key: string]: unknown;
}

export interface DraftArtifactInput {
  slides?: DraftArtifactSlide[];
  cards?: DraftArtifactSlide[];
  meta?: DraftArtifactMeta;
  rawText?: string;
  artifact?: ArtifactV2;
}

export type CleaningStep =
  | 'trimmed_whitespace' | 'removed_markdown' | 'removed_code_block'
  | 'json_extracted' | 'stripped_markdown_fences' | 'removed_bold_markers'
  | 'removed_preamble' | 'removed_postamble' | 'removed_stray_control_chars';

export type NormalizeOptions = {
  taskType: TaskType;
  enableLLMRepair?: boolean;
  callLLM?: (input: string) => Promise<string>;
};

export type NormalizationTrace = {
  steps: string[];
  warnings?: string[];
  cleaningApplied?: string[];
  extractionAttempted?: boolean;
  repairAttempted?: boolean;
  repairSucceeded?: boolean;
  validationPassed?: boolean;
  strategy?: string;
  errorMessage?: string;
};

export type NormalizedOutput = {
  success: boolean;
  type: 'carousel' | 'deck' | 'report';
  content: DraftArtifactInput;
  trace?: NormalizationTrace;
  visualMetadata?: ArtifactVisualMetadata;
};

// ---------------------------------------------------------------------------
// REMOVED (FIX 3 — 2026-05-25): Dead response payload contracts
//
// The following interfaces were removed — zero consumers confirmed across all packages:
//   - UnavailableAction        (removed 2026-05-26 — confirmed zero consumers)
//   - CarouselResponse         (superseded by ArtifactV2 + route-level response types)
//   - GenerationResultPayload  (superseded by ArtifactV2)
//   - GenerationResponse       (superseded by ArtifactV2)
//   - CarouselInputSlide       (superseded by CarouselArtifact in artifact-v2.ts)
//   - CarouselSchema           (superseded by CarouselArtifact in artifact-v2.ts)
//   - DeckSection              (superseded by DeckArtifact in artifact-v2.ts)
//   - DeckSchema               (superseded by DeckArtifact in artifact-v2.ts)
//
// If you need to reference pre-ArtifactV2 response shapes, see git history.
// ---------------------------------------------------------------------------

/**
 * TaskType — domain task vocabulary. Single source of truth for content
 * creation intent across the BrandOS platform.
 *
 * Owned by: @brandos/contracts (this file).
 * Consumed by: control-plane-layer, governance-config, governance-layer,
 *              output-control-layer, brand-intelligence.
 *
 * Deliberately separate from InvocationType (airuntime-types.ts), which
 * describes how the AI runtime executes a request. Bounded-context separation
 * is intentional — do not unify these two vocabularies.
 *
 * Previously named: ContentTaskType
 */
export type TaskType =
  | 'carousel' | 'deck' | 'report' | 'newsletter' | 'campaign' | 'post'
  | 'remix' | 'export' | 'chat' | 'unknown';

export type CapabilityId =
  | 'text.generation' | 'text.structured' | 'text.streaming'
  | 'vision.analysis' | 'artifact.rendering' | 'policy.validation'
  | 'memory.read' | 'output.scoring' | 'output.repair';

export interface CapabilityDescriptor {
  id: CapabilityId;
  version: string;
  provider: string;
  model_id?: string;
  health_score: number;
  latency_p50_ms: number;
  cost_per_1k_tokens: number;
  supports_streaming: boolean;
  max_context_tokens: number;
  metadata?: Record<string, unknown>;
}

export interface ICapabilityRegistry {
  register(descriptor: CapabilityDescriptor): void;
  resolve(id: CapabilityId, hint?: RoutingHint): CapabilityDescriptor | null;
  resolveAll(id: CapabilityId): CapabilityDescriptor[];
  health(): Record<CapabilityId, number>;
  snapshot(): CapabilityDescriptor[];
}

export interface CapabilityOutput<T = string> {
  data: T;
  capabilityId: CapabilityId;
  provider: string;
  latency_ms: number;
  tokens_used?: number;
  cost_usd?: number;
  trace_id: string;
}

export interface CapabilityResolutionTrace {
  requested: CapabilityId;
  candidates: Array<{ provider: string; health_score: number; rejected_reason?: string }>;
  resolved: CapabilityDescriptor | null;
  hint_applied?: RoutingHint;
  resolved_at: string;
}

export interface GenerationOptions {
  max_tokens?: number;
  temperature?: number;
  timeout_ms?: number;
  user_id?: string;
}

export interface PolicyCheckResult {
  passed: boolean;
  violations: string[];
}

export interface MemoryEntry {
  key: string;
  value: unknown;
  created_at: string;
}

export interface QualityReport {
  score: number;
  flags: string[];
  suggestions: string[];
}

export type SkillCategory = 'generate' | 'compile' | 'export' | 'transform' | 'analyze';

export interface SkillMetadata {
  id: string;
  name: string;
  version: string;
  category: SkillCategory;
  description: string;
  inputType: string;
  outputType: string;
  requiredCapabilities?: string[];
  required_capabilities?: CapabilityId[];
  permissions?: string[];
}

export interface SkillContext {
  requestId: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  trace_id?: string;
  config_version?: string;
  capability_snapshot?: CapabilityDescriptor[];
  capabilities?: Partial<Record<CapabilityId, ICapabilityImplementation>>;
  granted_permissions?: string[];
  identity?: ISemanticIdentity;
}

export interface SkillResult<T = unknown> {
  success: boolean;
  output?: T;
  error?: string;
  durationMs: number;
  skillId: string;
  trace_id?: string;
  config_version?: string;
  capability_ids_used?: CapabilityId[];
}

/**
 * ISkill — modular skill execution contract.
 *
 * Status (Phase 2.6 gate-lift, 2026-06-21 — human-approved):
 *   - Interface is defined and stable.
 *   - `iskill-runtime` package bootstraps CarouselFounderSkill at server startup
 *     (apps/web/instrumentation.ts), and `globalThis.__brandos_iskill_contract_contributor`
 *     is now set to `true` immediately after that bootstrap succeeds.
 *   - The contract-contributor implementation lives in
 *     `@brandos/output-control-layer`'s SkillContributor
 *     (contract-assembler/contributors/SkillContributor.ts) and is registered
 *     in ContractAssemblerFactory's 'default' contributor set — it now
 *     participates in every structured-artifact generation request.
 *     (The prior copy in control-plane-layer/contributors/index.ts was never
 *     registered with the factory and was always dead code; it has been
 *     left in place only as historical reference, annotated accordingly.)
 *   - For `taskType === 'carousel'`, SkillContributor now contributes the
 *     carousel-founder workflow/successCriteria, which compilePromptFromContract()
 *     injects into the LLM prompt as narrative structure guidance.
 *   - ArtifactEngine's separate skill registry (SkillRuntime.execute(), with its
 *     own validate→prepare→execute→govern→repair→finalize→export lifecycle)
 *     remains unwired to the canonical generation path — that is a distinct,
 *     heavier execution mode, not required for contract-level contribution,
 *     and out of scope for this activation. No route calls it.
 *   - Governance for skill-influenced output is unchanged: it still flows
 *     through the existing artifact-engine governance pipeline exactly as it
 *     does for non-skill-contributed content.
 *
 * Do not remove this interface or the iskill-runtime bootstrap — they represent
 * committed infrastructure investment.
 */
export interface ISkill<TInput = unknown, TOutput = unknown> {
  readonly metadata: SkillMetadata;
  execute(input: TInput, context: SkillContext): Promise<SkillResult<TOutput>>;
  validate?(input: TInput): boolean;
  onInit?(registry: ICapabilityRegistry): Promise<void>;
  onBeforeExecute?(input: TInput, context: SkillContext): Promise<void>;
  onAfterExecute?(result: SkillResult<TOutput>, context: SkillContext): Promise<void>;
  onError?(err: Error, context: SkillContext): Promise<void>;
}

export interface ICapabilityImplementation {
  readonly capabilityId: CapabilityId;
  readonly descriptor: CapabilityDescriptor;
  invoke(args: unknown): Promise<CapabilityOutput>;
}

export interface SkillManifest {
  skill: ISkill;
  required_permissions: string[];
  required_capabilities: CapabilityId[];
}

export type OrchestratorIntent =
  | 'generate_deck' | 'generate_carousel' | 'generate_report'
  | 'generate_post' | 'remix_deck' | 'export_deck';

export interface OrchestratorRequest {
  intent: OrchestratorIntent;
  userPrompt: string;
  context?: string;
  exportFormat?: ExportFormat;
  themePreset?: string;
  maxSlides?: number;
  existingArtifact?: ArtifactV2;
  metadata?: Record<string, unknown>;
}

export interface OrchestratorResponse {
  success: boolean;
  intent: OrchestratorIntent;
  artifact?: ArtifactV2;
  exportResult?: ExportResult;
  runtimeOutput?: AIRuntimeOutput;
  workflowResult?: WorkflowResult;
  error?: string;
  totalDurationMs: number;
}

export type WorkflowStatus = 'pending' | 'running' | 'success' | 'partial_failure' | 'failed';

export interface WorkflowStep {
  skillId: string;
  label: string;
  optional?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
}

export interface WorkflowStepResult {
  skillId: string;
  label: string;
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
}

export interface WorkflowResult {
  workflowId: string;
  status: WorkflowStatus;
  steps: WorkflowStepResult[];
  finalOutput?: unknown;
  totalDurationMs: number;
}

export interface IWorkflowEngine {
  register(definition: WorkflowDefinition): void;
  run(workflowId: string, initialInput: unknown, context: SkillContext): Promise<WorkflowResult>;
  list(): WorkflowDefinition[];
}

export interface IPlatformPluginRegistry {
  registerSkill(skill: ISkill): this;
  registerWorkflow(definition: WorkflowDefinition): this;
  getSkill(id: string): ISkill | undefined;
  listSkills(): SkillMetadata[];
}

export interface ProviderPreference {
  forced_providers?: ProviderName[];
  disabled_providers?: ProviderName[];
  routing_mode: 'cost_first' | 'quality_first' | 'balanced' | 'deterministic' | 'exploratory';
  deterministic: boolean;
  capability_overrides?: Partial<Record<CapabilityId, { min_health_score?: number; max_cost?: number }>>;
  created_at: string;
  user_id: string;
}

export interface RoutingOverrideAuditEvent {
  event_id: string;
  trace_id: string;
  user_id: string;
  workspace_id?: string;
  timestamp: string;
  override_type: 'provider_forced' | 'provider_disabled' | 'routing_mode' | 'capability_override';
  from_state: Partial<RoutingDecisionSnapshot>;
  to_state: Partial<RoutingDecisionSnapshot>;
  reason?: string;
  admin_constraint_applied?: string;
}

export interface RoutingDecisionSnapshot {
  selected_provider: ProviderName;
  selected_mode: string;
  routing_mode: string;
  capability_id?: CapabilityId;
  fallback_chain: ProviderName[];
  cost_estimate_usd: number;
  latency_estimate_ms: number;
  user_preference_applied: boolean;
  admin_constraint_applied: boolean;
  explainability: string[];
}

export interface ExplainedRoutingPlan {
  snapshot: RoutingDecisionSnapshot;
  capability_candidates: CapabilityDescriptor[];
  rejected_candidates: Array<{ descriptor: CapabilityDescriptor; reason: string }>;
  preference_applied: ProviderPreference | null;
  admin_constraints_active: string[];
}

export interface SkillExecutionTelemetry {
  skillId: string;
  trace_id: string;
  config_version: string;
  provider?: string;
  durationMs: number;
  success: boolean;
  repairInvoked: boolean;
  validationFailures: string[];
  retryCount: number;
  capabilitiesUsed: CapabilityId[];
  evaluationScore?: number;
  timestamp: string;
}

export interface SkillHealthScore {
  skillId: string;
  successRate: number;
  repairRate: number;
  schemaCompliance: number;
  avgDurationMs: number;
  avgEvaluationScore?: number;
  sampleCount: number;
  lastExecutedAt: string;
}

export interface SkillEvalResult {
  skillId: string;
  runId: string;
  iterations: number;
  passCount: number;
  failCount: number;
  repairCount: number;
  determinismRatio: number;
  avgDurationMs: number;
  schemaErrors: string[];
  runs: SkillExecutionTelemetry[];
}

export interface SkillRegressionFixture<TInput = unknown> {
  fixtureId: string;
  skillId: string;
  description: string;
  input: TInput;
  requiredOutputFields?: string[];
  outputSchemaHint?: Record<string, unknown>;
  expectSuccess: boolean;
}

export interface RegressionRunResult {
  fixtureId: string;
  skillId: string;
  passed: boolean;
  failureReason?: string;
  durationMs: number;
  repairInvoked: boolean;
  trace_id?: string;
}

export interface IOCL {
  normalize(raw: string, options: NormalizeOptions): Promise<NormalizedOutput>;
  compile(draft: DraftArtifactInput): Promise<ArtifactV2>;
}

/**
 * SemanticValidationOutcome — discriminated union carrying structured validation detail.
 * Promoted from @brandos/governance-layer/src/contracts.ts (canonical source).
 * Consumers should prefer this over the governance-layer-local definition.
 */
export type SemanticValidationOutcome =
  | { valid: true; slideCount: number; warnings: string[] }
  | { valid: false; reason: string; details: string[]; slideCount: number }

export interface IGovernanceResult<TArtifact = unknown> {
  success: boolean;
  artifact: TArtifact;
  repaired: boolean;
  attempts: number;
  finalRejection?: string;
  passed: boolean;
  violations?: string[];
  /**
   * Structured validation detail from the semantic governance pass.
   * Optional for backward compatibility — governance-layer always populates this;
   * legacy or stub implementations may omit it.
   *
   * MED-004 FIX: This field was present in governance-layer's GovernanceResult<T>
   * (via SemanticValidationOutcome) but absent from the contracts IGovernanceResult.
   * Promotes the field to contracts so CPL can safely read validationOutcome.valid
   * without risk of a silent undefined cast if governance semantics shift to
   * discriminated union only. Both success: boolean AND validationOutcome are
   * now part of the canonical contract.
   */
  validationOutcome?: SemanticValidationOutcome;

   governanceFeedback?: IGovernanceFeedback;
}

export interface IGovernance<TArtifact extends ArtifactV2 = ArtifactV2> {
  validate(artifact: TArtifact): Promise<IGovernanceResult<TArtifact>>;
  repair?(artifact: TArtifact): Promise<TArtifact>;
}

export type {
  IdentityDimension,
  SemanticIdentityDimension,
  VisualIdentityDimension,
  ISemanticIdentity,
  IVisualIdentity,
  IdentitySnapshot,
  VisualIdentitySnapshot,
  IdentitySignal,
  SignalType,
  ArtifactVisualMetadata,
  VisualPersonalizationContext,
  VisualIdentityColorProfile,
  VisualIdentityTypographyProfile,
  VisualIdentityLayoutProfile,
  IObservationEvent,
  IIdentityProjection,
  IPersonalizationSnapshot,
  ISkillPersonalizationContext,
  SkillType,
  ExtractionResult,
  MergeDecision,
  MergeStrategy,
  PromptPersonalizationContext,
  IdentityVersionRecord,
  IdentityProfile,
  IdentityLayerConfig,
} from './identity-types'

export {
  SEMANTIC_DIMENSIONS,
  VISUAL_DIMENSIONS,
  ALL_DIMENSIONS,
  isVisualDimension,
  isSemanticDimension,
  DEFAULT_IDENTITY_CONFIG,
} from './identity-types'

// ─────────────────────────────────────────────────────────────
// AUTH TYPES — promoted from @brandos/auth (R6+)
//
// These are the canonical shared types for authentication,
// user identity, and BrandOS DB rows. Import from here in
// any layer that needs user/campaign/persona shapes WITHOUT
// pulling in the full @brandos/auth package dependency tree
// (Supabase SSR, React, Next.js).
// ─────────────────────────────────────────────────────────────
export type {
  AuthProviderKind,
  UserPlan,
  AuthUser,
  AuthState,
  AuthSession,
  ProfileRetryOptions,
  LoginCredentials,
  SignupCredentials,
  UserRow,
  CampaignFormat,
  CampaignStatus,
  CampaignRow,
  NewCampaign,
  PersonaTone,
  PersonaRow,
  NewPersona,
  FeedbackSignal,
  FeedbackRow,
  NewFeedback,
  DbResult,
  DbListResult,
  TableName,
  // P0 — Workspace Foundation (Implementation Wave 1A)
  WorkspacePlan,
  WorkspaceRow,
  NewWorkspace,
  WorkspaceSettingsRow,
  NewWorkspaceSettings,
  BrandAssetStatus,
  BrandAssetRow,
  // P1 — Asset Vault Evolution
  NewBrandAsset,
  // P3 — BYOK & Provider Observability
  WorkspaceApiKeyRow,
  NewWorkspaceApiKey,
  WorkspaceProviderUsageRow,
  NewWorkspaceProviderUsage,
  WorkspaceProviderHealthRow,
  // Priority 4/5 — OAuth-based export integrations (Canva, Figma)
  WorkspaceOAuthConnectionRow,
  NewWorkspaceOAuthConnection,
  // Priority 5 — Figma Export: ephemeral plugin handoff tokens
  FigmaHandoffTokenRow,
  NewFigmaHandoffToken,
} from './auth-types';

// ─────────────────────────────────────────────────────────────
// USER LIFECYCLE STATE — computed lifecycle projection
//
// Type only — computation lives in @brandos/auth
// (src/lifecycle/computeUserLifecycleState.ts). See
// user-state-types.ts for the full architectural role comment
// and the "what does NOT belong here" boundary list.
// ─────────────────────────────────────────────────────────────
export type {
  UserLifecycleStage,
  UserLifecycleFacts,
  UserLifecycleError,
  UserLifecycleState,
} from './user-state-types';

export type OverrideMode =
  | 'standard'
  | 'strict'
  | 'fast'
  | 'raw'
  | 'cost_saver'
  | 'premium'

export type PipelineStage =
  | 'intake'
  | 'policy'
  | 'brand_merge'
  | 'identity'
  | 'routing'
  | 'prompt_compile'
  | 'generation'
  | 'validation'
  | 'scoring'
  | 'retry'
  | 'override'
  | 'format'
  | 'telemetry'
  | 'delivery'

export interface ActivityEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'success'
  stage: PipelineStage
  message: string
  data?: Record<string, unknown>
}

/**
 * IntentTaskType — alias of TaskType for use in intent analysis results.
 * The two vocabularies are identical; this alias preserves the name at
 * call sites that read intent.detected_task without requiring a rename
 * cascade into intake.ts and tests.
 */
export type IntentTaskType = TaskType

export interface IntentAnalysis {
  detected_task: IntentTaskType
  confidence: number
  ambiguity_level: 'low' | 'medium' | 'high'
  missing_data: string[]
  is_unsafe: boolean
  unsafe_reason?: string
  is_spam: boolean
  has_contradictions: boolean
  complexity: 'simple' | 'moderate' | 'complex'
  estimated_tokens: number
  suggested_improvements: string[]
}

// ─────────────────────────────────────────────────────────────
// SELF-VALIDATION LAYER
//
// Exported so callers can run package invariant checks during
// monorepo bootstrap or CI validation steps.
// ─────────────────────────────────────────────────────────────
export {
  validateContractsPackage,
  checkProviderRegistryIntegrity,
  checkIdentityDimensions,
  checkArtifactTypeGuards,
  checkCarouselRoles,
  checkCarouselSchemaInstruction,
  checkRuntimeModeConverters,
  checkSchemaVersion,
  checkRuntimeExports,
} from './self-validate';
export type {
  ValidationCheckResult,
  PackageValidationReport,
} from './self-validate';

// ─── Section : Brand cognition contracts — REMOVED (platform split) ─────────
// The former @brandos/brand-intelligence type surface (IBrandCognitionContext,
// IStyleProjection, IBrandSignalRepository, etc.) has no successor export
// here. BrandOS's cognitive vocabulary now lives entirely in
// @platform/cognition-contract (CognitionContext, CognitionProvider) and is
// consumed exclusively through @brandos/cognition-client. See
// packages/cognition-contract/README.md for the migration record.

// ─── Section: Governance Feedback Loop Contracts ──────────────────────────────
// Closed-loop feedback channel from Governance → Prompt Compiler.
// Governance emits IGovernanceFeedback; Prompt Compiler consumes IAttemptHistory.
// These contracts are artifact-type agnostic and version-stable.

export type {
  GovernanceViolationSeverity,
  IGovernanceViolationDetail,
  IGovernanceRecommendationDetail,
  IGovernanceFeedback,
  IAttemptRecord,
  IAttemptHistory,
} from './governance-feedback'

export {
  createEmptyAttemptHistory,
  appendAttemptRecord,
  buildGovernanceFeedbackFromEvaluation,
} from './governance-feedback'

// ─── Section: Runtime Verification Trace Contract ─────────────────────────────
// Canonical structured result shape emitted by every
// /api/internal/runtime-verify/* endpoint (Runtime Verification V2).
// See runtime-trace.ts for the full design rationale.

export type {
  RuntimeTrace,
  RuntimeTraceFieldIssue,
  RuntimeTraceValidationResult,
  RuntimeTraceExpectedField,
} from './runtime-trace'

export {
  createRuntimeTrace,
  isRuntimeTraceHealthy,
  validateRuntimeTrace,
  RUNTIME_TRACE_EXPECTED_FIELDS,
} from './runtime-trace'


