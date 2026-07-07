/**
 * @brandos/output-control-layer — contract-assembler/contributors/SkillContributor.ts
 *
 * Provides the optional ISkillContribution slice — ordered workflow stages and
 * success criteria for a registered ISkill, injected into the LLM prompt as
 * narrative structure guidance by compilePromptFromContract().
 *
 * ─── ACTIVATION HISTORY ──────────────────────────────────────────────────────
 *
 * Phase 2.6 gate-lift (2026-06-21): this contributor was previously defined in
 * @brandos/control-plane-layer (contributors/index.ts) as a stub that was never
 * passed to ContractAssemblerFactory.create() — registering it there would have
 * been a no-op regardless of the feature flag. It has been moved here, beside
 * its four siblings, and registered in the 'default' contributor set so the
 * existing flag actually takes effect.
 *
 * ISkill remains a contract contributor only, not a pipeline replacement:
 * this contributes workflow/success-criteria guidance into the prompt contract.
 * It does not invoke SkillRuntime.execute()'s separate validate→prepare→
 * execute→govern→repair→finalize→export lifecycle — that lifecycle continues
 * to run only where explicitly invoked (currently nowhere in the canonical
 * generation path), and governance for contributor-influenced output continues
 * to flow through the existing artifact-engine governance pipeline unchanged.
 *
 * Feature flag: globalThis.__brandos_iskill_contract_contributor
 *   - true  → contribute() may return a non-null ISkillContribution
 *   - false/undefined → contribute() always returns null (graceful no-op,
 *     ContractAssembler attaches no `skill` slot, behavior identical to
 *     before this contributor existed)
 *
 * Do not increase scope beyond the registered reference skill below without
 * a corresponding entry in @brandos/iskill-runtime's skill registry — this
 * contributor's branches must stay 1:1 with skills that are actually
 * registered and validated there (currently: carousel-founder).
 */

import type {
  IContractContributor,
  ContributorContext,
  ISkillContribution,
} from '@brandos/contracts';

// ---------------------------------------------------------------------------
// SkillContributor
// ---------------------------------------------------------------------------

export class SkillContributor implements IContractContributor<ISkillContribution> {
  readonly contributorId = 'skill';

  async contribute(context: ContributorContext): Promise<ISkillContribution | null> {
    // Phase 2.6 gate: only contribute if the ISkill feature flag is explicitly enabled.
    const featureFlagEnabled =
      typeof globalThis !== 'undefined' &&
      (globalThis as Record<string, unknown>).__brandos_iskill_contract_contributor === true;

    if (!featureFlagEnabled) return null;

    // carousel-founder — registered reference skill (iskill-runtime/src/skills/carousel-founder.ts)
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
