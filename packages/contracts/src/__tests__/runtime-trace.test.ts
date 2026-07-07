/**
 * @brandos/contracts — runtime-trace.test.ts
 *
 * Tests for the RuntimeTrace runtime-verification contract.
 *
 * Verifies:
 *   - createRuntimeTrace stamps requestId/checkedAt correctly
 *   - createRuntimeTrace honors an explicitly supplied checkedAt
 *   - isRuntimeTraceHealthy judges provider/model presence
 *   - isRuntimeTraceHealthy judges governance score / repair ceiling
 *   - isRuntimeTraceHealthy judges artifact persistence
 */

import { describe, it, expect } from 'vitest';
import type { RuntimeTrace } from '../runtime-trace';
import { createRuntimeTrace, isRuntimeTraceHealthy, validateRuntimeTrace, RUNTIME_TRACE_EXPECTED_FIELDS } from '../runtime-trace';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTrace(overrides: Partial<RuntimeTrace> = {}): RuntimeTrace {
  return {
    requestId: 'req-1',
    checkedAt: new Date().toISOString(),
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    brandMemoryApplied: false,
    ...overrides,
  };
}

// ─── createRuntimeTrace ────────────────────────────────────────────────────────

describe('createRuntimeTrace', () => {
  it('stamps the supplied requestId onto the trace', () => {
    const trace = createRuntimeTrace('req-abc', {
      provider: 'openai',
      model: 'gpt-5',
      brandMemoryApplied: false,
    });
    expect(trace.requestId).toBe('req-abc');
  });

  it('defaults checkedAt to a valid current ISO timestamp when omitted', () => {
    const before = Date.now();
    const trace = createRuntimeTrace('req-abc', {
      provider: 'openai',
      model: 'gpt-5',
      brandMemoryApplied: false,
    });
    const checkedAtMs = new Date(trace.checkedAt).getTime();
    expect(checkedAtMs).toBeGreaterThanOrEqual(before);
    expect(checkedAtMs).toBeLessThanOrEqual(Date.now());
  });

  it('honors an explicitly supplied checkedAt instead of defaulting to now', () => {
    const fixed = '2026-01-01T00:00:00.000Z';
    const trace = createRuntimeTrace('req-abc', {
      provider: 'openai',
      model: 'gpt-5',
      brandMemoryApplied: false,
      checkedAt: fixed,
    });
    expect(trace.checkedAt).toBe(fixed);
  });

  it('carries through optional fields untouched', () => {
    const trace = createRuntimeTrace('req-abc', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      brandMemoryApplied: true,
      identityVersion: 'v2',
      governanceScore: 91,
      repairAttempts: 1,
      artifactPersisted: true,
      durationMs: 1234,
    });
    expect(trace.identityVersion).toBe('v2');
    expect(trace.governanceScore).toBe(91);
    expect(trace.repairAttempts).toBe(1);
    expect(trace.artifactPersisted).toBe(true);
    expect(trace.durationMs).toBe(1234);
  });
});

// ─── isRuntimeTraceHealthy ──────────────────────────────────────────────────────

describe('isRuntimeTraceHealthy', () => {
  it('is healthy for a minimal trace with provider+model and nothing else', () => {
    expect(isRuntimeTraceHealthy(makeTrace())).toBe(true);
  });

  it('is unhealthy when provider is empty', () => {
    expect(isRuntimeTraceHealthy(makeTrace({ provider: '' }))).toBe(false);
  });

  it('is unhealthy when model is empty', () => {
    expect(isRuntimeTraceHealthy(makeTrace({ model: '' }))).toBe(false);
  });

  it('is healthy when governanceScore is present and non-negative', () => {
    expect(isRuntimeTraceHealthy(makeTrace({ governanceScore: 72 }))).toBe(true);
  });

  it('is unhealthy when governanceScore is negative', () => {
    expect(isRuntimeTraceHealthy(makeTrace({ governanceScore: -1 }))).toBe(false);
  });

  it('is healthy when repairAttempts is within the default ceiling of 3', () => {
    expect(isRuntimeTraceHealthy(makeTrace({ repairAttempts: 3 }))).toBe(true);
  });

  it('is unhealthy when repairAttempts exceeds the default ceiling of 3', () => {
    expect(isRuntimeTraceHealthy(makeTrace({ repairAttempts: 4 }))).toBe(false);
  });

  it('respects a custom repair ceiling argument', () => {
    expect(isRuntimeTraceHealthy(makeTrace({ repairAttempts: 4 }), 5)).toBe(true);
  });

  it('is unhealthy when artifactPersisted is explicitly false', () => {
    expect(isRuntimeTraceHealthy(makeTrace({ artifactPersisted: false }))).toBe(false);
  });

  it('is healthy when artifactPersisted is true', () => {
    expect(isRuntimeTraceHealthy(makeTrace({ artifactPersisted: true }))).toBe(true);
  });

  it('is healthy when artifactPersisted is absent (out of scope for the check)', () => {
    expect(isRuntimeTraceHealthy(makeTrace())).toBe(true);
  });
});

// ─── createRuntimeTrace alias auto-population ──────────────────────────────────

describe('createRuntimeTrace alias auto-population', () => {
  it('auto-populates resolvedProvider/resolvedModel/executionLatency from provider/model/durationMs', () => {
    const trace = createRuntimeTrace('req-alias', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      brandMemoryApplied: false,
      durationMs: 500,
    });
    expect(trace.resolvedProvider).toBe('anthropic');
    expect(trace.resolvedModel).toBe('claude-sonnet-4-6');
    expect(trace.executionLatency).toBe(500);
  });

  it('lets an explicit resolvedProvider/resolvedModel/executionLatency override the auto-populated value', () => {
    const trace = createRuntimeTrace('req-alias-override', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      brandMemoryApplied: false,
      durationMs: 500,
      resolvedProvider: 'openai',
      resolvedModel: 'gpt-5',
      executionLatency: 999,
    });
    expect(trace.resolvedProvider).toBe('openai');
    expect(trace.resolvedModel).toBe('gpt-5');
    expect(trace.executionLatency).toBe(999);
  });
});

// ─── validateRuntimeTrace ───────────────────────────────────────────────────────

describe('validateRuntimeTrace', () => {
  function makeFullTrace(overrides: Partial<RuntimeTrace> = {}): RuntimeTrace {
    return {
      requestId: 'req-full',
      checkedAt: new Date().toISOString(),
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      configuredProvider: 'anthropic',
      resolvedProvider: 'anthropic',
      configuredModel: 'claude-sonnet-4-6',
      resolvedModel: 'claude-sonnet-4-6',
      fallbackUsed: false,
      runtimeMode: 'cloud',
      brandMemoryApplied: true,
      identityVersion: 'v2',
      governanceScore: 88,
      repairAttempts: 0,
      artifactPersisted: true,
      persistenceStatus: 'persisted',
      schemaVersion: 'artifact-json@2.0',
      runtimeVersion: '1.0.0',
      durationMs: 1200,
      executionLatency: 1200,
      ...overrides,
    };
  }

  it('checks exactly the 13 expected fields', () => {
    expect(RUNTIME_TRACE_EXPECTED_FIELDS).toHaveLength(13);
  });

  it('is valid with zero issues for a fully-populated, internally-consistent trace', () => {
    const result = validateRuntimeTrace(makeFullTrace());
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('returns a WARN per missing field for a minimal trace, with a human-readable message', () => {
    const minimal: RuntimeTrace = {
      requestId: 'req-min',
      checkedAt: new Date().toISOString(),
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      brandMemoryApplied: false,
    };
    const result = validateRuntimeTrace(minimal);
    expect(result.valid).toBe(true); // missing fields are WARN, not FAIL
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every(i => i.severity === 'warn')).toBe(true);
    expect(result.issues.every(i => i.message.length > 0)).toBe(true);
  });

  it('FAILs when configuredProvider differs from resolvedProvider but fallbackUsed is not true', () => {
    const result = validateRuntimeTrace(
      makeFullTrace({ configuredProvider: 'anthropic', resolvedProvider: 'openai', fallbackUsed: false })
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.field === 'fallbackUsed' && i.severity === 'fail')).toBe(true);
  });

  it('WARNs when fallbackUsed is true but providers match', () => {
    const result = validateRuntimeTrace(
      makeFullTrace({ configuredProvider: 'anthropic', resolvedProvider: 'anthropic', fallbackUsed: true })
    );
    expect(result.issues.some(i => i.field === 'fallbackUsed' && i.severity === 'warn')).toBe(true);
  });

  it('FAILs when governanceScore is outside 0-100', () => {
    const result = validateRuntimeTrace(makeFullTrace({ governanceScore: 150 }));
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.field === 'governanceScore' && i.severity === 'fail')).toBe(true);
  });

  it('FAILs when repairAttempts exceeds the supplied ceiling', () => {
    const result = validateRuntimeTrace(makeFullTrace({ repairAttempts: 5 }), { maxRepairAttempts: 3 });
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.field === 'repairAttempts' && i.severity === 'fail')).toBe(true);
  });

  it('FAILs when persistenceStatus is "persisted" but artifactPersisted is false', () => {
    const result = validateRuntimeTrace(makeFullTrace({ persistenceStatus: 'persisted', artifactPersisted: false }));
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.field === 'persistenceStatus' && i.severity === 'fail')).toBe(true);
  });

  it('WARNs when brandMemoryApplied is true but identityVersion is missing', () => {
    const result = validateRuntimeTrace(makeFullTrace({ brandMemoryApplied: true, identityVersion: undefined }));
    expect(result.issues.some(i => i.field === 'identityVersion' && i.severity === 'warn')).toBe(true);
  });

  it('FAILs when provider and resolvedProvider disagree', () => {
    const result = validateRuntimeTrace(makeFullTrace({ provider: 'anthropic', resolvedProvider: 'openai' }));
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.field === 'resolvedProvider' && i.severity === 'fail')).toBe(true);
  });
});
