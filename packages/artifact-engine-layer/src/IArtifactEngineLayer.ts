/**
 * @brandos/artifact-engine-layer — IArtifactEngineLayer.ts
 *
 * PUBLIC INTERFACE BOUNDARY — the strict contract surface of this package.
 *
 * RULES FOR CONSUMERS:
 *   - Import ONLY from '@brandos/artifact-engine-layer' (the package root).
 *   - Do NOT import from deep paths inside this package.
 *   - All types crossing the package boundary originate from '@brandos/contracts'.
 *
 * RULES FOR MAINTAINERS:
 *   - Every symbol exported from index.ts MUST be reflected here.
 *   - Removing an export here is a breaking change — version the package accordingly.
 *   - Adding exports is additive and safe.
 *   - Internal implementation details (assertCompiledArtifact, MAX_REPAIR_ATTEMPTS)
 *     are intentionally absent — they are private to this package.
 *
 * DEPENDENCY RULE:
 *   - This file MUST NOT import from './engine', './registry', etc.
 *   - It references only interfaces and types, never implementations.
 *   - It is safe to import this file in test environments with no runtime deps.
 *
 * AGENTIC USE:
 *   - An LLM agent checking "what can I call on this package?" reads this file.
 *   - An LLM agent checking "how is it implemented?" reads engine.ts, registry.ts, etc.
 *   - When in doubt: if it's not in IArtifactEngineLayer, it's not part of the public API.
 */

import type {
  ArtifactV2,
  ArtifactType,
  IGovernanceResult,
  ExportFormat,
  ExportResult,
  CompileResult,
  CompileOptions,
  ExportOptions,
  DraftArtifactInput,
  ISemanticIdentity,
  SkillContext,
  ISkill,
  SkillMetadata,
  WorkflowDefinition,
  WorkflowResult,
  CarouselArtifact,
  DeckArtifact,
  ReportArtifact,
} from '@brandos/contracts'

// ─── Re-export for external consumers ─────────────────────────────────────────
// These are the only @brandos/contracts types that are part of THIS package's
// public surface. Do not export types that are not directly used by the
// interfaces below — consumers who need more should import from @brandos/contracts.

export type {
  ArtifactV2,
  ArtifactType,
  IGovernanceResult,
  ExportFormat,
  ExportResult,
  CompileResult,
  CompileOptions,
  ExportOptions,
  DraftArtifactInput,
  ISemanticIdentity,
  SkillContext,
  ISkill,
  SkillMetadata,
  WorkflowDefinition,
  CarouselArtifact,
  DeckArtifact,
  ReportArtifact,
}

// ─── Package-internal interface types (from interfaces.ts) ────────────────────

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

export { ArtifactEngineRejection, isArtifactEngineRejection } from './interfaces'

// ─── Eval utilities ────────────────────────────────────────────────────────────

export type { ArtifactDiff } from './eval/compare'
export { hashArtifact, compareArtifacts, assertArtifactFields } from './eval/compare'

// ─── IArtifactEngineLayer ─────────────────────────────────────────────────────

/**
 * IArtifactEngineLayer — the structural type of this package's public boundary.
 *
 * This interface describes what the package exports as a cohesive unit.
 * It is primarily used for:
 *   1. Type-checking that the package exports are consistent.
 *   2. Dependency injection in test environments (inject a mock implementing this).
 *   3. Agent introspection — an LLM agent reads this to understand the API surface.
 *
 * USAGE: Consumers should depend on the concrete singletons (globalArtifactEngine,
 * globalArtifactRegistry) or the interfaces (IArtifactEngine, IArtifactRegistry).
 * This structural type is for DI frameworks and test doubles.
 */
export interface IArtifactEngineLayer {
  /**
   * The canonical horizontal orchestration runtime.
   * Dispatches compile → govern → export via the registry.
   * @see IArtifactEngine for full method signatures.
   */
  readonly engine: import('./interfaces').IArtifactEngine

  /**
   * The runtime registry for compilers, governance adapters, exporters, and renderers.
   * Populated by bootstrapArtifactEngine() at server startup.
   * @see IArtifactRegistry for full method signatures.
   */
  readonly registry: import('./interfaces').IArtifactRegistry

  /**
   * Initialize the engine by registering all known artifact types.
   * Call once at server startup (e.g., instrumentation.ts).
   * Idempotent — safe to call multiple times; subsequent calls are no-ops.
   *
   * Currently registers: carousel, deck, report.
   * Future: landing-page, infographic, email-campaign.
   */
  readonly bootstrap: () => void
}


