/**
 * @brandos/contracts — governance-feedback.test.ts
 *
 * Tests for the closed-loop governance feedback contracts.
 *
 * Verifies:
 *   - IGovernanceFeedback contract shape
 *   - IAttemptHistory accumulation correctness
 *   - appendAttemptRecord derived field computation
 *   - buildGovernanceFeedbackFromEvaluation translation
 *   - Persistent violation detection across attempts
 *   - createEmptyAttemptHistory factory
 */

import { describe, it, expect } from 'vitest';
import type {
  IGovernanceFeedback,
  IAttemptRecord,
  IAttemptHistory,
  IGovernanceViolationDetail,
} from '../governance-feedback';
import {
  createEmptyAttemptHistory,
  appendAttemptRecord,
  buildGovernanceFeedbackFromEvaluation,
} from '../governance-feedback';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeViolation(code: string, severity: IGovernanceViolationDetail['severity'] = 'HIGH'): IGovernanceViolationDetail {
  return { code, severity, message: `Violation: ${code}` };
}

function makeFeedback(overrides: Partial<IGovernanceFeedback> = {}): IGovernanceFeedback {
  return {
    passed: false,
    score: 45,
    violations: [],
    recommendations: [],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRecord(
  attemptNumber: number,
  feedback: Partial<IGovernanceFeedback> = {}
): IAttemptRecord {
  return {
    attemptNumber,
    promptVersion: `v${attemptNumber}`,
    governanceFeedback: makeFeedback(feedback),
    artifactType: 'carousel',
  };
}

// ─── createEmptyAttemptHistory ────────────────────────────────────────────────

describe('createEmptyAttemptHistory', () => {
  it('creates an empty history with all fields at zero/null/empty', () => {
    const h = createEmptyAttemptHistory();
    expect(h.records).toHaveLength(0);
    expect(h.latestScore).toBeNull();
    expect(h.anyPreviousPassed).toBe(false);
    expect(h.persistentViolationCodes).toHaveLength(0);
    expect(h.totalFailures).toBe(0);
  });
});

// ─── appendAttemptRecord ──────────────────────────────────────────────────────

describe('appendAttemptRecord', () => {
  it('appends a record and increments totalFailures for a failure', () => {
    const h0 = createEmptyAttemptHistory();
    const record = makeRecord(1, { passed: false, score: 40 });
    const h1 = appendAttemptRecord(h0, record);

    expect(h1.records).toHaveLength(1);
    expect(h1.latestScore).toBe(40);
    expect(h1.totalFailures).toBe(1);
    expect(h1.anyPreviousPassed).toBe(false);
  });

  it('does NOT increment totalFailures when attempt passed', () => {
    const h0 = createEmptyAttemptHistory();
    const record = makeRecord(1, { passed: true, score: 78 });
    const h1 = appendAttemptRecord(h0, record);

    expect(h1.totalFailures).toBe(0);
    expect(h1.latestScore).toBe(78);
    expect(h1.anyPreviousPassed).toBe(true);
  });

  it('accumulates totalFailures across multiple failures', () => {
    let h = createEmptyAttemptHistory();
    h = appendAttemptRecord(h, makeRecord(1, { passed: false, score: 40 }));
    h = appendAttemptRecord(h, makeRecord(2, { passed: false, score: 45 }));
    h = appendAttemptRecord(h, makeRecord(3, { passed: true,  score: 70 }));

    expect(h.totalFailures).toBe(2);
    expect(h.latestScore).toBe(70);
    expect(h.anyPreviousPassed).toBe(true);
    expect(h.records).toHaveLength(3);
  });

  it('is immutable — original history is unchanged', () => {
    const h0 = createEmptyAttemptHistory();
    const record = makeRecord(1, { passed: false });
    appendAttemptRecord(h0, record);

    // h0 should be unchanged
    expect(h0.records).toHaveLength(0);
    expect(h0.totalFailures).toBe(0);
  });
});

// ─── Persistent violation detection ──────────────────────────────────────────

describe('appendAttemptRecord — persistent violation detection', () => {
  it('detects no persistent violations after a single attempt', () => {
    let h = createEmptyAttemptHistory();
    h = appendAttemptRecord(h, makeRecord(1, {
      violations: [makeViolation('WEAK_HOOK')],
    }));
    expect(h.persistentViolationCodes).toHaveLength(0);
  });

  it('detects WEAK_HOOK as persistent when it appears in 2 consecutive attempts', () => {
    let h = createEmptyAttemptHistory();
    h = appendAttemptRecord(h, makeRecord(1, { violations: [makeViolation('WEAK_HOOK')] }));
    h = appendAttemptRecord(h, makeRecord(2, { violations: [makeViolation('WEAK_HOOK')] }));

    expect(h.persistentViolationCodes).toContain('WEAK_HOOK');
  });

  it('detects multiple persistent violations independently', () => {
    let h = createEmptyAttemptHistory();
    h = appendAttemptRecord(h, makeRecord(1, {
      violations: [makeViolation('WEAK_HOOK'), makeViolation('CLICHE_DENSITY')],
    }));
    h = appendAttemptRecord(h, makeRecord(2, {
      violations: [makeViolation('WEAK_HOOK'), makeViolation('CLICHE_DENSITY')],
    }));

    expect(h.persistentViolationCodes).toContain('WEAK_HOOK');
    expect(h.persistentViolationCodes).toContain('CLICHE_DENSITY');
  });

  it('does NOT flag a violation as persistent if it only appeared once', () => {
    let h = createEmptyAttemptHistory();
    h = appendAttemptRecord(h, makeRecord(1, { violations: [makeViolation('WEAK_HOOK')] }));
    h = appendAttemptRecord(h, makeRecord(2, { violations: [makeViolation('CLICHE_DENSITY')] }));

    // Each appeared once — neither should be persistent
    expect(h.persistentViolationCodes).not.toContain('WEAK_HOOK');
    expect(h.persistentViolationCodes).not.toContain('CLICHE_DENSITY');
  });

  it('drops a violation from persistent list if it stops appearing', () => {
    let h = createEmptyAttemptHistory();
    // WEAK_HOOK appears in attempts 1 and 2 → persistent
    h = appendAttemptRecord(h, makeRecord(1, { violations: [makeViolation('WEAK_HOOK')] }));
    h = appendAttemptRecord(h, makeRecord(2, { violations: [makeViolation('WEAK_HOOK')] }));
    // Attempt 3: WEAK_HOOK fixed, now CLICHE appears
    h = appendAttemptRecord(h, makeRecord(3, { violations: [makeViolation('CLICHE_DENSITY')] }));

    // WEAK_HOOK appeared 2 times total — still flagged as persistent
    // (cumulative count across all records)
    expect(h.persistentViolationCodes).toContain('WEAK_HOOK');
    expect(h.persistentViolationCodes).not.toContain('CLICHE_DENSITY');
  });
});

// ─── buildGovernanceFeedbackFromEvaluation ────────────────────────────────────

describe('buildGovernanceFeedbackFromEvaluation', () => {
  it('returns a well-formed IGovernanceFeedback on a clean pass', () => {
    const fb = buildGovernanceFeedbackFromEvaluation({
      passed: true,
      score: 85,
      violations: [],
      recommendations: [],
    });

    expect(fb.passed).toBe(true);
    expect(fb.score).toBe(85);
    expect(fb.violations).toHaveLength(0);
    expect(fb.recommendations).toHaveLength(0);
    expect(fb.evaluatedAt).toBeTruthy();
  });

  it('maps known violation codes to structured violations', () => {
    const fb = buildGovernanceFeedbackFromEvaluation({
      passed: false,
      score: 42,
      violations: ['weak_hook', 'cliche_density', 'score_below_threshold'],
      recommendations: [],
    });

    expect(fb.violations).toHaveLength(3);
    const codes = fb.violations.map(v => v.code);
    expect(codes).toContain('WEAK_HOOK');
    expect(codes).toContain('CLICHE_DENSITY');
    expect(codes).toContain('SCORE_THRESHOLD');
  });

  it('assigns CRITICAL severity to SCORE_THRESHOLD violation', () => {
    const fb = buildGovernanceFeedbackFromEvaluation({
      passed: false,
      score: 30,
      violations: ['score_below_threshold'],
      recommendations: [],
    });

    const scoreViolation = fb.violations.find(v => v.code === 'SCORE_THRESHOLD');
    expect(scoreViolation?.severity).toBe('CRITICAL');
  });

  it('assigns HIGH severity to WEAK_HOOK violation', () => {
    const fb = buildGovernanceFeedbackFromEvaluation({
      passed: false,
      score: 55,
      violations: ['weak_hook'],
      recommendations: [],
    });

    const hookViolation = fb.violations.find(v => v.code === 'WEAK_HOOK');
    expect(hookViolation?.severity).toBe('HIGH');
  });

  it('maps unknown violation strings to UNKNOWN_VIOLATION with LOW severity', () => {
    const fb = buildGovernanceFeedbackFromEvaluation({
      passed: false,
      score: 50,
      violations: ['some_unknown_violation_xyz'],
      recommendations: [],
    });

    expect(fb.violations[0].code).toBe('UNKNOWN_VIOLATION');
    expect(fb.violations[0].severity).toBe('LOW');
    expect(fb.violations[0].message).toBe('some_unknown_violation_xyz');
  });

  it('maps known recommendation strings to structured recommendations', () => {
    const fb = buildGovernanceFeedbackFromEvaluation({
      passed: false,
      score: 50,
      violations: [],
      recommendations: [
        'Vary paragraph openers — "as" repeated',
        'Weak hook — opening line needs a bolder rewrite',
      ],
    });

    expect(fb.recommendations).toHaveLength(2);
    const codes = fb.recommendations.map(r => r.code);
    expect(codes).toContain('VARY_OPENERS');
    expect(codes).toContain('STRENGTHEN_HOOK');
  });

  it('includes evaluatedAt ISO timestamp', () => {
    const before = Date.now();
    const fb = buildGovernanceFeedbackFromEvaluation({
      passed: true, score: 80, violations: [], recommendations: [],
    });
    const after = Date.now();

    const ts = new Date(fb.evaluatedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('preserves originalScore when provided', () => {
    const fb = buildGovernanceFeedbackFromEvaluation({
      passed: false,
      score: 60,
      originalScore: 45,
      violations: [],
      recommendations: [],
    });

    expect(fb.originalScore).toBe(45);
  });

  it('forwards flagsRemaining when provided', () => {
    const fb = buildGovernanceFeedbackFromEvaluation({
      passed: false,
      score: 50,
      violations: [],
      recommendations: [],
      flagsRemaining: ['Uniform paragraph cadence', 'Generic visual placeholder'],
    });

    expect(fb.flagsRemaining).toHaveLength(2);
    expect(fb.flagsRemaining).toContain('Uniform paragraph cadence');
  });
});

// ─── IAttemptHistory shape contract ──────────────────────────────────────────

describe('IAttemptHistory shape contract', () => {
  it('satisfies the expected shape after three mixed attempts', () => {
    let h = createEmptyAttemptHistory();

    // Attempt 1: fail with WEAK_HOOK
    h = appendAttemptRecord(h, makeRecord(1, {
      passed: false,
      score: 38,
      violations: [makeViolation('WEAK_HOOK'), makeViolation('CLICHE_DENSITY')],
    }));

    // Attempt 2: fail again with WEAK_HOOK (persistent)
    h = appendAttemptRecord(h, makeRecord(2, {
      passed: false,
      score: 52,
      violations: [makeViolation('WEAK_HOOK')],
    }));

    // Attempt 3: pass
    h = appendAttemptRecord(h, makeRecord(3, {
      passed: true,
      score: 74,
      violations: [],
    }));

    expect(h.records).toHaveLength(3);
    expect(h.totalFailures).toBe(2);
    expect(h.anyPreviousPassed).toBe(true);
    expect(h.latestScore).toBe(74);
    // WEAK_HOOK appeared in attempts 1 and 2 → persistent
    expect(h.persistentViolationCodes).toContain('WEAK_HOOK');
    // CLICHE_DENSITY appeared only once → not persistent
    expect(h.persistentViolationCodes).not.toContain('CLICHE_DENSITY');
  });
});

