// ============================================================
// @brandos/contracts — interfaces/Icontracts.ts
//
// PACKAGE BOUNDARY CONTRACT
//
// This file is the machine-readable definition of everything
// @brandos/contracts owns, exports, and guarantees.
//
// It does NOT contain implementations. It documents invariants
// that are enforced by tests, TypeScript types, and the
// self-validation layer (src/self-validate.ts).
//
// AGENT INSTRUCTIONS:
//   - Read this file before touching any source file.
//   - Every symbol listed here has a corresponding test.
//   - Never add runtime deps to @brandos/contracts.
//   - Extension rules are in IcontractsRequirements.ts.
// ============================================================

// ─────────────────────────────────────────────────────────────
// SECTION 1 — PACKAGE IDENTITY
// ─────────────────────────────────────────────────────────────

/**
 * Package identity descriptor.
 * Consumed by the self-validation layer to assert package invariants at startup.
 */
export const CONTRACTS_PACKAGE_IDENTITY = {
  name: '@brandos/contracts',
  version: '1.0.0',
  description: 'Zero-runtime, zero-dependency type kernel for the BrandOS monorepo',
  schemaVersion: '2.1',
  tier: 'L0',         // Bottommost tier — no @brandos/* imports allowed
  agenticLevel: 'L5', // Target agentic readiness level
} as const;

// ─────────────────────────────────────────────────────────────
// SECTION 2 — EXPORT CONTRACT MAP
//
// Every public symbol the package exports, grouped by domain.
// A symbol MUST appear here before being added to index.ts.
// ─────────────────────────────────────────────────────────────

/**
 * Group A — Artifact schema (what content IS after compilation).
 * Source: src/artifact-v2.ts
 */
export const ARTIFACT_SCHEMA_EXPORTS = [
  // Discriminated union entry point
  'ArtifactV2',
  'ArtifactType',
  // Concrete types
  'CarouselArtifact',
  'DeckArtifact',
  'ReportArtifact',
  // Base + shared
  'BaseArtifact',
  'RichCarouselSlide',
  'CarouselMeta',
  'CarouselRole',
  'DeckSlide',
  'DeckMeta',
  'ReportSection',
  'ReportMeta',
  // Semantic richness
  'SemanticTheme',
  'AudienceProfile',
  'NarrativeArc',
  'RichnessMetrics',
  'GenerationTrace',
  // Export plumbing
  'ExportFormat',
  'ExportMetadata',
  // Runtime values (not just types)
  'CAROUSEL_ROLES',
  'CAROUSEL_SCHEMA_INSTRUCTION',
  // Type guards
  'isCarouselArtifact',
  'isDeckArtifact',
  'isReportArtifact',
  // Migration helper
  'upcastCarouselBlueprint',
  // Legacy (deprecated, migration in progress)
  'CarouselBlueprint',
  'LegacyCarouselSlide',
  'LegacyCarouselMeta',
] as const;

/**
 * Group B — AI Runtime contracts (how content IS MADE).
 * Source: src/airuntime-types.ts
 */
export const AI_RUNTIME_EXPORTS = [
  // Primary entry point
  'IAIRuntime',
  // Sub-engine contracts
  'IProviderAdapter',
  'IRouterEngine',
  'ICapabilityEngine',
  'IValidatorEngine',
  'IPolicyEngine',
  'ITelemetryEngine',
  'ICircuitBreaker',
  'IRateLimiter',
  'ICostTracker',
  'IPluginRegistry',
  'IStreamable',
  // Data shapes
  'AIRuntimeOutput',
  'AIRuntimeConfig',
  'AIRuntimePolicy',
  'AIRuntimeError',
  'ProviderConfig',
  'ProviderCapabilityStatus',
  'ProviderInvokeRequest',
  'ProviderInvokeResult',
  'CapabilityResult',
  'CapabilityCheckOptions',
  'InvocationRequest',
  'OutputSchema',
  'FallbackRule',
  'RetryBudget',
  'ExecutionPlan',
  'ValidationResult',
  'TelemetrySnapshot',
  'TelemetrySink',
  'TelemetryStats',
  'RateLimitResult',
  'CostSummary',
  'IPromptBuilder',
  'BuiltPrompt',
  'StreamChunk',
  'HookEvent',
  'HookHandler',
  'HookContext',
  // Enum-like primitives
  'ExecutionMode',
  'InvocationType',
  'ProviderName',
  'OutputStatus',
  'QualityFlag',
  'ErrorCode',
  'FallbackTrigger',
  'RoutingHint',
  'RuntimeMode',
  // Runtime utility values
  'runtimeModeToExecutionMode',
  'fromLegacyToRuntimeMode',
  'RUNTIME_MODE_LABELS',
] as const;

/**
 * Group C — Generation contract (how prompts ARE ASSEMBLED).
 * Source: src/generation-contract.ts
 */
export const GENERATION_CONTRACT_EXPORTS = [
  // Contribution slot interfaces
  'IIdentityContribution',
  'IPersonaContribution',
  'IIntentContribution',
  'IArtifactContribution',
  'IRuntimeContribution',
  'ISkillContribution',
  // The assembled contract
  'ResolvedGenerationContract',
  // Contributor plumbing
  'IContractContributor',
  'ContributorContext',
  'IContractAssembler',
] as const;

/**
 * Group D — Capability and skill contracts.
 * Source: src/index.ts (inline definitions)
 */
export const CAPABILITY_SKILL_EXPORTS = [
  'CapabilityId',
  'CapabilityDescriptor',
  'ICapabilityRegistry',
  'CapabilityOutput',
  'CapabilityResolutionTrace',
  'ICapabilityImplementation',
  'SkillCategory',
  'SkillMetadata',
  'SkillContext',
  'SkillResult',
  'ISkill',
  'SkillManifest',
  'SkillExecutionTelemetry',
  'SkillHealthScore',
  'SkillEvalResult',
  'SkillRegressionFixture',
  'RegressionRunResult',
] as const;

/**
 * Group E — Orchestrator and workflow contracts.
 * Source: src/index.ts (inline definitions)
 */
export const ORCHESTRATOR_WORKFLOW_EXPORTS = [
  'OrchestratorIntent',
  'OrchestratorRequest',
  'OrchestratorResponse',
  'WorkflowStatus',
  'WorkflowStep',
  'WorkflowDefinition',
  'WorkflowStepResult',
  'WorkflowResult',
  'IWorkflowEngine',
  'IPlatformPluginRegistry',
] as const;

/**
 * Group F — Routing and provider preference contracts.
 * Source: src/index.ts (inline definitions)
 */
export const ROUTING_EXPORTS = [
  'ProviderPreference',
  'RoutingOverrideAuditEvent',
  'RoutingDecisionSnapshot',
  'ExplainedRoutingPlan',
] as const;

/**
 * Group G — OCL and governance contracts.
 * Source: src/index.ts (inline definitions)
 */
export const OCL_GOVERNANCE_EXPORTS = [
  'IOCL',
  'IGovernance',
  'IGovernanceResult',
  'NormalizeOptions',
  'NormalizationTrace',
  'NormalizedOutput',
  'CleaningStep',
  'DraftArtifactInput',
  'DraftArtifactSlide',
  'DraftArtifactMeta',
] as const;

/**
 * Group G2 — Governance Feedback Loop contracts (closed-loop refactor).
 * Source: src/governance-feedback.ts
 *
 * These contracts are the information channel from Governance → Prompt Compiler.
 * Governance emits IGovernanceFeedback; Prompt Compiler consumes IAttemptHistory.
 */
export const GOVERNANCE_FEEDBACK_EXPORTS = [
  'GovernanceViolationSeverity',
  'IGovernanceViolationDetail',
  'IGovernanceRecommendationDetail',
  'IGovernanceFeedback',
  'IAttemptRecord',
  'IAttemptHistory',
  'createEmptyAttemptHistory',
  'appendAttemptRecord',
  'buildGovernanceFeedbackFromEvaluation',
] as const;

/**
 * Group H — Artifact engine contracts.
 * Source: src/index.ts (inline definitions)
 */
export const ARTIFACT_ENGINE_EXPORTS = [
  'IArtifactEngine',
  'CompileOptions',
  'ExportOptions',
  'ExportResult',
  'CompileResult',
] as const;

/**
 * Group I — Identity and brand intelligence types.
 * Source: src/identity-types.ts
 */
export const IDENTITY_EXPORTS = [
  'IdentityDimension',
  'SemanticIdentityDimension',
  'VisualIdentityDimension',
  'ISemanticIdentity',
  'IVisualIdentity',
  'IdentitySnapshot',
  'VisualIdentitySnapshot',
  'IdentitySignal',
  'SignalType',
  'ArtifactVisualMetadata',
  'VisualPersonalizationContext',
  'VisualIdentityColorProfile',
  'VisualIdentityTypographyProfile',
  'VisualIdentityLayoutProfile',
  'IObservationEvent',
  'IIdentityProjection',
  'IPersonalizationSnapshot',
  'ISkillPersonalizationContext',
  'SkillType',
  'ExtractionResult',
  'MergeDecision',
  'MergeStrategy',
  'PromptPersonalizationContext',
  'IdentityVersionRecord',
  'IdentityProfile',
  'IdentityLayerConfig',
  // Runtime values
  'SEMANTIC_DIMENSIONS',
  'VISUAL_DIMENSIONS',
  'ALL_DIMENSIONS',
  'isVisualDimension',
  'isSemanticDimension',
  'DEFAULT_IDENTITY_CONFIG',
] as const;

/**
 * Group J — Auth types (promoted from @brandos/auth, R6+).
 * Source: src/auth-types.ts
 */
export const AUTH_TYPE_EXPORTS = [
  'AuthProviderKind',
  'UserPlan',
  'AuthUser',
  'AuthState',
  'AuthSession',
  'LoginCredentials',
  'SignupCredentials',
  'UserRow',
  'CampaignFormat',
  'CampaignStatus',
  'CampaignRow',
  'NewCampaign',
  'PersonaTone',
  'PersonaRow',
  'NewPersona',
  'FeedbackSignal',
  'FeedbackRow',
  'NewFeedback',
  'DbResult',
  'DbListResult',
  'TableName',
] as const;

/**
 * Group K — Provider registry.
 * Source: src/provider-registry.ts
 */
export const PROVIDER_REGISTRY_EXPORTS = [
  'ProviderDefinition',
  'PROVIDER_REGISTRY',
  'ALL_PROVIDER_IDS',
  'LOCAL_PROVIDER_IDS',
  'CLOUD_PROVIDER_IDS',
  'DEFAULT_ENABLED_PROVIDER_IDS',
  'OPENAI_COMPATIBLE_DEFS',
  'getProviderDefinition',
  'isLocalProvider',
  'isCloudProvider',
] as const;

/**
 * Group L — Cross-cutting domain types.
 * Source: src/index.ts (inline definitions)
 */
export const DOMAIN_TYPE_EXPORTS = [
  // Core domain vocabulary
  'TaskType',
  'CapabilityId',
  'OverrideMode',
  'PipelineStage',
  'ActivityEntry',
  'IntentTaskType',
  'IntentAnalysis',
  // Generation options (used by OCL and CPL)
  'GenerationOptions',
  'PolicyCheckResult',
  'MemoryEntry',
  'QualityReport',
] as const;

/**
 * Deprecated exports — kept for migration only.
 * Consumers MUST migrate away before the next major version.
 */
export const DEPRECATED_EXPORTS = [
  /**
   * @deprecated Use SemanticTheme from artifact-v2.ts instead.
   * Pending removal after pptx renderer migration.
   */
  'ArtifactTheme',
  /**
   * @deprecated Use CarouselArtifact instead.
   */
  'CarouselBlueprint',
  /**
   * @deprecated Use CarouselArtifact instead.
   */
  'LegacyCarouselSlide',
  /**
   * @deprecated Use CarouselArtifact instead.
   */
  'LegacyCarouselMeta',
] as const;

// ─────────────────────────────────────────────────────────────
// SECTION 3 — PACKAGE INVARIANTS
//
// These are the rules that MUST hold at all times.
// Each invariant has a corresponding test in src/__tests__/
// ─────────────────────────────────────────────────────────────

export const PACKAGE_INVARIANTS = {
  /**
   * INV-1: Zero runtime dependencies.
   * package.json must have no "dependencies" field (only devDependencies).
   * Verified by: tests/self-validate.test.ts
   */
  ZERO_RUNTIME_DEPS: 'The package must have zero runtime dependencies',

  /**
   * INV-2: No @brandos/* imports anywhere in src/.
   * Verified by: tests/self-validate.test.ts
   */
  NO_INTERNAL_IMPORTS: 'No @brandos/* package imports allowed anywhere in src/',

  /**
   * INV-3: Single entry point.
   * All consumers import from @brandos/contracts (index.ts).
   * No deep imports into sub-files are permitted.
   * Verified by: structural convention + this document
   */
  SINGLE_ENTRY_POINT: 'index.ts is the only public entry point',

  /**
   * INV-4: Additive-only extension.
   * Existing exported interfaces/types may not be removed or have required
   * fields added (breaking change). Only optional fields may be added.
   * Verified by: TypeScript structural compatibility + code review
   */
  ADDITIVE_ONLY: 'Interfaces are additive-only — no breaking removals or required field additions',

  /**
   * INV-5: No dead code.
   * Every export in index.ts must have at least one consumer in the monorepo.
   * Deprecated exports are tagged explicitly and have a removal target.
   * Verified by: tests/self-validate.test.ts (export consistency check)
   */
  NO_DEAD_CODE: 'Every export must be consumed or explicitly marked deprecated with removal target',

  /**
   * INV-6: CAROUSEL_SCHEMA_INSTRUCTION is single source of truth.
   * Must not be duplicated in any other package. All imports must come
   * from @brandos/contracts.
   * Verified by: structural convention
   */
  CAROUSEL_SCHEMA_SINGLE_SOURCE: 'CAROUSEL_SCHEMA_INSTRUCTION must only be imported from @brandos/contracts',

  /**
   * INV-7: contributor() must never throw.
   * All IContractContributor<T> implementations must catch errors internally
   * and return null on failure.
   * Verified by: integration tests in output-control-layer
   */
  CONTRIBUTORS_NEVER_THROW: 'IContractContributor.contribute() must never throw — return null on failure',

  /**
   * INV-8: Bounded context separation.
   * TaskType and InvocationType are DIFFERENT concepts and MUST NOT be unified.
   * TaskType = what to create (domain vocabulary).
   * InvocationType = how the AI executes it (runtime vocabulary).
   * Verified by: structural convention + this document
   */
  BOUNDED_CONTEXT_SEPARATION: 'TaskType and InvocationType are separate bounded contexts — never unify',
} as const;

// ─────────────────────────────────────────────────────────────
// SECTION 4 — DEPENDENCY CONTRACT
// ─────────────────────────────────────────────────────────────

export const DEPENDENCY_CONTRACT = {
  /**
   * Packages this package is ALLOWED to depend on.
   * Currently: none. This is the L0 of the dependency stack.
   */
  ALLOWED_DEPENDENCIES: [] as string[],

  /**
   * Packages explicitly FORBIDDEN as dependencies.
   * If you find an import from any of these: it's a critical violation.
   */
  FORBIDDEN_DEPENDENCIES: [
    '@brandos/shared-utils',
    '@brandos/runtime-config',
    '@brandos/governance-config',
    '@brandos/auth',
    '@brandos/output-control-layer',
    '@brandos/ai-runtime-layer',
    '@brandos/governance-layer',
    '@brandos/iskill-runtime',
    '@brandos/artifact-engine-layer',
    '@brandos/cognition-client',
    '@brandos/control-plane-layer',
    '@brandos/presentation-layer',
    '@brandos/ui-admin',
  ] as string[],

  /**
   * External npm packages that are allowed in devDependencies (build/test only).
   * These must NOT appear in the compiled output.
   */
  ALLOWED_DEV_DEPENDENCIES: [
    'typescript',
    'vitest',
    '@vitest/coverage-v8',
    '@types/node',
    'rimraf',
  ] as string[],
} as const;

// ─────────────────────────────────────────────────────────────
// SECTION 5 — SCHEMA CONTRACT
//
// The canonical artifact schema version and discriminant field.
// ─────────────────────────────────────────────────────────────

export const SCHEMA_CONTRACT = {
  /** Current artifact schema version string. Must match BaseArtifact.$schema */
  CURRENT_SCHEMA_VERSION: 'artifact-json@2.0',

  /** Discriminant field used in ArtifactV2 union narrowing */
  DISCRIMINANT_FIELD: 'artifact_type',

  /** Valid discriminant values */
  ARTIFACT_TYPES: ['carousel', 'deck', 'report'] as const,

  /** Export formats with implementation status */
  EXPORT_FORMAT_STATUS: {
    html:   'implemented',
    json:   'implemented',
    pptx:   'declared-not-implemented',
    canva:  'declared-not-implemented',
    figma:  'declared-not-implemented',
    pdf:    'declared-not-implemented',
    png:    'declared-not-implemented',
  } as const,
} as const;

// ─────────────────────────────────────────────────────────────
// SECTION 6 — VALIDATION CONTRACT
// ─────────────────────────────────────────────────────────────

export const VALIDATION_CONTRACT = {
  /** Minimum richness score to pass governance without repair (carousel) */
  CAROUSEL_MIN_RICHNESS: 60,
  /** Minimum richness score to pass governance without repair (deck) */
  DECK_MIN_RICHNESS: 55,
  /** Minimum richness score to pass governance without repair (report) */
  REPORT_MIN_RICHNESS: 65,
  /** Identity confidence below this threshold → contributor returns null */
  IDENTITY_MIN_CONFIDENCE: 40,
  /** Fallback runtime mode when no valid mode can be parsed */
  DEFAULT_RUNTIME_MODE: 'cloud',
} as const;

// ─────────────────────────────────────────────────────────────
// SECTION 7 — EVENT CONTRACT
// ─────────────────────────────────────────────────────────────

/**
 * Event types that flow through the BrandOS pipeline, as observed
 * from this package's perspective. This package defines the types
 * but does not emit events.
 */
export const EVENT_CONTRACT = {
  PIPELINE_STAGES: [
    'intake',
    'policy',
    'brand_merge',
    'identity',
    'routing',
    'prompt_compile',
    'generation',
    'validation',
    'scoring',
    'retry',
    'override',
    'format',
    'telemetry',
    'delivery',
  ] as const,

  GOVERNANCE_OUTCOMES: [
    'passed',
    'passed_after_repair',
    'bypassed',
  ] as const,
} as const;

// ─────────────────────────────────────────────────────────────
// SECTION 8 — EXTENSION RULES (summary)
//
// Full extension rules in IcontractsRequirements.ts.
// ─────────────────────────────────────────────────────────────

export const EXTENSION_RULES_SUMMARY = {
  ADD_NEW_ARTIFACT_TYPE: [
    '1. Add to ArtifactType union in artifact-v2.ts',
    '2. Create <Type>Artifact interface extending BaseArtifact',
    '3. Add type guard is<Type>Artifact()',
    '4. Export from index.ts',
    '5. Add compiler in artifact-engine-layer',
    '6. Add governance validator in governance-layer',
    '7. Update ARTIFACT_SCHEMA_EXPORTS in Icontracts.ts',
    '8. Add tests for type guard and schema shape',
  ],

  ADD_NEW_CONTRACT_SLOT: [
    '1. Define I<Slot>Contribution interface in generation-contract.ts',
    '2. Add optional slot to ResolvedGenerationContract',
    '3. Export from index.ts and Icontracts.ts',
    '4. Add IContractContributor<T> implementation in owning package',
    '5. Register contributor in ContractAssembler bootstrap',
    '6. Document contributor in CONTRIBUTOR_MAP in generation-contract.ts',
  ],

  ADD_NEW_PROVIDER: [
    '1. Add ProviderName union value in airuntime-types.ts',
    '2. Add ProviderDefinition entry in provider-registry.ts',
    '3. Assign next available priority_default (no gaps allowed)',
    '4. Add IProviderAdapter implementation in ai-runtime-layer',
    '5. Update provider registry tests',
  ],
} as const;


