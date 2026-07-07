// ============================================================
// @brandos/output-control-layer — interfaces/IContractAssembler.ts
//
// Defines the ContractAssembler boundary and factory.
//
// OWNERSHIP:
//   ContractAssembler owns contract assembly only.
//   It does NOT own: prompt compilation, normalization, artifact compilation.
//
// EXTENSION RULES:
//   New contributors: implement IContractContributor<T> from @brandos/contracts
//   and register via ContractAssemblerFactory.create({ additionalContributors }).
//   Do NOT call getContractAssembler() in new code — it is a legacy accessor.
// ============================================================

import type {
  ResolvedGenerationContract,
  IContractAssembler as IContractAssemblerBase,
  IContractContributor,
  ContributorContext,
} from '@brandos/contracts';

import type { IContractAssemblerFactoryOptions } from './IOutputControlLayerRequirements';

// ─── Re-export base interface ─────────────────────────────────────────────────

/**
 * IContractAssembler — the public contract for contract assembly.
 *
 * Extends the base from @brandos/contracts with an explicit register() method
 * documented at the OCL boundary level.
 *
 * INVARIANT: assemble() must never throw. On contributor failure, the slot
 * falls back to the default value. Errors are swallowed internally.
 */
export interface IContractAssembler extends IContractAssemblerBase {
  /**
   * Register a contributor for a named slot.
   *
   * ADDITIVE ONLY: registering the same slot twice overwrites the prior
   * contributor. This is intentional for test overrides.
   *
   * THREAD SAFETY: not safe for concurrent registration during assembly.
   * Register all contributors before the first assemble() call.
   */
  register<T>(
    slot: keyof ResolvedGenerationContract,
    contributor: IContractContributor<T>
  ): void;

  /**
   * Assemble — invoke all registered contributors in parallel and return
   * a complete ResolvedGenerationContract with typed fallbacks.
   *
   * GUARANTEED: always returns a non-null contract.
   * GUARANTEED: never propagates contributor errors.
   * GUARANTEED: intent and runtime slots always have values (fallback or contributed).
   */
  assemble(context: ContributorContext): Promise<ResolvedGenerationContract>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * IContractAssemblerFactory — creates isolated ContractAssembler instances.
 *
 * PREFER this over getContractAssembler() for all new code.
 * Each factory call returns a fresh instance with no shared state.
 *
 * Usage:
 *   const assembler = ContractAssemblerFactory.create({ contributorSet: 'default' });
 *   const contract = await assembler.assemble(context);
 */
export interface IContractAssemblerFactory {
  create(options?: IContractAssemblerFactoryOptions): IContractAssembler;
}


