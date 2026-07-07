// ============================================================
// @brandos/output-control-layer — tests/unit/extractJSON.test.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import { extractJSON } from '../../src/output-normalizer/pipeline/extractJSON';

describe('extractJSON', () => {
  it('parses valid JSON object directly', () => {
    const result = extractJSON('{"slides": []}');
    expect(result).toEqual({ slides: [] });
  });

  it('parses valid JSON array directly', () => {
    const result = extractJSON('[1, 2, 3]');
    expect(result).toEqual([1, 2, 3]);
  });

  it('extracts object from surrounding text', () => {
    const result = extractJSON('Some preamble {"key": "value"} some postamble');
    expect(result).toEqual({ key: 'value' });
  });

  it('extracts array from surrounding text', () => {
    const result = extractJSON('Before [1, 2, 3] after');
    expect(result).toEqual([1, 2, 3]);
  });

  it('handles nested objects correctly', () => {
    const json = '{"outer": {"inner": {"deep": true}}}';
    expect(extractJSON(json)).toEqual({ outer: { inner: { deep: true } } });
  });

  it('handles nested arrays', () => {
    const json = '[[1, 2], [3, 4]]';
    expect(extractJSON(json)).toEqual([[1, 2], [3, 4]]);
  });

  it('handles objects with array values', () => {
    const json = '{"slides": [{"role": "hook"}, {"role": "CTA"}]}';
    const result = extractJSON(json) as { slides: { role: string }[] };
    expect(result.slides).toHaveLength(2);
  });

  it('returns null for completely invalid input', () => {
    expect(extractJSON('not json at all')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractJSON('')).toBeNull();
  });

  it('returns null for whitespace only', () => {
    expect(extractJSON('   ')).toBeNull();
  });

  it('handles escaped quotes in strings', () => {
    const json = '{"message": "She said \\"hello\\""}';
    const result = extractJSON(json) as { message: string };
    expect(result.message).toBe('She said "hello"');
  });

  it('handles strings containing bracket chars', () => {
    const json = '{"text": "Use {curly} and [square] brackets"}';
    const result = extractJSON(json) as { text: string };
    expect(result.text).toBe('Use {curly} and [square] brackets');
  });

  it('prefers the outermost object when multiple exist', () => {
    const json = 'Before {"first": 1} and {"second": 2} after';
    const result = extractJSON(json) as { first: number };
    // Should extract the first outermost block
    expect(result.first).toBe(1);
  });

  it('handles unicode content', () => {
    const json = '{"name": "Ångström", "emoji": "🚀"}';
    const result = extractJSON(json) as { name: string; emoji: string };
    expect(result.name).toBe('Ångström');
    expect(result.emoji).toBe('🚀');
  });
});


