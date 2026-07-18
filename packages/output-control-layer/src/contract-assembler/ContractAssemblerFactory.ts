// ============================================================
// @brandos/output-control-layer — src/contract-assembler/ContractAssemblerFactory.ts
//
// REPLACES: getContractAssembler() singleton pattern
//
// ContractAssemblerFactory creates isolated ContractAssembler instances.
// No global mutable state. Each create() call returns a fresh instance.
//
// MIGRATION GUIDE:
//   Old: const assembler = getContractAssembler()
//   New: const assembler = ContractAssemblerFactory.create({ contributorSet: 'default' })
//
// WHY:
//   - Singleton makes parallel testing impossible (shared registered state)
//   - Factory allows test isolation via contributor overrides
//   - Factory enables per-request assemblers for full isolation
//   - Enables multi-agent parallel work on OCL without state collision
//
// BACKWARD COMPAT:
//   getContractAssembler() still works — it delegates to this factory.
//   New code must use ContractAssemblerFactory.create() directly.
// ============================================================

import { ContractAssembler } from './ContractAssembler';
import { IdentityContributor } from './contributors/IdentityContributor';
import { PersonaContributor }  from './contributors/PersonaContributor';
import { IntentContributor }   from './contributors/IntentContributor';
import { ArtifactContributor } from './contributors/ArtifactContributor';
import { RuntimeContributor }  from './contributors/RuntimeContributor';
import { SkillContributor }    from './contributors/SkillContributor';
import { KnowledgeContributor } from './contributors/KnowledgeContributor';

// ─── Options type (inline to stay within rootDir) ────────────────────────────

export interface ContractAssemblerFactoryOptions {
  /**
   * Named contributor set.
   * 'default' — registers all 6 standard contributors.
   * 'none'    — empty assembler; caller registers contributors manually.
   */
  contributorSet?: 'default' | 'none';

  /**
   * Additional slot→contributor pairs merged after the named set.
   * Keys are ResolvedGenerationContract slot names.
   * Use for test mocks or one-off overrides.
   */
  additionalContributors?: Record<string, unknown>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export class ContractAssemblerFactory {
  /**
   * create — returns a new ContractAssembler with the requested contributor set.
   *
   * Each call returns a fresh instance with no shared state.
   * PREFER this over getContractAssembler() in all new code.
   */
  static create(options: ContractAssemblerFactoryOptions = {}): ContractAssembler {
    const assembler = new ContractAssembler();
    const set = options.contributorSet ?? 'default';

    if (set === 'default') {
      assembler.register('identity', new IdentityContributor());
      assembler.register('persona',  new PersonaContributor());
      assembler.register('intent',   new IntentContributor());
      assembler.register('artifact', new ArtifactContributor());
      assembler.register('runtime',  new RuntimeContributor());
      // Phase 2.6: always registered. SkillContributor internally gates on
      // globalThis.__brandos_iskill_contract_contributor and returns null
      // when the flag is off, so registering it is a no-op until the flag
      // flips — exactly mirroring pre-gate-lift behavior for every workspace
      // that hasn't enabled it.
      assembler.register('skill',    new SkillContributor());
      // EM-4.1 (Cognitive Platform Evolution Program) — see
      // KnowledgeContributor.ts. Always registered; the contributor
      // itself returns null when the workspace has nothing synthesized
      // yet, same pattern as identity/skill above.
      assembler.register('knowledge', new KnowledgeContributor());
    }

    if (options.additionalContributors) {
      for (const [slot, contributor] of Object.entries(options.additionalContributors)) {
        assembler.register(
          slot as Parameters<typeof assembler.register>[0],
          contributor as Parameters<typeof assembler.register>[1]
        );
      }
    }

    return assembler;
  }
}


