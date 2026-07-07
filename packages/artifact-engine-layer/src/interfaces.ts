/**
 * @brandos/artifact-engine-layer — interfaces.ts
 *
 * Canonical behavioral interfaces for the horizontal artifact runtime.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  FOR AGENTS: This file defines WHAT each component must do (contracts). │
 * │  For HOW they do it, see:                                               │
 * │    engine.ts         → IArtifactEngine implementation (ArtifactEngine)  │
 * │    registry.ts       → IArtifactRegistry implementation                 │
 * │    compiler/*.ts     → ICompiler implementations                        │
 * │    governance/*.ts   → IGovernanceAdapter implementations               │
 * │    skill-registry.ts → IPlatformPluginRegistry implementation           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * DESIGN PRINCIPLES:
 *   - ICompiler<TArtifact>:       type-safe, deterministic OCL compilation
 *   - IGovernanceAdapter<T>:      semantic validation + optional LLM repair
 *   - IExporter:                  format-specific artifact serialization
 *   - IRendererAdapter:           server-side rendering (HTML/JSON/PNG)
 *   - IArtifactExecutionContext:  per-request environment (identity, tracing)
 *   - IArtifactEngine:            orchestration entry point
 *   - IArtifactRegistry:          runtime lookup for all four dimensions
 *
 * DEPENDENCY RULES (enforced at build time via tsconfig references):
 *   - This file imports ONLY from '@brandos/contracts'.
 *   - No circular deps (contracts ← this file, never the reverse).
 *   - No Next.js imports. No LLM SDK imports. No React imports.
 *   - Compilers are deterministic; only governance adapters may call LLMs.
 *   - Registry lookup is always by ArtifactType string key.
 */

import type {
  ArtifactV2,
  ArtifactType,
  CarouselArtifact,
  DeckArtifact,
  ReportArtifact,
  IGovernanceResult,
  ExportFormat,
  ExportResult,
  CompileResult,
  CompileOptions,
  ExportOptions,
  DraftArtifactInput,
  SkillContext,
  ISemanticIdentity,
} from '@brandos/contracts'

// ─── PHASE 3 CLEANUP (3.3): SemanticIdentity alias removed ───────────────────
//
// The 'SemanticIdentity' re-export alias from this package has been removed
// as part of the ownership audit Phase 3 (2026-06-08).
//
// MIGRATION: Replace any import of 'SemanticIdentity' from this package with:
//   import type { ISemanticIdentity } from '@brandos/contracts'

// ─── ICompiler<TArtifact> ─────────────────────────────────────────────────────

/**
 * ICompiler<TArtifact> — deterministic OCL compiler for a specific artifact type.
 *
 * WHAT IT DOES:
 *   Transforms raw LLM output (a JSON string or a partially-structured object)
 *   into a fully canonical TArtifact, with all required fields populated,
 *   $schema set to 'artifact-json@2.0', and artifact_type set correctly.
 *
 * INVARIANTS (all implementations MUST uphold):
 *   1. compile() is PURE and DETERMINISTIC. Identical inputs produce identical outputs.
 *   2. compile() NEVER calls an LLM. It only parses, normalizes, and validates structure.
 *   3. compile() NEVER performs I/O (no DB reads, no network calls).
 *   4. The returned artifact MUST pass assertCompiledArtifact() (i.e., has $schema guard).
 *   5. The returned artifact MUST be ready for IGovernanceAdapter.validate() immediately.
 *
 * EDGE CASES compile() must handle (documented here for governance awareness):
 *   - raw is a string that is NOT valid JSON: compilers must throw a descriptive error.
 *   - raw is a valid JSON string but wrong schema version: normalize or reject.
 *   - raw has correct artifact_type but missing required fields: apply safe defaults.
 *   - raw has extra/unknown fields: strip silently (deterministic output).
 *
 * REGISTRATION:
 *   registry.registerCompiler(new MyCompiler())
 *   Throws if an identical artifactType is already registered.
 *
 * GENERIC PARAMETER:
 *   TArtifact — must extend ArtifactV2. Narrowed to CarouselArtifact, DeckArtifact,
 *   ReportArtifact, or a future artifact type. The default (ArtifactV2) is the
 *   type-erased fallback for generic dispatch.
 */
export interface ICompiler<TArtifact extends ArtifactV2 = ArtifactV2> {
  /**
   * The artifact type this compiler handles.
   * Must match the ArtifactType discriminant in @brandos/contracts.
   * Used as the registry key — must be unique across all registered compilers.
   */
  readonly artifactType: ArtifactType

  /**
   * Compile raw input into a canonical TArtifact.
   *
   * @param raw   - Raw LLM output string, a DraftArtifactInput, or a plain object.
   *                If object/DraftArtifactInput: serialize to JSON before OCL parsing.
   * @param options - Compilation options forwarded from the caller.
   *                  options.topic: used by some compilers for context-aware defaults.
   *                  options.tone: voice archetype override (optional).
   *                  options.provider: LLM provider tag for provenance tracking.
   *                  options.requestId: trace ID for error reporting.
   * @returns CompileResult & { artifact: TArtifact }
   *          artifact: the fully normalized, $schema-stamped artifact.
   *          durationMs: wall-clock time for the compile step (for telemetry).
   *          inputType: 'json' | 'markdown' | 'unknown' (parsed input format).
   *          slideCount / sectionCount: type-specific field count for logging.
   *
   * @throws Error if raw input cannot be parsed into a valid TArtifact structure.
   *         The error message MUST include requestId if available.
   */
  compile(
    raw: string | DraftArtifactInput | object,
    options?: CompileOptions & {
      requestId?: string
      topic?: string
      tone?: string
      provider?: string
    }
  ): CompileResult & { artifact: TArtifact }
}

// ─── IGovernanceAdapter<TArtifact> ────────────────────────────────────────────

/**
 * IGovernanceAdapter<TArtifact> — semantic validation + LLM repair for one artifact type.
 *
 * WHAT IT DOES:
 *   1. validate(): Checks a COMPILED artifact against semantic business rules.
 *      These are rules like "carousel must have 5–10 slides", "deck must have a
 *      title slide", "report sections must be unique". Purely structural/semantic.
 *   2. repair() (optional): Uses LLM to fix a failing artifact and re-enters OCL
 *      compilation via the injected recompile callback.
 *
 * INVARIANTS (all implementations MUST uphold):
 *   1. validate() is PURE. No LLM calls. No I/O. Deterministic.
 *   2. validate() operates only on TArtifact (fully compiled, $schema-stamped).
 *   3. repair() MUST use the injected callLLM callback — never raw LLM SDKs.
 *   4. repair() MUST call recompile() on the LLM output before re-validating.
 *      This ensures the repair re-enters OCL, not just raw LLM text.
 *   5. A governance adapter without repair() is validation-only (soft governance).
 *      ArtifactEngine.govern() handles a missing repair() gracefully.
 *
 * EDGE CASES:
 *   - repair() LLM returns malformed JSON: the recompile callback should throw,
 *     which govern() catches and counts as a failed repair attempt.
 *   - repair() is called with repairAttempts already at MAX_REPAIR_ATTEMPTS: the
 *     engine stops calling repair() — adapters do not need to track attempt count.
 *   - validate() is called on an artifact from a different artifactType: this is
 *     a caller bug — adapters may throw or return invalid without repair.
 *
 * REGISTRATION:
 *   registry.registerGovernance(new MyGovernanceAdapter())
 *   Replaces any existing adapter for the same artifactType (warn + replace).
 */
export interface IGovernanceAdapter<TArtifact extends ArtifactV2 = ArtifactV2> {
  /**
   * The artifact type this governance adapter handles.
   * Must match the ArtifactType discriminant in @brandos/contracts.
   */
  readonly artifactType: ArtifactType

  /**
   * Validate a COMPILED artifact against semantic business rules.
   *
   * @param artifact - A fully compiled, $schema-stamped TArtifact.
   *                   MUST have passed assertCompiledArtifact() before reaching here.
   * @returns IGovernanceResult<TArtifact>
   *          success: true if all rules pass.
   *          violations: array of rule violation descriptions (if success=false).
   *          finalRejection: human-readable summary of why validation failed.
   *
   * NOTE: This method is async for interface consistency, but implementations
   * should return synchronously (wrapped in Promise.resolve) for performance.
   */
  validate(artifact: TArtifact): Promise<IGovernanceResult<TArtifact>>

  /**
   * Attempt LLM-powered repair of a failing artifact.
   *
   * CONTRACT (enforced by ArtifactEngine.govern()):
   *   - callLLM: provided by the engine, wraps the caller-supplied repairLLM.
   *              Implementations MUST use this — never call LLMs directly.
   *   - recompile: provided by the engine. Implementations MUST call this on
   *                the LLM's repair output before returning. This re-enters OCL.
   *                Signature: (rawRepairOutput: unknown, topic: string) => TArtifact
   *
   * @param artifact    - The failing artifact (will be described in the repair prompt).
   * @param topic       - The original generation topic (used in repair prompt context).
   * @param callLLM     - Engine-injected LLM call wrapper. Takes a prompt string.
   * @param requestId   - Trace ID for error correlation in repair prompts.
   * @param recompile   - Engine-injected OCL re-entry. MUST be called on LLM output.
   * @returns IGovernanceResult<TArtifact> with the repaired (and recompiled) artifact,
   *          or a failure result if the LLM repair did not resolve the violations.
   */
  repair?(
    artifact: TArtifact,
    topic: string,
    callLLM: (prompt: string) => Promise<string>,
    requestId: string,
    recompile: (raw: unknown, topic: string) => TArtifact
  ): Promise<IGovernanceResult<TArtifact>>
}

// ─── IExporter ────────────────────────────────────────────────────────────────

/**
 * IExporter — format-specific artifact serialization.
 *
 * WHAT IT DOES:
 *   Converts a governed ArtifactV2 into a specific output format (JSON, HTML,
 *   PPTX, PDF, PNG, Canva, Figma, etc.). One exporter can support multiple
 *   artifact types and multiple formats.
 *
 * INVARIANTS:
 *   1. export() NEVER re-compiles or re-validates. It only converts format.
 *   2. export() MAY perform I/O (write to disk, call external APIs like Canva).
 *   3. export() SHOULD be idempotent — same artifact + options = same output.
 *   4. If an exporter is registered for format F and type T, it MUST be able
 *      to export any artifact of type T in format F without additional dispatch.
 *
 * REGISTRATION:
 *   registry.registerExporter(myExporter)
 *   Registers for all combinations of supportedArtifactTypes × supportedFormats.
 *   Key: `${artifactType}:${format}` (last-write-wins per key).
 *
 * EDGE CASES:
 *   - Exporter receives an artifact it supports but with unexpected field values:
 *     it should apply best-effort export, not throw (defensive rendering).
 *   - Output path in ExportOptions does not exist: the exporter must create it.
 *   - External API (Canva, Figma) returns an error: wrap in a typed Error with
 *     the requestId context for traceability.
 */
export interface IExporter {
  /**
   * Which output formats this exporter produces.
   * Typically one format, but may support multiple (e.g., ['html', 'png']).
   */
  readonly supportedFormats: ExportFormat[]

  /**
   * Which artifact types this exporter can handle.
   * If supporting all types, list them explicitly — do not use ['*'].
   */
  readonly supportedArtifactTypes: ArtifactType[]

  /**
   * Export a governed artifact to the target format.
   *
   * @param artifact - A fully governed ArtifactV2.
   * @param options  - Export options: format, outputPath, requestId, quality, etc.
   * @returns ExportResult with output path, byte size, MIME type, and metadata.
   * @throws Error with descriptive message if export fails.
   */
  export(artifact: ArtifactV2, options: ExportOptions): Promise<ExportResult>
}

// ─── IRendererAdapter ─────────────────────────────────────────────────────────

/**
 * IRendererAdapter — server-side rendering of artifacts to HTML, JSON, or PNG.
 *
 * WHAT IT DOES:
 *   Provides server-side rendering for SSR HTML export, API JSON snapshots,
 *   or PNG thumbnail generation. NOT used for React client rendering.
 *
 * DISTINCTION from IExporter:
 *   - IExporter: file-based output (PPTX, PDF, Canva). Produces bytes/paths.
 *   - IRendererAdapter: in-process output (HTML string, JSON string, PNG Buffer).
 *     Used for embedding in API responses, email, or generating preview images.
 *
 * INVARIANTS:
 *   1. render() NEVER compiles or validates. Read-only view of the artifact.
 *   2. render() MUST be pure: same artifact + options = same output.
 *   3. No LLM calls. No database writes. No side effects.
 *
 * REGISTRATION:
 *   registry.registerRenderer(myRendererAdapter)
 *   Key: `${artifactType}:${rendererFormat}` (replaces existing).
 */
export interface IRendererAdapter {
  /**
   * The artifact type this renderer handles.
   */
  readonly artifactType: ArtifactType

  /**
   * The output format this renderer produces.
   * 'html': UTF-8 string of rendered HTML.
   * 'json': UTF-8 string of the artifact serialized as API-shaped JSON.
   * 'png': Binary Buffer of a rendered thumbnail (may use headless browser).
   */
  readonly rendererFormat: 'html' | 'json' | 'png'

  /**
   * Render a canonical artifact to the target format.
   *
   * @param artifact - A fully governed ArtifactV2 (any narrowed subtype is fine).
   * @param options  - Renderer-specific options (e.g., { width: 1280, height: 720 }).
   * @returns UTF-8 string (html, json) or binary Buffer (png).
   */
  render(artifact: ArtifactV2, options?: Record<string, unknown>): Promise<string | Buffer>
}

// ─── IArtifactExecutionContext ─────────────────────────────────────────────────

/**
 * IArtifactExecutionContext — per-request execution environment.
 *
 * WHAT IT IS:
 *   A read-only snapshot of the runtime environment for a single artifact
 *   generation request. Carries identity, tracing, and injected services.
 *   Passed through compile → govern → export without mutation.
 *
 * LIFECYCLE:
 *   Created by the caller (Next.js route or API handler) before calling
 *   IArtifactEngine.compileAndGovern(). Destroyed when the request completes.
 *
 * IDENTITY RESOLUTION ORDER:
 *   1. context.identity — pre-resolved ISemanticIdentity (preferred if available)
 *   2. context.workspaceId — used to resolve identity lazily if identity is absent
 *   3. context.userId — fallback for unauthenticated or system-level calls
 *
 * SENSITIVE FIELDS:
 *   - context.supabase: a live Supabase client — do NOT log this field.
 *   - context.userId: PII — include in logs only as a short prefix (first 8 chars).
 *
 * EXTENSION GUIDANCE:
 *   If you need to add a new field to IArtifactExecutionContext, add it as an
 *   optional field here. Existing callers will not break. Update AGENT_CONTEXT.md.
 *
 * EDGE CASES:
 *   - skillContext.granted_permissions may be empty for system-level calls.
 *   - supabase may be undefined in test environments (use mock context).
 *   - identity may be undefined for new workspaces without a configured persona.
 */
export interface IArtifactExecutionContext {
  /**
   * Unique request trace ID (UUID v4).
   * Included in all log lines and error messages for correlation.
   * Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
   */
  requestId: string

  /**
   * Authenticated user ID (Supabase auth.user.id or system ID).
   * Used for audit logging. Do not use for permission checks — use
   * skillContext.granted_permissions instead.
   */
  userId: string

  /**
   * Active workspace/organization ID.
   * Used for identity resolution and multi-tenancy scoping.
   * Optional for system-level or anonymous calls.
   */
  workspaceId?: string

  /**
   * Generation mode tag (e.g., 'standard', 'fast', 'quality', 'icp').
   * Used for telemetry grouping and feature flag resolution.
   * Does not affect core compilation or governance behavior.
   */
  runtimeMode: string

  /**
   * Live Supabase client for governance repair LLM calls and event persistence.
   * Injected by the Next.js route. NOT available in test environments.
   * Use `any` here to avoid importing Supabase types into this package.
   * Governance adapters that need Supabase should receive it via this field,
   * not via a separate import.
   */
  supabase?: any // eslint-disable-line @typescript-eslint/no-explicit-any

  /**
   * Skill execution context (identity-aware, permission-carrying).
   * Forwarded to ISkill.execute() by the PlatformPluginRegistry.
   * granted_permissions controls what skills may do on behalf of the user.
   */
  skillContext: SkillContext

  /**
   * Pre-resolved SemanticIdentity for this workspace/persona.
   * If undefined, governance adapters that need identity should resolve it
   * lazily via workspaceId + supabase, or fall back to neutral defaults.
   * Populated by the caller (route) before passing into the engine.
   */
  identity?: ISemanticIdentity
}

// ─── IArtifactRegistry ────────────────────────────────────────────────────────

/**
 * IArtifactRegistry — the runtime registry surface for all engine dimensions.
 *
 * WHAT IT IS:
 *   A runtime container for four registries: compilers, governance adapters,
 *   exporters, and renderers. All dispatch in the engine goes through this registry.
 *
 * REGISTRATION vs. DISPATCH:
 *   - Registration: happens once at server startup via bootstrapArtifactEngine().
 *   - Dispatch: happens at request time via resolveXxx() methods.
 *
 * KEY DESIGN:
 *   - All lookups are by ArtifactType string key.
 *   - registerCompiler throws on duplicate; registerGovernance replaces (idempotent).
 *   - resolveCompiler throws on miss (fail-fast, expected to be registered at startup).
 *   - resolveGovernance, resolveExporter, resolveRenderer return null on miss (soft miss).
 *
 * THREAD SAFETY:
 *   The registry is populated synchronously at startup before any requests arrive.
 *   After bootstrapArtifactEngine() completes, the registry is read-only at runtime.
 *   No locking is required for concurrent reads.
 *
 * INTROSPECTION:
 *   listArtifactTypes() and isFullyRegistered() are used for health checks and
 *   admin endpoints to verify the engine is correctly initialized.
 */
export interface IArtifactRegistry {
  // ── Compiler registry ─────────────────────────────────────────────────────

  /**
   * Register a compiler for an artifact type.
   * @throws Error if a compiler is already registered for compiler.artifactType.
   *         Call registry.deregister() first if replacement is intended.
   */
  registerCompiler<T extends ArtifactV2>(compiler: ICompiler<T>): this

  /**
   * Resolve a compiler for the given artifact type.
   * @throws Error if no compiler is registered for artifactType.
   *         This is a fail-fast guard — missing compilers indicate a bootstrap bug.
   */
  resolveCompiler<T extends ArtifactV2>(artifactType: ArtifactType): ICompiler<T>

  // ── Governance registry ───────────────────────────────────────────────────

  /**
   * Register a governance adapter for an artifact type.
   * Replaces any existing adapter (last-write-wins with a console.warn).
   * This allows hot-swapping governance adapters in testing environments.
   */
  registerGovernance<T extends ArtifactV2>(adapter: IGovernanceAdapter<T>): this

  /**
   * Resolve governance for an artifact type.
   * Returns null if no adapter is registered — the engine treats this as a bypass.
   * A bypass is logged as a warning; it is NOT a hard error (allows ungovernanced types).
   */
  resolveGovernance<T extends ArtifactV2>(artifactType: ArtifactType): IGovernanceAdapter<T> | null

  // ── Exporter registry ──────────────────────────────────────────────────────

  /**
   * Register an exporter.
   * One exporter may cover multiple artifact types × multiple formats.
   * Registration key: `${artifactType}:${format}` (last-write-wins per key).
   * Multiple exporters may be registered for overlapping (type, format) pairs;
   * the last registered wins.
   */
  registerExporter(exporter: IExporter): this

  /**
   * Resolve an exporter for the given artifact type and format.
   * Returns null if no exporter is registered for this (type, format) pair.
   * The engine throws an ArtifactEngineError (not ArtifactEngineRejection) on null.
   */
  resolveExporter(artifactType: ArtifactType, format: ExportFormat): IExporter | null

  // ── Renderer registry ──────────────────────────────────────────────────────

  /**
   * Register a renderer adapter.
   * Registration key: `${artifactType}:${rendererFormat}` (replaces existing).
   */
  registerRenderer(adapter: IRendererAdapter): this

  /**
   * Resolve a renderer for the given artifact type and format.
   * Returns null if no renderer is registered — callers handle null (soft miss).
   */
  resolveRenderer(artifactType: ArtifactType, format: 'html' | 'json' | 'png'): IRendererAdapter | null

  // ── Introspection ──────────────────────────────────────────────────────────

  /**
   * List all artifact types that have at least one dimension registered.
   * Used for health checks and admin observability.
   * A type appears in this list if it has a compiler OR a governance adapter.
   */
  listArtifactTypes(): ArtifactType[]

  /**
   * Check whether all REQUIRED dimensions are registered for an artifact type.
   * Required dimensions: compiler + governance adapter.
   * Exporters and renderers are optional (not required for compile+govern flow).
   *
   * @returns true if and only if both compiler and governance adapter are registered.
   */
  isFullyRegistered(artifactType: ArtifactType): boolean
}

// ─── IArtifactEngine ──────────────────────────────────────────────────────────

/**
 * IArtifactEngine — the orchestration abstraction for all artifact execution.
 *
 * WHAT IT IS:
 *   The canonical entry point for the artifact generation pipeline. It orchestrates:
 *     compile → govern → [repair loop] → export
 *   across all registered artifact types via registry dispatch.
 *
 * ARCHITECTURE LAWS (enforced internally, documented here for agents):
 *
 *   LAW 1 — OCL-first:
 *     ICompiler.compile() ALWAYS runs before IGovernanceAdapter.validate().
 *     assertCompiledArtifact() enforces this at three checkpoints.
 *
 *   LAW 2 — Repair re-enters OCL:
 *     IGovernanceAdapter.repair() receives a recompile callback. It MUST call it
 *     on the LLM repair output. The engine validates this with POST-REPAIR-COMPILE guard.
 *
 *   LAW 3 — No artifact-type branching:
 *     The engine dispatches ONLY via registry lookup. No `if (artifactType === 'carousel')`
 *     in engine.ts. All type-specific logic lives in compiler/governance adapters.
 *
 *   LAW 4 — LLM is injected, never called directly:
 *     repairLLM is always provided by the caller. The engine never calls an LLM SDK.
 *
 *   LAW 5 — MAX_REPAIR_ATTEMPTS = 2:
 *     The repair loop runs at most 2 iterations. After 2 failures, govern() returns
 *     a failed IGovernanceResult; compileAndGovern() throws ArtifactEngineRejection.
 *
 * PIPELINE ENTRY POINTS (in order of preference):
 *   1. compileAndGovern()  → compile + govern (most common; use this)
 *   2. compileAndExport()  → compile + govern + export (if export is needed too)
 *   3. compile()           → compile only (for testing or pre-validation)
 *   4. govern()            → govern only (if artifact is already compiled)
 *   5. export()            → export only (if artifact is already governed)
 *   6. remix()             → modify an existing artifact (requires repairLLM)
 *
 * REMIX STATUS: remix() is defined in the interface but throws NotImplemented in
 * the current engine. It will be implemented when LLM callback injection via
 * IArtifactExecutionContext.skillContext is finalized.
 * See: skillContext.capabilities['output.repair'] for the planned wiring.
 */
export interface IArtifactEngine {
  /**
   * Access the underlying registry for registration and introspection.
   * Consumers may use this to register custom exporters or renderers at runtime.
   */
  readonly registry: IArtifactRegistry

  /**
   * Compile raw input into a canonical ArtifactV2 via the registered ICompiler.
   *
   * WHEN TO USE: Testing, or when you need to inspect the compiled artifact
   * before running governance separately. In production, prefer compileAndGovern().
   *
   * @param artifactType - Discriminant for registry lookup.
   * @param input        - Raw LLM output string, DraftArtifactInput, or object.
   * @param options      - topic, tone, provider, requestId for the compiler.
   * @returns CompileResult with the type-erased ArtifactV2.
   *          Narrow the artifact with isCarouselArtifact() etc. from @brandos/contracts.
   * @throws Error if no compiler is registered for artifactType.
   * @throws Error if the compiled artifact fails the $schema guard (OCL bug).
   */
  compile(
    artifactType: ArtifactType,
    input: string | DraftArtifactInput | object,
    options?: CompileOptions & { requestId?: string; topic?: string; tone?: string }
  ): Promise<CompileResult>

  /**
   * Run semantic governance on a pre-compiled ArtifactV2.
   *
   * WHEN TO USE: When you already have a compiled artifact (e.g., from compile())
   * and want to run governance separately. In production, prefer compileAndGovern().
   *
   * REPAIR LOOP BEHAVIOR:
   *   - If validate() fails and repairLLM is provided and repair() is implemented:
   *     runs up to MAX_REPAIR_ATTEMPTS repair iterations.
   *   - Each repair iteration: repair() → recompile (OCL re-entry) → validate().
   *   - Returns a failed IGovernanceResult if all repair attempts are exhausted.
   *   - Does NOT throw ArtifactEngineRejection (that is compileAndGovern()'s job).
   *
   * @param artifact    - A compiled, $schema-stamped ArtifactV2.
   * @param context     - Per-request execution environment (identity, tracing).
   * @param repairLLM   - Optional. LLM callback for repair. If absent, no repair runs.
   * @returns IGovernanceResult<ArtifactV2> — success/failure with optional repaired artifact.
   * @throws Error if artifact fails PRE-GOVERNANCE assertCompiledArtifact() guard.
   */
  govern(
    artifact: ArtifactV2,
    context: IArtifactExecutionContext,
    repairLLM?: (prompt: string) => Promise<string>
  ): Promise<IGovernanceResult<ArtifactV2>>

  /**
   * Compile and govern in one call. THE CANONICAL PIPELINE ENTRY.
   *
   * WHEN TO USE: Always, unless you have a specific reason to separate compile/govern.
   *
   * Internally: compile() → govern() with repair loop wired to re-enter compile().
   *
   * @param artifactType - Discriminant for registry lookup.
   * @param input        - Raw LLM output string, DraftArtifactInput, or object.
   * @param context      - Per-request environment (requestId, identity, supabase).
   * @param options      - CompileOptions (topic, tone, provider).
   * @param repairLLM    - Optional LLM callback for governance repair.
   * @returns { artifact, governanceResult } — the governed artifact and its result.
   * @throws ArtifactEngineRejection if governance ultimately fails after all repair attempts.
   *         Check isArtifactEngineRejection(err) in catch blocks.
   */
  compileAndGovern(
    artifactType: ArtifactType,
    input: string | DraftArtifactInput | object,
    context: IArtifactExecutionContext,
    options?: CompileOptions,
    repairLLM?: (prompt: string) => Promise<string>
  ): Promise<{ artifact: ArtifactV2; governanceResult: IGovernanceResult<ArtifactV2> }>

  /**
   * Export a governed artifact to the target format.
   *
   * WHEN TO USE: After compileAndGovern(), when file-based output is needed.
   *
   * @param artifact - A fully governed ArtifactV2.
   * @param options  - ExportOptions: format, outputPath, requestId, quality, etc.
   * @returns ExportResult with output path, bytes, MIME type.
   * @throws Error if no exporter is registered for (artifactType, format).
   */
  export(artifact: ArtifactV2, options: ExportOptions): Promise<ExportResult>

  /**
   * Compile, govern, and export in one call.
   *
   * WHEN TO USE: When the caller needs the exported file immediately after generation,
   * without inspecting the intermediate governed artifact.
   *
   * NOTE (Wave 2 — Phase 2.6): This implementation DOES run governance between compile
   * and export. The prior "TODO: Wire in governance" is resolved — engine.ts calls
   * compileAndGovern() internally before exporting. If you only need the governed
   * artifact without an export step, prefer compileAndGovern() directly.
   *
   * @returns { compile: CompileResult, export: ExportResult }
   */
  compileAndExport(
    artifactType: ArtifactType,
    input: string | DraftArtifactInput | object,
    compileOptions: CompileOptions,
    exportOptions: ExportOptions,
    context: IArtifactExecutionContext
  ): Promise<{ compile: CompileResult; export: ExportResult }>

  /**
   * Remix an existing artifact with a natural language instruction.
   *
   * @planned — Phase 2.5 decision: Option B applied.
   * STATUS: NOT YET IMPLEMENTED. Engine throws NotImplemented on call.
   * Do not call remix() in production — it will throw immediately.
   * Implementation is tracked as Phase 3F-2 in the overlap removal plan.
   *
   * PLANNED BEHAVIOR:
   *   1. Serialize the existing artifact to a remix-prompt string.
   *   2. Apply the instruction via LLM (injected via context.skillContext).
   *   3. Re-compile the LLM output through the registered ICompiler.
   *   4. Re-govern the recompiled artifact.
   *   5. Return the final remixed, governed artifact.
   *
   * PLANNED LLM INJECTION:
   *   context.skillContext.capabilities['output.repair'] will carry the LLM callback.
   *   See TODO in engine.ts for the implementation plan.
   *
   * @param artifact    - The existing governed artifact to remix.
   * @param instruction - Natural language remix instruction (e.g., "make it more bold").
   * @param context     - Per-request environment (must carry LLM callback).
   * @throws Error until implementation is complete.
   */
  remix(
    artifact: ArtifactV2,
    instruction: string,
    context: IArtifactExecutionContext
  ): Promise<ArtifactV2>

  /**
   * List available export formats, optionally filtered by artifact type.
   *
   * NOTE: The current implementation returns a static list of known formats.
   * A future implementation will query the registry for dynamically registered exporters.
   * See TODO in engine.ts.
   *
   * @param artifactType - If provided, filter to formats registered for this type.
   * @returns Array of ExportFormat values.
   */
  availableFormats(artifactType?: ArtifactType): ExportFormat[]
}

// ─── ArtifactEngineRejection ───────────────────────────────────────────────────

/**
 * ArtifactEngineRejection — typed error thrown by compileAndGovern() on governance failure.
 *
 * WHEN IT IS THROWN:
 *   compileAndGovern() throws this when IGovernanceAdapter.validate() fails
 *   AND all MAX_REPAIR_ATTEMPTS repair iterations are exhausted.
 *
 * WHEN IT IS NOT THROWN:
 *   govern() does NOT throw this — it returns a failed IGovernanceResult.
 *   compile() does NOT throw this — it throws a plain Error on parse failure.
 *
 * CALLER PATTERN:
 *   ```typescript
 *   try {
 *     const { artifact } = await engine.compileAndGovern(...)
 *   } catch (err) {
 *     if (isArtifactEngineRejection(err)) {
 *       // err.artifactType: which type failed
 *       // err.reason: the final violation description
 *       // err.repairAttempts: how many LLM repair attempts were made (0, 1, or 2)
 *       // err.requestId: for log correlation
 *     }
 *     throw err // re-throw unknown errors
 *   }
 *   ```
 *
 * OBSERVABILITY:
 *   All four fields are included in the error message string for log scraping:
 *   "[ArtifactEngine] Governance rejected {artifactType} after {repairAttempts} attempts: {reason}"
 */
export class ArtifactEngineRejection extends Error {
  /**
   * @param artifactType      - The artifact type that failed governance.
   * @param reason            - Human-readable description of the governance failure.
   * @param repairAttempts    - Number of LLM repair attempts made (0 if no repairLLM).
   * @param requestId         - Trace ID for correlating with engine logs.
   * @param lastValidArtifact - P3-RECOVERY: the last compiled artifact from the repair
   *                            loop, even if governance rejected it. Callers can use
   *                            this to render a degraded artifact rather than show
   *                            nothing. The artifact is NOT governance-approved — callers
   *                            must set recoverable_issues=true and display a warning.
   *                            May be undefined if compilation itself failed (no artifact
   *                            was ever produced).
   */
  constructor(
    public readonly artifactType: ArtifactType,
    public readonly reason: string,
    public readonly repairAttempts: number,
    public readonly requestId: string,
    public readonly lastValidArtifact?: ArtifactV2 | undefined,
  ) {
    super(
      `[ArtifactEngine] Governance rejected ${artifactType} after ${repairAttempts} repair attempts: ${reason}`
    )
    this.name = 'ArtifactEngineRejection'
    // Capture V8 stack trace correctly (excludes this constructor frame)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ArtifactEngineRejection)
    }
  }
}

/**
 * Type guard for ArtifactEngineRejection.
 *
 * USAGE: Use in catch blocks to distinguish governance failures from other errors.
 *
 * @param err - Any unknown caught error.
 * @returns true if err is an ArtifactEngineRejection instance.
 */
export function isArtifactEngineRejection(err: unknown): err is ArtifactEngineRejection {
  return err instanceof ArtifactEngineRejection
}


