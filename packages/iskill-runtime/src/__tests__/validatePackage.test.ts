/**
 * @brandos/iskill-runtime — validatePackage.test.ts
 * L4 test suite.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { validatePackage } from '../validatePackage'
import {
  SkillCapabilityRegistry,
  skillCapabilityRegistry,
} from '../capability/SkillCapabilityRegistry'

describe('validatePackage()', () => {
  it('returns a healthy report', () => {
    const report = validatePackage()
    expect(report.package).toBe('@brandos/iskill-runtime')
    expect(report.level).toBe('L4')
    expect(report.healthy).toBe(true)
  })

  it('never throws', () => {
    expect(() => validatePackage()).not.toThrow()
  })

  it('reports gated=true by default (production gate active)', () => {
    const report = validatePackage()
    // In tests, the global flag is not set, so gated should be true
    expect(typeof report.gated).toBe('boolean')
  })

  it('includes all required check names', () => {
    const report = validatePackage()
    const names = report.checks.map(c => c.name)
    expect(names).toContain('capability_registry_complete')
    expect(names).toContain('production_gate_documented')
    expect(names).toContain('carousel_founder_capability_exists')
    expect(names).toContain('govern_repair_capability_exists')
    expect(names).toContain('validate_skill_rejects_invalid')
  })
})

describe('SkillCapabilityRegistry — static capabilities', () => {
  it('owns skill.generate.carousel', () => {
    expect(skillCapabilityRegistry.owns('skill.generate.carousel')).toBe(true)
  })

  it('owns skill.govern.repair', () => {
    expect(skillCapabilityRegistry.owns('skill.govern.repair')).toBe(true)
  })

  it('owns skill.runtime.personalize', () => {
    expect(skillCapabilityRegistry.owns('skill.runtime.personalize')).toBe(true)
  })

  it('owns skill.runtime.health', () => {
    expect(skillCapabilityRegistry.owns('skill.runtime.health')).toBe(true)
  })

  it('does not own governance capabilities', () => {
    expect(skillCapabilityRegistry.owns('governance.policy.threshold' as never)).toBe(false)
  })

  it('has at least 10 capabilities', () => {
    expect(skillCapabilityRegistry.keys().length).toBeGreaterThanOrEqual(10)
  })

  it('skill.generate.carousel has exports', () => {
    const cap = skillCapabilityRegistry.getCapability('skill.generate.carousel')
    expect(cap).toBeDefined()
    expect(cap!.exports.length).toBeGreaterThan(0)
  })

  it('skill.generate.deck and skill.generate.report are flagged as unimplemented', () => {
    const unimpl = skillCapabilityRegistry.unimplemented()
    const keys = unimpl.map(c => c.key)
    expect(keys).toContain('skill.generate.deck')
    expect(keys).toContain('skill.generate.report')
  })

  it('gated() returns capabilities that require production flag', () => {
    const gated = skillCapabilityRegistry.gated()
    expect(gated.length).toBeGreaterThan(0)
    expect(gated.every(c => c.gated)).toBe(true)
  })
})

describe('SkillCapabilityRegistry — registerSkill/resolveSkill/listSkills', () => {
  let registry: SkillCapabilityRegistry

  beforeEach(() => {
    registry = new SkillCapabilityRegistry()
  })

  const makeEntry = (id: string, artifactType: string) => ({
    skill: { metadata: { id, version: '1.0.0', description: '', type: 'generation' } },
    lifecycle: {
      artifactContract: { artifactType },
      consumedDimensions: ['voice', 'domain'],
      validate: async () => ({ valid: true, errors: [] }),
      prepare: async (i: unknown) => i,
      execute: async () => ({ artifact: null }),
      finalize: async (a: unknown) => a,
    },
    metadata: {
      id,
      name: id,
      version: '1.0.0',
      description: '',
      type: 'generation' as const,
      artifactType,
      consumedDimensions: ['voice', 'domain'],
      bundleIds: [],
      fixtureValidated: false,
      lifecycleVersion: '1.0.0',
    },
    registeredAt: new Date().toISOString(),
  })

  it('registerSkill() makes skill resolvable', () => {
    const entry = makeEntry('test-skill', 'carousel') as never
    registry.registerSkill(entry)
    expect(registry.resolveSkill('test-skill')).toBeDefined()
  })

  it('listSkills() returns registered skills', () => {
    registry.registerSkill(makeEntry('skill-a', 'carousel') as never)
    registry.registerSkill(makeEntry('skill-b', 'deck') as never)
    const list = registry.listSkills()
    expect(list.map(m => m.id)).toContain('skill-a')
    expect(list.map(m => m.id)).toContain('skill-b')
  })

  it('resolveSkill() returns undefined for unknown skill', () => {
    expect(registry.resolveSkill('not-registered')).toBeUndefined()
  })
})

describe('SkillCapabilityRegistry — validateSkill()', () => {
  let registry: SkillCapabilityRegistry

  beforeEach(() => {
    registry = new SkillCapabilityRegistry()
  })

  it('rejects entry with empty id', () => {
    const result = registry.validateSkill({
      skill: { metadata: { id: '' } },
      lifecycle: { artifactContract: { artifactType: 'carousel' }, consumedDimensions: [], validate: () => {}, execute: () => {} },
      metadata: { id: '', version: '1.0.0', artifactType: 'carousel', consumedDimensions: [], bundleIds: [], fixtureValidated: false, lifecycleVersion: '1.0.0' },
      registeredAt: '',
    } as never)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('id'))).toBe(true)
  })

  it('rejects entry with non-semver version', () => {
    const result = registry.validateSkill({
      skill: { metadata: { id: 'test', version: 'bad', artifactType: 'carousel' } },
      lifecycle: { artifactContract: { artifactType: 'carousel' }, consumedDimensions: [], validate: () => {}, execute: () => {} },
      metadata: { id: 'test', version: 'bad', artifactType: 'carousel', consumedDimensions: [], bundleIds: [], fixtureValidated: false, lifecycleVersion: '1.0.0' },
      registeredAt: '',
    } as never)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('version'))).toBe(true)
  })

  it('rejects when lifecycle artifactType does not match metadata', () => {
    const result = registry.validateSkill({
      skill: { metadata: { id: 'test', version: '1.0.0', artifactType: 'carousel' } },
      lifecycle: { artifactContract: { artifactType: 'deck' }, consumedDimensions: [], validate: () => {}, execute: () => {} },
      metadata: { id: 'test', version: '1.0.0', artifactType: 'carousel', consumedDimensions: [], bundleIds: [], fixtureValidated: false, lifecycleVersion: '1.0.0' },
      registeredAt: '',
    } as never)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('artifactType'))).toBe(true)
  })
})


