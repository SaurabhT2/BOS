/**
 * @brandos/contracts — generation-contract.test.ts
 *
 * Tests for the ResolvedGenerationContract structure and all
 * contribution slot interface invariants.
 *
 * These tests verify:
 *   - Required slots (intent, runtime) are non-optional
 *   - Optional slots degrade gracefully when absent
 *   - ContributorContext field types are correct
 *   - IContractContributor null-return contract
 */

import { describe, it, expect } from 'vitest';
import type {
  ResolvedGenerationContract,
  IIdentityContribution,
  IPersonaContribution,
  IIntentContribution,
  IArtifactContribution,
  IRuntimeContribution,
  ISkillContribution,
  IContractContributor,
  ContributorContext,
  IContractAssembler,
} from '../generation-contract';

// ─────────────────────────────────────────────────────────────────────────────
// Fixture builders
// ─────────────────────────────────────────────────────────────────────────────

function makeIntent(): IIntentContribution {
  return {
    taskType: 'carousel',
    topic: 'Why founders fail in year two',
    confidence: 0.95,
    ambiguityLevel: 'none',
    userPrompt: 'Create a carousel about why founders fail in year two',
  };
}

function makeRuntime(): IRuntimeContribution {
  return {
    qualityThreshold: 60,
    maxAttempts: 3,
    autoRegenerate: true,
    attempt: 1,
    runtimeMode: 'cloud',
  };
}

function makeMinimalContract(): ResolvedGenerationContract {
  return {
    intent: makeIntent(),
    runtime: makeRuntime(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// REQ-1: Required slots
// ─────────────────────────────────────────────────────────────────────────────

describe('ResolvedGenerationContract required slots', () => {
  it('is valid with only intent and runtime populated', () => {
    const contract = makeMinimalContract();
    expect(contract.intent).toBeDefined();
    expect(contract.runtime).toBeDefined();
  });

  it('intent.taskType is required', () => {
    const contract = makeMinimalContract();
    expect(contract.intent.taskType).toBe('carousel');
  });

  it('intent.topic is required', () => {
    const contract = makeMinimalContract();
    expect(contract.intent.topic).toBeTruthy();
  });

  it('intent.confidence is required and a number', () => {
    const contract = makeMinimalContract();
    expect(typeof contract.intent.confidence).toBe('number');
  });

  it('intent.ambiguityLevel is required', () => {
    const contract = makeMinimalContract();
    expect(['none', 'low', 'high']).toContain(contract.intent.ambiguityLevel);
  });

  it('intent.userPrompt is required', () => {
    const contract = makeMinimalContract();
    expect(typeof contract.intent.userPrompt).toBe('string');
  });

  it('runtime.qualityThreshold is required', () => {
    const contract = makeMinimalContract();
    expect(typeof contract.runtime.qualityThreshold).toBe('number');
  });

  it('runtime.maxAttempts is required', () => {
    const contract = makeMinimalContract();
    expect(typeof contract.runtime.maxAttempts).toBe('number');
    expect(contract.runtime.maxAttempts).toBeGreaterThan(0);
  });

  it('runtime.autoRegenerate is required', () => {
    const contract = makeMinimalContract();
    expect(typeof contract.runtime.autoRegenerate).toBe('boolean');
  });

  it('runtime.attempt is required and 1-based', () => {
    const contract = makeMinimalContract();
    expect(contract.runtime.attempt).toBeGreaterThanOrEqual(1);
  });

  it('runtime.runtimeMode is required', () => {
    const contract = makeMinimalContract();
    expect(typeof contract.runtime.runtimeMode).toBe('string');
    expect(['local', 'cloud']).toContain(contract.runtime.runtimeMode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Optional slots — must degrade gracefully
// ─────────────────────────────────────────────────────────────────────────────

describe('ResolvedGenerationContract optional slots', () => {
  it('identity slot can be absent', () => {
    const contract = makeMinimalContract();
    expect(contract.identity).toBeUndefined();
  });

  it('persona slot can be absent', () => {
    const contract = makeMinimalContract();
    expect(contract.persona).toBeUndefined();
  });

  it('artifact slot can be absent', () => {
    const contract = makeMinimalContract();
    expect(contract.artifact).toBeUndefined();
  });

  it('skill slot can be absent', () => {
    const contract = makeMinimalContract();
    expect(contract.skill).toBeUndefined();
  });

  it('accepts identity when provided', () => {
    const identity: IIdentityContribution = {
      confidence: 85,
      hookStyle: 'contrarian',
      domains: ['AI', 'enterprise'],
      preferredLength: 'medium',
    };
    const contract: ResolvedGenerationContract = {
      ...makeMinimalContract(),
      identity,
    };
    expect(contract.identity?.confidence).toBe(85);
    expect(contract.identity?.hookStyle).toBe('contrarian');
  });

  it('accepts persona when provided', () => {
    const persona: IPersonaContribution = {
      tone: 'executive',
      voice: 'strategic',
      brandName: 'Acme Corp',
    };
    const contract: ResolvedGenerationContract = {
      ...makeMinimalContract(),
      persona,
    };
    expect(contract.persona?.tone).toBe('executive');
    expect(contract.persona?.brandName).toBe('Acme Corp');
  });

  it('accepts artifact when provided', () => {
    const artifact: IArtifactContribution = {
      schema: 'artifact-json@2.0',
      requiredRoles: ['hook', 'cta'],
      minSlides: 5,
      maxSlides: 10,
      schemaInstruction: 'Return a JSON carousel.',
    };
    const contract: ResolvedGenerationContract = {
      ...makeMinimalContract(),
      artifact,
    };
    expect(contract.artifact?.schema).toBe('artifact-json@2.0');
    expect(contract.artifact?.requiredRoles).toContain('hook');
  });

  it('accepts skill when provided (Phase 2 path)', () => {
    const skill: ISkillContribution = {
      workflow: ['hook', 'problem', 'framework', 'CTA'],
      skillId: 'carousel-founder-skill',
    };
    const contract: ResolvedGenerationContract = {
      ...makeMinimalContract(),
      skill,
    };
    expect(contract.skill?.skillId).toBe('carousel-founder-skill');
    expect(contract.skill?.workflow).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IIdentityContribution — confidence threshold
// ─────────────────────────────────────────────────────────────────────────────

describe('IIdentityContribution', () => {
  it('confidence is required', () => {
    const identity: IIdentityContribution = { confidence: 72 };
    expect(identity.confidence).toBe(72);
  });

  it('confidence below 40 should signal low-quality personalization', () => {
    const lowConfidence: IIdentityContribution = { confidence: 35 };
    // Implementations should omit this contribution when confidence < 40
    expect(lowConfidence.confidence).toBeLessThan(40);
  });

  it('all other fields are optional', () => {
    const minimal: IIdentityContribution = { confidence: 80 };
    expect(minimal.hookStyle).toBeUndefined();
    expect(minimal.ctaPatterns).toBeUndefined();
    expect(minimal.domains).toBeUndefined();
    expect(minimal.phraseLibrary).toBeUndefined();
    expect(minimal.preferredLength).toBeUndefined();
    expect(minimal.visual).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IPersonaContribution
// ─────────────────────────────────────────────────────────────────────────────

describe('IPersonaContribution', () => {
  it('tone and voice are required', () => {
    const persona: IPersonaContribution = {
      tone: 'executive',
      voice: 'strategic',
    };
    expect(persona.tone).toBe('executive');
    expect(persona.voice).toBe('strategic');
  });

  it('audiencePositioning and brandName are optional', () => {
    const minimal: IPersonaContribution = { tone: 'executive', voice: 'direct' };
    expect(minimal.audiencePositioning).toBeUndefined();
    expect(minimal.brandName).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IArtifactContribution
// ─────────────────────────────────────────────────────────────────────────────

describe('IArtifactContribution', () => {
  it('schema, requiredRoles, schemaInstruction are required', () => {
    const artifact: IArtifactContribution = {
      schema: 'artifact-json@2.0',
      requiredRoles: ['hook', 'cta'],
      schemaInstruction: 'Return a carousel JSON.',
    };
    expect(artifact.schema).toBe('artifact-json@2.0');
    expect(artifact.requiredRoles).toContain('hook');
    expect(artifact.schemaInstruction).toBeTruthy();
  });

  it('minSlides, maxSlides, qualityThreshold are optional', () => {
    const minimal: IArtifactContribution = {
      schema: 'artifact-json@2.0',
      requiredRoles: ['hook'],
      schemaInstruction: 'JSON',
    };
    expect(minimal.minSlides).toBeUndefined();
    expect(minimal.maxSlides).toBeUndefined();
    expect(minimal.qualityThreshold).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ISkillContribution (Phase 2 path)
// ─────────────────────────────────────────────────────────────────────────────

describe('ISkillContribution', () => {
  it('workflow and skillId are required', () => {
    const skill: ISkillContribution = {
      workflow: ['hook', 'evidence', 'CTA'],
      skillId: 'founder-skill-v1',
    };
    expect(skill.workflow).toHaveLength(3);
    expect(skill.skillId).toBe('founder-skill-v1');
  });

  it('validationStrategy and successCriteria are optional', () => {
    const skill: ISkillContribution = {
      workflow: ['hook'],
      skillId: 'test-skill',
    };
    expect(skill.validationStrategy).toBeUndefined();
    expect(skill.successCriteria).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IContractContributor interface contract
// ─────────────────────────────────────────────────────────────────────────────

describe('IContractContributor contract', () => {
  it('a valid contributor has contributorId and contribute function', () => {
    const contributor: IContractContributor<IRuntimeContribution> = {
      contributorId: 'runtime',
      contribute: async (_ctx: ContributorContext) => makeRuntime(),
    };
    expect(contributor.contributorId).toBe('runtime');
    expect(typeof contributor.contribute).toBe('function');
  });

  it('contribute() can return null for graceful degradation', async () => {
    const nullContributor: IContractContributor<IIdentityContribution> = {
      contributorId: 'identity',
      contribute: async (_ctx: ContributorContext) => null,
    };
    const ctx: ContributorContext = {
      userId: 'user-1',
      workspaceId: 'ws-1',
      requestId: 'req-1',
      userPrompt: 'Test prompt',
      taskType: 'carousel',
      runtimeMode: 'cloud',
      attempt: 1,
    };
    const result = await nullContributor.contribute(ctx);
    expect(result).toBeNull();
  });

  it('a failing contributor can return null without throwing', async () => {
    const failingContributor: IContractContributor<IPersonaContribution> = {
      contributorId: 'persona',
      contribute: async (_ctx: ContributorContext) => {
        try {
          throw new Error('DB lookup failed');
        } catch {
          return null;
        }
      },
    };
    const ctx: ContributorContext = {
      userId: 'user-1',
      workspaceId: 'ws-1',
      requestId: 'req-1',
      userPrompt: 'Test prompt',
      taskType: 'carousel',
      runtimeMode: 'cloud',
      attempt: 1,
    };
    // Must not throw — must return null
    await expect(failingContributor.contribute(ctx)).resolves.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ContributorContext — field types
// ─────────────────────────────────────────────────────────────────────────────

describe('ContributorContext', () => {
  it('has all required fields', () => {
    const ctx: ContributorContext = {
      userId: 'user-abc',
      workspaceId: 'ws-1',
      requestId: 'req-xyz',
      userPrompt: 'Create a carousel',
      taskType: 'carousel',
      runtimeMode: 'cloud',
      attempt: 1,
    };
    expect(ctx.userId).toBe('user-abc');
    expect(ctx.requestId).toBe('req-xyz');
    expect(ctx.attempt).toBe(1);
  });

  it('optional fields default to undefined', () => {
    const ctx: ContributorContext = {
      userId: 'u', workspaceId: 'ws-1', requestId: 'r', userPrompt: 'p',
      taskType: 'deck', runtimeMode: 'local', attempt: 1,
    };
    expect(ctx.supabase).toBeUndefined();
    expect(ctx.persona).toBeUndefined();
    expect(ctx.overrideMode).toBeUndefined();
    expect(ctx.resolvedSemanticIdentity).toBeUndefined();
    expect(ctx.resolvedVisualIdentity).toBeUndefined();
  });

  it('attempt is 1-based', () => {
    const ctx: ContributorContext = {
      userId: 'u', workspaceId: 'ws-1', requestId: 'r', userPrompt: 'p',
      taskType: 'carousel', runtimeMode: 'cloud', attempt: 1,
    };
    expect(ctx.attempt).toBeGreaterThanOrEqual(1);
  });

  it('accepts attempt > 1 for retry scenarios', () => {
  const ctx: ContributorContext = {
    userId: 'u',
    workspaceId: 'ws-1',
    requestId: 'r',
    userPrompt: 'p',
    taskType: 'carousel',
    runtimeMode: 'cloud',
    attempt: 3,
  };
  expect(ctx.attempt).toBe(3);
});
});

// ─────────────────────────────────────────────────────────────────────────────
// IIntentContribution — ambiguityLevel semantics
// ─────────────────────────────────────────────────────────────────────────────

describe('IIntentContribution ambiguityLevel', () => {
  it('none = clean intent, proceed directly', () => {
    const intent: IIntentContribution = {
      ...makeIntent(),
      ambiguityLevel: 'none',
      confidence: 0.95,
    };
    expect(intent.ambiguityLevel).toBe('none');
  });

  it('low = proceed with best guess', () => {
    const intent: IIntentContribution = {
      ...makeIntent(),
      ambiguityLevel: 'low',
      confidence: 0.65,
    };
    expect(intent.ambiguityLevel).toBe('low');
  });

  it('high = consider clarification prompt', () => {
    const intent: IIntentContribution = {
      ...makeIntent(),
      ambiguityLevel: 'high',
      confidence: 0.35,
    };
    expect(intent.ambiguityLevel).toBe('high');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IRuntimeContribution — constraint semantics
// ─────────────────────────────────────────────────────────────────────────────

describe('IRuntimeContribution optional constraints', () => {
  it('maxCostUsd is optional (undefined = no cap)', () => {
    const runtime = makeRuntime();
    expect(runtime.maxCostUsd).toBeUndefined();
  });

  it('maxLatencyMs is optional (undefined = no constraint)', () => {
    const runtime = makeRuntime();
    expect(runtime.maxLatencyMs).toBeUndefined();
  });

  it('accepts explicit cost and latency constraints', () => {
    const runtime: IRuntimeContribution = {
      ...makeRuntime(),
      maxCostUsd: 0.05,
      maxLatencyMs: 10000,
    };
    expect(runtime.maxCostUsd).toBe(0.05);
    expect(runtime.maxLatencyMs).toBe(10000);
  });
});


