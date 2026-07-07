/**
 * @brandos/iskill-runtime — __tests__/registry.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SkillRegistry } from '../registry/skill-registry'
import { BundleRegistry } from '../registry/bundle-registry'
import type { ISkill } from '@brandos/contracts'
import type { ISkillLifecycle, IBundleDefinition } from '../contracts'

// ─── Minimal mock skill ───────────────────────────────────────────────────────

function makeSkill(id: string, version = '1.0.0'): ISkill {
  return {
    metadata: {
      id,
      name: `${id} skill`,
      version,
      category: 'content' as any,
      description: 'test',
      inputType: 'unknown',
      outputType: 'unknown',
    },
    execute: async () => ({ success: true, skillId: id, durationMs: 0 }),
  }
}

function makeLifecycle(): ISkillLifecycle {
  return {
    artifactContract: { artifactType: 'carousel', supportedFormats: [] },
    consumedDimensions: ['hookStyle'],
    validate: () => ({ valid: true, errors: [] }),
    prepare: async (input, ctx) => ({
      skillId: 'test', requestId: ctx.requestId, input,
      prompt: 'test prompt', personalizationSnapshot: {} as any,
      topic: 'test', artifactType: 'carousel', planMetadata: {}, builtAt: '',
    }),
    execute: async () => ({
      artifact: { $schema: 'artifact-json@2.0', artifact_type: 'carousel' } as any,
      rawLLMOutput: '', durationMs: 0, compileDurationMs: 0,
    }),
  }
}

// ─── SkillRegistry tests ──────────────────────────────────────────────────────

describe('SkillRegistry', () => {
  let registry: SkillRegistry

  beforeEach(() => { registry = new SkillRegistry() })

  it('registers a skill and returns the entry', () => {
    const skill = makeSkill('test-skill')
    const lifecycle = makeLifecycle()
    const entry = registry.register(skill, lifecycle)
    expect(entry.metadata.id).toBe('test-skill')
    expect(entry.metadata.artifactType).toBe('carousel')
    expect(entry.metadata.consumedDimensions).toContain('hookStyle')
  })

  it('retrieves a registered skill', () => {
    registry.register(makeSkill('s1'), makeLifecycle())
    expect(registry.get('s1')).toBeDefined()
    expect(registry.has('s1')).toBe(true)
  })

  it('returns undefined for unregistered skill', () => {
    expect(registry.get('nope')).toBeUndefined()
    expect(registry.has('nope')).toBe(false)
  })

  it('lists registered skills', () => {
    registry.register(makeSkill('s1'), makeLifecycle())
    registry.register(makeSkill('s2'), makeLifecycle())
    const list = registry.list()
    expect(list).toHaveLength(2)
    expect(list.map(m => m.id)).toContain('s1')
    expect(list.map(m => m.id)).toContain('s2')
  })

  it('associates bundle with skill', () => {
    registry.register(makeSkill('s1'), makeLifecycle())
    registry.associateBundle('s1', 'bundle-1')
    const entry = registry.get('s1')!
    expect(entry.metadata.bundleIds).toContain('bundle-1')
  })

  it('does not duplicate bundle associations', () => {
    registry.register(makeSkill('s1'), makeLifecycle())
    registry.associateBundle('s1', 'bundle-1')
    registry.associateBundle('s1', 'bundle-1')
    expect(registry.get('s1')!.metadata.bundleIds).toHaveLength(1)
  })

  it('marks skill as fixture-validated', () => {
    registry.register(makeSkill('s1'), makeLifecycle())
    expect(registry.get('s1')!.metadata.fixtureValidated).toBe(false)
    registry.markFixtureValidated('s1')
    expect(registry.get('s1')!.metadata.fixtureValidated).toBe(true)
  })

  it('checks version compatibility', () => {
    registry.register(makeSkill('s1', '2.1.0'), makeLifecycle())
    expect(registry.checkCompatibility('s1', '2.0.0')).toBe(true)
    expect(registry.checkCompatibility('s1', '2.1.0')).toBe(true)
    expect(registry.checkCompatibility('s1', '2.2.0')).toBe(false)
    expect(registry.checkCompatibility('s1', '3.0.0')).toBe(false)
  })
})

// ─── BundleRegistry tests ─────────────────────────────────────────────────────

describe('BundleRegistry', () => {
  let skillRegistry: SkillRegistry
  let bundleRegistry: BundleRegistry

  const bundle: IBundleDefinition = {
    id: 'test-bundle',
    name: 'Test Bundle',
    icp: 'Test ICP',
    skillIds: ['s1', 's2'],
    version: '1.0.0',
    active: true,
    source: 'static',
    registeredAt: new Date().toISOString(),
  }

  beforeEach(() => {
    skillRegistry = new SkillRegistry()
    bundleRegistry = new BundleRegistry(skillRegistry)
  })

  it('registers a bundle', () => {
    bundleRegistry.register(bundle)
    expect(bundleRegistry.has('test-bundle')).toBe(true)
    expect(bundleRegistry.get('test-bundle')?.name).toBe('Test Bundle')
  })

  it('associates skills with bundle on registration', () => {
    skillRegistry.register(makeSkill('s1'), makeLifecycle())
    bundleRegistry.register(bundle)
    expect(skillRegistry.get('s1')!.metadata.bundleIds).toContain('test-bundle')
  })

  it('resolves capabilities including missing skills', () => {
    skillRegistry.register(makeSkill('s1'), makeLifecycle())
    // s2 is NOT registered
    bundleRegistry.register(bundle)
    const caps = bundleRegistry.resolveCapabilities('test-bundle')
    expect(caps.availableSkills).toHaveLength(1)
    expect(caps.missingSkills).toContain('s2')
  })

  it('throws when resolving capabilities for unknown bundle', () => {
    expect(() => bundleRegistry.resolveCapabilities('nope')).toThrow()
  })

  it('lists only active bundles', () => {
    bundleRegistry.register(bundle)
    bundleRegistry.register({ ...bundle, id: 'inactive', active: false })
    expect(bundleRegistry.listActive()).toHaveLength(1)
    expect(bundleRegistry.listActive()[0]?.id).toBe('test-bundle')
  })
})


