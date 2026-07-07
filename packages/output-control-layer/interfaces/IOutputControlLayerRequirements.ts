// ============================================================
// @brandos/output-control-layer — interfaces/IOutputControlLayerRequirements.ts
//
// Defines what OCL REQUIRES from its environment.
// Injected dependencies only — no direct imports from other packages.
//
// This interface enables full test isolation: a test harness can
// satisfy IOutputControlLayerRequirements with mocks without
// spinning up any real infrastructure.
// ============================================================

// No imports — this file declares only injected-dependency shapes.

// ─── Injected LLM callback ────────────────────────────────────────────────────

/**
 * LLMRepairCallback — injected by the orchestrator (CPL) when LLM repair is enabled.
 *
 * OCL calls this only from repairWithLLM(), gated by NormalizeOptions.enableLLMRepair.
 * OCL never imports @brandos/ai-runtime-layer — the orchestrator bridges the gap.
 */
export type LLMRepairCallback = (prompt: string) => Promise<string>;

// ─── Contributor requirements ─────────────────────────────────────────────────
//
// PLATFORM SPLIT: the former IBrandIntelligenceContext / IContributorRequirements
// types declared here were an unused, second local approximation of brand
// cognition's shape — never actually wired into ContributorContext (see
// generation-contract.ts, which defines the real `cognitionContext` field
// contributors read). Removed rather than updated, per the architecture's own
// prohibition on locally-declared cognition shapes. The single canonical shape
// now lives at @platform/cognition-contract's CognitionContext.

// ─── ContractAssemblerFactory requirements ────────────────────────────────────

/**
 * IContractAssemblerFactoryOptions — configuration for creating a
 * ContractAssembler instance without global state.
 *
 * Pass contributor instances explicitly so each factory call is isolated.
 */
export interface IContractAssemblerFactoryOptions {
  /**
   * Named contributor set. If omitted, no contributors are registered —
   * ContractAssembler will use fallback defaults for all slots.
   *
   * 'default' = IdentityContributor + PersonaContributor + IntentContributor
   *            + ArtifactContributor + RuntimeContributor
   */
  contributorSet?: 'default' | 'none';

  /**
   * Additional custom contributors to register after the named set.
   * Keys are ResolvedGenerationContract slot names.
   */
  additionalContributors?: Record<string, unknown>;
}

// ─── Full requirements surface ────────────────────────────────────────────────

/**
 * IOutputControlLayerRequirements — everything OCL needs injected from outside.
 *
 * When unit-testing OCL, construct a mock of this interface and pass it
 * to the relevant factory/initializer. OCL will never reach for globals.
 */
export interface IOutputControlLayerRequirements {
  /** Optional LLM repair callback — injected only when enableLLMRepair=true */
  llmRepair?: LLMRepairCallback;
}


