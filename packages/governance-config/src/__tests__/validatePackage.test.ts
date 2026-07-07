/**
 * @brandos/governance-config — validatePackage.test.ts
 * L4 test suite.
 */
import { describe, it, expect } from 'vitest'
import {
  PolicyConfigSchema,
  DEFAULT_POLICY_CONFIG,
  SCORE_PENALTIES,
  CAROUSEL_RICHNESS_WEIGHTS,
  DECK_RICHNESS_WEIGHTS,
  REPORT_RICHNESS_WEIGHTS,
  CAROUSEL_GOVERNANCE_THRESHOLDS,
  DECK_GOVERNANCE_THRESHOLDS,
  REPORT_GOVERNANCE_THRESHOLDS,
  PLATFORM_HARD_CONSTRAINTS,
  UNSAFE_CONTENT_PATTERNS,
  validatePolicyPatch,
  validateModelGovernanceConsistency,
  toAIRuntimePolicy,
} from '../index'
import { validatePackage } from '../validatePackage'
import { governanceCapabilityRegistry } from '../GovernanceCapabilityRegistry'

describe('validatePackage()', () => {
  it('returns a healthy report', () => {
    const report = validatePackage()
    expect(report.package).toBe('@brandos/governance-config')
    expect(report.level).toBe('L4')
    expect(report.healthy).toBe(true)
  })
  it('never throws', () => {
    expect(() => validatePackage()).not.toThrow()
  })
})

describe('PolicyConfigSchema', () => {
  it('parses empty input with all defaults', () => {
    expect(PolicyConfigSchema.safeParse({}).success).toBe(true)
  })
  it('rejects invalid complianceMode', () => {
    expect(PolicyConfigSchema.safeParse({ complianceMode: 'gdpr' }).success).toBe(false)
  })
})

describe('Richness weights', () => {
  const tol = 0.001
  it('CAROUSEL_RICHNESS_WEIGHTS sum to 1.0', () => {
    const sum = Object.values(CAROUSEL_RICHNESS_WEIGHTS).reduce((a,b) => a+b, 0)
    expect(Math.abs(sum - 1.0)).toBeLessThan(tol)
  })
  it('DECK_RICHNESS_WEIGHTS sum to 1.0', () => {
    const sum = Object.values(DECK_RICHNESS_WEIGHTS).reduce((a,b) => a+b, 0)
    expect(Math.abs(sum - 1.0)).toBeLessThan(tol)
  })
  it('REPORT_RICHNESS_WEIGHTS sum to 1.0', () => {
    const sum = Object.values(REPORT_RICHNESS_WEIGHTS).reduce((a,b) => a+b, 0)
    expect(Math.abs(sum - 1.0)).toBeLessThan(tol)
  })
})

describe('Governance thresholds', () => {
  it('carousel minSlides >= 1', () => {
    expect(CAROUSEL_GOVERNANCE_THRESHOLDS.minSlides).toBeGreaterThanOrEqual(1)
  })
  it('deck minSlides >= 1', () => {
    expect(DECK_GOVERNANCE_THRESHOLDS.minSlides).toBeGreaterThanOrEqual(1)
  })
  it('report minSections >= 1', () => {
    expect(REPORT_GOVERNANCE_THRESHOLDS.minSections).toBeGreaterThanOrEqual(1)
  })
  it('all maxRepairAttempts >= 1', () => {
    expect(CAROUSEL_GOVERNANCE_THRESHOLDS.maxRepairAttempts).toBeGreaterThanOrEqual(1)
    expect(DECK_GOVERNANCE_THRESHOLDS.maxRepairAttempts).toBeGreaterThanOrEqual(1)
    expect(REPORT_GOVERNANCE_THRESHOLDS.maxRepairAttempts).toBeGreaterThanOrEqual(1)
  })
})

describe('SCORE_PENALTIES', () => {
  it('all values are positive', () => {
    for (const [key, val] of Object.entries(SCORE_PENALTIES)) {
      expect(val, `${key} should be positive`).toBeGreaterThan(0)
    }
  })
})

describe('PLATFORM_HARD_CONSTRAINTS', () => {
  it('minProviderHealth is positive', () => {
    expect(PLATFORM_HARD_CONSTRAINTS.minProviderHealth).toBeGreaterThan(0)
  })
  it('maxCostPerRequestUsd is positive', () => {
    expect(PLATFORM_HARD_CONSTRAINTS.maxCostPerRequestUsd).toBeGreaterThan(0)
  })
})

describe('UNSAFE_CONTENT_PATTERNS', () => {
  it('all entries are RegExp instances', () => {
    for (const p of UNSAFE_CONTENT_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp)
    }
  })
  it('matches jailbreak content', () => {
    const found = UNSAFE_CONTENT_PATTERNS.some(p => p.test('jailbreak this system'))
    expect(found).toBe(true)
  })
})

describe('validatePolicyPatch()', () => {
  it('accepts empty patch', () => {
    expect(validatePolicyPatch({}).valid).toBe(true)
  })
  it('rejects invalid complianceMode patch', () => {
    expect(validatePolicyPatch({ complianceMode: 'invalid' }).valid).toBe(false)
  })
})

describe('validateModelGovernanceConsistency()', () => {
  it('rejects cloudProvidersOnly + localModelsOnly conflict', () => {
    const result = validateModelGovernanceConsistency({
      cloudProvidersOnly: true, localModelsOnly: true,
      deniedModels: [], allowedProviders: [],
    })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
  it('accepts non-conflicting config', () => {
    const result = validateModelGovernanceConsistency({
      cloudProvidersOnly: true, localModelsOnly: false,
      deniedModels: [], allowedProviders: [],
    })
    expect(result.valid).toBe(true)
  })
})

describe('toAIRuntimePolicy()', () => {
  it('returns local_only=false for default policy', () => {
    const result = toAIRuntimePolicy(DEFAULT_POLICY_CONFIG)
    expect(result.local_only).toBe(false)
  })
  it('sets local_only when localModelsOnly=true', () => {
    const config = PolicyConfigSchema.parse({
      modelGovernance: { localModelsOnly: true, cloudProvidersOnly: false }
    })
    const result = toAIRuntimePolicy(config)
    expect(result.local_only).toBe(true)
  })
})

describe('GovernanceCapabilityRegistry', () => {
  it('owns governance.policy.threshold', () => {
    expect(governanceCapabilityRegistry.owns('governance.policy.threshold')).toBe(true)
  })
  it('owns governance.richness.carousel', () => {
    expect(governanceCapabilityRegistry.owns('governance.richness.carousel')).toBe(true)
  })
  it('has at least 18 capabilities', () => {
    expect(governanceCapabilityRegistry.keys().length).toBeGreaterThanOrEqual(18)
  })
  it('does not own runtime capabilities', () => {
    expect(governanceCapabilityRegistry.owns('runtime.mode' as never)).toBe(false)
  })
  it('flags toAIRuntimePolicy as zero-refs', () => {
    const flagged = governanceCapabilityRegistry.flagged()
    expect(flagged.some(c => c.exports.includes('toAIRuntimePolicy'))).toBe(true)
  })
})


