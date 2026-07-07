/**
 * @brandos/governance-config — validatePackage.ts
 *
 * Self-validation: produces a PackageHealthReport describing the current
 * state of this package's governance contracts.
 *
 * Used by repo-intelligence, CI gate, and agentic pre-flight.
 * No side effects. Additive-only.
 */

import {
  PolicyConfigSchema,
  DEFAULT_POLICY_CONFIG,
  SCORE_PENALTIES,
  CAROUSEL_GOVERNANCE_THRESHOLDS,
  DECK_GOVERNANCE_THRESHOLDS,
  REPORT_GOVERNANCE_THRESHOLDS,
  CAROUSEL_RICHNESS_WEIGHTS,
  DECK_RICHNESS_WEIGHTS,
  REPORT_RICHNESS_WEIGHTS,
  PLATFORM_HARD_CONSTRAINTS,
  UNSAFE_CONTENT_PATTERNS,
  validatePolicyPatch,
  validateModelGovernanceConsistency,
  toAIRuntimePolicy,
} from './index'
import { governanceCapabilityRegistry } from './GovernanceCapabilityRegistry'

// ─── PackageHealthReport ───────────────────────────────────────────────────────

export interface PackageHealthCheck {
  name: string
  passed: boolean
  detail: string
}

export interface PackageHealthReport {
  package: '@brandos/governance-config'
  level: 'L4'
  timestamp: string
  healthy: boolean
  checks: PackageHealthCheck[]
  flaggedExports: string[]
  capabilityCount: number
  summary: string
}

// ─── Checks ───────────────────────────────────────────────────────────────────

function checkDefaultPolicyParseable(): PackageHealthCheck {
  try {
    const result = PolicyConfigSchema.safeParse({})
    return {
      name: 'default_policy_parseable',
      passed: result.success,
      detail: result.success
        ? 'PolicyConfigSchema.parse({}) succeeds with all defaults'
        : `Schema parse failed: ${result.error?.message}`,
    }
  } catch (err) {
    return { name: 'default_policy_parseable', passed: false, detail: String(err) }
  }
}

function checkRichnessWeightsSumToOne(): PackageHealthCheck {
  const tolerance = 0.001
  const checks = [
    { name: 'carousel', weights: CAROUSEL_RICHNESS_WEIGHTS },
    { name: 'deck',     weights: DECK_RICHNESS_WEIGHTS },
    { name: 'report',   weights: REPORT_RICHNESS_WEIGHTS },
  ]
  const failures: string[] = []
  for (const { name, weights } of checks) {
    const sum = Object.values(weights).reduce((a, b) => a + b, 0)
    if (Math.abs(sum - 1.0) > tolerance) {
      failures.push(`${name} weights sum to ${sum.toFixed(4)} (expected 1.0)`)
    }
  }
  return {
    name: 'richness_weights_sum_to_one',
    passed: failures.length === 0,
    detail: failures.length === 0
      ? 'carousel, deck, and report richness weights all sum to 1.0'
      : failures.join('; '),
  }
}

function checkPlatformHardConstraintsPositive(): PackageHealthCheck {
  const { minProviderHealth, maxCostPerRequestUsd } = PLATFORM_HARD_CONSTRAINTS
  const passed = minProviderHealth > 0 && maxCostPerRequestUsd > 0
  return {
    name: 'platform_hard_constraints_positive',
    passed,
    detail: passed
      ? `minProviderHealth=${minProviderHealth} maxCostPerRequestUsd=${maxCostPerRequestUsd}`
      : 'Platform hard constraints must be positive values',
  }
}

function checkGovernanceThresholdsValid(): PackageHealthCheck {
  const errors: string[] = []
  if (CAROUSEL_GOVERNANCE_THRESHOLDS.minSlides < 1) errors.push('carousel.minSlides < 1')
  if (CAROUSEL_GOVERNANCE_THRESHOLDS.maxRepairAttempts < 1) errors.push('carousel.maxRepairAttempts < 1')
  if (DECK_GOVERNANCE_THRESHOLDS.minSlides < 1) errors.push('deck.minSlides < 1')
  if (DECK_GOVERNANCE_THRESHOLDS.maxRepairAttempts < 1) errors.push('deck.maxRepairAttempts < 1')
  if (REPORT_GOVERNANCE_THRESHOLDS.minSections < 1) errors.push('report.minSections < 1')
  if (REPORT_GOVERNANCE_THRESHOLDS.maxRepairAttempts < 1) errors.push('report.maxRepairAttempts < 1')
  return {
    name: 'governance_thresholds_valid',
    passed: errors.length === 0,
    detail: errors.length === 0
      ? 'All artifact governance thresholds have positive minimum values'
      : errors.join(', '),
  }
}

function checkScorePenaltiesPositive(): PackageHealthCheck {
  const negatives = Object.entries(SCORE_PENALTIES).filter(([, v]) => v <= 0)
  return {
    name: 'score_penalties_positive',
    passed: negatives.length === 0,
    detail: negatives.length === 0
      ? 'All SCORE_PENALTIES values are positive'
      : `Non-positive penalties: ${negatives.map(([k]) => k).join(', ')}`,
  }
}

function checkUnsafeContentPatternsAreRegex(): PackageHealthCheck {
  const invalid = UNSAFE_CONTENT_PATTERNS.filter(p => !(p instanceof RegExp))
  return {
    name: 'unsafe_content_patterns_are_regex',
    passed: invalid.length === 0,
    detail: invalid.length === 0
      ? `${UNSAFE_CONTENT_PATTERNS.length} UNSAFE_CONTENT_PATTERNS are all valid RegExp instances`
      : `${invalid.length} entries are not RegExp instances`,
  }
}

function checkValidatePolicyPatchAcceptsEmpty(): PackageHealthCheck {
  try {
    const result = validatePolicyPatch({})
    return {
      name: 'validate_policy_patch_accepts_empty',
      passed: result.valid,
      detail: result.valid
        ? 'validatePolicyPatch({}) returns valid:true'
        : `validatePolicyPatch({}) returned errors: ${result.errors.join(', ')}`,
    }
  } catch (err) {
    return { name: 'validate_policy_patch_accepts_empty', passed: false, detail: String(err) }
  }
}

function checkModelGovernanceConsistencyDetectsConflict(): PackageHealthCheck {
  try {
    const result = validateModelGovernanceConsistency({
      cloudProvidersOnly: true,
      localModelsOnly: true,
      deniedModels: [],
      allowedProviders: [],
    })
    const passed = !result.valid && result.errors.length > 0
    return {
      name: 'model_governance_detects_conflict',
      passed,
      detail: passed
        ? 'Correctly rejects cloudProvidersOnly=true AND localModelsOnly=true'
        : 'Failed to detect contradictory model governance constraints',
    }
  } catch (err) {
    return { name: 'model_governance_detects_conflict', passed: false, detail: String(err) }
  }
}

function checkToAIRuntimePolicyBridge(): PackageHealthCheck {
  try {
    const result = toAIRuntimePolicy(DEFAULT_POLICY_CONFIG)
    const passed = typeof result.local_only === 'boolean'
    return {
      name: 'to_ai_runtime_policy_bridge',
      passed,
      detail: passed
        ? 'toAIRuntimePolicy(DEFAULT_POLICY_CONFIG) returns object with local_only boolean'
        : 'toAIRuntimePolicy() did not return expected shape',
    }
  } catch (err) {
    return { name: 'to_ai_runtime_policy_bridge', passed: false, detail: String(err) }
  }
}

function checkCapabilityRegistryComplete(): PackageHealthCheck {
  const count = governanceCapabilityRegistry.keys().length
  const passed = count >= 18
  return {
    name: 'capability_registry_complete',
    passed,
    detail: passed
      ? `GovernanceCapabilityRegistry has ${count} entries`
      : `Only ${count} capabilities registered (expected ≥18)`,
  }
}

// ─── validatePackage ──────────────────────────────────────────────────────────

export function validatePackage(): PackageHealthReport {
  const checks: PackageHealthCheck[] = [
    checkDefaultPolicyParseable(),
    checkRichnessWeightsSumToOne(),
    checkPlatformHardConstraintsPositive(),
    checkGovernanceThresholdsValid(),
    checkScorePenaltiesPositive(),
    checkUnsafeContentPatternsAreRegex(),
    checkValidatePolicyPatchAcceptsEmpty(),
    checkModelGovernanceConsistencyDetectsConflict(),
    checkToAIRuntimePolicyBridge(),
    checkCapabilityRegistryComplete(),
  ]

  const failed = checks.filter(c => !c.passed)
  const healthy = failed.length === 0
  const flaggedExports = governanceCapabilityRegistry.flagged().flatMap(c => c.exports)

  return {
    package: '@brandos/governance-config',
    level: 'L4',
    timestamp: new Date().toISOString(),
    healthy,
    checks,
    flaggedExports: [...new Set(flaggedExports)],
    capabilityCount: governanceCapabilityRegistry.keys().length,
    summary: healthy
      ? `All ${checks.length} checks passed. Package is L4-healthy.`
      : `${failed.length}/${checks.length} checks failed: ${failed.map(c => c.name).join(', ')}`,
  }
}


