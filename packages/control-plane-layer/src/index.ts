/**
 * @brandos/control-plane-layer — Public API
 *
 * REFACTORED: BrandOS Architecture Assessment 2026-05-29
 *
 * SINGLE EXPORT BARREL for the Control Plane.
 * All apps/web API routes import from here ONLY — no direct imports from
 * config packages, governance-layer, or AI runtime internals.
 *
 * LAYER RULE: This file is the L7 gateway. Everything that apps/web needs
 * from any lower layer must pass through here.
 */

// ─── Core orchestration ────────────────────────────────────────────────────────

export { CPLOrchestrator }          from './orchestrator'
export { initCPL }                  from './init'
export type { CPLInitOptions, CPLBootstrap } from './init'
export type {
  GenerationRequest,
  GenerationResult,
  GeneratedArtifact,
  OrchestrationContext,
} from './types'

// ─── runControlPlane — primary generation entrypoint ─────────────────────────
// All routes call this. Wraps CPLOrchestrator.orchestrate() with legacy compat.

export {
  runControlPlane,
  type ControlPlaneRequestInput,
  type ControlPlaneResponse,
  type StageEventCallback,
  type StageEvent,
} from './run-control-plane'

// ─── Artifact pipeline ────────────────────────────────────────────────────────

export {
  executeArtifactPipeline,
  ArtifactPipelineRejection,
  isArtifactPipelineRejection,
} from './artifact-pipeline'
export type { ArtifactPipelineInput, ArtifactPipelineResult } from './artifact-pipeline'

// ─── Workspace Foundation (P0 — Implementation Wave 1A) ──────────────────────
export { resolveWorkspaceSettings } from './workspace/settings-resolver'
export type { ResolvedWorkspaceSettings } from './workspace/settings-resolver'
export { checkWorkspaceLimits } from './workspace/limits-checker'
export type { LimitsCheckResult } from './workspace/limits-checker'
export {
  resolveTierLimits,
  isArtifactTypeAllowed,
  TIER_DEFAULTS,
  buildArtifactTypeGateError,
  buildGenerationLimitError,
  buildStorageLimitError,
  buildUploadCountLimitError,
} from './workspace/tier-resolver'
export type {
  TierDefaults,
  ResolvedTierLimits,
  TierGateError,
} from './workspace/tier-resolver'

// ─── Admin settings ────────────────────────────────────────────────────────────

export { AdminSettingsService }                from './admin/settings-service'
export { SupabaseAdminSettingsService }         from './admin/settings-service-supabase'
export { probeProvider }                        from './admin/settings-service-supabase'
export type { ProviderProbeResult }             from './admin/settings-service-supabase'
export type { AdminSettingsSnapshot }           from './admin/settings-service-supabase'
export type {
  ControlPlaneSettings,
  AIRuntimeSettings,
  ArtifactEngineSettings,
  OutputControlSettings,
  FallbackLink,
} from './admin/settings-service'
// ProviderSettings is canonical in @brandos/runtime-config.
// Re-exported here so existing callers of @brandos/control-plane-layer
// do not need import site changes. New code should import directly from
// @brandos/runtime-config.
export type { ProviderSettings } from '@brandos/runtime-config'
export { assembleRuntimeOverrides }             from './admin/runtime-override-assembler'

// ─── Admin auth ────────────────────────────────────────────────────────────────

export type { AdminAuthResult, AdminAuthDenied, AdminAuthCheck } from './admin/require-admin'

// ─── Configuration gateway (L7 boundary fix) ──────────────────────────────────
// Exposes config package schemas through CPL so routes never import them directly.

export {
  RuntimeConfigSchema,
  DEFAULT_RUNTIME_CONFIG,
  mergeRuntimeConfig,
  toAIRuntimeConfig,
  type RuntimeConfig,
  PolicyConfigSchema,
  DEFAULT_POLICY_CONFIG,
  validatePolicyPatch,
  validateModelGovernanceConsistency,
  type PolicyConfig,
  ArtifactEngineConfigSchema,
  DEFAULT_ARTIFACT_CONFIG,
  type ArtifactEngineConfig,
  validateCarouselArtifact,
  validateDeckArtifact,
  validateReportArtifact,
} from './config-gateway'

// ─── Enterprise features (re-exported from enterprise barrel) ─────────────────
// PHASE 3 CLEANUP (3.2): BrandMemoryService and globalBrandMemory removed.
// Import from @brandos/brand-intelligence directly.

export {
  PolicyAdminService,
  globalPolicyAdminService,
  ScoreHistoryService,
  globalScoreHistory,
  WebhookService,
  globalWebhookService,
  PromptLibraryService,
  globalPromptLibrary,
  EnterpriseTelemetryEngine,
  globalEnterpriseTelemetry,
} from './enterprise'

export type {
  ScoreHistoryEntry,
  ScoreAggregation,
  WebhookEvent,
  WebhookConfig,
  WebhookDelivery,
  Experiment,
  VariantConfig,
  VariantStats,
  ExperimentVariant,
} from './shared/types'

export { globalExperimentService } from './experiments/service'
export type { PromptLibraryEntry } from './shared/types'

// ─── Phase C services ─────────────────────────────────────────────────────────

export {
  AuditTrailService,
  globalAuditTrail,
} from './governance/audit-trail'
export type { GovernanceAuditEntry } from './governance/audit-trail'

export {
  ArtifactVersioningService,
  globalArtifactVersioning,
} from './versioning/artifact-versioning'
export type { ArtifactVersion, VersionStampOptions } from './versioning/artifact-versioning'

export {
  ApprovalService,
  globalApprovalService,
} from './approval/approval-service'
export type { ApprovalRecord, ApprovalStatus, ApprovalResult } from './approval/approval-service'

export {
  PersistentTelemetryService,
  globalPersistentTelemetry,
} from './telemetry/persistent-telemetry'
export type { TelemetrySnapshot, TelemetryStats } from './telemetry/persistent-telemetry'

// ─── Deprecated backward-compat shims (Phase 3 cleaned up) ───────────────────
// PHASE 3 CLEANUP (3.2, 3.3):
//   - globalBrandMemory, BrandMemoryService → import from @brandos/brand-intelligence
//   - BrandMemoryEntry, BrandMemoryConfig   → import from @brandos/contracts
//   - BrandContext                          → IBrandCognitionContext from @brandos/contracts
//   - BrandMemoryRepository                → createBrandSignalRepository() from @brandos/brand-intelligence (Fix C4)
//   - resolveIdentity                      → getGlobalBrandIntelligenceRuntime().resolve()
//   - recordBrandMemoryEntry               → getGlobalBrandIntelligenceRuntime().recordArtifactObservation()
//   - mergeBrandContext                    → import from @brandos/brand-intelligence

// ─── Type re-exports for routes ────────────────────────────────────────────────
export type { OverrideMode, TaskType, RuntimeMode } from '@brandos/contracts'

// ─── Brand Memory proxy (Cleanup Sprint 2) ────────────────────────────────────
// apps/web routes must use these instead of importing @brandos/cognition-client
// directly. Enforces the apps/web → CPL → cognition-client routing rule.
// Option B: getBrandMemory (raw memory read) and reviewBrandMemorySignal
// (review() passthrough) are removed — BrandOS no longer owns raw-signal
// review; see brand-memory/service.ts header.

export {
  recordBrandMemoryObservation,
  resolveBrandCognitionContext,
  getBrandSummary,
} from './brand-memory/service'

// ─── Workspace Configuration proxy (Cognitive Platform Evolution Program, EM-1.2) ──
// apps/web routes must use this instead of importing @brandos/cognition-client
// directly. Enforces the same apps/web → CPL → cognition-client routing rule as
// the Brand Memory proxy above.
export {
  syncWorkspaceConfiguration,
} from './workspace-configuration/service'
export type { WorkspaceConfigurationSyncRequest } from './workspace-configuration/service'

// ─── Experience proxy (Cognitive Platform Evolution Program, EM-3.1/EM-3.3) ──
// apps/web routes must use these instead of importing @brandos/cognition-client
// directly. Enforces the same apps/web → CPL → cognition-client routing rule.
export { recordArtifactFeedback, recordUserCorrection } from './experience/service'
export type { FeedbackEventInput, CorrectionInput } from './experience/service'

// ─── Knowledge ingestion proxy (Milestone 3, Phase 1) ─────────────────────────
// apps/web routes must use this instead of importing @brandos/cognition-client
// directly. Enforces the same apps/web → CPL → cognition-client routing rule
// as the Brand Memory proxy above.

export { ingestWorkspaceKnowledgeAsset } from './knowledge/service'
export type { KnowledgeAssetIngestInput } from '@brandos/cognition-client'

// ─── Governance routing service ────────────────────────────────────────────────
// Used by apps/web/app/api/control-plane/routing/route.ts

export { ProviderGovernanceService } from './governance/index'

// ─── Contract assembler bootstrap (RETIRED) ────────────────────────────────────
// bootstrapContractAssembler() wired a dead getContractAssembler() singleton.
// The orchestrator uses ContractAssemblerFactory.create() per-request instead.
// Kept as no-op export for any external callers that haven't updated yet.
export { bootstrapContractAssembler, _resetContractAssemblerForTesting } from './bootstrap-contract'


