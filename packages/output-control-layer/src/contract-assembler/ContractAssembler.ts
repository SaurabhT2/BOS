/**
 * @brandos/contracts — contract-assembler.ts
 *
 * ContractAssembler: Wires contributor instances and resolves the full
 * ResolvedGenerationContract by invoking each contributor in parallel.
 *
 * Design principles (from implementation-rules.md):
 *   - Additive: contributors are registered, not hardcoded
 *   - Graceful: any contributor returning null falls back to typed default
 *   - Backward-compat: missing contributors produce the same result as
 *     the current implicit fragment-based approach
 *
 * This class is instantiated once (singleton pattern matching BrandOS conventions)
 * and contributors are registered during bootstrapArtifactEngine() / initControlPlane().
 */

import type {
  ResolvedGenerationContract,
  IContractAssembler,
  IContractContributor,
  ContributorContext,
  IIdentityContribution,
  IPersonaContribution,
  IIntentContribution,
  IArtifactContribution,
  IRuntimeContribution,
  ISkillContribution,
} from '@brandos/contracts';
import { CAROUSEL_STRUCTURAL_CONSTRAINTS } from '@brandos/contracts';

// ---------------------------------------------------------------------------
// Fallback values — mirror current implicit behavior so absence of a
// contributor produces the same result as before the contract was introduced
// ---------------------------------------------------------------------------

function defaultIdentity(): IIdentityContribution {
  return { confidence: 0 };
}

function defaultPersona(): IPersonaContribution {
  return { tone: 'professional', voice: 'direct' };
}

function defaultArtifact(): IArtifactContribution {
  return {
    schema: 'artifact-json@2.0',
    requiredRoles: [...CAROUSEL_STRUCTURAL_CONSTRAINTS.requiredRoles], // derived — not hardcoded
    schemaInstruction: '',
  };
}

// ---------------------------------------------------------------------------
// ContractAssembler
// ---------------------------------------------------------------------------

export class ContractAssembler implements IContractAssembler {
  private readonly _contributors = new Map<
    keyof ResolvedGenerationContract,
    IContractContributor<unknown>
  >();

  register<T>(
    slot: keyof ResolvedGenerationContract,
    contributor: IContractContributor<T>
  ): void {
    this._contributors.set(slot, contributor as IContractContributor<unknown>);
  }

  async assemble(context: ContributorContext): Promise<ResolvedGenerationContract> {
    // Run all registered contributors in parallel; failures return null.
    const slots: Array<keyof ResolvedGenerationContract> = [
      'identity',
      'persona',
      'intent',
      'artifact',
      'runtime',
      'skill',
    ];

    const results = await Promise.all(
      slots.map(async (slot) => {
        const contributor = this._contributors.get(slot);
        if (!contributor) return [slot, null] as const;
        try {
          const value = await contributor.contribute(context);
          return [slot, value] as const;
        } catch (err) {
          // Never propagate contributor errors — graceful degradation
         // console.warn(`[ContractAssembler] Contributor "${slot}" threw:`, err);
          return [slot, null] as const;
        }
      })
    );

    // Assemble with typed fallbacks for required fields
    const raw = Object.fromEntries(results) as Record<string, unknown>;

    // intent and runtime are required — throw only if they are missing AND
    // no contributor is registered (this would be a bootstrap misconfiguration)
    const intent = (raw.intent as IIntentContribution | null) ?? buildFallbackIntent(context);
    const runtime = (raw.runtime as IRuntimeContribution | null) ?? buildFallbackRuntime(context);

    const contract: ResolvedGenerationContract = {
      intent,
      runtime,
      identity: (raw.identity as IIdentityContribution | null) ?? defaultIdentity(),
      persona: (raw.persona as IPersonaContribution | null) ?? defaultPersona(),
      artifact: (raw.artifact as IArtifactContribution | null) ?? defaultArtifact(),
    };

    // skill is truly optional — only attach if contributor produced a value
    const skill = raw.skill as ISkillContribution | null;
    if (skill) contract.skill = skill;

    // PLATFORM SPLIT: styleProjection promotion removed. Raw IStyleProjection
    // never crosses the BrandOS boundary anymore — see
    // ResolvedGenerationContract in generation-contract.ts. Identity data now
    // flows exclusively through contract.identity (IIdentityContribution),
    // populated by IdentityContributor from ContributorContext.cognitionContext.identity.

    return contract;
  }
}

function buildFallbackIntent(ctx: ContributorContext): IIntentContribution {
  return {
    taskType: ctx.taskType,
    topic: ctx.userPrompt.slice(0, 120),
    confidence: 1,
    ambiguityLevel: 'none',
    userPrompt: ctx.userPrompt,
  };
}

function buildFallbackRuntime(ctx: ContributorContext): IRuntimeContribution {
  return {
    qualityThreshold: 65,
    maxAttempts: 3,
    autoRegenerate: true,
    attempt: ctx.attempt,
    runtimeMode: ctx.runtimeMode,
  };
}

// ---------------------------------------------------------------------------
// Singleton — matches BrandOS globalThis singleton pattern
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __brandos_contract_assembler: ContractAssembler | undefined;
}

export function getContractAssembler(): ContractAssembler {
  if (!globalThis.__brandos_contract_assembler) {
    globalThis.__brandos_contract_assembler = new ContractAssembler();
  }
  return globalThis.__brandos_contract_assembler;
}


