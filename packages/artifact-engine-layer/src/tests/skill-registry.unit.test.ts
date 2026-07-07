/**
 * @brandos/artifact-engine-layer — tests/skill-registry.unit.test.ts
 *
 * Unit tests for PlatformPluginRegistry.
 *
 * STRATEGY:
 *   Mock ISkill implementations with inline objects. No live services.
 *   Each test creates a fresh PlatformPluginRegistry instance.
 */

import { PlatformPluginRegistry } from '../skill-registry'
import type { ISkill, SkillContext, WorkflowDefinition } from '@brandos/contracts'

// ─── Mock factories ────────────────────────────────────────────────────────────

function makeMockContext(permissions: string[] = []): SkillContext {
  return {
    requestId: 'req-test-001',
    granted_permissions: permissions,
  } as SkillContext
}

function makeMockSkill(
  id: string,
  requiredPermissions: string[] = [],
  returnValue: unknown = { done: true }
): ISkill {
  return {
    metadata: {
      id,
      version: '1.0.0',
      name: `Mock Skill: ${id}`,
      description: 'Test skill',
      permissions: requiredPermissions,
    },
    execute: jest.fn().mockResolvedValue(returnValue),
  } as unknown as ISkill
}

function makeMockWorkflow(id: string): WorkflowDefinition {
  return { id, name: `Workflow ${id}`, steps: [] } as unknown as WorkflowDefinition
}

// ─── registerSkill + getSkill ──────────────────────────────────────────────────

describe('PlatformPluginRegistry — registerSkill / getSkill', () => {
  it('returns a registered skill by ID', () => {
    const registry = new PlatformPluginRegistry()
    const skill    = makeMockSkill('output.generate')
    registry.registerSkill(skill)

    expect(registry.getSkill('output.generate')).toBe(skill)
  })

  it('returns undefined for an unregistered skill ID', () => {
    const registry = new PlatformPluginRegistry()
    expect(registry.getSkill('unknown.skill')).toBeUndefined()
  })

  it('replaces an existing skill on duplicate registration (warn + replace)', () => {
    const registry = new PlatformPluginRegistry()
    const skill1   = makeMockSkill('my.skill')
    const skill2   = makeMockSkill('my.skill')
    registry.registerSkill(skill1)
    registry.registerSkill(skill2)

    expect(registry.getSkill('my.skill')).toBe(skill2)
  })

  it('supports fluent chaining on registerSkill', () => {
    const registry = new PlatformPluginRegistry()
    const result   = registry.registerSkill(makeMockSkill('skill.a'))
    expect(result).toBe(registry)
  })
})

// ─── listSkills ────────────────────────────────────────────────────────────────

describe('PlatformPluginRegistry — listSkills', () => {
  it('returns metadata for all registered skills', () => {
    const registry = new PlatformPluginRegistry()
    registry.registerSkill(makeMockSkill('skill.a'))
    registry.registerSkill(makeMockSkill('skill.b'))

    const metadataList = registry.listSkills()
    expect(metadataList.map(m => m.id)).toContain('skill.a')
    expect(metadataList.map(m => m.id)).toContain('skill.b')
    expect(metadataList.length).toBe(2)
  })

  it('returns empty array when no skills are registered', () => {
    const registry = new PlatformPluginRegistry()
    expect(registry.listSkills()).toHaveLength(0)
  })
})

// ─── registerWorkflow + listWorkflows ─────────────────────────────────────────

describe('PlatformPluginRegistry — workflows', () => {
  it('lists registered workflows', () => {
    const registry = new PlatformPluginRegistry()
    registry.registerWorkflow(makeMockWorkflow('workflow.alpha'))
    registry.registerWorkflow(makeMockWorkflow('workflow.beta'))

    const workflows = registry.listWorkflows()
    expect(workflows.map(w => w.id)).toContain('workflow.alpha')
    expect(workflows.map(w => w.id)).toContain('workflow.beta')
  })

  it('returns empty array when no workflows are registered', () => {
    const registry = new PlatformPluginRegistry()
    expect(registry.listWorkflows()).toHaveLength(0)
  })
})

// ─── executeSkill ─────────────────────────────────────────────────────────────

describe('PlatformPluginRegistry — executeSkill', () => {
  it('executes a skill and returns its result', async () => {
    const registry = new PlatformPluginRegistry()
    const skill    = makeMockSkill('output.generate', [], { generated: true })
    registry.registerSkill(skill)

    const result = await registry.executeSkill('output.generate', { topic: 'AI' }, makeMockContext())

    expect(result).toEqual({ generated: true })
    expect(skill.execute).toHaveBeenCalledTimes(1)
  })

  it('throws if skill is not registered', async () => {
    const registry = new PlatformPluginRegistry()

    await expect(
      registry.executeSkill('nonexistent.skill', {}, makeMockContext())
    ).rejects.toThrow(/Skill "nonexistent.skill" not found/)
  })

  it('throws if required permissions are not granted', async () => {
    const registry = new PlatformPluginRegistry()
    const skill    = makeMockSkill('sensitive.skill', ['admin:write', 'data:read'])
    registry.registerSkill(skill)

    await expect(
      registry.executeSkill('sensitive.skill', {}, makeMockContext(['admin:write']))
      // Only admin:write granted, data:read is missing
    ).rejects.toThrow(/data:read/)
  })

  it('executes successfully when all required permissions are granted', async () => {
    const registry = new PlatformPluginRegistry()
    const skill    = makeMockSkill('guarded.skill', ['read:data', 'write:data'])
    registry.registerSkill(skill)

    const result = await registry.executeSkill(
      'guarded.skill',
      {},
      makeMockContext(['read:data', 'write:data', 'admin:extra'])
    )

    expect(result).toEqual({ done: true })
    expect(skill.execute).toHaveBeenCalledTimes(1)
  })

  it('executes a skill with no required permissions without checking context permissions', async () => {
    const registry = new PlatformPluginRegistry()
    const skill    = makeMockSkill('open.skill', []) // no required permissions
    registry.registerSkill(skill)

    const result = await registry.executeSkill('open.skill', {}, makeMockContext([]))
    expect(result).toEqual({ done: true })
  })

  it('passes input and context to skill.execute()', async () => {
    const registry = new PlatformPluginRegistry()
    const skill    = makeMockSkill('passthrough.skill')
    registry.registerSkill(skill)
    const ctx   = makeMockContext(['some:permission'])
    const input = { topic: 'test-topic', tone: 'bold' }

    await registry.executeSkill('passthrough.skill', input, ctx)

    expect(skill.execute).toHaveBeenCalledWith(input, ctx)
  })
})


