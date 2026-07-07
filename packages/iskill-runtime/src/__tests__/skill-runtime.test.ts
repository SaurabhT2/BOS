/**
 * @brandos/iskill-runtime — __tests__/skill-runtime.test.ts
 *
 * Integration tests for the full SkillRuntime execution path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SkillRuntime } from '../runtime/skill-runtime'
import { CarouselFounderSkillDef, CarouselFounderLifecycle } from '../skills/carousel-founder'
import { buildPersonalizationContext } from '../personalization/context'
import { createTestOnlyGovernanceBridge } from '../governance/bridge'
import {
  bootstrapSkillRuntime,
  getGlobalSkillRuntime,
  _resetSkillRuntime,
  AI_FOUNDER_GTM_BUNDLE,
} from '../bootstrap'
import type { CarouselArtifact } from '@brandos/contracts'
import type { ISkillExecutionContext } from '../contracts'

// ─── Minimal compiled carousel artifact factory ────────────────────────────────

function makeCompiledCarousel(topic: string): CarouselArtifact {
  const now = new Date().toISOString()
  return {
    $schema: 'artifact-json@2.0',
    artifact_type: 'carousel',
    id: 'test-artifact-id',
    title: topic,
    summary: `A carousel about ${topic}`,
    hook: 'Hook text',
    cta: 'Follow for more',
    semantic_theme: {
      primary: '#000000',
      accent: '#ffffff',
      background: '#ffffff',
      font_family: 'Inter',
    } as any,
    audience: { role: 'Founder' } as any,
    narrative_arc: { opening: 'hook', progression: 'linear', resolution: 'cta' } as any,
    richness_metrics: {
      overall: 0.75, hooks: 0.8, evidence: 0.7, cta: 0.75, visual_direction: 0.6,
    } as any,
    generation_trace: {
      generated_at: now,
      ocl_strategy: 'json-parse',
      governance_outcome: 'passed',
      repair_attempts: 0,
      input_type: 'json',
    } as any,
    export_metadata: { available_formats: ['json', 'pptx'] } as any,
    created_at: now,
    carousel_meta: {
      topic,
      slide_count: 1,
      tone: 'professional',
    } as any,
    slides: [
      { id: 's1', role: 'hook', headline: 'Hook headline', body: 'Hook body', sequence_index: 0 } as any,
    ],
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(runtime: SkillRuntime, extras?: Partial<ISkillExecutionContext>): ISkillExecutionContext {
  const personalization = buildPersonalizationContext('ws-test', [])
  return {
    requestId: 'req-test-123',
    userId: 'user-test',
    workspaceId: 'ws-test',
    runtimeMode: 'cloud',
    personalization,
    metadata: {
      compileCarousel: (_raw: string, topic: string) => makeCompiledCarousel(topic),
    },
    builtAt: new Date().toISOString(),
    ...extras,
  }
}

function makeLLM(): (prompt: string) => Promise<string> {
  return vi.fn().mockResolvedValue(JSON.stringify({
    slides: [{ role: 'hook', headline: 'Mock headline', body: 'Mock body' }],
    topic: 'test topic',
    tone: 'professional',
  }))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SkillRuntime', () => {
  let runtime: SkillRuntime

  beforeEach(() => {
    runtime = new SkillRuntime(createTestOnlyGovernanceBridge())
    runtime.registerSkill(CarouselFounderSkillDef as any, new CarouselFounderLifecycle())
  })

  describe('registration', () => {
    it('lists registered skills', () => {
      const skills = runtime.listSkills()
      expect(skills).toHaveLength(1)
      expect(skills[0]?.id).toBe('carousel-founder')
    })

    it('getSkillMetadata returns metadata for registered skill', () => {
      const meta = runtime.getSkillMetadata('carousel-founder')
      expect(meta?.artifactType).toBe('carousel')
      expect(meta?.consumedDimensions).toContain('hookStyle')
    })

    it('returns undefined for unknown skill', () => {
      expect(runtime.getSkillMetadata('unknown')).toBeUndefined()
    })
  })

  describe('bundle registration', () => {
    it('registers a bundle and resolves capabilities', () => {
      runtime.registerBundle(AI_FOUNDER_GTM_BUNDLE)
      const caps = runtime.resolveBundleCapabilities('ai-founder-gtm')
      expect(caps.bundleId).toBe('ai-founder-gtm')
      expect(caps.availableSkills.map(s => s.id)).toContain('carousel-founder')
    })

    it('throws when resolving capabilities for unknown bundle', () => {
      expect(() => runtime.resolveBundleCapabilities('nope')).toThrow()
    })
  })

  describe('executeSkill', () => {
    it('returns SKILL_NOT_FOUND error for unregistered skill', async () => {
      const ctx = makeContext(runtime)
      const output = await runtime.executeSkill('nope', {}, ctx)
      expect(output.success).toBe(false)
      expect(output.error?.code).toBe('SKILL_NOT_FOUND')
    })

    it('returns VALIDATION_FAILED error for invalid input', async () => {
      const ctx = makeContext(runtime)
      const output = await runtime.executeSkill('carousel-founder', { topic: '' }, ctx)
      expect(output.success).toBe(false)
      expect(output.error?.code).toBe('VALIDATION_FAILED')
    })

    it('executes successfully with valid input and passthrough governance', async () => {
      const ctx = makeContext(runtime)
      const output = await runtime.executeSkill(
        'carousel-founder',
        { topic: 'Why B2B founders fail at content' },
        ctx,
        makeLLM(),
      )
      expect(output.success).toBe(true)
      expect(output.artifact).toBeDefined()
      expect(output.artifact?.artifact_type).toBe('carousel')
    })

    it('includes lifecycle durations in output', async () => {
      const ctx = makeContext(runtime)
      const output = await runtime.executeSkill(
        'carousel-founder',
        { topic: 'The GTM playbook' },
        ctx,
        makeLLM(),
      )
      expect(output.lifecycleDurations).toBeDefined()
      expect(output.lifecycleDurations.validateMs).toBeGreaterThanOrEqual(0)
      expect(output.lifecycleDurations.prepareMs).toBeGreaterThanOrEqual(0)
    })

    it('includes personalization snapshot in output', async () => {
      const ctx = makeContext(runtime)
      const output = await runtime.executeSkill(
        'carousel-founder',
        { topic: 'Content strategy for founders' },
        ctx,
        makeLLM(),
      )
      expect(output.personalizationSnapshot.workspaceId).toBe('ws-test')
    })
  })

  describe('buildExecutionContext', () => {
    it('builds a valid execution context', async () => {
      const personalization = buildPersonalizationContext('ws-abc', [])
      const ctx = await runtime.buildExecutionContext({
        requestId: 'req-abc',
        userId: 'user-abc',
        workspaceId: 'ws-abc',
        runtimeMode: 'cloud',
        personalization,
      })
      expect(ctx.requestId).toBe('req-abc')
      expect(ctx.workspaceId).toBe('ws-abc')
      expect(ctx.builtAt).toBeDefined()
    })

    it('merges bundle governance overrides', async () => {
      runtime.registerBundle(AI_FOUNDER_GTM_BUNDLE)
      const personalization = buildPersonalizationContext('ws-abc', [])
      const ctx = await runtime.buildExecutionContext({
        requestId: 'req-abc',
        userId: 'user-abc',
        workspaceId: 'ws-abc',
        runtimeMode: 'cloud',
        personalization,
        bundleId: 'ai-founder-gtm',
      })
      expect(ctx.governanceOverrides?.minRichnessScore).toBe(0.65)
    })

    it('caller overrides win over bundle defaults', async () => {
      runtime.registerBundle(AI_FOUNDER_GTM_BUNDLE)
      const personalization = buildPersonalizationContext('ws-abc', [])
      const ctx = await runtime.buildExecutionContext({
        requestId: 'req-abc',
        userId: 'user-abc',
        workspaceId: 'ws-abc',
        runtimeMode: 'cloud',
        personalization,
        bundleId: 'ai-founder-gtm',
        governanceOverrides: { minRichnessScore: 0.90 },  // caller override
      })
      expect(ctx.governanceOverrides?.minRichnessScore).toBe(0.90)
    })
  })

  describe('versioning', () => {
    it('returns skill version', () => {
      expect(runtime.getSkillVersion('carousel-founder')).toBe('1.0.0')
    })

    it('checks compatibility correctly', () => {
      expect(runtime.checkCompatibility('carousel-founder', '1.0.0')).toBe(true)
      expect(runtime.checkCompatibility('carousel-founder', '0.9.0')).toBe(true)
      expect(runtime.checkCompatibility('carousel-founder', '2.0.0')).toBe(false)
    })
  })
})

// ─── Bootstrap tests ──────────────────────────────────────────────────────────

describe('bootstrapSkillRuntime', () => {
  beforeEach(() => {
    _resetSkillRuntime()
  })

  it('bootstraps and returns runtime', () => {
    const rt = bootstrapSkillRuntime({
      governanceCaller: createTestOnlyGovernanceBridge(),
    })
    // CarouselFounderSkillDef + LinkedInPostSkillDef are both registered at bootstrap
    expect(rt.listSkills()).toHaveLength(2)
    expect(rt.listBundles()).toHaveLength(1)
  })

  it('getGlobalSkillRuntime throws before bootstrap', () => {
    expect(() => getGlobalSkillRuntime()).toThrow()
  })

  it('getGlobalSkillRuntime returns runtime after bootstrap', () => {
    bootstrapSkillRuntime({ governanceCaller: createTestOnlyGovernanceBridge() })
    expect(getGlobalSkillRuntime()).toBeDefined()
  })

  it('calling bootstrap twice skips second call', () => {
    const rt1 = bootstrapSkillRuntime({ governanceCaller: createTestOnlyGovernanceBridge() })
    const rt2 = bootstrapSkillRuntime({ governanceCaller: createTestOnlyGovernanceBridge() })
    expect(rt1).toBe(rt2)
  })
})

// ─── CarouselFounderLifecycle unit tests ──────────────────────────────────────

describe('CarouselFounderLifecycle', () => {
  const lifecycle = new CarouselFounderLifecycle()

  describe('validate', () => {
    it('passes valid input', () => {
      const result = lifecycle.validate({ topic: 'B2B GTM strategy' })
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('fails empty topic', () => {
      const result = lifecycle.validate({ topic: '' })
      expect(result.valid).toBe(false)
      expect(result.errors[0]?.field).toBe('topic')
    })

    it('fails missing topic', () => {
      const result = lifecycle.validate({} as any)
      expect(result.valid).toBe(false)
    })

    it('fails topic under 5 chars', () => {
      const result = lifecycle.validate({ topic: 'ai' })
      expect(result.valid).toBe(false)
      expect(result.errors[0]?.code).toBe('TOO_SHORT')
    })

    it('fails slideCount out of range', () => {
      const result = lifecycle.validate({ topic: 'valid topic', slideCount: 20 })
      expect(result.valid).toBe(false)
      expect(result.errors[0]?.field).toBe('slideCount')
    })
  })

  describe('prepare', () => {
    it('builds execution plan with personalization', async () => {
      const personalization = buildPersonalizationContext('ws-1', [
        { type: 'hook_style', content: 'bold claim', status: 'active', createdAt: new Date().toISOString(), weight: 0.9 },
      ])
      const ctx: ISkillExecutionContext = {
        requestId: 'req-1',
        userId: 'u1',
        workspaceId: 'ws-1',
        runtimeMode: 'cloud',
        personalization,
        metadata: {},
        builtAt: new Date().toISOString(),
      }
      const plan = await lifecycle.prepare({ topic: 'Why content wins' }, ctx)
      expect(plan.prompt).toContain('Why content wins')
      expect(plan.artifactType).toBe('carousel')
      expect(plan.skillId).toBe('carousel-founder')
    })
  })
})


