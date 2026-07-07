// ============================================================
// @brandos/output-control-layer — interfaces/IOutputControlLayer.ts
//
// PRIMARY INTERFACE BOUNDARY
//
// Defines the complete public contract for the output-control-layer.
// All external consumers must depend on this interface, never on
// concrete implementations.
//
// INVARIANTS:
//   - All operations are stateless and pure (no side effects)
//   - No LLM calls except via injected callLLM callback
//   - No database access, no telemetry, no routing
//   - All outputs are deterministic given the same input
// ============================================================

import type {
  AIRuntimeOutput,
  NormalizedOutput,
  NormalizeOptions,
  ResolvedGenerationContract,
  ContributorContext,
  DraftArtifactInput,
} from '@brandos/contracts';

import type { CompiledPrompt } from '../src/prompt-compiler/compilePromptFromContract';
import type { OCLCompileResult } from '../src/artifact-compiler/compilers/carouselCompiler';
import type { OCLDeckCompileResult } from '../src/artifact-compiler/compilers/deckCompiler';
import type { OCLReportCompileResult } from '../src/artifact-compiler/compilers/reportCompiler';

// ─── Pre-generation contract ──────────────────────────────────────────────────

/**
 * IContractAssemblerFacade — wraps ContractAssembler in the OCL boundary.
 * External callers receive a ResolvedGenerationContract without touching
 * internal contributor wiring.
 */
export interface IContractAssemblerFacade {
  assemble(context: ContributorContext): Promise<ResolvedGenerationContract>;
}

// ─── Pre-generation prompt ────────────────────────────────────────────────────

/**
 * IPromptCompiler — deterministic prompt assembly from a typed contract.
 */
export interface IPromptCompiler {
  compile(contract: ResolvedGenerationContract): CompiledPrompt;
}

// ─── Post-generation normalization ───────────────────────────────────────────

/**
 * IOutputNormalizer — orchestrates the clean→extract→repair→transform pipeline.
 */
export interface IOutputNormalizer {
  normalize(input: AIRuntimeOutput, options: NormalizeOptions): Promise<NormalizedOutput>;
}

// ─── Post-generation artifact compilation ────────────────────────────────────

/**
 * IArtifactCompiler — compiles a DraftArtifactInput into canonical ArtifactV2.
 */
export interface IArtifactCompiler {
  compileCarousel(draft: DraftArtifactInput | string): OCLCompileResult;
  compileDeck(draft: DraftArtifactInput | string): OCLDeckCompileResult;
  compileReport(draft: DraftArtifactInput | string): OCLReportCompileResult;
}

// ─── Full OCL facade ──────────────────────────────────────────────────────────

/**
 * IOutputControlLayer — the single interface describing the complete
 * capability set of @brandos/output-control-layer.
 *
 * Ownership boundaries:
 *   OWNS: contract assembly, prompt compilation, output normalization, artifact compilation
 *   DOES NOT OWN: LLM execution, routing, governance, telemetry, persistence
 */
export interface IOutputControlLayer
  extends IContractAssemblerFacade,
    IPromptCompiler,
    IOutputNormalizer,
    IArtifactCompiler {}


