/**
 * @brandos/artifact-engine-layer — index.ts
 *
 * Package entry point. Re-exports the full public API surface.
 *
 * RULES:
 *   - Every symbol here MUST be documented in IArtifactEngineLayer.ts.
 *   - Removing a symbol here is a breaking change — bump the package version.
 *   - Internal implementation details are NOT exported (e.g., assertCompiledArtifact).
 *
 * CONSUMERS: import from '@brandos/artifact-engine-layer', never from deep paths.
 *
 * FOR AGENTS: The authoritative export list with descriptions lives in
 * src/IArtifactEngineLayer.ts. Read that file to understand what each export does.
 */

// ── Engine + Registry ──────────────────────────────────────────────────────────
export { ArtifactEngine }                               from './engine'
export { ArtifactRegistry, globalArtifactRegistry }    from './registry'

// ── Bootstrap + Singleton engine ──────────────────────────────────────────────
export { bootstrapArtifactEngine, globalArtifactEngine } from './bootstrap'

// ── Plugin Registry ───────────────────────────────────────────────────────────
export { PlatformPluginRegistry, globalPluginRegistry } from './skill-registry'

// ── Compiler implementations ──────────────────────────────────────────────────
export { CarouselCompiler } from './compiler/carousel'
export { DeckCompiler }     from './compiler/deck'
export { ReportCompiler }   from './compiler/report'

// ── Behavioral interfaces (contracts for implementors) ────────────────────────
export type {
  ICompiler,
  IGovernanceAdapter,
  IExporter,
  IRendererAdapter,
  IArtifactExecutionContext,
  IArtifactEngine,
  IArtifactRegistry,
  // PHASE 3 CLEANUP (3.3): SemanticIdentity alias removed.
  // Import ISemanticIdentity from '@brandos/contracts' directly.
} from './interfaces'

// ── Typed errors ──────────────────────────────────────────────────────────────
export { ArtifactEngineRejection, isArtifactEngineRejection } from './interfaces'

// ── Public interface type (package boundary structural type) ──────────────────
export type { IArtifactEngineLayer } from './IArtifactEngineLayer'

// ── Eval utilities ────────────────────────────────────────────────────────────
export { hashArtifact, compareArtifacts, assertArtifactFields } from './eval/compare'
export type { ArtifactDiff } from './eval/compare'


