/**
 * @brandos/iskill-runtime — validatePackage.ts
 *
 * Self-validation: produces a PackageHealthReport describing the current
 * state of the ISkill runtime package.
 *
 * Used by repo-intelligence, CI gate, and agentic pre-flight.
 * No side effects. Additive-only.
 */

import { skillCapabilityRegistry } from './capability/SkillCapabilityRegistry'
import { createDefaultRepairRegistry } from './repair/repair-registry'

// ─── PackageHealthReport ───────────────────────────────────────────────────────

export interface PackageHealthCheck {
  name: string
  passed: boolean
  detail: string
}

export interface PackageHealthReport {
  package: '@brandos/iskill-runtime'
  level: 'L4'
  timestamp: string
  healthy: boolean
  gated: boolean
  checks: PackageHealthCheck[]
  registeredSkillCount: number
  capabilityCount: number
  summary: string
}

// ─── Checks ───────────────────────────────────────────────────────────────────

function checkCapabilityRegistryComplete(): PackageHealthCheck {
  const count = skillCapabilityRegistry.keys().length
  const passed = count >= 10
  return {
    name: 'capability_registry_complete',
    passed,
    detail: passed
      ? `SkillCapabilityRegistry has ${count} capability entries`
      : `Only ${count} capabilities registered (expected ≥10)`,
  }
}

function checkProductionGateDocumented(): PackageHealthCheck {
  const gatedCount = skillCapabilityRegistry.gated().length
  const passed = gatedCount > 0
  return {
    name: 'production_gate_documented',
    passed,
    detail: passed
      ? `${gatedCount} capabilities correctly flagged as gated (production flag required)`
      : 'No gated capabilities found — production gate status undocumented',
  }
}

function checkRepairRegistryCreatable(): PackageHealthCheck {
  try {
    const registry = createDefaultRepairRegistry()
    // createDefaultRepairRegistry returns a RepairPromptRegistry — check it has expected structure
    const passed = typeof registry === 'object' && registry !== null
    return {
      name: 'repair_registry_creatable',
      passed,
      detail: passed
        ? 'createDefaultRepairRegistry() returns a valid RepairPromptRegistry'
        : 'createDefaultRepairRegistry() returned unexpected value',
    }
  } catch (err) {
    return {
      name: 'repair_registry_creatable',
      passed: false,
      detail: `createDefaultRepairRegistry threw: ${String(err)}`,
    }
  }
}

function checkCarouselFounderCapabilityExists(): PackageHealthCheck {
  const cap = skillCapabilityRegistry.getCapability('skill.generate.carousel')
  const passed = cap !== undefined && cap.exports.length > 0
  return {
    name: 'carousel_founder_capability_exists',
    passed,
    detail: passed
      ? `skill.generate.carousel exports: ${cap!.exports.join(', ')}`
      : 'skill.generate.carousel capability missing or has no exports',
  }
}

function checkGovernRepairCapabilityExists(): PackageHealthCheck {
  const cap = skillCapabilityRegistry.getCapability('skill.govern.repair')
  const passed = cap !== undefined && cap.exports.length > 0
  return {
    name: 'govern_repair_capability_exists',
    passed,
    detail: passed
      ? `skill.govern.repair exports: ${cap!.exports.join(', ')}`
      : 'skill.govern.repair capability missing',
  }
}

function checkPersonalizationCapabilityExists(): PackageHealthCheck {
  const cap = skillCapabilityRegistry.getCapability('skill.runtime.personalize')
  const passed = cap !== undefined && cap.exports.includes('buildPersonalizationContext')
  return {
    name: 'personalization_capability_exists',
    passed,
    detail: passed
      ? 'skill.runtime.personalize includes buildPersonalizationContext'
      : 'skill.runtime.personalize missing or buildPersonalizationContext not listed',
  }
}

function checkHealthCapabilityExists(): PackageHealthCheck {
  const cap = skillCapabilityRegistry.getCapability('skill.runtime.health')
  const passed = cap !== undefined && cap.exports.includes('computeSkillHealth')
  return {
    name: 'health_capability_exists',
    passed,
    detail: passed
      ? 'skill.runtime.health includes computeSkillHealth'
      : 'skill.runtime.health capability missing',
  }
}

function checkSkillValidateRejectsInvalidEntry(): PackageHealthCheck {
  try {
    const fakeEntry = {
      skill: { metadata: { id: '', version: 'bad', artifactType: '' } },
      lifecycle: {
        artifactContract: { artifactType: 'carousel' },
        consumedDimensions: 'not-an-array',
        validate: 'not-a-function',
        execute: 'not-a-function',
      },
      metadata: {
        id: '',
        version: 'bad',
        artifactType: '',
        consumedDimensions: 'not-an-array',
        bundleIds: [],
        fixtureValidated: false,
        lifecycleVersion: '1.0.0',
      },
      registeredAt: '',
    }
    const result = skillCapabilityRegistry.validateSkill(fakeEntry as never)
    const passed = !result.valid && result.errors.length > 0
    return {
      name: 'validate_skill_rejects_invalid',
      passed,
      detail: passed
        ? `validateSkill() correctly rejects invalid entry with ${result.errors.length} errors`
        : 'validateSkill() did not reject invalid entry',
    }
  } catch (err) {
    return {
      name: 'validate_skill_rejects_invalid',
      passed: false,
      detail: `validateSkill threw: ${String(err)}`,
    }
  }
}

// ─── validatePackage ──────────────────────────────────────────────────────────

export function validatePackage(): PackageHealthReport {
  const checks: PackageHealthCheck[] = [
    checkCapabilityRegistryComplete(),
    checkProductionGateDocumented(),
    checkRepairRegistryCreatable(),
    checkCarouselFounderCapabilityExists(),
    checkGovernRepairCapabilityExists(),
    checkPersonalizationCapabilityExists(),
    checkHealthCapabilityExists(),
    checkSkillValidateRejectsInvalidEntry(),
  ]

  const failed = checks.filter(c => !c.passed)
  const healthy = failed.length === 0

  // Check whether production gate is active
  const gated = typeof globalThis.__brandos_iskill_contract_contributor !== 'boolean'
    || globalThis.__brandos_iskill_contract_contributor === false

  return {
    package: '@brandos/iskill-runtime',
    level: 'L4',
    timestamp: new Date().toISOString(),
    healthy,
    gated,
    checks,
    registeredSkillCount: skillCapabilityRegistry.listSkills().length,
    capabilityCount: skillCapabilityRegistry.keys().length,
    summary: healthy
      ? `All ${checks.length} checks passed. Package is L4-healthy. Production gate: ${gated ? 'ACTIVE (gated)' : 'DISABLED (live)'}.`
      : `${failed.length}/${checks.length} checks failed: ${failed.map(c => c.name).join(', ')}`,
  }
}

// ─── Global type declaration for production gate ──────────────────────────────
// Fulfils Phase 0.4 from ARCHITECTURE_EVOLUTION_ROADMAP.md

declare global {
  // eslint-disable-next-line no-var
  var __brandos_iskill_contract_contributor: boolean | undefined
}


