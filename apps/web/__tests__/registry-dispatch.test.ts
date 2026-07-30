/**
 * apps/web — __tests__/registry-dispatch.test.ts
 *
 * Tests for Rendering V2 Phase 7: the registry cutover
 * (lib/registry-dispatch.ts). This is the one Rendering V2 phase where the
 * whole point is "does this actually go through @brandos/artifact-engine-
 * layer's registry, not just produce output that looks the same as the
 * direct-call path" — so these tests deliberately do NOT rely on output
 * looking similar to the legacy renderers (registry adapters wrap the same
 * underlying lib functions, so that would prove nothing). Instead, each
 * dispatch function is given a hand-written STUB registry (implementing the
 * IArtifactRegistry interface structurally) with a distinguishing marker
 * response — proving structurally that the registry argument was actually
 * consulted, by asserting on output only the stub could have produced.
 *
 * WHY A HAND-WRITTEN STUB, NOT THE REAL ArtifactRegistry CLASS:
 *   @brandos/artifact-engine-layer transitively imports
 *   @brandos/governance-layer, whose tsconfig ("module": "ESNext") emits
 *   relative re-exports without a file extension (e.g. `from
 *   './governanceEngine'`, not './governanceEngine.js'). Next.js's
 *   bundler-style resolution tolerates this; Vitest, resolving workspace
 *   packages via Node's native ESM loader, does not — confirmed by a
 *   scratch reproduction that failed identically with zero relation to
 *   this test's own code. Rather than alter another package's build output
 *   (out of scope, its own AGENT_CONTEXT, its own reasons) or fight
 *   Vitest's resolver configuration for a one-package edge case, this test
 *   imports ONLY THE TYPE `IArtifactRegistry`/`IRendererAdapter`/`IExporter`
 *   (a `import type` — erased entirely at compile time, never loaded as a
 *   real module at test-run time) and satisfies it structurally with a
 *   plain object. registry-dispatch.ts's dispatch functions only need
 *   something matching the interface shape; they never care whether it's
 *   literally the same class instance production code uses.
 */

import { describe, it, expect, afterEach } from 'vitest'
import type { IArtifactRegistry, IRendererAdapter, IExporter } from '@brandos/artifact-engine-layer'
import type { ArtifactType, ExportResult } from '@brandos/contracts'
import {
  isRegistryDispatchEnabled,
  dispatchHtmlExport,
  dispatchPdfExport,
  dispatchPptxExport,
} from '../lib/registry-dispatch'

const ORIGINAL_FLAG = process.env.RENDERING_V2_REGISTRY_DISPATCH

function setFlag(value: 'true' | undefined) {
  if (value === undefined) delete process.env.RENDERING_V2_REGISTRY_DISPATCH
  else process.env.RENDERING_V2_REGISTRY_DISPATCH = value
}

afterEach(() => {
  setFlag(ORIGINAL_FLAG as 'true' | undefined)
})

const STUB_MARKER = '__STUB_REGISTRY_OUTPUT__'

/**
 * Minimal stub satisfying IArtifactRegistry structurally. Only
 * resolveRenderer/resolveExporter have real behavior (configurable per
 * test); every other method is unused by registry-dispatch.ts and throws
 * if accidentally called, so a test would fail loudly rather than silently
 * pass on an unexercised path.
 */
class StubRegistry implements IArtifactRegistry {
  constructor(
    private rendererResult: IRendererAdapter | null = null,
    private exporterResult: IExporter | null = null
  ) {}

  registerCompiler(): this {
    throw new Error('not used by registry-dispatch.ts')
  }
  resolveCompiler(): never {
    throw new Error('not used by registry-dispatch.ts')
  }
  registerGovernance(): this {
    throw new Error('not used by registry-dispatch.ts')
  }
  resolveGovernance(): null {
    throw new Error('not used by registry-dispatch.ts')
  }
  registerExporter(): this {
    throw new Error('not used by registry-dispatch.ts (tests construct StubRegistry with an exporter directly)')
  }
  resolveExporter(): IExporter | null {
    return this.exporterResult
  }
  registerRenderer(): this {
    throw new Error('not used by registry-dispatch.ts (tests construct StubRegistry with a renderer directly)')
  }
  resolveRenderer(): IRendererAdapter | null {
    return this.rendererResult
  }
  listArtifactTypes(): ArtifactType[] {
    throw new Error('not used by registry-dispatch.ts')
  }
  isFullyRegistered(): boolean {
    throw new Error('not used by registry-dispatch.ts')
  }
}

const stubHtmlRendererAdapter: IRendererAdapter = {
  artifactType: 'carousel',
  rendererFormat: 'html',
  async render() {
    return STUB_MARKER
  },
}

const throwingHtmlRendererAdapter: IRendererAdapter = {
  artifactType: 'carousel',
  rendererFormat: 'html',
  async render(): Promise<string> {
    throw new Error('stub registry adapter intentionally failing')
  },
}

const stubPdfExporter: IExporter = {
  supportedFormats: ['pdf'],
  supportedArtifactTypes: ['carousel'],
  async export(): Promise<ExportResult> {
    return {
      format: 'pdf',
      data: Buffer.from(STUB_MARKER),
      sizeBytes: STUB_MARKER.length,
      slideCount: 1,
      durationMs: 1,
      success: true,
    }
  },
}

const stubPptxExporter: IExporter = {
  supportedFormats: ['pptx'],
  supportedArtifactTypes: ['carousel'],
  async export(): Promise<ExportResult> {
    return {
      format: 'pptx',
      data: Buffer.from(STUB_MARKER),
      sizeBytes: STUB_MARKER.length,
      slideCount: 1,
      durationMs: 1,
      success: true,
    }
  },
}

const dummyArtifact = { artifact_type: 'carousel', title: 'Dummy', slides: [] } as unknown as Record<string, unknown>

describe('isRegistryDispatchEnabled', () => {
  it('is false when unset, true only when exactly "true"', () => {
    setFlag(undefined)
    expect(isRegistryDispatchEnabled()).toBe(false)
    setFlag('true')
    expect(isRegistryDispatchEnabled()).toBe(true)
  })
})

describe('dispatchHtmlExport', () => {
  it('does NOT consult the registry when the flag is off, even if one is provided', async () => {
    setFlag(undefined)
    const registry = new StubRegistry(stubHtmlRendererAdapter)
    const html = await dispatchHtmlExport(dummyArtifact, 'carousel', registry)
    expect(html).not.toBe(STUB_MARKER) // legacy renderer produced this, not the stub
  })

  it("DOES consult the registry when the flag is on, proven by the stub adapter's distinguishing output", async () => {
    setFlag('true')
    const registry = new StubRegistry(stubHtmlRendererAdapter)
    const html = await dispatchHtmlExport(dummyArtifact, 'carousel', registry)
    expect(html).toBe(STUB_MARKER)
  })

  it('falls back to the direct-call path when nothing is registered for this (type, format) pair', async () => {
    setFlag('true')
    const emptyRegistry = new StubRegistry(null)
    const html = await dispatchHtmlExport(dummyArtifact, 'carousel', emptyRegistry)
    expect(html).not.toBe(STUB_MARKER)
    expect(typeof html).toBe('string')
    expect(html.length).toBeGreaterThan(0)
  })

  it('falls back to the direct-call path if the registered adapter throws', async () => {
    setFlag('true')
    const registry = new StubRegistry(throwingHtmlRendererAdapter)
    const html = await dispatchHtmlExport(dummyArtifact, 'carousel', registry)
    expect(html).not.toBe(STUB_MARKER)
    expect(html.length).toBeGreaterThan(0)
  })
})

describe('dispatchPdfExport', () => {
  it('consults the registry when the flag is on and an exporter is registered', async () => {
    setFlag('true')
    const registry = new StubRegistry(null, stubPdfExporter)
    const result = await dispatchPdfExport(dummyArtifact, 'carousel', registry)
    expect(result.bytes.toString()).toBe(STUB_MARKER)
  })

  // NO "flag off falls back to legacy PDF" test here, unlike dispatchHtmlExport
  // and dispatchPptxExport above/below: the legacy fallback for PDF is
  // renderArtifactToPDF(), which launches a real headless-Chromium process —
  // unavailable in this sandbox (same disclosed limitation as Rendering V2
  // Phase 4's artifact-export-pdf-template.test.ts). Verifying "does NOT
  // consult the registry when the flag is off" is only meaningful together
  // with verifying what the fallback path actually does, which would require
  // a working Chromium binary here. The registry-consultation behavior
  // itself (the actual point of this phase) IS fully verified by the test
  // above and by dispatchHtmlExport's/dispatchPptxExport's equivalent tests,
  // which don't share this dependency.
})

describe('dispatchPptxExport', () => {
  it('consults the registry when the flag is on and an exporter is registered', async () => {
    setFlag('true')
    const registry = new StubRegistry(null, stubPptxExporter)
    const result = await dispatchPptxExport(dummyArtifact, 'carousel', registry)
    expect(result.bytes.toString()).toBe(STUB_MARKER)
  })

  it('falls back to the direct-call path when nothing is registered', async () => {
    setFlag('true')
    const emptyRegistry = new StubRegistry(null, null)
    const result = await dispatchPptxExport(dummyArtifact, 'carousel', emptyRegistry)
    expect(result.bytes.toString()).not.toBe(STUB_MARKER)
    expect(result.mimeType).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation')
  })
})
