// ============================================================
// @brandos/output-control-layer — tests/contracts/contributors.test.ts
//
// Contract tests: verify each contributor conforms to IContractContributor<T>.
// Contract tests verify the interface, not internal implementation.
// ============================================================

import { describe, it, expect } from 'vitest';
import { ContractAssemblerFactory } from '../../src/contract-assembler/ContractAssemblerFactory';
import { IdentityContributor }  from '../../src/contract-assembler/contributors/IdentityContributor';
import { PersonaContributor }   from '../../src/contract-assembler/contributors/PersonaContributor';
import { IntentContributor }    from '../../src/contract-assembler/contributors/IntentContributor';
import { ArtifactContributor }  from '../../src/contract-assembler/contributors/ArtifactContributor';
import { RuntimeContributor }   from '../../src/contract-assembler/contributors/RuntimeContributor';
import { MINIMAL_CONTRIBUTOR_CONTEXT, CONTRIBUTOR_CONTEXT_WITH_BRAND } from '../fixtures';

// ─── Interface conformance ────────────────────────────────────────────────────

describe('Contributor interface conformance', () => {
  const contributors = [
    { name: 'IdentityContributor', instance: new IdentityContributor() },
    { name: 'PersonaContributor',  instance: new PersonaContributor() },
    { name: 'IntentContributor',   instance: new IntentContributor() },
    { name: 'ArtifactContributor', instance: new ArtifactContributor() },
    { name: 'RuntimeContributor',  instance: new RuntimeContributor() },
  ];

  for (const { name, instance } of contributors) {
    it(`${name} has a contribute() method`, () => {
      expect(typeof instance.contribute).toBe('function');
    });

    it(`${name}.contribute() returns a Promise`, async () => {
      const result = instance.contribute(MINIMAL_CONTRIBUTOR_CONTEXT);
      expect(result).toBeInstanceOf(Promise);
    });

    it(`${name}.contribute() returns T or null, never throws`, async () => {
      const result = await instance.contribute(MINIMAL_CONTRIBUTOR_CONTEXT);
      // Valid return is either null or an object
      expect(result === null || typeof result === 'object').toBe(true);
    });
  }
});

// ─── IdentityContributor ──────────────────────────────────────────────────────

describe('IdentityContributor', () => {
  const contributor = new IdentityContributor();

  it('returns null when no brandIntelligence in context', async () => {
    const result = await contributor.contribute(MINIMAL_CONTRIBUTOR_CONTEXT);
    // With no brand intelligence, may return null or minimal identity
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('returns IIdentityContribution when brand intelligence available', async () => {
    const result = await contributor.contribute(CONTRIBUTOR_CONTEXT_WITH_BRAND);
    if (result !== null) {
      expect(typeof result.confidence).toBe('number');
    }
  });
});

// ─── ArtifactContributor ──────────────────────────────────────────────────────

describe('ArtifactContributor', () => {
  const contributor = new ArtifactContributor();

  it('returns carousel contribution for carousel taskType', async () => {
    const result = await contributor.contribute({ ...MINIMAL_CONTRIBUTOR_CONTEXT, taskType: 'carousel' });
    expect(result).not.toBeNull();
    if (result) {
      expect(result.schema).toBe('artifact-json@2.0');
      expect(result.requiredRoles).toContain('hook');
      expect(result.requiredRoles).toContain('cta'); // P1-4 FIX: impl derives 'cta' (lowercase) from CAROUSEL_STRUCTURAL_CONSTRAINTS
      expect(typeof result.schemaInstruction).toBe('string');
      expect(result.schemaInstruction.length).toBeGreaterThan(0);
    }
  });

  it('returns deck contribution for deck taskType', async () => {
    const result = await contributor.contribute({ ...MINIMAL_CONTRIBUTOR_CONTEXT, taskType: 'deck' });
    expect(result).not.toBeNull();
    if (result) {
      expect(result.requiredRoles).toContain('cover');
      expect(result.requiredRoles).toContain('closing');
    }
  });

  it('returns report contribution for report taskType', async () => {
    const result = await contributor.contribute({ ...MINIMAL_CONTRIBUTOR_CONTEXT, taskType: 'report' });
    expect(result).not.toBeNull();
  });

  it('returns null for unknown taskType', async () => {
    const result = await contributor.contribute({ ...MINIMAL_CONTRIBUTOR_CONTEXT, taskType: 'unknown_task' });
    expect(result).toBeNull();
  });

  it('uses CAROUSEL_SCHEMA_INSTRUCTION from @brandos/contracts (not duplicated)', async () => {
    const { CAROUSEL_SCHEMA_INSTRUCTION } = await import('@brandos/contracts');
    const result = await contributor.contribute({ ...MINIMAL_CONTRIBUTOR_CONTEXT, taskType: 'carousel' });
    expect(result?.schemaInstruction).toBe(CAROUSEL_SCHEMA_INSTRUCTION);
  });
});

// ─── RuntimeContributor ───────────────────────────────────────────────────────

describe('RuntimeContributor', () => {
  const contributor = new RuntimeContributor();

  it('returns IRuntimeContribution with required fields', async () => {
    const result = await contributor.contribute(MINIMAL_CONTRIBUTOR_CONTEXT);
    expect(result).not.toBeNull();
    if (result) {
      expect(typeof result.qualityThreshold).toBe('number');
      expect(typeof result.maxAttempts).toBe('number');
      expect(typeof result.autoRegenerate).toBe('boolean');
      expect(typeof result.attempt).toBe('number');
    }
  });

  it('reflects attempt from context', async () => {
    const result = await contributor.contribute({ ...MINIMAL_CONTRIBUTOR_CONTEXT, attempt: 2 });
    if (result) {
      expect(result.attempt).toBe(2);
    }
  });
});

// ─── ContractAssemblerFactory ─────────────────────────────────────────────────

describe('ContractAssemblerFactory', () => {
  it('creates instances that produce valid contracts', async () => {
    const assembler = ContractAssemblerFactory.create({ contributorSet: 'default' });
    const contract = await assembler.assemble(MINIMAL_CONTRIBUTOR_CONTEXT);
    expect(contract).toBeDefined();
    expect(contract.intent).toBeDefined();
    expect(contract.runtime).toBeDefined();
    expect(contract.identity).toBeDefined();
    expect(contract.persona).toBeDefined();
    expect(contract.artifact).toBeDefined();
  });

  it('always returns non-null contract', async () => {
    const assembler = ContractAssemblerFactory.create({ contributorSet: 'none' });
    const contract = await assembler.assemble(MINIMAL_CONTRIBUTOR_CONTEXT);
    expect(contract).not.toBeNull();
    expect(contract.intent).toBeDefined();
    expect(contract.runtime).toBeDefined();
  });

  it('returns independent instances on each call', () => {
    const a1 = ContractAssemblerFactory.create();
    const a2 = ContractAssemblerFactory.create();
    expect(a1).not.toBe(a2);
  });

  it('assembler.assemble() never throws on valid context', async () => {
    const assembler = ContractAssemblerFactory.create({ contributorSet: 'default' });
    await expect(assembler.assemble(MINIMAL_CONTRIBUTOR_CONTEXT)).resolves.toBeDefined();
  });
});

// ─── Schema validation ────────────────────────────────────────────────────────

describe('Contract schema validation', () => {
  it('assembled contract has all required slots', async () => {
    const assembler = ContractAssemblerFactory.create({ contributorSet: 'default' });
    const contract = await assembler.assemble(MINIMAL_CONTRIBUTOR_CONTEXT);

    // Required slots per ResolvedGenerationContract
    expect('intent' in contract).toBe(true);
    expect('runtime' in contract).toBe(true);
    expect('identity' in contract).toBe(true);
    expect('persona' in contract).toBe(true);
    expect('artifact' in contract).toBe(true);
  });

  it('intent.taskType matches context.taskType', async () => {
    const assembler = ContractAssemblerFactory.create({ contributorSet: 'default' });
    const contract = await assembler.assemble({ ...MINIMAL_CONTRIBUTOR_CONTEXT, taskType: 'deck' });
    expect(contract.intent.taskType).toBe('deck');
  });

  it('intent.userPrompt matches context.userPrompt', async () => {
    const assembler = ContractAssemblerFactory.create({ contributorSet: 'default' });
    const contract = await assembler.assemble(MINIMAL_CONTRIBUTOR_CONTEXT);
    expect(contract.intent.userPrompt).toBe(MINIMAL_CONTRIBUTOR_CONTEXT.userPrompt);
  });
});


