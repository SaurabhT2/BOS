/**
 * @brandos/artifact-engine-layer — registry.ts
 *
 * ArtifactRegistry — runtime registry for all artifact engine dimensions.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  FOR AGENTS: This file manages runtime lookup tables. It is DANGEROUS   │
 * │  to modify. Changes here can produce silent null-dispatch failures.      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * FOUR LOOKUP DIMENSIONS:
 *   1. compilers   → Map<ArtifactType, ICompiler<any>>
 *                    Key: artifactType (e.g., 'carousel')
 *                    Behavior: registerCompiler THROWS on duplicate (fail-fast at startup)
 *                              resolveCompiler THROWS on miss (hard dependency)
 *
 *   2. governance  → Map<ArtifactType, IGovernanceAdapter<any>>
 *                    Key: artifactType
 *                    Behavior: registerGovernance REPLACES (idempotent for hot-swap in tests)
 *                              resolveGovernance returns null on miss (soft dependency — bypass)
 *
 *   3. exporters   → Map<`${ArtifactType}:${ExportFormat}`, IExporter>
 *                    Key: composite `${artifactType}:${format}`
 *                    Behavior: last-write-wins per key (allows exporter replacement)
 *                              resolveExporter returns null on miss (soft dependency)
 *
 *   4. renderers   → Map<`${ArtifactType}:${'html'|'json'|'png'}`, IRendererAdapter>
 *                    Key: composite `${artifactType}:${rendererFormat}`
 *                    Behavior: last-write-wins per key
 *                              resolveRenderer returns null on miss (soft dependency)
 *
 * THREAD SAFETY:
 *   Registration is synchronous and expected at server startup only (before requests).
 *   After bootstrapArtifactEngine() completes, the registry is effectively read-only.
 *   No locking needed for concurrent reads.
 *
 * TESTING:
 *   Instantiate a fresh ArtifactRegistry per test — do NOT share globalArtifactRegistry
 *   between tests. Mock adapters can be registered on a fresh instance.
 *   See src/tests/registry.unit.test.ts for patterns.
 */

import type {
  ArtifactV2,
  ArtifactType,
  ExportFormat,
} from '@brandos/contracts'

import type {
  ICompiler,
  IGovernanceAdapter,
  IExporter,
  IRendererAdapter,
  IArtifactRegistry,
} from './interfaces'

// ─── ArtifactRegistry ─────────────────────────────────────────────────────────

export class ArtifactRegistry implements IArtifactRegistry {
  /**
   * Compiler registry: one compiler per artifact type.
   * Key: ArtifactType string (e.g., 'carousel', 'deck', 'report').
   * Throws on duplicate registration — duplication indicates a bootstrap bug.
   */
  private readonly compilers = new Map<ArtifactType, ICompiler<ArtifactV2>>()

  /**
   * Governance registry: one governance adapter per artifact type.
   * Key: ArtifactType string.
   * Replaces on duplicate — allows governance hot-swap in test environments.
   */
  private readonly governance = new Map<ArtifactType, IGovernanceAdapter<ArtifactV2>>()

  /**
   * Exporter registry: one exporter per (artifactType, format) pair.
   * Key: `${artifactType}:${format}` (composite key — last-write-wins).
   * One IExporter instance may be stored under multiple keys if it supports
   * multiple artifact types and/or formats.
   */
  private readonly exporters = new Map<string, IExporter>()

  /**
   * Renderer registry: one renderer per (artifactType, rendererFormat) pair.
   * Key: `${artifactType}:${rendererFormat}` (composite key — last-write-wins).
   */
  private readonly renderers = new Map<string, IRendererAdapter>()

  // ── Compiler registration + dispatch ──────────────────────────────────────

  /**
   * Register a compiler for an artifact type.
   *
   * BEHAVIOR:
   *   - Throws if a compiler is already registered for compiler.artifactType.
   *   - This is a HARD FAILURE at startup — it indicates two compilers competing
   *     for the same artifact type (e.g., bootstrap called twice, or a conflict
   *     between two packages registering the same type).
   *   - Returns `this` for fluent chaining: registry.registerCompiler(a).registerCompiler(b)
   *
   * EDGE CASE — replacing a compiler intentionally (e.g., in tests):
   *   There is no deregisterCompiler() API. Create a fresh ArtifactRegistry
   *   instance per test instead of re-registering on the shared global.
   */
  registerCompiler<T extends ArtifactV2>(compiler: ICompiler<T>): this {
    if (this.compilers.has(compiler.artifactType)) {
      throw new Error(
        `[ArtifactRegistry] Compiler already registered for artifactType="${compiler.artifactType}". ` +
        `Duplicate registration indicates a bootstrap or module loading bug. ` +
        `Use a fresh ArtifactRegistry instance for test isolation.`
      )
    }
    this.compilers.set(compiler.artifactType, compiler as ICompiler<ArtifactV2>)
    return this
  }

  /**
   * Resolve a compiler for the given artifact type.
   *
   * BEHAVIOR:
   *   - Throws if no compiler is registered for artifactType.
   *   - This is a HARD FAILURE at request time — it means bootstrapArtifactEngine()
   *     did not register the required compiler, or the caller passed an unknown type.
   *   - The error message includes all currently registered types for diagnostics.
   *
   * GENERIC: The returned ICompiler<T> is cast from ICompiler<ArtifactV2>.
   *   The generic T is for caller convenience (type narrowing at call site).
   *   The registry itself stores ICompiler<ArtifactV2> internally.
   */
  resolveCompiler<T extends ArtifactV2>(artifactType: ArtifactType): ICompiler<T> {
    const compiler = this.compilers.get(artifactType)
    if (!compiler) {
      throw new Error(
        `[ArtifactRegistry] No compiler registered for artifactType="${artifactType}". ` +
        `Registered types: [${[...this.compilers.keys()].join(', ')}]. ` +
        `Register a compiler via registry.registerCompiler() before calling compile().`
      )
    }
    return compiler as ICompiler<T>
  }

  // ── Governance registration + dispatch ────────────────────────────────────

  /**
   * Register a governance adapter for an artifact type.
   *
   * BEHAVIOR:
   *   - Replaces any existing adapter for the same artifactType with a console.warn.
   *   - This is intentional: governance adapters can be hot-swapped in tests.
   *   - Returns `this` for fluent chaining.
   *
   * EDGE CASE — governance for a type without a compiler:
   *   This is allowed but unusual. A governance adapter can exist without a compiler
   *   (e.g., for legacy artifact validation). The engine will still fail at compile()
   *   if no compiler is registered.
   */
  registerGovernance<T extends ArtifactV2>(adapter: IGovernanceAdapter<T>): this {
    if (this.governance.has(adapter.artifactType)) {
      console.warn(
        `[ArtifactRegistry] Governance adapter for artifactType="${adapter.artifactType}" ` +
        `is being replaced. If this is not intentional, check for duplicate registerGovernance() calls.`
      )
    }
    this.governance.set(adapter.artifactType, adapter as IGovernanceAdapter<ArtifactV2>)
    return this
  }

  /**
   * Resolve a governance adapter for the given artifact type.
   *
   * BEHAVIOR:
   *   - Returns null if no adapter is registered (soft miss).
   *   - The engine treats null as a governance bypass (warn + pass through).
   *   - Returns null rather than throwing to allow optional governance rollout.
   */
  resolveGovernance<T extends ArtifactV2>(artifactType: ArtifactType): IGovernanceAdapter<T> | null {
    return (this.governance.get(artifactType) as IGovernanceAdapter<T>) ?? null
  }

  // ── Exporter registration + dispatch ──────────────────────────────────────

  /**
   * Register an exporter.
   *
   * BEHAVIOR:
   *   - Registers the exporter for ALL combinations of supportedArtifactTypes × supportedFormats.
   *   - Last-write-wins per key: if two exporters support the same (type, format),
   *     the last one registered wins (no error, no warning — intentional for extensibility).
   *   - Returns `this` for fluent chaining.
   *
   * EXAMPLE:
   *   An exporter with supportedArtifactTypes=['carousel','deck'] and supportedFormats=['pptx','pdf']
   *   registers 4 keys: 'carousel:pptx', 'carousel:pdf', 'deck:pptx', 'deck:pdf'.
   */
  registerExporter(exporter: IExporter): this {
    for (const artifactType of exporter.supportedArtifactTypes) {
      for (const format of exporter.supportedFormats) {
        const key = `${artifactType}:${format}`
        this.exporters.set(key, exporter)
      }
    }
    return this
  }

  /**
   * Resolve an exporter for the given artifact type and format.
   *
   * BEHAVIOR:
   *   - Returns null if no exporter is registered for (artifactType, format).
   *   - The engine throws an Error (not ArtifactEngineRejection) when this returns null.
   *     A missing exporter is a configuration error, not a governance failure.
   */
  resolveExporter(artifactType: ArtifactType, format: ExportFormat): IExporter | null {
    return this.exporters.get(`${artifactType}:${format}`) ?? null
  }

  // ── Renderer registration + dispatch ──────────────────────────────────────

  /**
   * Register a renderer adapter.
   *
   * BEHAVIOR:
   *   - Key: `${artifactType}:${rendererFormat}` (last-write-wins).
   *   - Returns `this` for fluent chaining.
   */
  registerRenderer(adapter: IRendererAdapter): this {
    const key = `${adapter.artifactType}:${adapter.rendererFormat}`
    this.renderers.set(key, adapter)
    return this
  }

  /**
   * Resolve a renderer for the given artifact type and format.
   *
   * BEHAVIOR:
   *   - Returns null if no renderer is registered for (artifactType, format).
   *   - Callers handle null (soft miss) — no engine-level Error thrown for missing renderers.
   */
  resolveRenderer(artifactType: ArtifactType, format: 'html' | 'json' | 'png'): IRendererAdapter | null {
    return this.renderers.get(`${artifactType}:${format}`) ?? null
  }

  // ── Introspection ──────────────────────────────────────────────────────────

  /**
   * List all artifact types that have at least one dimension registered.
   *
   * SOURCES: union of compiler keys and governance keys.
   * Exporters and renderers are NOT included in this set (they are optional).
   *
   * USE CASES:
   *   - Health check: verify bootstrapArtifactEngine() registered expected types.
   *   - Admin endpoints: list available generation capabilities.
   *   - Error messages: include in "No compiler for type X" messages.
   */
  listArtifactTypes(): ArtifactType[] {
    const types = new Set<ArtifactType>([
      ...this.compilers.keys(),
      ...this.governance.keys(),
    ])
    return [...types]
  }

  /**
   * Check whether all REQUIRED dimensions are registered for an artifact type.
   *
   * REQUIRED DIMENSIONS: compiler + governance adapter.
   * (Exporters and renderers are optional — not checked here.)
   *
   * USE CASE: Bootstrap validation after bootstrapArtifactEngine() completes.
   * Call isFullyRegistered('carousel') to assert carousel is production-ready.
   *
   * @returns true if and only if both compiler and governance adapter are registered.
   */
  isFullyRegistered(artifactType: ArtifactType): boolean {
    return this.compilers.has(artifactType) && this.governance.has(artifactType)
  }
}

// ─── Singleton global registry ────────────────────────────────────────────────
//
// Populated at server startup by bootstrap.ts:bootstrapArtifactEngine().
//
// IMPORTANT:
//   - Do NOT use globalArtifactRegistry directly in unit tests.
//   - Create a fresh ArtifactRegistry() per test for isolation.
//   - The global is only for production server-startup use.

// NEXT.JS MODULE SPLIT FIX:
// Next.js webpack creates separate module instances per chunk (instrumentation.ts,
// API route handlers, etc.). A plain `const` singleton is re-created per chunk,
// so bootstrap in instrumentation.ts registers compilers into a DIFFERENT instance
// than the one imported by artifact-pipeline.ts → "Registered types: []" at compile.
// The globalThis store survives module splits — same pattern as llmRouter.ts.
declare global {
  // eslint-disable-next-line no-var
  var __BRANDOS_ARTIFACT_REGISTRY__: ArtifactRegistry | undefined
}

function _getOrCreateRegistry(): ArtifactRegistry {
  if (!globalThis.__BRANDOS_ARTIFACT_REGISTRY__) {
    globalThis.__BRANDOS_ARTIFACT_REGISTRY__ = new ArtifactRegistry()
  }
  return globalThis.__BRANDOS_ARTIFACT_REGISTRY__
}

export const globalArtifactRegistry: ArtifactRegistry = _getOrCreateRegistry()


