/**
 * @brandos/artifact-engine-layer — tests/public-interface.contract.test.ts
 *
 * Contract tests for the package's public interface boundary.
 *
 * PURPOSE:
 *   These tests verify that the package exports exactly what IArtifactEngineLayer
 *   declares, and that the structural types are correctly satisfied.
 *   They serve as compile-time + runtime documentation of the public surface.
 *
 * STRATEGY:
 *   1. Import from the package index (as a consumer would).
 *   2. Assert that each exported symbol is present and of the expected type.
 *   3. Assert that concrete classes satisfy their interfaces.
 *   4. Assert that singletons are initialized.
 *
 * If a symbol is accidentally removed from index.ts, these tests will fail —
 * preventing silent breaking changes to consumers.
 */

// Import everything as a consumer of the public interface would
import {
  // Classes
  ArtifactEngine,
  ArtifactRegistry,
  PlatformPluginRegistry,
  CarouselCompiler,
  DeckCompiler,
  ReportCompiler,
  ArtifactEngineRejection,
  // Singletons + functions
  globalArtifactRegistry,
  globalArtifactEngine,
  globalPluginRegistry,
  bootstrapArtifactEngine,
  isArtifactEngineRejection,
  // Eval utilities
  hashArtifact,
  compareArtifacts,
  assertArtifactFields,
} from '../index'

// ─── Exported classes exist ────────────────────────────────────────────────────

describe('Public interface — class exports', () => {
  it('ArtifactEngine is a constructor function', () => {
    expect(typeof ArtifactEngine).toBe('function')
    expect(ArtifactEngine.prototype).toBeDefined()
  })

  it('ArtifactRegistry is a constructor function', () => {
    expect(typeof ArtifactRegistry).toBe('function')
  })

  it('PlatformPluginRegistry is a constructor function', () => {
    expect(typeof PlatformPluginRegistry).toBe('function')
  })

  it('CarouselCompiler has correct artifactType', () => {
    const compiler = new CarouselCompiler()
    expect(compiler.artifactType).toBe('carousel')
    expect(typeof compiler.compile).toBe('function')
  })

  it('DeckCompiler has correct artifactType', () => {
    const compiler = new DeckCompiler()
    expect(compiler.artifactType).toBe('deck')
    expect(typeof compiler.compile).toBe('function')
  })

  it('ReportCompiler has correct artifactType', () => {
    const compiler = new ReportCompiler()
    expect(compiler.artifactType).toBe('report')
    expect(typeof compiler.compile).toBe('function')
  })

  it('ArtifactEngineRejection is an Error subclass', () => {
    const err = new ArtifactEngineRejection('carousel', 'test reason', 2, 'req-001')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ArtifactEngineRejection)
    expect(err.name).toBe('ArtifactEngineRejection')
    expect(err.artifactType).toBe('carousel')
    expect(err.reason).toBe('test reason')
    expect(err.repairAttempts).toBe(2)
    expect(err.requestId).toBe('req-001')
  })
})

// ─── Exported singletons and functions ────────────────────────────────────────

describe('Public interface — singletons and functions', () => {
  it('globalArtifactRegistry is an ArtifactRegistry instance', () => {
    expect(globalArtifactRegistry).toBeInstanceOf(ArtifactRegistry)
  })

  it('globalArtifactEngine is an ArtifactEngine instance', () => {
    expect(globalArtifactEngine).toBeInstanceOf(ArtifactEngine)
  })

  it('globalPluginRegistry is a PlatformPluginRegistry instance', () => {
    expect(globalPluginRegistry).toBeInstanceOf(PlatformPluginRegistry)
  })

  it('bootstrapArtifactEngine is a function', () => {
    expect(typeof bootstrapArtifactEngine).toBe('function')
  })

  it('isArtifactEngineRejection is a function', () => {
    expect(typeof isArtifactEngineRejection).toBe('function')
  })
})

// ─── Exported eval utilities ──────────────────────────────────────────────────

describe('Public interface — eval utilities', () => {
  it('hashArtifact is a function', () => {
    expect(typeof hashArtifact).toBe('function')
  })

  it('compareArtifacts is a function', () => {
    expect(typeof compareArtifacts).toBe('function')
  })

  it('assertArtifactFields is a function', () => {
    expect(typeof assertArtifactFields).toBe('function')
  })
})

// ─── IArtifactEngine interface compliance ─────────────────────────────────────

describe('Public interface — IArtifactEngine method surface', () => {
  it('globalArtifactEngine has all required IArtifactEngine methods', () => {
    const engine = globalArtifactEngine

    expect(typeof engine.compile).toBe('function')
    expect(typeof engine.govern).toBe('function')
    expect(typeof engine.compileAndGovern).toBe('function')
    expect(typeof engine.export).toBe('function')
    expect(typeof engine.compileAndExport).toBe('function')
    expect(typeof engine.remix).toBe('function')
    expect(typeof engine.availableFormats).toBe('function')
    expect(engine.registry).toBeInstanceOf(ArtifactRegistry)
  })
})

// ─── IArtifactRegistry interface compliance ───────────────────────────────────

describe('Public interface — IArtifactRegistry method surface', () => {
  it('ArtifactRegistry instance has all required IArtifactRegistry methods', () => {
    const registry = new ArtifactRegistry()

    expect(typeof registry.registerCompiler).toBe('function')
    expect(typeof registry.resolveCompiler).toBe('function')
    expect(typeof registry.registerGovernance).toBe('function')
    expect(typeof registry.resolveGovernance).toBe('function')
    expect(typeof registry.registerExporter).toBe('function')
    expect(typeof registry.resolveExporter).toBe('function')
    expect(typeof registry.registerRenderer).toBe('function')
    expect(typeof registry.resolveRenderer).toBe('function')
    expect(typeof registry.listArtifactTypes).toBe('function')
    expect(typeof registry.isFullyRegistered).toBe('function')
  })
})

// ─── IPlatformPluginRegistry interface compliance ─────────────────────────────

describe('Public interface — IPlatformPluginRegistry method surface', () => {
  it('PlatformPluginRegistry instance has all required IPlatformPluginRegistry methods', () => {
    const registry = new PlatformPluginRegistry()

    expect(typeof registry.registerSkill).toBe('function')
    expect(typeof registry.registerWorkflow).toBe('function')
    expect(typeof registry.getSkill).toBe('function')
    expect(typeof registry.listSkills).toBe('function')
    expect(typeof registry.listWorkflows).toBe('function')
    expect(typeof registry.executeSkill).toBe('function')
  })
})


