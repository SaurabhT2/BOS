/**
 * @brandos/control-plane-layer — contributors/index.ts
 *
 * Phase 1 contributor implementations:
 *   - RuntimeContributor
 *   - ArtifactContributor
 *
 * IdentityContributor, PersonaContributor, IntentContributor have been moved
 * to @brandos/output-control-layer. Import them from there:
 *   import { IdentityContributor, PersonaContributor, IntentContributor }
 *     from '@brandos/output-control-layer'
 *
 * Phase 2: ISkillContributor (kept as a stub, not wired to canonical path)
 */

import type {
  IContractContributor,
  ContributorContext,
  IArtifactContribution,
  IRuntimeContribution,
  ISkillContribution,
} from '@brandos/contracts';
import { CAROUSEL_SCHEMA_INSTRUCTION, DECK_SCHEMA_INSTRUCTION } from '@brandos/contracts';
import {
  CAROUSEL_STRUCTURAL_CONSTRAINTS,
  DECK_STRUCTURAL_CONSTRAINTS,
  REPORT_STRUCTURAL_CONSTRAINTS,
} from '@brandos/governance-config'; // Structural constraints — single source of truth

// ---------------------------------------------------------------------------
// RuntimeContributor
// Wraps: router.ts routeRequest() RoutingHint + AdminSettingsService
// ---------------------------------------------------------------------------

export class RuntimeContributor implements IContractContributor<IRuntimeContribution> {
  readonly contributorId = 'runtime';

  async contribute(
    context: ContributorContext & {
      qualityThreshold?: number;
      maxAttempts?: number;
      autoRegenerate?: boolean;
      maxCostUsd?: number;
      maxLatencyMs?: number;
    }
  ): Promise<IRuntimeContribution> {
    return {
      qualityThreshold: context.qualityThreshold ?? 65,
      maxAttempts: context.maxAttempts ?? 3,
      autoRegenerate: context.autoRegenerate ?? true,
      attempt: context.attempt,
      runtimeMode: context.runtimeMode,
      maxCostUsd: context.maxCostUsd,
      maxLatencyMs: context.maxLatencyMs,
    };
  }
}

// ---------------------------------------------------------------------------
// ArtifactContributor
// Wraps: ArtifactEngine registry — resolves schema and required roles
// per task type. Fixes B7: single source of truth for schema instruction.
// ---------------------------------------------------------------------------

export class ArtifactContributor implements IContractContributor<IArtifactContribution> {
  readonly contributorId = 'artifact';

  async contribute(context: ContributorContext): Promise<IArtifactContribution | null> {
    switch (context.taskType) {
      case 'carousel':
        return {
          schema: 'artifact-json@2.0',
          requiredRoles: [...CAROUSEL_STRUCTURAL_CONSTRAINTS.requiredRoles],
          minSlides: CAROUSEL_STRUCTURAL_CONSTRAINTS.minSlides,
          maxSlides: CAROUSEL_STRUCTURAL_CONSTRAINTS.maxSlides,
          qualityThreshold: 72,
          // This is now the SINGLE source of truth for carousel schema instructions.
          // AIRuntimeAdapter.run() must be updated to NOT inject carousel schema
          // once this contributor is wired. See prompt-compiler.ts migration note.
          schemaInstruction: CAROUSEL_SCHEMA_INSTRUCTION,
        };

      case 'deck':
        // B8/B9: Deck is wired in routing but has no compiler registered.
        // ArtifactContributor returns the schema definition now;
        // DeckCompiler registration is a separate deliverable.
        return {
          schema: 'artifact-json@2.0',
          requiredRoles: [...DECK_STRUCTURAL_CONSTRAINTS.requiredRoles],
          minSlides: DECK_STRUCTURAL_CONSTRAINTS.minSlides,
          maxSlides: DECK_STRUCTURAL_CONSTRAINTS.maxSlides,
          qualityThreshold: 70,
          schemaInstruction: DECK_SCHEMA_INSTRUCTION,
        };

      default:
        // Text tasks (post, article) — no artifact schema required
        return null;
    }
  }
}

// ---------------------------------------------------------------------------
// ISkillContributor (Phase 2 stub — historical reference only)
//
// MOVED 2026-06-21 (Phase 2.6 gate-lift): the live, registered implementation
// is now @brandos/output-control-layer's SkillContributor
// (contract-assembler/contributors/SkillContributor.ts), registered in
// ContractAssemblerFactory's 'default' contributor set. This copy was never
// passed to the factory and has never affected any generation request.
// Kept here only because bootstrap-contract.ts's RETIRED header references it;
// do not register this copy — it would create a second, divergent definition
// of the same contributor slot.
// ---------------------------------------------------------------------------

export class ISkillContributor implements IContractContributor<ISkillContribution> {
  readonly contributorId = 'skill';

  async contribute(context: ContributorContext): Promise<ISkillContribution | null> {
    // Phase 2 guard: only contribute if ISkill feature flag is explicitly enabled
    const featureFlagEnabled =
      typeof globalThis !== 'undefined' &&
      (globalThis as Record<string, unknown>).__brandos_iskill_contract_contributor === true;

    if (!featureFlagEnabled) return null;

    // carousel-founder lifecycle — workflow from CarouselFounderLifecycle
    if (context.taskType === 'carousel') {
      return {
        skillId: 'carousel-founder',
        workflow: ['hook', 'problem', 'framework', 'evidence', 'CTA'],
        validationStrategy: 'semantic-governance',
        successCriteria: [
          'Hook slide uses contrarian or data-led framing',
          'Framework slide includes actionable step or model',
          'CTA is specific and actionable',
          'All slides pass richness threshold',
        ],
      };
    }

    return null;
  }
}

// SPRINT1-CHANGE-F: DECK_SCHEMA_INSTRUCTION imported from @brandos/contracts (see import above)


