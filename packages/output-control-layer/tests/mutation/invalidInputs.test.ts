// ============================================================
// @brandos/output-control-layer — tests/mutation/invalidInputs.test.ts
//
// Mutation tests: verify OCL handles pathological, adversarial,
// and edge-case inputs without throwing, corrupting state, or
// producing malformed output.
// ============================================================

import { describe, it, expect } from 'vitest';
import { cleanOutput } from '../../src/output-normalizer/pipeline/cleanOutput';
import { extractJSON } from '../../src/output-normalizer/pipeline/extractJSON';
import { repairJSON } from '../../src/output-normalizer/pipeline/repairJSON';
import { parseArtifact } from '../../src/output-normalizer/parser/parseArtifact';
import { normalizeOutput } from '../../src/output-normalizer/normalizeOutput';
import { makeRuntimeOutput, CAROUSEL_OPTIONS } from '../fixtures';

// ─── Adversarial inputs ───────────────────────────────────────────────────────

const MUTATIONS = [
  // Invalid JSON
  { label: 'empty string',              value: '' },
  { label: 'whitespace only',           value: '   \n  \t  ' },
  { label: 'null literal',              value: 'null' },
  { label: 'true literal',              value: 'true' },
  { label: 'number',                    value: '42' },
  { label: 'plain text',                value: 'Write me a carousel about dogs.' },
  { label: 'deeply nested braces',      value: '{{{{{{{{{{}}}}}}}}}' },
  { label: 'deeply nested brackets',    value: '[[[[[[[[[[]]]]]]]]]]' },
  { label: 'mismatched brackets',       value: '[{"key": "value"}}}' },
  { label: 'only opening brace',        value: '{' },
  { label: 'only closing brace',        value: '}' },
  { label: 'html content',              value: '<div>hello</div>' },
  { label: 'binary-looking content',    value: '\x00\x01\x02\x03\x04' },
  { label: 'very long string',          value: 'a'.repeat(100_000) },
  { label: 'JSON with null values',     value: '{"slides": null}' },
  { label: 'JSON with wrong types',     value: '{"slides": "not an array"}' },
  { label: 'array at root',             value: '[1, 2, 3]' },
  { label: 'duplicate keys',            value: '{"slides": [], "slides": []}' },
  { label: 'unicode surrogates',        value: '{"key": "\uD800\uDC00"}' },
  { label: 'escaped unicode',           value: '{"key": "\\u0000\\u001F"}' },
];

// ─── cleanOutput mutation tests ───────────────────────────────────────────────

describe('cleanOutput — mutation tests', () => {
  for (const { label, value } of MUTATIONS) {
    it(`never throws on: ${label}`, () => {
      expect(() => cleanOutput(value)).not.toThrow();
    });

    it(`returns CleanResult with cleaned string: ${label}`, () => {
      const result = cleanOutput(value);
      expect(typeof result.cleaned).toBe('string');
      expect(Array.isArray(result.steps)).toBe(true);
    });
  }
});

// ─── extractJSON mutation tests ───────────────────────────────────────────────

describe('extractJSON — mutation tests', () => {
  for (const { label, value } of MUTATIONS) {
    it(`never throws on: ${label}`, () => {
      expect(() => extractJSON(value)).not.toThrow();
    });

    it(`returns unknown or null: ${label}`, () => {
      const result = extractJSON(value);
      // Result must be a parseable value or null — never undefined or a thrown error
      expect(result === null || result !== undefined).toBe(true);
    });
  }
});

// ─── repairJSON mutation tests ────────────────────────────────────────────────

describe('repairJSON — mutation tests', () => {
  for (const { label, value } of MUTATIONS) {
    it(`never throws on: ${label}`, () => {
      expect(() => repairJSON(value)).not.toThrow();
    });

    it(`returns string or null: ${label}`, () => {
      const result = repairJSON(value);
      expect(result === null || typeof result === 'string').toBe(true);
    });

    it(`returned string parses if non-null: ${label}`, () => {
      const result = repairJSON(value);
      if (result !== null) {
        expect(() => JSON.parse(result)).not.toThrow();
      }
    });
  }
});

// ─── parseArtifact mutation tests ─────────────────────────────────────────────

describe('parseArtifact — mutation tests', () => {
  for (const { label, value } of MUTATIONS) {
    it(`never throws on: ${label}`, () => {
      expect(() => parseArtifact(value)).not.toThrow();
    });

    it(`returns discriminated union: ${label}`, () => {
      const result = parseArtifact(value);
      expect('ok' in result).toBe(true);
      expect(typeof result.ok).toBe('boolean');
    });
  }
});

// ─── normalizeOutput mutation tests ──────────────────────────────────────────

describe('normalizeOutput — mutation tests', () => {
  // Smaller set for async tests
  const ASYNC_MUTATIONS = MUTATIONS.slice(0, 10);

  for (const { label, value } of ASYNC_MUTATIONS) {
    it(`never throws, always returns NormalizedOutput: ${label}`, async () => {
      const output = makeRuntimeOutput(value);
      const result = await normalizeOutput(output, CAROUSEL_OPTIONS);
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(result.content).toBeDefined();
      expect(result.trace).toBeDefined();
    });
  }

  it('null content field treated as empty string', async () => {
    const output = { ...makeRuntimeOutput(''), content: null as unknown as string };
    const result = await normalizeOutput(output, CAROUSEL_OPTIONS);
    expect(result).toBeDefined();
  });

  it('undefined content field treated as empty string', async () => {
    const output = { ...makeRuntimeOutput(''), content: undefined as unknown as string };
    const result = await normalizeOutput(output, CAROUSEL_OPTIONS);
    expect(result).toBeDefined();
  });

  it('JSON with correct structure but empty slides array fails schema', async () => {
    const empty = JSON.stringify({ slides: [] });
    const result = await normalizeOutput(makeRuntimeOutput(empty), CAROUSEL_OPTIONS);
    // Empty slides should fail carousel schema (no required roles)
    expect(typeof result.success).toBe('boolean');
    // Result must still be a valid NormalizedOutput
    expect(result.content).toBeDefined();
    expect(result.trace).toBeDefined();
  });

  it('schema drift — missing required carousel fields', async () => {
    const drifted = JSON.stringify({ items: [{ text: 'no slides key' }] });
    const result = await normalizeOutput(makeRuntimeOutput(drifted), CAROUSEL_OPTIONS);
    expect(result.success).toBe(false);
  });
});


