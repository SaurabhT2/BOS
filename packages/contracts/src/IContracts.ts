// ============================================================
// @brandos/contracts — IContracts.ts
//
// PUBLIC INTERFACE BOUNDARY FILE
//
// PURPOSE:
//   This file is the strict, documented, agent-readable boundary
//   for the @brandos/contracts package. It re-exports every
//   public symbol from index.ts through named interface groups,
//   provides deprecation markers, and documents the invariants
//   that any dependent layer must honour.
//
// RULES FOR THIS FILE:
//   1. Never add implementation logic here — re-exports only.
//   2. Never import from @brandos/* packages.
//   3. Every group export corresponds to one functional domain.
//   4. When a type is deprecated, mark it with @deprecated here
//      so dependents get IDE warnings immediately.
//
// CONSUMERS:
//   Import from '@brandos/contracts' (index.ts), NOT from this
//   file directly. This file exists for documentation and
//   boundary auditing — index.ts is the runtime entry point.
// ============================================================

// ─────────────────────────────────────────────────────────────
// GROUP A — ARTIFACT SCHEMA (what content IS)
//
// The canonical post-compilation artifact representation.
// OCL compiles INTO ArtifactV2. The Renderer reads FROM ArtifactV2.
// ISkill validates ArtifactV2. Nothing else is authoritative.
// ─────────────────────────────────────────────────────────────
export type {
  // Discriminated union — top-level type. Always use this.
  ArtifactV2,

  // Concrete artifact types — extend BaseArtifact
  CarouselArtifact,
  DeckArtifact,
  ReportArtifact,

  // Shared base — every artifact carries these fields
  BaseArtifact,
  ArtifactType,

  // Slide/section models
  RichCarouselSlide,
  CarouselMeta,
  CarouselRole,
  DeckSlide,
  DeckMeta,
  ReportSection,
  ReportMeta,

  // Semantic richness primitives
  SemanticTheme,
  AudienceProfile,
  NarrativeArc,
  RichnessMetrics,
  GenerationTrace,

  // Export plumbing
  ExportFormat,
  ExportMetadata,

  // Legacy shapes — DEPRECATED, kept for migration only
  /** @deprecated Use CarouselArtifact instead */
  CarouselBlueprint,
  /** @deprecated Use CarouselArtifact instead */
  LegacyCarouselSlide,
  /** @deprecated Use CarouselArtifact instead */
  LegacyCarouselMeta,
} from './artifact-v2';

export {
  // Type guards — always use these to narrow ArtifactV2
  isCarouselArtifact,
  isDeckArtifact,
  isReportArtifact,

  // Migration helper — converts legacy CarouselBlueprint → CarouselArtifact
  upcastCarouselBlueprint,

  // Prompt schema string — single source of truth for LLM carousel schema injection
  CAROUSEL_SCHEMA_INSTRUCTION,
  CAROUSEL_ROLES,
} from './artifact-v2';

// ─────────────────────────────────────────────────────────────
// GROUP B — AI RUNTIME CONTRACTS (how content IS MADE)
//
// All interfaces that the AI execution layer must implement.
// The runtime depends on this package; this package does not
// depend on the runtime.
// ─────────────────────────────────────────────────────────────
export type {
  // Primary runtime entry point
  IAIRuntime,

  // Sub-engine contracts
  IProviderAdapter,
  ICapabilityEngine,
  IRouterEngine,
  IPromptBuilder,
  IValidatorEngine,
  IPolicyEngine,
  ITelemetryEngine,

  // Resilience contracts
  ICircuitBreaker,
  IRateLimiter,
  ICostTracker,

  // Plugin / extension point
  IPluginRegistry,
  IStreamable,

  // Request/response shapes
  InvocationRequest,
  InvocationType,
  ExecutionPlan,
  BuiltPrompt,
  AIRuntimeOutput,
  AIRuntimeConfig,
  AIRuntimePolicy,
  AIRuntimeError,

  // Provider shapes
  ProviderName,
  ProviderConfig,
  ProviderInvokeRequest,
  ProviderInvokeResult,
  ProviderCapabilityStatus,

  // Capability shapes
  CapabilityResult,
  CapabilityCheckOptions,

  // Output quality
  OutputStatus,
  QualityFlag,
  ErrorCode,
  FallbackTrigger,
  FallbackRule,
  RetryBudget,
  RoutingHint,
  OutputSchema,
  ValidationResult,

  // Telemetry
  TelemetrySnapshot,
  TelemetryStats,
  TelemetrySink,

  // Streaming
  StreamChunk,

  // Hook system
  HookEvent,
  HookHandler,
  HookContext,

  // Cost
  CostSummary,
  RateLimitResult,

  // Mode
  ExecutionMode,
  RuntimeMode,

  // Phase 0 — Runtime Consolidation (Gate 1)
  RuntimeExecutionProfile,
} from './airuntime-types';

export {
  // Translation functions — the ONLY correct mode conversion points
  runtimeModeToExecutionMode,
  fromLegacyToRuntimeMode,
  RUNTIME_MODE_LABELS,
} from './airuntime-types';

// ─────────────────────────────────────────────────────────────
// GROUP C — GENERATION CONTRACT (how prompts are assembled)
//
// The typed prompt-assembly contract. Each subsystem contributes
// one typed slice to ResolvedGenerationContract. IContractAssembler
// wires them together.
//
// NOTE: ContractAssembler implementation lives in
// @brandos/output-control-layer. Only the interface is here.
// ─────────────────────────────────────────────────────────────
export type {
  ResolvedGenerationContract,
  IContractAssembler,
  IContractContributor,
  ContributorContext,

  // Contributor slices — one per subsystem
  IIdentityContribution,
  IPersonaContribution,
  IIntentContribution,
  IArtifactContribution,
  IRuntimeContribution,
  ISkillContribution,   // Phase 2 — not active in production yet
} from './generation-contract';

// ─────────────────────────────────────────────────────────────
// GROUP D — IDENTITY TYPES (brand personalisation)
//
// Canonical brand identity and signal types. identity-layer
// implements these interfaces; it does NOT define them.
// ─────────────────────────────────────────────────────────────
export type {
  // Core identity interfaces
  ISemanticIdentity,
  IVisualIdentity,
  IIdentityProjection,
  IPersonalizationSnapshot,
  ISkillPersonalizationContext,
  IObservationEvent,

  // Snapshot types (serialisable views)
  IdentitySnapshot,
  VisualIdentitySnapshot,

  // Profile and versioning
  IdentityProfile,
  IdentityVersionRecord,

  // Signal model
  IdentitySignal,
  SignalType,

  // Dimension taxonomies
  IdentityDimension,
  SemanticIdentityDimension,
  VisualIdentityDimension,

  // Visual sub-profiles
  VisualIdentityColorProfile,
  VisualIdentityTypographyProfile,
  VisualIdentityLayoutProfile,
  ArtifactVisualMetadata,

  // Personalization context
  VisualPersonalizationContext,
  PromptPersonalizationContext,

  // Extraction / merge
  ExtractionResult,
  MergeDecision,
  MergeStrategy,

  // Config
  IdentityLayerConfig,

  // Skill personalization
  SkillType,
} from './identity-types';

export {
  SEMANTIC_DIMENSIONS,
  VISUAL_DIMENSIONS,
  ALL_DIMENSIONS,
  isVisualDimension,
  isSemanticDimension,
  DEFAULT_IDENTITY_CONFIG,
} from './identity-types';

// ─────────────────────────────────────────────────────────────
// GROUP E — PROVIDER REGISTRY (AI provider metadata)
//
// Single source of truth for every provider. All provider
// lists elsewhere in the codebase must import from here.
// ─────────────────────────────────────────────────────────────
export type {
  ProviderDefinition,
  ProviderKind,
  ProviderProtocol,
} from './provider-registry';

export {
  PROVIDER_REGISTRY,
  ALL_PROVIDER_IDS,
  LOCAL_PROVIDER_IDS,
  CLOUD_PROVIDER_IDS,
  DEFAULT_ENABLED_PROVIDER_IDS,
  OPENAI_COMPATIBLE_DEFS,
  getProviderDefinition,
  isLocalProvider,
  isCloudProvider,
} from './provider-registry';

// ─────────────────────────────────────────────────────────────
// GROUP F — DOMAIN VOCABULARY (TaskType, pipeline, intents)
//
// These types describe the domain (what the user wants).
// They are SEPARATE from InvocationType (how the runtime executes).
// ─────────────────────────────────────────────────────────────
export type {
  // Core domain task vocabulary
  TaskType,
  IntentTaskType,    // alias for TaskType — used at call sites reading intent.detected_task
  IntentAnalysis,

  // Pipeline observability
  PipelineStage,
  ActivityEntry,

  // Override modes
  OverrideMode,
} from './index';

// ─────────────────────────────────────────────────────────────
// GROUP G — ARTIFACT ENGINE & ORCHESTRATION
//
// High-level engine and orchestrator contracts. These sit above
// the raw AI runtime and below the API route handlers.
// ─────────────────────────────────────────────────────────────
export type {
  IArtifactEngine,
  CompileOptions,
  CompileResult,
  ExportOptions,
  ExportResult,
  DraftArtifactInput,
  DraftArtifactSlide,
  DraftArtifactMeta,

  // OCL
  IOCL,
  NormalizedOutput,
  NormalizationTrace,
  NormalizeOptions,
  CleaningStep,

  // Governance
  IGovernance,
  IGovernanceResult,

  // Orchestration
  OrchestratorRequest,
  OrchestratorResponse,
  OrchestratorIntent,

  // Workflow
  IWorkflowEngine,
  WorkflowDefinition,
  WorkflowResult,
  WorkflowStep,
  WorkflowStepResult,
  WorkflowStatus,

} from './index';

// ─────────────────────────────────────────────────────────────
// GROUP H — SKILL SYSTEM (ISkill, capabilities, registry)
//
// Phase 2.6 — Interface is stable. Contract-contribution path is ACTIVE
// in production for taskType === 'carousel' (human gate-lift 2026-06-21,
// see ISkill JSDoc in index.ts). The separate SkillRuntime.execute()
// lifecycle remains unwired to the canonical generation path.
// ─────────────────────────────────────────────────────────────
export type {
  ISkill,
  ICapabilityImplementation,
  ICapabilityRegistry,
  IPlatformPluginRegistry,
  SkillManifest,
  SkillContext,
  SkillMetadata,
  SkillResult,
  SkillCategory,
  SkillType as SkillContextType,

  // Telemetry
  SkillExecutionTelemetry,
  SkillHealthScore,
  SkillEvalResult,
  SkillRegressionFixture,
  RegressionRunResult,

  // Capability descriptor
  CapabilityId,
  CapabilityDescriptor,
  CapabilityOutput,
  CapabilityResolutionTrace,
} from './index';

// ─────────────────────────────────────────────────────────────
// GROUP I — ROUTING / PROVIDER PREFERENCES
//
// User-level and admin-level routing preference types.
// Owned by the routing subsystem in control-plane-layer.
// ─────────────────────────────────────────────────────────────
export type {
  ProviderPreference,
  RoutingOverrideAuditEvent,
  RoutingDecisionSnapshot,
  ExplainedRoutingPlan,
} from './index';

// ─────────────────────────────────────────────────────────────
// GROUP J — DEPRECATED (scheduled for removal)
//
// These exports are kept alive for backward compatibility only.
// Do not use in new code.
// ─────────────────────────────────────────────────────────────

/**
 * @deprecated Use SemanticTheme from artifact-v2.ts instead.
 * Will be removed after pptx renderer migrates.
 * Tracking: TODO-1 in AGENT_CONTEXT.md
 */
export type { ArtifactTheme } from './artifact-v2-compat';


