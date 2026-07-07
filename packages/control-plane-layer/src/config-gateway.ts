/**
 * @brandos/control-plane-layer — src/config-gateway.ts
 *
 * PHASE B: CPL Configuration Gateway
 *
 * BOUNDARY VIOLATION FIX (S1):
 *   Previously, v2 API routes imported from config packages directly:
 *     /api/v2/runtime/config  → @brandos/runtime-config
 *     /api/v2/governance/policy → @brandos/governance-config
 *     /api/v2/artifact/config → @brandos/artifact-config
 *
 *   This violated the L7-as-gateway rule: apps/web must route all
 *   configuration operations through CPL, not config packages directly.
 *
 *   This file is the CPL gateway facade for all config operations.
 *   Routes import from @brandos/control-plane-layer only.
 *
 * PRESERVED: All validation logic from original config schemas is preserved.
 * CONFIG PACKAGES remain in CPL deps — CPL still imports them.
 * The boundary shift is at the apps/web layer only.
 */

// ─── Runtime Config ───────────────────────────────────────────────────────────

export {
  RuntimeConfigSchema,
  DEFAULT_RUNTIME_CONFIG,
  mergeRuntimeConfig,
  toAIRuntimeConfig,
  type RuntimeConfig,
} from '@brandos/runtime-config'

// ─── Governance / Policy Config ───────────────────────────────────────────────

export {
  PolicyConfigSchema,
  DEFAULT_POLICY_CONFIG,
  validatePolicyPatch,
  validateModelGovernanceConsistency,
  toAIRuntimePolicy,
  type PolicyConfig,
} from '@brandos/governance-config'

// ─── Artifact Engine Config ───────────────────────────────────────────────────

export {
  ArtifactEngineConfigSchema,
  DEFAULT_ARTIFACT_CONFIG,
  type ArtifactEngineConfig,
} from '@brandos/artifact-config'

// ─── Governance Layer (CPL re-export to avoid direct layer violation) ─────────
// This satisfies the admin/iskill-test boundary violation (S1).
// apps/web must not import @brandos/governance-layer directly.

export {
  validateCarouselArtifact,
  validateDeckArtifact,
  validateReportArtifact,
} from '@brandos/governance-layer'


