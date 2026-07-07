/**
 * @brandos/governance-layer — Public API
 *
 * Semantic governance authority for BrandOS artifact generation.
 *
 * L5 ARCHITECTURE:
 *   - Single canonical entry point (this file — src/index.ts only)
 *   - No root-level index.ts (shadow file eliminated per FIX-2)
 *   - All consumers must import from '@brandos/governance-layer'
 *   - Do NOT import from internal subpaths (src/carousel, src/deck, etc.)
 *
 * TWO GOVERNANCE PATHS:
 *   1. Text scoring:    evaluateGovernance()      — for ALL task types
 *   2. Semantic validation: validateXxxArtifact() — for structured types (carousel, deck, report)
 *
 * EXTENSION POINT:
 *   To add governance for a new artifact type, use GovernancePluginRegistry.registerValidator()
 *   Do NOT modify existing validators.
 */

// ─── Internal contracts (re-exported for typed consumers) ─────────────────────
export type {
  SemanticGovernanceResult,
  SemanticValidator,
  SemanticScorer,
  SemanticRepair,
  SemanticRepairResult,
  GovernanceResult,
  SemanticValidationOutcome,
  GovernedArtifactType,
} from './contracts'

// ─── Text governance engine ───────────────────────────────────────────────────
export {
  evaluateGovernance,
  registerPolicyViolationHandler,
} from './governanceEngine'

export type {
  GovernanceEvaluationInput,
  GovernanceEvaluationResult,
  GovernanceContext,
  PolicyViolationType,
} from './governanceEngine'

// ─── Carousel governance ──────────────────────────────────────────────────────
export { validateCarouselArtifact, runCarouselSemanticGovernance } from './carousel'

// ─── Deck governance ──────────────────────────────────────────────────────────
export { validateDeckArtifact, runDeckSemanticGovernance } from './deck'

// ─── Report governance ────────────────────────────────────────────────────────
export { validateReportArtifact, runReportSemanticGovernance } from './report'

// ─── Newsletter governance ────────────────────────────────────────────────────
export { validateNewsletterArtifact, runNewsletterSemanticGovernance } from './newsletter'

// ─── Plugin registry ─────────────────────────────────────────────────────────
export {
  GovernancePluginRegistry,
  bootstrapGovernancePlugins,
} from './GovernancePluginRegistry'

export type {
  GovernanceCapabilityKey,
  GovernanceValidatorPlugin,
  GovernanceScorerPlugin,
  GovernanceRepairPlugin,
} from './GovernancePluginRegistry'

// ─── Package self-validation ──────────────────────────────────────────────────
export { validatePackage } from './validatePackage'
export type { PackageHealthReport, PackageHealthCheck } from './validatePackage'


