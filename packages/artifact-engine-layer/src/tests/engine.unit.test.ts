/**
 * @brandos/artifact-engine-layer — tests/engine.unit.test.ts
 *
 * Unit tests for ArtifactEngine.
 *
 * STRATEGY:
 *   All external dependencies (@brandos/output-control-layer, @brandos/governance-layer)
 *   are replaced with inline mock implementations. No live LLM, no live DB.
 *   The ArtifactEngine and ArtifactRegistry are tested with their real implementations.
 *
 * TEST ISOLATION:
 *   Each test creates a fresh ArtifactRegistry and ArtifactEngine instance.
 *   No shared state between tests. globalArtifactRegistry is NOT used here.
 *
 * MOCK ARTIFACT FACTORY:
 *   makeMockCarousel() builds a minimal valid CarouselArtifact with $schema set.
 *   This satisfies assertCompiledArtifact() in the engine.
 */

import { ArtifactEngine }    from '../engine'
import { ArtifactRegistry }  from '../registry'
import {
  ArtifactEngineRejection,
  isArtifactEngineRejection,
} from '../interfaces'
import type {
  ICompiler,
  IGovernanceAdapter,
  IArtifactExecutionContext,
} from '../interfaces'
import type {
  ArtifactV2,
  CarouselArtifact,
  IGovernanceResult,
  CompileResult,
  SkillContext,
} from '@brandos/contracts'

// ─── Shared mock factories ─────────────────────────────────────────────────────

/**
 * Build a minimal CarouselArtifact that satisfies assertCompiledArtifact().
 * The $schema field is mandatory — without it, the engine guard throws.
 */
function makeMockCarousel(overrides: Partial<CarouselArtifact> = {}): CarouselArtifact {
  return {
    $schema:       'artifact-json@2.0',
    artifact_type: 'carousel',
    title:         'Test Carousel',
    semantic_theme: {
      primaryColor:    '#000000',
      accentColor:     '#ffffff',
      bgColor:         '#f0f0f0',
      fontTitle:       'Inter',
      fontBody:        'Inter',
      visual_preset:   'clean',
      voice_archetype: 'professional',
    },
    slides: [
      { role: 'hook',    layout_hint: 'hero',    bullets: ['Hook bullet'] },
      { role: 'content', layout_hint: 'bullets', bullets: ['Content 1', 'Content 2'] },
      { role: 'cta',     layout_hint: 'cta',     bullets: ['Call to action'] },
    ],
    ...overrides,
  } as CarouselArtifact
}

/**
 * Build an IArtifactExecutionContext for testing.
 */
function makeMockContext(overrides: Partial<IArtifactExecutionContext> = {}): IArtifactExecutionContext {
  return {
    requestId:   'test-request-id-001',
    userId:      'user-test-001',
    workspaceId: 'workspace-test-001',
    runtimeMode: 'test',
    skillContext: {
      granted_permissions: [],
      workspace_id: 'workspace-test-001',
      user_id: 'user-test-001',
    } as SkillContext,
    ...overrides,
  }
}

/**
 * Build a mock ICompiler<CarouselArtifact> that returns a fixed artifact.
 */
function makeMockCompiler(artifact: CarouselArtifact): ICompiler<CarouselArtifact> {
  return {
    artifactType: 'carousel' as const,
    compile: jest.fn().mockReturnValue({
      artifact,
      durationMs: 10,
      inputType:  'json',
      slideCount: artifact.slides.length,
    } satisfies CompileResult & { artifact: CarouselArtifact }),
  }
}

/**
 * Build a mock IGovernanceAdapter that always passes validation.
 */
function makePassingGovernanceAdapter(): IGovernanceAdapter<CarouselArtifact> {
  return {
    artifactType: 'carousel' as const,
    validate: jest.fn().mockResolvedValue({
      success:  true,
      artifact: makeMockCarousel(),
      repaired: false,
      attempts: 0,
      passed:   true,
    } satisfies IGovernanceResult<CarouselArtifact>),
  }
}

/**
 * Build a mock IGovernanceAdapter that always fails validation (no repair).
 */
function makeFailingGovernanceAdapter(reason = 'slide count too low'): IGovernanceAdapter<CarouselArtifact> {
  return {
    artifactType: 'carousel' as const,
    validate: jest.fn().mockResolvedValue({
      success:        false,
      artifact:       makeMockCarousel(),
      repaired:       false,
      attempts:       0,
      passed:         false,
      finalRejection: reason,
      violations:     [reason],
    } satisfies IGovernanceResult<CarouselArtifact>),
  }
}

// ─── Test helpers ──────────────────────────────────────────────────────────────

function makeEngine(
  compiler: ICompiler<CarouselArtifact>,
  govAdapter?: IGovernanceAdapter<CarouselArtifact>
): ArtifactEngine {
  const registry = new ArtifactRegistry()
  registry.registerCompiler(compiler)
  if (govAdapter) {
    registry.registerGovernance(govAdapter)
  }
  return new ArtifactEngine(registry)
}

// ─── compile() ────────────────────────────────────────────────────────────────

describe('ArtifactEngine.compile()', () => {
  it('resolves the compiler from the registry and returns a CompileResult', async () => {
    const artifact  = makeMockCarousel()
    const compiler  = makeMockCompiler(artifact)
    const engine    = makeEngine(compiler)

    const result = await engine.compile('carousel', '{"raw":"input"}', { topic: 'AI trends' })

    expect(result.artifact).toEqual(artifact)
    expect(result.artifact.$schema).toBe('artifact-json@2.0')
    expect(compiler.compile).toHaveBeenCalledTimes(1)
  })

  it('throws if no compiler is registered for the artifact type', async () => {
    const engine = new ArtifactEngine(new ArtifactRegistry())

    await expect(engine.compile('carousel', '{}')).rejects.toThrow(
      /No compiler registered for artifactType="carousel"/
    )
  })

  it('throws POST-COMPILE guard if the compiler returns an artifact without $schema', async () => {
    const badArtifact = { artifact_type: 'carousel', title: 'Bad' } as unknown as CarouselArtifact
    const compiler: ICompiler<CarouselArtifact> = {
      artifactType: 'carousel' as const,
      compile: jest.fn().mockReturnValue({ artifact: badArtifact, durationMs: 1, inputType: 'json' }),
    }
    const engine = makeEngine(compiler)

    await expect(engine.compile('carousel', '{}')).rejects.toThrow(/POST-COMPILE GUARD VIOLATION/)
  })

  it('forwards requestId from options into the compiler call', async () => {
    const artifact = makeMockCarousel()
    const compiler = makeMockCompiler(artifact)
    const engine   = makeEngine(compiler)

    await engine.compile('carousel', '{}', { requestId: 'my-trace-id', topic: 'test' })

    expect(compiler.compile).toHaveBeenCalledWith('{}', expect.objectContaining({
      requestId: 'my-trace-id',
      topic: 'test',
    }))
  })
})

// ─── govern() ─────────────────────────────────────────────────────────────────

describe('ArtifactEngine.govern()', () => {
  it('returns success=true when governance passes on the first attempt', async () => {
    const artifact  = makeMockCarousel()
    const compiler  = makeMockCompiler(artifact)
    const govAdapter = makePassingGovernanceAdapter()
    const engine    = makeEngine(compiler, govAdapter)
    const ctx       = makeMockContext()

    const result = await engine.govern(artifact, ctx)

    expect(result.success).toBe(true)
    expect(result.repaired).toBe(false)
    expect(result.attempts).toBe(0)
    expect(govAdapter.validate).toHaveBeenCalledTimes(1)
  })

  it('returns success=false when governance fails and no repairLLM is provided', async () => {
    const artifact   = makeMockCarousel()
    const compiler   = makeMockCompiler(artifact)
    const govAdapter = makeFailingGovernanceAdapter('not enough slides')
    const engine     = makeEngine(compiler, govAdapter)
    const ctx        = makeMockContext()

    const result = await engine.govern(artifact, ctx)

    expect(result.success).toBe(false)
    expect(result.violations).toContain('not enough slides')
    expect(result.attempts).toBe(0)
  })

  it('bypasses governance and returns success=true when no adapter is registered', async () => {
    const artifact = makeMockCarousel()
    const compiler = makeMockCompiler(artifact)
    const engine   = makeEngine(compiler) // no governance adapter registered
    const ctx      = makeMockContext()

    const result = await engine.govern(artifact, ctx)

    expect(result.success).toBe(true)
    expect(result.repaired).toBe(false)
    expect(result.attempts).toBe(0)
  })

  it('throws PRE-GOVERNANCE guard if artifact lacks $schema', async () => {
    const badArtifact = { artifact_type: 'carousel', title: 'bad' } as unknown as ArtifactV2
    const compiler    = makeMockCompiler(makeMockCarousel())
    const govAdapter  = makePassingGovernanceAdapter()
    const engine      = makeEngine(compiler, govAdapter)
    const ctx         = makeMockContext()

    await expect(engine.govern(badArtifact, ctx)).rejects.toThrow(/PRE-GOVERNANCE GUARD VIOLATION/)
  })

  it('runs repair loop up to MAX_REPAIR_ATTEMPTS (3) when validation fails and repairLLM provided', async () => {
    const artifact      = makeMockCarousel()
    const compiler      = makeMockCompiler(artifact)
    const validateMock  = jest.fn().mockResolvedValue({
      success: false, artifact, repaired: false, attempts: 0, passed: false,
      finalRejection: 'still failing', violations: ['still failing'],
    } satisfies IGovernanceResult<CarouselArtifact>)

    const repairMock = jest.fn().mockResolvedValue({
      success: false, artifact, repaired: true, attempts: 1, passed: false,
      finalRejection: 'still failing after repair',
    } satisfies IGovernanceResult<CarouselArtifact>)

    const govAdapter: IGovernanceAdapter<CarouselArtifact> = {
      artifactType: 'carousel' as const,
      validate:     validateMock,
      repair:       repairMock,
    }
    const engine     = makeEngine(compiler, govAdapter)
    const ctx        = makeMockContext()
    const repairLLM  = jest.fn().mockResolvedValue('{}')

    const result = await engine.govern(artifact, ctx, repairLLM)

    expect(result.success).toBe(false)
    // Initial validate + 3 repair attempts (each calls validate once after repair)
    // validate called: 1 (initial) + 3 (post-repair) = 4
    expect(validateMock).toHaveBeenCalledTimes(4)
    expect(repairMock).toHaveBeenCalledTimes(3)
  })

  it('returns success=true and repaired=true when repair succeeds on first attempt', async () => {
    const artifact       = makeMockCarousel()
    const repairedArtifact = makeMockCarousel({ title: 'Repaired Carousel' })
    const compiler       = makeMockCompiler(artifact)

    const validateMock = jest.fn()
      .mockResolvedValueOnce({
        success: false, artifact, repaired: false, attempts: 0, passed: false,
        finalRejection: 'initial fail', violations: ['initial fail'],
      })
      .mockResolvedValueOnce({
        success: true, artifact: repairedArtifact, repaired: true, attempts: 1, passed: true,
      })

    const repairMock = jest.fn().mockResolvedValue({
      success: true, artifact: repairedArtifact, repaired: true, attempts: 1, passed: true,
    } satisfies IGovernanceResult<CarouselArtifact>)

    const govAdapter: IGovernanceAdapter<CarouselArtifact> = {
      artifactType: 'carousel' as const,
      validate:     validateMock,
      repair:       repairMock,
    }
    const engine    = makeEngine(compiler, govAdapter)
    const ctx       = makeMockContext()
    const repairLLM = jest.fn().mockResolvedValue('{}')

    const result = await engine.govern(artifact, ctx, repairLLM)

    expect(result.success).toBe(true)
    expect(result.repaired).toBe(true)
    expect(result.attempts).toBe(1)
    expect(result.artifact.title).toBe('Repaired Carousel')
  })
})

// ─── compileAndGovern() ───────────────────────────────────────────────────────

describe('ArtifactEngine.compileAndGovern()', () => {
  it('returns the compiled and governed artifact on success', async () => {
    const artifact   = makeMockCarousel()
    const compiler   = makeMockCompiler(artifact)
    const govAdapter = makePassingGovernanceAdapter()
    const engine     = makeEngine(compiler, govAdapter)
    const ctx        = makeMockContext()

    const { artifact: result, governanceResult } = await engine.compileAndGovern(
      'carousel', '{}', ctx
    )

    expect(result.$schema).toBe('artifact-json@2.0')
    expect(governanceResult.success).toBe(true)
  })

  it('throws ArtifactEngineRejection when governance fails after all repair attempts', async () => {
    const artifact   = makeMockCarousel()
    const compiler   = makeMockCompiler(artifact)
    const govAdapter = makeFailingGovernanceAdapter('rule violation')
    const engine     = makeEngine(compiler, govAdapter)
    const ctx        = makeMockContext()

    await expect(engine.compileAndGovern('carousel', '{}', ctx)).rejects.toThrow(
      ArtifactEngineRejection
    )
  })

  it('ArtifactEngineRejection carries correct metadata', async () => {
    const artifact   = makeMockCarousel()
    const compiler   = makeMockCompiler(artifact)
    const govAdapter = makeFailingGovernanceAdapter('bad structure')
    const engine     = makeEngine(compiler, govAdapter)
    const ctx        = makeMockContext()

    let caught: unknown
    try {
      await engine.compileAndGovern('carousel', '{}', ctx)
    } catch (err) {
      caught = err
    }

    expect(isArtifactEngineRejection(caught)).toBe(true)
    if (isArtifactEngineRejection(caught)) {
      expect(caught.artifactType).toBe('carousel')
      expect(caught.reason).toBe('bad structure')
      expect(caught.requestId).toBe(ctx.requestId)
      expect(caught.repairAttempts).toBe(0)
      expect(caught.name).toBe('ArtifactEngineRejection')
    }
  })
})

// ─── export() ─────────────────────────────────────────────────────────────────

describe('ArtifactEngine.export()', () => {
  it('throws a descriptive error when no exporter is registered', async () => {
    const artifact   = makeMockCarousel()
    const compiler   = makeMockCompiler(artifact)
    const govAdapter = makePassingGovernanceAdapter()
    const engine     = makeEngine(compiler, govAdapter)

    await expect(engine.export(artifact, { format: 'pdf', outputPath: '/tmp/test.pdf' })).rejects.toThrow(
      /No exporter registered for artifactType="carousel" format="pdf"/
    )
  })

  it('calls the registered exporter when one is present', async () => {
    const artifact   = makeMockCarousel()
    const compiler   = makeMockCompiler(artifact)
    const govAdapter = makePassingGovernanceAdapter()
    const registry   = new ArtifactRegistry()
    registry.registerCompiler(compiler)
    registry.registerGovernance(govAdapter)

    const mockExportResult = { outputPath: '/tmp/out.pdf', bytes: 1024, format: 'pdf' as const }
    const mockExporter = {
      supportedFormats:       ['pdf' as const],
      supportedArtifactTypes: ['carousel' as const],
      export: jest.fn().mockResolvedValue(mockExportResult),
    }
    registry.registerExporter(mockExporter)
    const engine = new ArtifactEngine(registry)

    const result = await engine.export(artifact, { format: 'pdf', outputPath: '/tmp/out.pdf' })

    expect(result).toEqual(mockExportResult)
    expect(mockExporter.export).toHaveBeenCalledWith(artifact, expect.objectContaining({ format: 'pdf' }))
  })
})

// ─── remix() ──────────────────────────────────────────────────────────────────

describe('ArtifactEngine.remix()', () => {
  it('throws NotImplemented until remix is implemented', async () => {
    const artifact = makeMockCarousel()
    const engine   = makeEngine(makeMockCompiler(artifact))
    const ctx      = makeMockContext()

    await expect(engine.remix(artifact, 'make it bolder', ctx)).rejects.toThrow(
      /remix\(\) is not yet implemented/
    )
  })
})

// ─── availableFormats() ────────────────────────────────────────────────────────

describe('ArtifactEngine.availableFormats()', () => {
  it('returns a non-empty array of known export formats', () => {
    const engine = new ArtifactEngine(new ArtifactRegistry())
    const formats = engine.availableFormats()

    expect(formats).toContain('json')
    expect(formats).toContain('pptx')
    expect(formats).toContain('pdf')
    expect(formats.length).toBeGreaterThan(0)
  })
})

// ─── ArtifactEngineRejection ───────────────────────────────────────────────────

describe('ArtifactEngineRejection', () => {
  it('isArtifactEngineRejection returns true for instances', () => {
    const err = new ArtifactEngineRejection('carousel', 'failed', 2, 'req-abc')
    expect(isArtifactEngineRejection(err)).toBe(true)
  })

  it('isArtifactEngineRejection returns false for generic Errors', () => {
    expect(isArtifactEngineRejection(new Error('plain'))).toBe(false)
    expect(isArtifactEngineRejection(null)).toBe(false)
    expect(isArtifactEngineRejection('string')).toBe(false)
  })

  it('message includes artifactType, repairAttempts, and reason', () => {
    const err = new ArtifactEngineRejection('deck', 'missing title slide', 1, 'req-xyz')
    expect(err.message).toMatch(/deck/)
    expect(err.message).toMatch(/1 repair attempts/)
    expect(err.message).toMatch(/missing title slide/)
  })
})


