/**
 * @brandos/output-control-layer — tests/unit/promptEvolution.test.ts
 *
 * GOVERNANCE FEEDBACK LOOP — Prompt Evolution Tests
 *
 * Evidence that:
 *   1. Governance failures generate structured feedback (via contracts)
 *   2. Feedback reaches the Prompt Compiler via IRuntimeContribution.attemptHistory
 *   3. Prompts evolve between attempts (v1 → v2-targeted → v3-prescriptive)
 *   4. Persistent violations trigger stronger language
 *   5. All artifact types use the same feedback mechanism (artifact-type agnostic)
 */

import { describe, it, expect } from 'vitest';
import { compilePromptFromContract } from '../../src/prompt-compiler/compilePromptFromContract';
import {
  createEmptyAttemptHistory,
  appendAttemptRecord,
  buildGovernanceFeedbackFromEvaluation,
} from '@brandos/contracts';
import type {
  ResolvedGenerationContract,
  IAttemptHistory,
  IAttemptRecord,
} from '@brandos/contracts';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeMinimalContract(
  attempt: number,
  attemptHistory?: IAttemptHistory
): ResolvedGenerationContract {
  return {
    intent: {
      taskType: 'carousel',
      topic: 'Test topic',
      confidence: 0.9,
      ambiguityLevel: 'none',
      userPrompt: 'Generate a carousel about test topic',
    },
    runtime: {
      qualityThreshold: 65,
      maxAttempts: 3,
      autoRegenerate: true,
      attempt,
      runtimeMode: 'cloud',
      attemptHistory,
    },
  };
}

function makeAttemptRecord(
  attemptNumber: number,
  violations: string[],
  score: number,
  passed: boolean
): IAttemptRecord {
  const feedback = buildGovernanceFeedbackFromEvaluation({
    passed,
    score,
    violations,
    recommendations: [],
    flagsRemaining: [],
  });
  return {
    attemptNumber,
    promptVersion: `v${attemptNumber}`,
    governanceFeedback: feedback,
    artifactType: 'carousel',
  };
}

// ─── Test 1: Attempt 1 generates v1 prompt with no feedback section ───────────

describe('Prompt evolution — attempt 1', () => {
  it('generates promptVersion v1 with no governance feedback section', () => {
    const contract = makeMinimalContract(1, undefined);
    const result = compilePromptFromContract(contract);

    expect(result.promptVersion).toBe('v1');
    // No governance feedback block on first attempt
    expect(result.system).not.toContain('Governance Repair');
    expect(result.system).not.toContain('PRESCRIPTIVE REPAIR MODE');
    expect(result.system).not.toContain('MAXIMUM CORRECTION MODE');
  });
});

// ─── Test 2: Attempt 2 generates v2-targeted with violation content ───────────

describe('Prompt evolution — attempt 2 (first retry)', () => {
  it('generates promptVersion v2-targeted when history has one failure record', () => {
    let history = createEmptyAttemptHistory();
    history = appendAttemptRecord(
      history,
      makeAttemptRecord(1, ['weak_hook', 'cliche_density'], 42, false)
    );

    const contract = makeMinimalContract(2, history);
    const result = compilePromptFromContract(contract);

    expect(result.promptVersion).toBe('v2-targeted');
  });

  it('includes governance feedback section with violation codes on attempt 2', () => {
    let history = createEmptyAttemptHistory();
    history = appendAttemptRecord(
      history,
      makeAttemptRecord(1, ['weak_hook', 'cliche_density'], 42, false)
    );

    const contract = makeMinimalContract(2, history);
    const result = compilePromptFromContract(contract);

    // Should mention the previous score
    expect(result.system).toContain('42');
    // Should include repair section header
    expect(result.system).toContain('Governance Repair');
    // Should include WEAK_HOOK instruction
    expect(result.system).toContain('WEAK_HOOK');
    // Should include cliché correction
    expect(result.system).toContain('CLICHE_DENSITY');
  });

  it('provides specific correction for WEAK_HOOK violation', () => {
    let history = createEmptyAttemptHistory();
    history = appendAttemptRecord(
      history,
      makeAttemptRecord(1, ['weak_hook'], 55, false)
    );

    const contract = makeMinimalContract(2, history);
    const result = compilePromptFromContract(contract);

    // Should include the specific WEAK_HOOK correction instruction
    expect(result.system).toContain("bold, specific");
    expect(result.system).toContain("contrarian");
  });

  it('provides specific correction for CLICHE_DENSITY violation', () => {
    let history = createEmptyAttemptHistory();
    history = appendAttemptRecord(
      history,
      makeAttemptRecord(1, ['cliche_density'], 50, false)
    );

    const contract = makeMinimalContract(2, history);
    const result = compilePromptFromContract(contract);

    expect(result.system).toContain('dive into');
    expect(result.system).toContain('game-changer');
  });
});

// ─── Test 3: Attempt 3 escalates to prescriptive mode ────────────────────────

describe('Prompt evolution — attempt 3 (prescriptive)', () => {
  it('generates v3-prescriptive with stronger language', () => {
    let history = createEmptyAttemptHistory();
    history = appendAttemptRecord(history, makeAttemptRecord(1, ['weak_hook'], 40, false));
    history = appendAttemptRecord(history, makeAttemptRecord(2, ['weak_hook'], 48, false));

    const contract = makeMinimalContract(3, history);
    const result = compilePromptFromContract(contract);

    expect(result.promptVersion).toBe('v3-prescriptive');
    expect(result.system).toContain('PRESCRIPTIVE REPAIR MODE');
    expect(result.system).toContain('MUST fix ALL');
  });

  it('surfaces score trend on attempt 3', () => {
    let history = createEmptyAttemptHistory();
    history = appendAttemptRecord(history, makeAttemptRecord(1, ['weak_hook'], 40, false));
    history = appendAttemptRecord(history, makeAttemptRecord(2, ['weak_hook'], 50, false));

    const contract = makeMinimalContract(3, history);
    const result = compilePromptFromContract(contract);

    expect(result.system).toContain('Score history:');
    expect(result.system).toContain('40');
    expect(result.system).toContain('50');
  });

  it('flags WEAK_HOOK as a recurring failure when it appears in 2 prior attempts', () => {
    let history = createEmptyAttemptHistory();
    history = appendAttemptRecord(history, makeAttemptRecord(1, ['weak_hook'], 40, false));
    history = appendAttemptRecord(history, makeAttemptRecord(2, ['weak_hook'], 48, false));

    const contract = makeMinimalContract(3, history);
    const result = compilePromptFromContract(contract);

    expect(result.system).toContain('RECURRING FAILURES');
    // Should include the stronger persistent-violation instruction for WEAK_HOOK
    expect(result.system).toContain('FIRST sentence must be a bold');
  });
});

// ─── Test 4: Attempt 4+ uses maximum correction mode ─────────────────────────

describe('Prompt evolution — attempt 4+ (maximum)', () => {
  it('generates MAXIMUM CORRECTION MODE header on attempt 4', () => {
    let history = createEmptyAttemptHistory();
    for (let i = 1; i <= 3; i++) {
      history = appendAttemptRecord(history, makeAttemptRecord(i, ['score_below_threshold'], 38, false));
    }

    const contract = makeMinimalContract(4, history);
    const result = compilePromptFromContract(contract);

    expect(result.system).toContain('MAXIMUM CORRECTION MODE');
    expect(result.system).toContain('MANDATORY');
  });
});

// ─── Test 5: Prompt grows in length across attempts ───────────────────────────

describe('Prompt length grows with attempt number', () => {
  it('prompt at attempt 2 is longer than attempt 1 (feedback added)', () => {
    const contract1 = makeMinimalContract(1, undefined);
    const result1 = compilePromptFromContract(contract1);

    let history = createEmptyAttemptHistory();
    history = appendAttemptRecord(history, makeAttemptRecord(1, ['weak_hook', 'cliche_density'], 42, false));
    const contract2 = makeMinimalContract(2, history);
    const result2 = compilePromptFromContract(contract2);

    expect(result2.system.length).toBeGreaterThan(result1.system.length);
  });

  it('prompt at attempt 3 is longer than attempt 2 (escalation added)', () => {
    let history1 = createEmptyAttemptHistory();
    history1 = appendAttemptRecord(history1, makeAttemptRecord(1, ['weak_hook'], 42, false));

    let history2 = createEmptyAttemptHistory();
    history2 = appendAttemptRecord(history2, makeAttemptRecord(1, ['weak_hook'], 42, false));
    history2 = appendAttemptRecord(history2, makeAttemptRecord(2, ['weak_hook'], 48, false));

    const contract2 = makeMinimalContract(2, history1);
    const contract3 = makeMinimalContract(3, history2);

    const result2 = compilePromptFromContract(contract2);
    const result3 = compilePromptFromContract(contract3);

    expect(result3.system.length).toBeGreaterThan(result2.system.length);
  });
});

// ─── Test 6: Artifact-type agnostic — same mechanism for deck and report ──────

describe('Prompt evolution is artifact-type agnostic', () => {
  const artifactTypes = ['carousel', 'deck', 'report', 'post', 'article'];

  for (const artifactType of artifactTypes) {
    it(`generates feedback section for ${artifactType}`, () => {
      let history = createEmptyAttemptHistory();
      const feedback = buildGovernanceFeedbackFromEvaluation({
        passed: false,
        score: 45,
        violations: ['weak_hook'],
        recommendations: [],
      });
      const record: IAttemptRecord = {
        attemptNumber: 1,
        promptVersion: 'v1',
        governanceFeedback: feedback,
        artifactType,
      };
      history = appendAttemptRecord(history, record);

      // Compile prompt for a contract that mentions this artifact type in intent
      const contract: ResolvedGenerationContract = {
        intent: {
          taskType: artifactType,
          topic: 'Test',
          confidence: 0.9,
          ambiguityLevel: 'none',
          userPrompt: 'Generate content',
        },
        runtime: {
          qualityThreshold: 65,
          maxAttempts: 3,
          autoRegenerate: true,
          attempt: 2,
          runtimeMode: 'cloud',
          attemptHistory: history,
        },
      };

      const result = compilePromptFromContract(contract);

      // The feedback mechanism should work regardless of artifact type
      expect(result.promptVersion).toBe('v2-targeted');
      expect(result.system).toContain('Governance Repair');
      expect(result.system).toContain('WEAK_HOOK');
    });
  }
});

// ─── Test 7: No feedback section when attempt 1 even if history is somehow present ──

describe('Prompt version guard', () => {
  it('uses v1 prompt when attempt=1 even if history is somehow non-empty', () => {
    // Edge case: history has records but attempt is 1 (should not produce feedback block)
    let history = createEmptyAttemptHistory();
    history = appendAttemptRecord(history, makeAttemptRecord(1, ['weak_hook'], 40, false));

    // Contract says attempt=1 — no feedback section regardless of history
    const contract = makeMinimalContract(1, history);
    const result = compilePromptFromContract(contract);

    // On attempt 1, we never inject governance feedback
    expect(result.promptVersion).toBe('v1');
    expect(result.system).not.toContain('Governance Repair');
  });
});

// ─── Test 8: CompiledPrompt exposes promptVersion ─────────────────────────────

describe('CompiledPrompt.promptVersion', () => {
  it('returns v1 for attempt 1', () => {
    const result = compilePromptFromContract(makeMinimalContract(1));
    expect(result.promptVersion).toBe('v1');
  });

  it('includes system and user fields', () => {
    const result = compilePromptFromContract(makeMinimalContract(1));
    expect(typeof result.system).toBe('string');
    expect(typeof result.user).toBe('string');
    expect(result.user).toBe('Generate a carousel about test topic');
  });
});

