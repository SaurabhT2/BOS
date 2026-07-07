/**
 * @brandos/iskill-runtime — index.ts
 *
 * PUBLIC API SURFACE
 *
 * This is the ONLY import path BrandOS should use from this package.
 * No deep imports. No internal types leaking.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE PATTERN (complete integration example):
 *
 *   // 1. Bootstrap (apps/web/instrumentation.ts)
 *   import {
 *     bootstrapSkillRuntime,
 *     createGovernanceBridge,
 *   } from '@brandos/iskill-runtime'
 *   import { globalArtifactEngine } from '@brandos/artifact-engine-layer'
 *
 *   const bridge = createGovernanceBridge(globalArtifactEngine)
 *   bootstrapSkillRuntime({ governanceCaller: bridge })
 *
 *   // 2. Execute a skill (control-plane / API route)
 *   import {
 *     getGlobalSkillRuntime,
 *     buildPersonalizationContext,
 *   } from '@brandos/iskill-runtime'
 *
 *   const runtime = getGlobalSkillRuntime()
 *   const personalization = buildPersonalizationContext(workspaceId, brandMemoryEntries)
 *
 *   const context = await runtime.buildExecutionContext({
 *     requestId, userId, workspaceId, runtimeMode: 'cloud',
 *     personalization, bundleId: 'ai-founder-gtm',
 *   })
 *
 *   const output = await runtime.executeSkill('carousel-founder', { topic }, context, callLLM)
 *   if (output.success) {
 *     // output.artifact is governed, compiled, personalized
 *   }
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Contracts (types) ─────────────────────────────────────────────────────────

export type {
  // Personalization
  IdentityDimension,
  IIdentityProjection,
  ISkillPersonalizationContext,
  IPersonalizationSnapshot,

  // Execution context
  ISkillExecutionContext,
  IGovernanceOverrides,
  IExecutionContextParams,

  // Lifecycle
  ISkillLifecycle,
  ISkillArtifactContract,
  ISkillRepairContract,
  ISkillExecutionPlan,
  ISkillExecutionResult,
  ISkillRepairResult,
  ISkillValidationResult,
  ISkillValidationError,

  // Registry
  ISkillRuntimeEntry,
  ISkillRuntimeMetadata,

  // Bundles
  IBundleDefinition,
  IBundleAudienceProfile,
  IBundleCapabilities,

  // Runtime output
  ISkillRuntimeOutput,
  ILifecycleDurations,
  ISkillRuntimeError,
  SkillRuntimeErrorCode,

  // Runtime interface
  ISkillRuntime,
} from './contracts'

// ── Personalization ───────────────────────────────────────────────────────────

export {
  buildPersonalizationContext,
  SkillPersonalizationContext,
  EmptyPersonalizationContext,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from './personalization/context'

export type { IRawBrandMemoryEntry } from './personalization/context'

// ── Runtime ───────────────────────────────────────────────────────────────────

export { SkillRuntime } from './runtime/skill-runtime'

// ── Bootstrap ─────────────────────────────────────────────────────────────────

export {
  bootstrapSkillRuntime,
  getGlobalSkillRuntime,
  _resetSkillRuntime,
  AI_FOUNDER_GTM_BUNDLE,
  B2B_SAAS_LAUNCH_BUNDLE,
} from './bootstrap'

export type { ISkillRuntimeBootstrapOptions } from './bootstrap'

// ── Governance bridge ─────────────────────────────────────────────────────────

export {
  createGovernanceBridge,
  createTestOnlyGovernanceBridge,
} from './governance/bridge'

export type { IArtifactEngineGovernable } from './governance/bridge'

// ── Repair registry ───────────────────────────────────────────────────────────

export {
  RepairPromptRegistry,
  createDefaultRepairRegistry,
  globalRepairRegistry,
} from './repair/repair-registry'

export type { IRepairPromptEntry } from './repair/repair-registry'

// ── Built-in skills ───────────────────────────────────────────────────────────

export {
  CarouselFounderSkillDef,
  CarouselFounderLifecycle,
} from './skills/carousel-founder'

export type { CarouselFounderInput } from './skills/carousel-founder'

export {
  LinkedInPostSkillDef,
  LinkedInPostLifecycle,
} from './skills/linkedin-post'

export type { LinkedInPostInput } from './skills/linkedin-post'

// ── Context utilities ─────────────────────────────────────────────────────────

export { toSkillContext } from './execution/context-builder'

// ── Lifecycle executor (for custom governance bridge construction) ─────────────

export type { IGovernanceCaller } from './lifecycle/executor'

// ── Telemetry health utilities (R3: moved from @brandos/shared-utils) ─────────
// @brandos/shared-utils still re-exports these for backward compatibility.

export { computeSkillHealth, healthSummary } from './telemetry/health'
export type { } from './telemetry/health'

// ─── L4 Additions (Wave C) ─────────────────────────────────────────────────

export {
  SkillCapabilityRegistry,
  skillCapabilityRegistry,
  STATIC_SKILL_CAPABILITIES,
} from './capability/SkillCapabilityRegistry'

export type {
  SkillCapabilityKey,
  SkillCapabilityDescriptor,
  SkillValidationResult,
} from './capability/SkillCapabilityRegistry'

export {
  validatePackage,
} from './validatePackage'

export type {
  PackageHealthReport,
  PackageHealthCheck,
} from './validatePackage'

export {
  PACKAGE_METADATA,
} from './IPackage'

export type {
  PackageCapabilityKey,
} from './IPackage'


