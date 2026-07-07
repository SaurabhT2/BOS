/**
 * @brandos/governance-config
 *
 * SINGLE SOURCE OF TRUTH for governance, compliance, and quality policy.
 *
 * Absorbs:
 *   - control-plane-layer/governance/  (ProviderGovernanceService hard constraints)
 *   - control-plane-layer/policy-engine.ts
 *   - control-plane-layer/scorer.ts
 *   - apps/web/app/api/control-plane/policy/route.ts (policy admin API)
 *   - Screen 4 (Policy Administration) full config model
 *   - control-plane-layer/types.ts (PolicyConfig — eliminated duplicate)
 *   - governance-layer/carousel/validator.ts (carousel thresholds)
 *   - control-plane-layer/admin/settings-service.ts (scoreThreshold default)
 *   - control-plane-layer/telemetry/enterprise.ts (webhook score triggers)
 *   - output-control-layer/artifact-compiler (richness scoring weights)
 *   - control-plane-layer/intake.ts (unsafe content patterns)
 *
 * Explicitly NOT responsible for:
 *   - Runtime provider selection → @brandos/runtime-config
 *   - Artifact pipeline settings → @brandos/artifact-config
 *   - Approval workflow execution → @brandos/control-plane-layer (consumes policy)
 */

import { z } from 'zod'
import type { TaskType, AIRuntimePolicy } from '@brandos/contracts'
import {
  CAROUSEL_SCHEMA_CONSTRAINTS,
  DECK_SCHEMA_CONSTRAINTS,
  REPORT_SCHEMA_CONSTRAINTS,
} from '@brandos/contracts'

// Re-export so consumers of governance-config can reference the domain type
// without a separate import from @brandos/contracts.
export type { TaskType }

// ─── Governance Scoring Constants ─────────────────────────────────────────────

/**
 * DEFAULT_PASS_THRESHOLD — minimum score for a generation to pass governance.
 *
 * This is the base threshold used by governanceEngine.ts when no task-specific
 * or admin-configured override is in effect.
 */
export const DEFAULT_PASS_THRESHOLD = 65

/**
 * DEFAULT_APPROVAL_SCORE_THRESHOLD — score below which an artifact requires
 * human-in-the-loop review before delivery.
 *
 * Matches QualityConfigSchema.scoreThreshold default (70).
 * CPL's ApprovalService must read from here — NOT hardcode locally.
 * Governance owns approval policy; CPL owns workflow execution only.
 */
export const DEFAULT_APPROVAL_SCORE_THRESHOLD = 70

/**
 * SCORE_PENALTIES — per-signal deduction weights used by the text scoring engine.
 *
 * All values are integer point deductions from a base score of 100.
 * Caps applied inside governanceEngine.ts (aiCliche max 25, buzzwordDensity
 * max 20, genericVisualLanguage max 16).
 */
export const SCORE_PENALTIES = {
  emDashAbuse:           8,   // per cluster of >2 em dashes
  aiCliche:              5,   // per cliché phrase
  roboticSymmetry:       10,  // uniform paragraph lengths
  repetitiveOpeners:     7,   // same word starts 3+ paragraphs
  weakHook:              12,  // opening line is generic
  buzzwordDensity:       6,   // per buzzword cluster
  genericVisualLanguage: 8,   // for carousel/visual outputs
} as const

export type ScorePenalties = typeof SCORE_PENALTIES

// ─── Task Score Thresholds ────────────────────────────────────────────────────

/**
 * TASK_TYPES — ordered array of domain TaskType members used for zod schema
 * enumeration and runtime iteration.
 */
export const TASK_TYPES = [
  'chat', 'post', 'carousel', 'deck', 'report',
  'campaign', 'remix', 'export', 'unknown',
] as const satisfies ReadonlyArray<TaskType>

export const ScoreThresholdsSchema = z.object({
  chat:     z.number().int().min(0).max(100).default(70),
  post:     z.number().int().min(0).max(100).default(78),
  carousel: z.number().int().min(0).max(100).default(80),
  deck:     z.number().int().min(0).max(100).default(88),
  report:   z.number().int().min(0).max(100).default(85),
  campaign: z.number().int().min(0).max(100).default(82),
  remix:    z.number().int().min(0).max(100).default(72),
  export:   z.number().int().min(0).max(100).default(75),
  unknown:  z.number().int().min(0).max(100).default(70),
})

export type ScoreThresholds = z.infer<typeof ScoreThresholdsSchema>

// ─── Approval Gates ───────────────────────────────────────────────────────────

export const ApprovalGatesSchema = z.object({
  requirePublishingApproval: z.boolean().default(false),
  requireApprovalForHighRisk: z.boolean().default(true),
  requireApprovalForLongArticle: z.boolean().default(false),
  requireApprovalForExternalPublish: z.boolean().default(true),
  maxRetries: z.number().int().min(0).max(10).default(3),
  retryEscalation: z.boolean().default(true),
})

export type ApprovalGates = z.infer<typeof ApprovalGatesSchema>

// ─── Model & Provider Governance ─────────────────────────────────────────────

export const ModelGovernanceSchema = z.object({
  cloudProvidersOnly: z.boolean().default(false),
  localModelsOnly:    z.boolean().default(false),
  deniedModels:       z.array(z.string()).default([]),
  allowedProviders:   z.array(z.string()).default([]),
})

export type ModelGovernance = z.infer<typeof ModelGovernanceSchema>

// ─── Compliance Mode ──────────────────────────────────────────────────────────

export const ComplianceModeSchema = z.enum(['off', 'basic', 'strict', 'hipaa']).default('basic')
export type ComplianceMode = z.infer<typeof ComplianceModeSchema>

/**
 * COMPLIANCE NOTE: 'hipaa' is a valid config value. Enforcement is structural
 * (field-level audit logging is enabled in supabase schema when set).
 * Full PII scrubbing pipeline is planned — track in governance roadmap.
 * TODO: implement PII output scrubbing when complianceMode === 'hipaa'.
 */

export const GovernanceModeSchema = z.enum(['standard', 'strict', 'fast', 'cost_saver', 'premium']).default('standard')
export type GovernanceMode = z.infer<typeof GovernanceModeSchema>

// ─── Quality Config ───────────────────────────────────────────────────────────

export const QualityConfigSchema = z.object({
  /**
   * hallucinationGuard — flag for hallucination detection.
   * NOTE: This flag is stored and surfaced in admin UI. The active enforcement
   * implementation (output cross-check against sources) is on the governance roadmap.
   * TODO: implement hallucination detection pass in governanceEngine.ts.
   */
  hallucinationGuard: z.boolean().default(true),
  autoRegenerate:     z.boolean().default(true),
  brandSafetyMode:    z.enum(['off', 'standard', 'strict']).default('standard'),
  scoreThreshold:     z.number().int().min(0).max(100).default(70),
})

export type QualityConfig = z.infer<typeof QualityConfigSchema>

// ─── Webhook Trigger Thresholds ───────────────────────────────────────────────

/**
 * WEBHOOK_SCORE_TRIGGERS — thresholds used by enterprise telemetry to fire
 * score.high and score.low webhook events.
 *
 * Previously hardcoded in control-plane-layer/src/telemetry/enterprise.ts.
 * Centralised here so the trigger points are auditable and config-driven.
 */
export const WEBHOOK_SCORE_TRIGGERS = {
  /** Scores at or above this value fire the 'score.high' webhook event */
  highScoreThreshold: 90,
  /** Scores strictly below this value fire the 'score.low' webhook event */
  lowScoreThreshold: 65,
} as const

export type WebhookScoreTriggers = typeof WEBHOOK_SCORE_TRIGGERS

// ─── Prompt Library Recommendation Threshold ─────────────────────────────────

/**
 * PROMPT_LIBRARY_RECOMMENDED_SCORE — minimum generation score for a prompt to
 * be marked as is_recommended in the prompt library.
 *
 * Previously hardcoded in control-plane-layer/src/prompt-library/service.ts.
 */
export const PROMPT_LIBRARY_RECOMMENDED_SCORE = 90

// ─── Platform Hard Constraints ────────────────────────────────────────────────

/**
 * PLATFORM_HARD_CONSTRAINTS — values that can never be bypassed by user or
 * admin preferences in ProviderGovernanceService.
 *
 * Previously hardcoded directly inside control-plane-layer/governance/index.ts.
 */
export const PLATFORM_HARD_CONSTRAINTS = {
  minProviderHealth:     20,
  maxCostPerRequestUsd:  1.00,
} as const

// ─── Unsafe Content Patterns ──────────────────────────────────────────────────

/**
 * UNSAFE_CONTENT_PATTERNS — regex patterns used by CPL intake.ts to block
 * requests containing jailbreak, illegal, or NSFW content.
 *
 * Previously hardcoded in control-plane-layer/src/intake.ts.
 * Centralised here so the pattern set is auditable and extensible.
 */
export const UNSAFE_CONTENT_PATTERNS: RegExp[] = [
  /\b(jailbreak|ignore previous|act as|pretend you|bypass|override instructions)\b/i,
  /\b(generate malware|write virus|hack|phish|illegal)\b/i,
  /\b(explicit|nsfw|xxx|pornograph)\b/i,
]

// ─── Carousel Governance Thresholds ──────────────────────────────────────────

/**
 * CAROUSEL_GOVERNANCE_THRESHOLDS — semantic validation gates for CarouselArtifact.
 *
 * Previously hardcoded constants inside governance-layer/src/carousel/validator.ts.
 * Centralised here so carousel governance is config-driven and auditable.
 */
export interface CarouselGovernanceThresholds {
  /** Minimum number of slides required to pass governance */
  minSlides: number
  /** Minimum richness_metrics.overall_score required */
  minRichnessOverall: number
  /** Minimum semantic_density_score per slide */
  minSlideDensityScore: number
  /** Minimum total content words across the whole carousel */
  minTotalContentWords: number
  /** Minimum CTA quality score */
  minCtaQuality: number
  /** Maximum LLM repair attempts before terminal rejection */
  maxRepairAttempts: number
}

export const CAROUSEL_GOVERNANCE_THRESHOLDS: CarouselGovernanceThresholds = {
  minSlides:            6,
  minRichnessOverall:   62,
  minSlideDensityScore: 40,
  minTotalContentWords: 280,
  minCtaQuality:        40,
  maxRepairAttempts:    3,
}


// ─── Carousel Structural Constraints ─────────────────────────────────────────
//
// CANONICAL SOURCE OF TRUTH for all carousel structural constraints.
//
// Every consumer (contributors, compilers, validators, prompt compiler, repair
// registries) MUST import from here. Do not hardcode these values anywhere else.
//
// Covers:
//   minSlides           — minimum slide count (also in CarouselGovernanceThresholds)
//   maxSlides           — maximum slide count
//   requiredRoles       — narrative roles every carousel must contain
//   minTitleChars       — title field minimum length
//   minHookChars        — hook field minimum character length
//   minHookWords        — hook field minimum word count
//   minCtaChars         — cta field minimum character length
//   minCtaWords         — cta field minimum word count
//   minSlideHeadlineChars — per-slide headline minimum length
//   genericCtaPhrases   — blocklist of CTA strings considered too generic to pass
//
// Architecture note: minSlides is the same value as
// CAROUSEL_GOVERNANCE_THRESHOLDS.minSlides — both must remain equal.
// The canonical numeric value lives in CAROUSEL_GOVERNANCE_THRESHOLDS.
// CAROUSEL_STRUCTURAL_CONSTRAINTS.minSlides re-exports it for consumers
// that only need the structural shape (contributors, compilers) without the
// full governance threshold object.

export interface CarouselStructuralConstraints {
  minSlides:              number
  maxSlides:              number
  requiredRoles:          readonly string[]
  minTitleChars:          number
  minHookChars:           number
  minHookWords:           number
  minCtaChars:            number
  minCtaWords:            number
  minSlideHeadlineChars:  number
  genericCtaPhrases:      readonly string[]
}

export const CAROUSEL_STRUCTURAL_CONSTRAINTS: CarouselStructuralConstraints = {
  minSlides:              6,
  maxSlides:              10,
  requiredRoles:          ['hook', 'cta'] as const,
  minTitleChars:          3,
  minHookChars:           5,
  minHookWords:           4,
  minCtaChars:            3,
  minCtaWords:            3,
  minSlideHeadlineChars:  10,
  genericCtaPhrases:      ['learn more', 'follow me', 'follow us', 'click here', 'get started', 'cta'] as const,
}

// ─── Deck Structural Constraints ─────────────────────────────────────────────
//
// CANONICAL SOURCE OF TRUTH for all deck structural constraints.

export interface DeckStructuralConstraints {
  minSlides:              number
  maxSlides:              number
  requiredRoles:          readonly string[]
  minTitleChars:          number
  minSlideHeadlineChars:  number
}

export const DECK_STRUCTURAL_CONSTRAINTS: DeckStructuralConstraints = {
  minSlides:              7,
  maxSlides:              14,
  requiredRoles:          ['cover', 'closing'] as const,
  minTitleChars:          3,
  minSlideHeadlineChars:  5,
}

// ─── Report Structural Constraints ───────────────────────────────────────────
//
// CANONICAL SOURCE OF TRUTH for all report structural constraints.

export interface ReportStructuralConstraints {
  minSections:            number
  maxSections:            number
  requiredSectionIds:     readonly string[]
  minTitleChars:          number
  minSectionHeadingChars: number
}

export const REPORT_STRUCTURAL_CONSTRAINTS: ReportStructuralConstraints = {
  minSections:            4,
  maxSections:            10,
  requiredSectionIds:     ['executive-summary'] as const,
  minTitleChars:          3,
  minSectionHeadingChars: 5,
}


// ─── Compile-time consistency assertions ──────────────────────────────────────
//
// These assertions fire at module load (TypeScript const context) if any value
// in CAROUSEL/DECK/REPORT_STRUCTURAL_CONSTRAINTS drifts from the corresponding
// SCHEMA_CONSTRAINTS constant defined in @brandos/contracts.
//
// If you see: "Type 'false' is not assignable to type 'true'"
// it means a constraint value was changed in one place but not the other.

type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// Carousel
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertCarouselMinSlides = AssertEqual<
  typeof CAROUSEL_STRUCTURAL_CONSTRAINTS.minSlides,
  typeof CAROUSEL_SCHEMA_CONSTRAINTS.minSlides
>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertCarouselMaxSlides = AssertEqual<
  typeof CAROUSEL_STRUCTURAL_CONSTRAINTS.maxSlides,
  typeof CAROUSEL_SCHEMA_CONSTRAINTS.maxSlides
>;

// Deck
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertDeckMinSlides = AssertEqual<
  typeof DECK_STRUCTURAL_CONSTRAINTS.minSlides,
  typeof DECK_SCHEMA_CONSTRAINTS.minSlides
>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertDeckMaxSlides = AssertEqual<
  typeof DECK_STRUCTURAL_CONSTRAINTS.maxSlides,
  typeof DECK_SCHEMA_CONSTRAINTS.maxSlides
>;

// Report
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertReportMinSections = AssertEqual<
  typeof REPORT_STRUCTURAL_CONSTRAINTS.minSections,
  typeof REPORT_SCHEMA_CONSTRAINTS.minSections
>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertReportMaxSections = AssertEqual<
  typeof REPORT_STRUCTURAL_CONSTRAINTS.maxSections,
  typeof REPORT_SCHEMA_CONSTRAINTS.maxSections
>;

// ─── Deck Governance Thresholds ───────────────────────────────────────────────

/**
 * DECK_GOVERNANCE_THRESHOLDS — semantic validation gates for DeckArtifact.
 */
export interface DeckGovernanceThresholds {
  minSlides:            number
  minRichnessOverall:   number
  minSlideDensityScore: number
  minTotalContentWords: number
  /**
   * @deprecated Sprint 1 fix — retry policy lives exclusively in ArtifactEngine
   * (MAX_REPAIR_ATTEMPTS = 3). runDeckSemanticGovernance() no longer reads this
   * field; it is a single-attempt helper. Mirrors the carousel validator fix
   * applied in Sprint 1 (2026-06-19).
   */
  maxRepairAttempts:    number
}

export const DECK_GOVERNANCE_THRESHOLDS: DeckGovernanceThresholds = {
  minSlides:            7,
  minRichnessOverall:   60,
  minSlideDensityScore: 35,
  minTotalContentWords: 350,
  maxRepairAttempts:    3,
}

// ─── Report Governance Thresholds ────────────────────────────────────────────

/**
 * REPORT_GOVERNANCE_THRESHOLDS — semantic validation gates for ReportArtifact.
 */
export interface ReportGovernanceThresholds {
  minSections:          number
  minRichnessOverall:   number
  minTotalContentWords: number
  /**
   * @deprecated Sprint 1 fix — retry policy lives exclusively in ArtifactEngine
   * (MAX_REPAIR_ATTEMPTS = 3). runReportSemanticGovernance() no longer reads this
   * field; it is a single-attempt helper. Mirrors the carousel validator fix
   * applied in Sprint 1 (2026-06-19).
   */
  maxRepairAttempts:    number
}

export const REPORT_GOVERNANCE_THRESHOLDS: ReportGovernanceThresholds = {
  minSections:          4,
  minRichnessOverall:   62,
  minTotalContentWords: 600,
  maxRepairAttempts:    3,
}

// ─── Newsletter Governance Thresholds ────────────────────────────────────────

/**
 * NEWSLETTER_GOVERNANCE_THRESHOLDS — semantic validation gates for NewsletterArtifact.
 */
export interface NewsletterGovernanceThresholds {
  minSections:          number
  minRichnessOverall:   number
  minTotalContentWords: number
  /**
   * @deprecated Sprint 1 fix — retry policy lives exclusively in ArtifactEngine
   * (MAX_REPAIR_ATTEMPTS = 3). runNewsletterSemanticGovernance() no longer reads
   * this field; it is a single-attempt helper. Mirrors the carousel validator fix
   * applied in Sprint 1 (2026-06-19).
   */
  maxRepairAttempts:    number
}

export const NEWSLETTER_GOVERNANCE_THRESHOLDS: NewsletterGovernanceThresholds = {
  minSections:          3,
  minRichnessOverall:   58,
  minTotalContentWords: 300,
  maxRepairAttempts:    3,
}

// ─── Richness Scoring Weights ─────────────────────────────────────────────────

/**
 * RichnessWeights — the contribution of each scoring dimension to overall_score.
 * All values should sum to 1.0.
 *
 * Previously three separate hardcoded formulas in:
 *   - carouselCompiler.ts
 *   - deckCompiler.ts
 *   - reportCompiler.ts
 *
 * Centralised here. Each compiler imports its own weight set. This allows
 * per-type tuning without scattering magic numbers across OCL.
 */
export interface RichnessWeights {
  density:            number
  evidence:           number
  persuasion:         number
  ctaQuality:         number
  narrativeCoherence: number
  hookStrength:       number
}

export const CAROUSEL_RICHNESS_WEIGHTS: RichnessWeights = {
  density:            0.25,
  evidence:           0.20,
  persuasion:         0.20,
  ctaQuality:         0.10,
  narrativeCoherence: 0.15,
  hookStrength:       0.10,
}

export const DECK_RICHNESS_WEIGHTS: RichnessWeights = {
  density:            0.25,
  evidence:           0.20,
  persuasion:         0.15,
  ctaQuality:         0.10,
  narrativeCoherence: 0.15,
  hookStrength:       0.15,
}

export const REPORT_RICHNESS_WEIGHTS: RichnessWeights = {
  density:            0.30,
  evidence:           0.20,
  persuasion:         0.10,
  ctaQuality:         0.05,
  narrativeCoherence: 0.15,
  hookStrength:       0.20,
}

// ─── Full Policy Config (canonical model) ────────────────────────────────────

/**
 * PolicyConfigSchema — THE canonical PolicyConfig definition for BrandOS.
 *
 * This replaces the duplicate interface PolicyConfig that previously existed
 * in control-plane-layer/src/types.ts with snake_case field names.
 * All code must import PolicyConfig from @brandos/governance-config, not from
 * control-plane-layer.
 *
 * Field naming: camelCase throughout. The Supabase persistence layer in
 * SupabaseAdminSettingsService reads/writes the 'governance' section and
 * handles snake_case ↔ camelCase mapping at the DB boundary.
 */
export const PolicyConfigSchema = z.object({
  modelGovernance: ModelGovernanceSchema.default(ModelGovernanceSchema.parse({})),
  scoreThresholds: ScoreThresholdsSchema.default(ScoreThresholdsSchema.parse({})),
  approvalGates: ApprovalGatesSchema.default(ApprovalGatesSchema.parse({})),

  complianceMode: ComplianceModeSchema,
  governanceMode: GovernanceModeSchema,

  quality: QualityConfigSchema.default(QualityConfigSchema.parse({})),

  bannedPhrases: z.array(z.string()).default([]),
  enforceBrandVoice: z.boolean().default(true),

  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
})

export type PolicyConfig = z.infer<typeof PolicyConfigSchema>

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_POLICY_CONFIG: PolicyConfig =
  PolicyConfigSchema.parse({})

// ─── Validation ───────────────────────────────────────────────────────────────

export interface PolicyValidationResult {
  valid:  boolean
  errors: string[]
}

export function validatePolicyPatch(patch: unknown): PolicyValidationResult {
  const result = PolicyConfigSchema.partial().safeParse(patch)
  if (result.success) return { valid: true, errors: [] }
  return {
    valid:  false,
    errors: result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`),
  }
}

/**
 * Validate that model governance constraints don't contradict each other.
 */
export function validateModelGovernanceConsistency(
  mg: ModelGovernance,
): PolicyValidationResult {
  const errors: string[] = []
  if (mg.cloudProvidersOnly && mg.localModelsOnly) {
    errors.push('cloudProvidersOnly and localModelsOnly cannot both be true')
  }
  return { valid: errors.length === 0, errors }
}

// ─── Policy → Runtime Policy bridge ──────────────────────────────────────────


/**
 * Converts PolicyConfig → AIRuntimePolicy consumed by ai-runtime-layer.
 * This is the only correct translation point.
 */
export function toAIRuntimePolicy(config: PolicyConfig): AIRuntimePolicy {
  return {
    local_only:            config.modelGovernance.localModelsOnly,
    no_external_providers: config.modelGovernance.localModelsOnly,
    blocked_providers:     config.modelGovernance.deniedModels as AIRuntimePolicy['blocked_providers'],
    allowed_modes:         config.modelGovernance.cloudProvidersOnly
      ? ['cloud']
      : config.modelGovernance.localModelsOnly
      ? ['local']
      : undefined,
  }
}

// ─── Service Interface ────────────────────────────────────────────────────────

export interface IPolicyConfigService {
  getPolicy(workspaceId?: string): Promise<PolicyConfig>
  savePolicy(patch: Partial<PolicyConfig>, workspaceId?: string, updatedBy?: string): Promise<PolicyConfig>
  resetPolicy(workspaceId?: string, updatedBy?: string): Promise<PolicyConfig>
  getCached(): PolicyConfig
}

// ─── L4 Additions (Wave C) ─────────────────────────────────────────────────

export {
  GovernanceCapabilityRegistry,
  governanceCapabilityRegistry,
  GOVERNANCE_CAPABILITIES,
} from './GovernanceCapabilityRegistry'

export type {
  GovernanceCapabilityKey,
  GovernanceCapabilityDescriptor,
} from './GovernanceCapabilityRegistry'

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


