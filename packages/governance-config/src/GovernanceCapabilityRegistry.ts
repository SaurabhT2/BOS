/**
 * @brandos/governance-config — GovernanceCapabilityRegistry.ts
 *
 * Machine-readable capability map for repo-intelligence, agentic tooling,
 * and multi-agent coordination. Declares which governance capabilities this
 * package owns and provides queryable access at runtime.
 *
 * Additive-only. No behavioral changes, no new dependencies.
 */

// ─── Capability Key Type ───────────────────────────────────────────────────────

export type GovernanceCapabilityKey =
  | 'governance.policy.threshold'
  | 'governance.policy.penalty'
  | 'governance.policy.compliance'
  | 'governance.policy.approval'
  | 'governance.policy.model'
  | 'governance.policy.quality'
  | 'governance.policy.full'
  | 'governance.policy.defaults'
  | 'governance.policy.validation'
  | 'governance.artifact.carousel'
  | 'governance.artifact.deck'
  | 'governance.artifact.report'
  | 'governance.richness.carousel'
  | 'governance.richness.deck'
  | 'governance.richness.report'
  | 'governance.unsafe'
  | 'governance.platform'
  | 'governance.webhooks'
  | 'governance.prompts'
  | 'governance.bridge'
  | 'governance.service'

// ─── Capability Descriptor ────────────────────────────────────────────────────

export interface GovernanceCapabilityDescriptor {
  key: GovernanceCapabilityKey
  description: string
  exports: string[]
  hasActiveConsumers: boolean
  notes?: string
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const GOVERNANCE_CAPABILITIES: readonly GovernanceCapabilityDescriptor[] = [
  {
    key: 'governance.policy.threshold',
    description: 'Per-task-type pass thresholds (carousel=85, deck=88, report=85, etc.)',
    exports: ['ScoreThresholdsSchema', 'ScoreThresholds'],
    hasActiveConsumers: true,
  },
  {
    key: 'governance.policy.penalty',
    description: 'Per-signal score deduction weights (emDashAbuse, aiCliche, buzzwordDensity, etc.)',
    exports: ['SCORE_PENALTIES'],
    hasActiveConsumers: true,
  },
  {
    key: 'governance.policy.compliance',
    description: 'Compliance mode (off|basic|strict|hipaa) and governance mode (standard|strict|fast|cost_saver|premium)',
    exports: ['ComplianceModeSchema', 'GovernanceModeSchema', 'ComplianceMode', 'GovernanceMode'],
    hasActiveConsumers: false,
    notes: 'ZERO_REFS — likely masked by control-plane-layer re-export. Keep.',
  },
  {
    key: 'governance.policy.approval',
    description: 'Human-in-the-loop approval gates (requirePublishingApproval, maxRetries, etc.)',
    exports: ['ApprovalGatesSchema', 'ApprovalGates'],
    hasActiveConsumers: false,
    notes: 'ZERO_REFS — schema defined, enforcement pending. Keep.',
  },
  {
    key: 'governance.policy.model',
    description: 'Provider/model allow/deny lists (cloudProvidersOnly, localModelsOnly, deniedModels)',
    exports: ['ModelGovernanceSchema', 'ModelGovernance'],
    hasActiveConsumers: true,
  },
  {
    key: 'governance.policy.quality',
    description: 'Quality flags: hallucinationGuard, autoRegenerate, brandSafetyMode, scoreThreshold',
    exports: ['QualityConfigSchema', 'QualityConfig'],
    hasActiveConsumers: true,
    notes: 'hallucinationGuard enforcement is TODO — documented in governance roadmap.',
  },
  {
    key: 'governance.policy.full',
    description: 'Canonical full PolicyConfig — composes all sub-schemas',
    exports: ['PolicyConfigSchema', 'PolicyConfig'],
    hasActiveConsumers: true,
  },
  {
    key: 'governance.policy.defaults',
    description: 'DEFAULT_POLICY_CONFIG and DEFAULT_PASS_THRESHOLD fallback values',
    exports: ['DEFAULT_POLICY_CONFIG', 'DEFAULT_PASS_THRESHOLD'],
    hasActiveConsumers: false,
    notes: 'ZERO_REFS (direct) — re-exported via control-plane-layer. Keep.',
  },
  {
    key: 'governance.policy.validation',
    description: 'validatePolicyPatch() and validateModelGovernanceConsistency() pure validators',
    exports: ['validatePolicyPatch', 'validateModelGovernanceConsistency'],
    hasActiveConsumers: false,
    notes: 'ZERO_REFS — called via CPL re-export. Keep.',
  },
  {
    key: 'governance.artifact.carousel',
    description: 'Semantic validation gates for CarouselArtifact (minSlides, minRichness, minCtaQuality)',
    exports: ['CAROUSEL_GOVERNANCE_THRESHOLDS', 'CarouselGovernanceThresholds'],
    hasActiveConsumers: true,
  },
  {
    key: 'governance.artifact.deck',
    description: 'Semantic validation gates for DeckArtifact',
    exports: ['DECK_GOVERNANCE_THRESHOLDS', 'DeckGovernanceThresholds'],
    hasActiveConsumers: true,
  },
  {
    key: 'governance.artifact.report',
    description: 'Semantic validation gates for ReportArtifact',
    exports: ['REPORT_GOVERNANCE_THRESHOLDS', 'ReportGovernanceThresholds'],
    hasActiveConsumers: true,
  },
  {
    key: 'governance.richness.carousel',
    description: 'Richness scoring weights for carousel (must sum to 1.0)',
    exports: ['CAROUSEL_RICHNESS_WEIGHTS'],
    hasActiveConsumers: true,
  },
  {
    key: 'governance.richness.deck',
    description: 'Richness scoring weights for deck (must sum to 1.0)',
    exports: ['DECK_RICHNESS_WEIGHTS'],
    hasActiveConsumers: true,
  },
  {
    key: 'governance.richness.report',
    description: 'Richness scoring weights for report (must sum to 1.0)',
    exports: ['REPORT_RICHNESS_WEIGHTS'],
    hasActiveConsumers: true,
  },
  {
    key: 'governance.unsafe',
    description: 'UNSAFE_CONTENT_PATTERNS — regex patterns for intake jailbreak/NSFW/illegal scan',
    exports: ['UNSAFE_CONTENT_PATTERNS'],
    hasActiveConsumers: true,
  },
  {
    key: 'governance.platform',
    description: 'PLATFORM_HARD_CONSTRAINTS — architectural minimums (minProviderHealth, maxCostPerRequestUsd)',
    exports: ['PLATFORM_HARD_CONSTRAINTS'],
    hasActiveConsumers: true,
  },
  {
    key: 'governance.webhooks',
    description: 'WEBHOOK_SCORE_TRIGGERS — thresholds for score.high / score.low webhook events',
    exports: ['WEBHOOK_SCORE_TRIGGERS'],
    hasActiveConsumers: true,
  },
  {
    key: 'governance.prompts',
    description: 'PROMPT_LIBRARY_RECOMMENDED_SCORE — minimum score for prompt library recommendation',
    exports: ['PROMPT_LIBRARY_RECOMMENDED_SCORE'],
    hasActiveConsumers: true,
  },
  {
    key: 'governance.bridge',
    description: 'toAIRuntimePolicy() — single translation from PolicyConfig to AIRuntimePolicy',
    exports: ['toAIRuntimePolicy'],
    hasActiveConsumers: false,
    notes: 'ZERO_REFS — bridge may not be wired to ai-runtime-layer. Investigate.',
  },
  {
    key: 'governance.service',
    description: 'IPolicyConfigService — interface for load/save/reset/getCached',
    exports: ['IPolicyConfigService'],
    hasActiveConsumers: false,
    notes: 'ZERO_REFS — interface only. Implementation lives in control-plane-layer.',
  },
] as const

// ─── Query API ────────────────────────────────────────────────────────────────

export class GovernanceCapabilityRegistry {
  private readonly map: ReadonlyMap<GovernanceCapabilityKey, GovernanceCapabilityDescriptor>

  constructor() {
    this.map = new Map(GOVERNANCE_CAPABILITIES.map(c => [c.key, c]))
  }

  get(key: GovernanceCapabilityKey): GovernanceCapabilityDescriptor | undefined {
    return this.map.get(key)
  }

  keys(): GovernanceCapabilityKey[] {
    return [...this.map.keys()]
  }

  list(): GovernanceCapabilityDescriptor[] {
    return [...this.map.values()]
  }

  flagged(): GovernanceCapabilityDescriptor[] {
    return this.list().filter(c => !c.hasActiveConsumers)
  }

  owns(key: string): key is GovernanceCapabilityKey {
    return this.map.has(key as GovernanceCapabilityKey)
  }
}

export const governanceCapabilityRegistry = new GovernanceCapabilityRegistry()


