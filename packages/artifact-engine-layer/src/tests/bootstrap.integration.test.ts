/**
 * @brandos/artifact-engine-layer — tests/bootstrap.integration.test.ts
 *
 * Integration tests for bootstrapArtifactEngine().
 *
 * STRATEGY:
 *   These tests mock @brandos/output-control-layer and @brandos/governance-layer
 *   at the module level (jest.mock) so that the real bootstrap, registry, and
 *   engine code runs — but the external compile/validate functions are controlled.
 *
 *   This validates the FULL bootstrap → compile → govern pipeline end-to-end
 *   within this package's boundaries.
 *
 * ISOLATION:
 *   Each test resets the module registry to re-run bootstrap in isolation.
 *   We use jest.resetModules() in beforeEach to get a fresh bootstrap state.
 *
 * NOTE:
 *   Because jest.mock hoisting occurs at module load time, the mocks below
 *   must be defined before any imports that use them.
 */

// ─── Module-level mocks ───────────────────────────────────────────────────────
// These mock the external OCL and governance-layer dependencies.
// The returned artifacts must have $schema set to satisfy assertCompiledArtifact().

const MOCK_CAROUSEL: any = {
  $schema:       'artifact-json@2.0',
  artifact_type: 'carousel',
  title:         'Mocked Carousel',
  semantic_theme: {
    primaryColor: '#000', accentColor: '#fff', bgColor: '#f0f',
    fontTitle: 'Inter', fontBody: 'Inter', visual_preset: 'clean', voice_archetype: 'professional',
  },
  slides: [
    { role: 'hook',    layout_hint: 'hero',    bullets: ['Hook'] },
    { role: 'content', layout_hint: 'bullets', bullets: ['A', 'B'] },
    { role: 'cta',     layout_hint: 'cta',     bullets: ['CTA'] },
  ],
}

const MOCK_DECK: any = {
  $schema:       'artifact-json@2.0',
  artifact_type: 'deck',
  title:         'Mocked Deck',
  semantic_theme: {
    primaryColor: '#111', accentColor: '#eee', bgColor: '#fff',
    fontTitle: 'Roboto', fontBody: 'Roboto', visual_preset: 'bold', voice_archetype: 'authoritative',
  },
  slides: [
    { type: 'title',   title: 'Title Slide',   body: [] },
    { type: 'content', title: 'Content Slide', body: ['Point'] },
  ],
}

const MOCK_REPORT: any = {
  $schema:       'artifact-json@2.0',
  artifact_type: 'report',
  title:         'Mocked Report',
  semantic_theme: {
    primaryColor: '#222', accentColor: '#ddd', bgColor: '#fafafa',
    fontTitle: 'Georgia', fontBody: 'Georgia', visual_preset: 'editorial', voice_archetype: 'analytical',
  },
  sections: [
    { id: 'intro', heading: 'Introduction', content: 'Intro text.' },
    { id: 'body',  heading: 'Body',         content: 'Body text.'  },
  ],
}

jest.mock('@brandos/output-control-layer', () => ({
  compileCarouselArtifact: jest.fn().mockReturnValue({ artifact: MOCK_CAROUSEL, durationMs: 5 }),
  compileDeckArtifact:     jest.fn().mockReturnValue({ artifact: MOCK_DECK,     durationMs: 5 }),
  compileReportArtifact:   jest.fn().mockReturnValue({ artifact: MOCK_REPORT,   durationMs: 5 }),
  // L5 FIX: bootstrap.ts reads ARTIFACT_TASK_PROMPTS from OCL; mock must include it
  ARTIFACT_TASK_PROMPTS: {
    generate_carousel: 'mock carousel prompt',
    generate_deck:     'mock deck prompt',
    generate_report:   'mock report prompt',
  },
}))

jest.mock('@brandos/governance-layer', () => ({
  validateCarouselArtifact:       jest.fn().mockReturnValue({ valid: true }),
  validateDeckArtifact:           jest.fn().mockReturnValue({ valid: true }),
  validateReportArtifact:         jest.fn().mockReturnValue({ valid: true }),
  runCarouselSemanticGovernance:  jest.fn(),
  runDeckSemanticGovernance:      jest.fn(),
  runReportSemanticGovernance:    jest.fn(),
}))

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  bootstrapArtifactEngine,
  globalArtifactEngine,
} from '../bootstrap'
import { globalArtifactRegistry } from '../registry'
import type { IArtifactExecutionContext } from '../interfaces'
import type { SkillContext } from '@brandos/contracts'

function makeMockContext(): IArtifactExecutionContext {
  return {
    requestId:   'bootstrap-test-req-001',
    userId:      'user-bootstrap-test',
    workspaceId: 'workspace-bootstrap-test',
    runtimeMode: 'test',
    skillContext: {
      requestId: 'bootstrap-test-req-001',
      granted_permissions: [],
    } as SkillContext,
  }
}

// ─── Bootstrap registration tests ─────────────────────────────────────────────

describe('bootstrapArtifactEngine()', () => {
  it('registers carousel, deck, and report after bootstrap', () => {
    bootstrapArtifactEngine()
    const types = globalArtifactRegistry.listArtifactTypes()

    expect(types).toContain('carousel')
    expect(types).toContain('deck')
    expect(types).toContain('report')
  })

  it('marks carousel, deck, and report as fully registered (compiler + governance)', () => {
    bootstrapArtifactEngine()

    expect(globalArtifactRegistry.isFullyRegistered('carousel')).toBe(true)
    expect(globalArtifactRegistry.isFullyRegistered('deck')).toBe(true)
    expect(globalArtifactRegistry.isFullyRegistered('report')).toBe(true)
  })

  it('is idempotent — calling bootstrap twice does not throw', () => {
    expect(() => {
      bootstrapArtifactEngine()
      bootstrapArtifactEngine() // second call should be a no-op
    }).not.toThrow()
  })
})

// ─── End-to-end pipeline tests ────────────────────────────────────────────────

describe('globalArtifactEngine — end-to-end pipeline', () => {
  beforeAll(() => {
    bootstrapArtifactEngine()
  })

  it('compiles a carousel artifact via globalArtifactEngine', async () => {
    const result = await globalArtifactEngine.compile(
      'carousel',
      JSON.stringify(MOCK_CAROUSEL),
      { topic: 'AI integration', requestId: 'test-req-001' }
    )

    expect(result.artifact.$schema).toBe('artifact-json@2.0')
    expect(result.artifact.artifact_type).toBe('carousel')
    expect(result.artifact.title).toBe('Mocked Carousel')
  })

  it('compileAndGovern succeeds for carousel with mocked passing governance', async () => {
    const ctx = makeMockContext()
    const { artifact, governanceResult } = await globalArtifactEngine.compileAndGovern(
      'carousel',
      JSON.stringify(MOCK_CAROUSEL),
      ctx
    )

    expect(artifact.$schema).toBe('artifact-json@2.0')
    expect(governanceResult.success).toBe(true)
    expect(governanceResult.repaired).toBe(false)
  })

  it('compiles a deck artifact', async () => {
    const result = await globalArtifactEngine.compile(
      'deck',
      JSON.stringify(MOCK_DECK),
      { topic: 'Business Strategy' }
    )

    expect(result.artifact.artifact_type).toBe('deck')
    expect(result.artifact.$schema).toBe('artifact-json@2.0')
  })

  it('compiles a report artifact', async () => {
    const result = await globalArtifactEngine.compile(
      'report',
      JSON.stringify(MOCK_REPORT),
      { topic: 'Market Analysis' }
    )

    expect(result.artifact.artifact_type).toBe('report')
    expect(result.artifact.$schema).toBe('artifact-json@2.0')
  })

  it('govern passes when governance-layer returns valid=true', async () => {
    const ctx    = makeMockContext()
    const result = await globalArtifactEngine.govern(MOCK_CAROUSEL, ctx)

    expect(result.success).toBe(true)
    expect(result.attempts).toBe(0)
    expect(result.repaired).toBe(false)
  })

  it('availableFormats returns the expected format list', () => {
    const formats = globalArtifactEngine.availableFormats()
    expect(formats).toContain('json')
    expect(formats).toContain('pdf')
    expect(formats).toContain('pptx')
  })
})


