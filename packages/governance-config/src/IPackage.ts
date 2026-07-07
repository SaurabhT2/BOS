/**
 * @brandos/governance-config — IPackage.ts
 *
 * Machine-readable package metadata. Updated to L4 in Wave C.
 */

export const PACKAGE_METADATA = {
  name:    '@brandos/governance-config' as const,
  version: '1.0.0',
  layer:   2,
  level:   'L4',

  capabilities: {
    'governance.policy.threshold':       'ScoreThresholdsSchema — per-task-type pass thresholds',
    'governance.policy.penalty':         'SCORE_PENALTIES — per-signal deduction weights',
    'governance.policy.compliance':      'ComplianceModeSchema + GovernanceModeSchema',
    'governance.policy.approval':        'ApprovalGatesSchema — human-in-the-loop gates',
    'governance.policy.model':           'ModelGovernanceSchema — provider/model allow lists',
    'governance.policy.quality':         'QualityConfigSchema — hallucination guard, brand safety',
    'governance.policy.full':            'PolicyConfigSchema — canonical full policy shape',
    'governance.policy.defaults':        'DEFAULT_POLICY_CONFIG + DEFAULT_PASS_THRESHOLD',
    'governance.policy.validation':      'validatePolicyPatch, validateModelGovernanceConsistency',
    'governance.artifact.carousel':      'CAROUSEL_GOVERNANCE_THRESHOLDS',
    'governance.artifact.deck':          'DECK_GOVERNANCE_THRESHOLDS',
    'governance.artifact.report':        'REPORT_GOVERNANCE_THRESHOLDS',
    'governance.richness.carousel':      'CAROUSEL_RICHNESS_WEIGHTS (must sum to 1.0)',
    'governance.richness.deck':          'DECK_RICHNESS_WEIGHTS (must sum to 1.0)',
    'governance.richness.report':        'REPORT_RICHNESS_WEIGHTS (must sum to 1.0)',
    'governance.unsafe':                 'UNSAFE_CONTENT_PATTERNS — intake scan regexes',
    'governance.platform':               'PLATFORM_HARD_CONSTRAINTS — architectural minimums',
    'governance.webhooks':               'WEBHOOK_SCORE_TRIGGERS — high/low score thresholds',
    'governance.prompts':                'PROMPT_LIBRARY_RECOMMENDED_SCORE',
    'governance.bridge':                 'toAIRuntimePolicy() — PolicyConfig → AIRuntimePolicy',
    'governance.service':                'IPolicyConfigService — load/save/reset interface',
  },

  dependencies: [
    '@brandos/contracts',
    'zod',
  ],

  consumers: [
    '@brandos/governance-layer',
    '@brandos/output-control-layer',
    '@brandos/control-plane-layer',
  ],

  flaggedExports: [
    { name: 'validatePolicyPatch',                status: 'ZERO_REFS', action: 'Keep — called via CPL re-export' },
    { name: 'validateModelGovernanceConsistency', status: 'ZERO_REFS', action: 'Keep — validation utility' },
    { name: 'toAIRuntimePolicy',                  status: 'ZERO_REFS', action: 'Keep — single bridge to AIRuntimePolicy' },
    { name: 'DEFAULT_PASS_THRESHOLD',             status: 'ZERO_REFS', action: 'Keep — base threshold for governance engine' },
    { name: 'DEFAULT_POLICY_CONFIG',              status: 'ZERO_REFS (direct)', action: 'Keep — re-exported via CPL' },
  ],

  invariants: [
    'I-1: No imports from governance-layer, runtime-config, ai-runtime-layer, or control-plane-layer',
    'I-2: toAIRuntimePolicy() is the single bridge from PolicyConfig → AIRuntimePolicy',
    'I-3: PLATFORM_HARD_CONSTRAINTS values are architectural minimums — never lower',
    'I-4: Threshold decreases require human sign-off',
    'I-5: UNSAFE_CONTENT_PATTERNS removals require human security review',
    'I-6: Richness weight arrays must sum to 1.0 — enforced in validatePackage()',
  ],

  l4Additions: [
    'GovernanceCapabilityRegistry.ts — queryable capability map',
    'validatePackage.ts — self-check returns PackageHealthReport (includes richness weight sum assertion)',
    'IPackage.ts — machine-readable metadata (this file)',
    'AGENT_CONTEXT.md — updated to L4',
    'src/__tests__/validatePackage.test.ts — L4 test coverage',
  ],

  requiredReads: [
    'AGENT_CONTEXT.md',
    'src/IPackage.ts',
    'src/index.ts',
    'src/GovernanceCapabilityRegistry.ts',
  ],
} as const

export type PackageCapabilityKey = keyof typeof PACKAGE_METADATA.capabilities


