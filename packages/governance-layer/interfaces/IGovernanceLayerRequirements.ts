/**
 * @brandos/governance-layer — IGovernanceLayerRequirements.ts
 *
 * Dependency contract: declares the external capabilities this package consumes.
 *
 * L5 REQUIREMENT: Every external import used by governance-layer must be
 * documented here. Agents must not introduce new external dependencies without
 * updating this file and the AGENT_CONTEXT.md allowedImports list.
 *
 * DESIGN:
 *   - Re-exports only the shapes governance-layer needs from each dependency
 *   - No implementation, no side effects
 *   - Acts as a dependency audit surface for boundary enforcement
 */

// ─── From @brandos/contracts ──────────────────────────────────────────────────

/**
 * Artifact types consumed by governance-layer validators.
 * governance-layer READS these types — it does not produce them.
 * Artifact production is owned by artifact-engine-layer and OCL.
 */
export type {
  CarouselArtifact,
  DeckArtifact,
  ReportArtifact,
  ArtifactV2,
} from '@brandos/contracts'

// ─── From @brandos/governance-config ─────────────────────────────────────────

/**
 * Policy constants consumed by governance validators.
 * All thresholds, penalties, and limits are sourced from governance-config.
 * governance-layer MUST NOT hardcode any numeric threshold values.
 */
export type {
  CarouselGovernanceThresholds,
  DeckGovernanceThresholds,
  ReportGovernanceThresholds,
  ScorePenalties,
} from '@brandos/governance-config'

export {
  CAROUSEL_GOVERNANCE_THRESHOLDS,
  DECK_GOVERNANCE_THRESHOLDS,
  REPORT_GOVERNANCE_THRESHOLDS,
  DEFAULT_PASS_THRESHOLD,
  SCORE_PENALTIES,
} from '@brandos/governance-config'

// ─── Forbidden dependencies (documented for audit) ────────────────────────────

/**
 * FORBIDDEN — governance-layer MUST NOT import from:
 *
 * @brandos/ai-runtime-layer
 *   Reason: governance does not invoke LLM directly — LLM is always injected
 *           via the callLLM callback parameter.
 *
 * @brandos/control-plane-layer
 *   Reason: governance is consumed BY CPL, not the reverse.
 *           CPL calls evaluateGovernance(); governance never calls CPL.
 *
 * @brandos/artifact-engine-layer
 *   Reason: governance is consumed BY the artifact engine; dependency inversion
 *           is the correct architecture here.
 *
 * @brandos/shared-utils
 *   Reason: removed as dependency in L5 migration — governance-layer uses no
 *           shared-utils utilities. Direct console logging with ISO timestamps
 *           is sufficient. Removing this dependency eliminates the root/src
 *           shadow confusion documented in ARCHITECTURE_VIOLATIONS.md.
 *
 * @supabase/supabase-js
 *   Reason: no persistence in governance-layer.
 *
 * react, next
 *   Reason: server-side only package.
 */
export type ForbiddenDependencies = never


