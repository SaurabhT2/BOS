/**
 * @brandos/artifact-engine-layer — tests/registry.unit.test.ts
 *
 * Unit tests for ArtifactRegistry.
 *
 * STRATEGY:
 *   Tests use inline mock adapters. No live dependencies.
 *   Each test creates a fresh ArtifactRegistry instance for isolation.
 */

import { ArtifactRegistry } from '../registry'
import type {
  ICompiler,
  IGovernanceAdapter,
  IExporter,
  IRendererAdapter,
} from '../interfaces'
import type { ArtifactV2, CarouselArtifact, DeckArtifact } from '@brandos/contracts'

// ─── Mock factories ────────────────────────────────────────────────────────────

function makeMockCarouselCompiler(): ICompiler<CarouselArtifact> {
  return {
    artifactType: 'carousel' as const,
    compile: jest.fn(),
  }
}

function makeMockDeckCompiler(): ICompiler<DeckArtifact> {
  return {
    artifactType: 'deck' as const,
    compile: jest.fn(),
  }
}

function makeMockGovernanceAdapter(type: 'carousel' | 'deck' = 'carousel'): IGovernanceAdapter {
  return {
    artifactType: type as 'carousel' | 'deck',
    validate: jest.fn(),
  }
}

function makeMockExporter(types: string[], formats: string[]): IExporter {
  return {
    supportedArtifactTypes: types as any[],
    supportedFormats:       formats as any[],
    export: jest.fn(),
  }
}

function makeMockRenderer(type: string, format: 'html' | 'json' | 'png'): IRendererAdapter {
  return {
    artifactType:   type as any,
    rendererFormat: format,
    render: jest.fn(),
  }
}

// ─── Compiler registration ────────────────────────────────────────────────────

describe('ArtifactRegistry — compiler', () => {
  it('resolves a registered compiler by artifactType', () => {
    const registry = new ArtifactRegistry()
    const compiler = makeMockCarouselCompiler()
    registry.registerCompiler(compiler)

    const resolved = registry.resolveCompiler('carousel')
    expect(resolved).toBe(compiler)
  })

  it('throws if compiler is already registered for the same type', () => {
    const registry = new ArtifactRegistry()
    registry.registerCompiler(makeMockCarouselCompiler())

    expect(() => registry.registerCompiler(makeMockCarouselCompiler())).toThrow(
      /Compiler already registered for artifactType="carousel"/
    )
  })

  it('throws if no compiler is registered for the requested type', () => {
    const registry = new ArtifactRegistry()

    expect(() => registry.resolveCompiler('carousel')).toThrow(
      /No compiler registered for artifactType="carousel"/
    )
  })

  it('supports registering multiple compilers for different types', () => {
    const registry      = new ArtifactRegistry()
    const carouselComp  = makeMockCarouselCompiler()
    const deckComp      = makeMockDeckCompiler()
    registry.registerCompiler(carouselComp)
    registry.registerCompiler(deckComp)

    expect(registry.resolveCompiler('carousel')).toBe(carouselComp)
    expect(registry.resolveCompiler('deck')).toBe(deckComp)
  })

  it('supports fluent chaining on registerCompiler', () => {
    const registry = new ArtifactRegistry()
    const result   = registry.registerCompiler(makeMockCarouselCompiler())
    expect(result).toBe(registry)
  })
})

// ─── Governance registration ──────────────────────────────────────────────────

describe('ArtifactRegistry — governance', () => {
  it('resolves a registered governance adapter by artifactType', () => {
    const registry = new ArtifactRegistry()
    const adapter  = makeMockGovernanceAdapter('carousel')
    registry.registerGovernance(adapter)

    const resolved = registry.resolveGovernance('carousel')
    expect(resolved).toBe(adapter)
  })

  it('returns null when no governance adapter is registered', () => {
    const registry = new ArtifactRegistry()
    expect(registry.resolveGovernance('carousel')).toBeNull()
  })

  it('replaces an existing governance adapter (last-write-wins)', () => {
    const registry  = new ArtifactRegistry()
    const adapter1  = makeMockGovernanceAdapter('carousel')
    const adapter2  = makeMockGovernanceAdapter('carousel')
    registry.registerGovernance(adapter1)
    registry.registerGovernance(adapter2) // should warn and replace

    expect(registry.resolveGovernance('carousel')).toBe(adapter2)
  })
})

// ─── Exporter registration ────────────────────────────────────────────────────

describe('ArtifactRegistry — exporter', () => {
  it('resolves a registered exporter for a given artifactType and format', () => {
    const registry = new ArtifactRegistry()
    const exporter = makeMockExporter(['carousel'], ['pdf'])
    registry.registerExporter(exporter)

    const resolved = registry.resolveExporter('carousel', 'pdf')
    expect(resolved).toBe(exporter)
  })

  it('returns null when no exporter is registered for the combination', () => {
    const registry = new ArtifactRegistry()
    expect(registry.resolveExporter('carousel', 'pdf')).toBeNull()
  })

  it('registers a single exporter for all supported type × format combinations', () => {
    const registry = new ArtifactRegistry()
    const exporter = makeMockExporter(['carousel', 'deck'], ['pdf', 'pptx'])
    registry.registerExporter(exporter)

    expect(registry.resolveExporter('carousel', 'pdf')).toBe(exporter)
    expect(registry.resolveExporter('carousel', 'pptx')).toBe(exporter)
    expect(registry.resolveExporter('deck', 'pdf')).toBe(exporter)
    expect(registry.resolveExporter('deck', 'pptx')).toBe(exporter)
    expect(registry.resolveExporter('report', 'pdf')).toBeNull()
  })
})

// ─── Renderer registration ────────────────────────────────────────────────────

describe('ArtifactRegistry — renderer', () => {
  it('resolves a registered renderer for a given artifactType and format', () => {
    const registry = new ArtifactRegistry()
    const renderer = makeMockRenderer('carousel', 'html')
    registry.registerRenderer(renderer)

    const resolved = registry.resolveRenderer('carousel', 'html')
    expect(resolved).toBe(renderer)
  })

  it('returns null when no renderer is registered for the combination', () => {
    const registry = new ArtifactRegistry()
    expect(registry.resolveRenderer('carousel', 'html')).toBeNull()
  })
})

// ─── Introspection ────────────────────────────────────────────────────────────

describe('ArtifactRegistry — introspection', () => {
  it('listArtifactTypes returns all types with at least one dimension registered', () => {
    const registry = new ArtifactRegistry()
    registry.registerCompiler(makeMockCarouselCompiler())
    registry.registerCompiler(makeMockDeckCompiler())
    registry.registerGovernance(makeMockGovernanceAdapter('carousel'))

    const types = registry.listArtifactTypes()
    expect(types).toContain('carousel')
    expect(types).toContain('deck')
    expect(types.length).toBe(2)
  })

  it('isFullyRegistered returns true only when both compiler and governance are registered', () => {
    const registry = new ArtifactRegistry()
    registry.registerCompiler(makeMockCarouselCompiler())

    expect(registry.isFullyRegistered('carousel')).toBe(false)

    registry.registerGovernance(makeMockGovernanceAdapter('carousel'))
    expect(registry.isFullyRegistered('carousel')).toBe(true)
  })

  it('isFullyRegistered returns false for unregistered type', () => {
    const registry = new ArtifactRegistry()
    expect(registry.isFullyRegistered('carousel')).toBe(false)
  })

  it('listArtifactTypes returns empty array when nothing is registered', () => {
    const registry = new ArtifactRegistry()
    expect(registry.listArtifactTypes()).toEqual([])
  })
})


