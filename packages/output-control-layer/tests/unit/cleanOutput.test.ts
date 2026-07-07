// ============================================================
// @brandos/output-control-layer — tests/unit/cleanOutput.test.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import { cleanOutput } from '../../src/output-normalizer/pipeline/cleanOutput';

describe('cleanOutput', () => {
  it('returns unchanged text when no cleaning needed', () => {
    const r = cleanOutput('{"slides": []}');
    expect(r.cleaned).toBe('{"slides": []}');
    expect(r.steps).toHaveLength(0);
  });

  it('strips markdown code fences (```json)', () => {
    const r = cleanOutput('```json\n{"slides": []}\n```');
    expect(r.cleaned).toBe('{"slides": []}');
    expect(r.steps).toContain('stripped_markdown_fences');
  });

  it('strips markdown code fences (bare ```)', () => {
    const r = cleanOutput('```\n{"slides": []}\n```');
    expect(r.cleaned).toBe('{"slides": []}');
    expect(r.steps).toContain('stripped_markdown_fences');
  });

  it('removes bold markers', () => {
    const r = cleanOutput('{"key": "**bold value**"}');
    expect(r.cleaned).toBe('{"key": "bold value"}');
    expect(r.steps).toContain('removed_bold_markers');
  });

  it('removes preamble before first {', () => {
    const r = cleanOutput('Here is your carousel:\n{"slides": []}');
    expect(r.cleaned).toBe('{"slides": []}');
    expect(r.steps).toContain('removed_preamble');
  });

  it('removes preamble before first [', () => {
    const r = cleanOutput('Here is the array: [1,2,3]');
    expect(r.cleaned).toBe('[1,2,3]');
    expect(r.steps).toContain('removed_preamble');
  });

  it('removes postamble after last }', () => {
    const r = cleanOutput('{"slides": []}\nLet me know if you want changes!');
    expect(r.cleaned).toBe('{"slides": []}');
    expect(r.steps).toContain('removed_postamble');
  });

  it('does not truncate when JSON is last content', () => {
    const r = cleanOutput('{"slides": []}');
    expect(r.cleaned).toBe('{"slides": []}');
    expect(r.steps).not.toContain('removed_postamble');
  });

  it('strips stray control characters', () => {
    const r = cleanOutput('{"key":\x00"value\x01"}');
    expect(r.cleaned).not.toContain('\x00');
    expect(r.cleaned).not.toContain('\x01');
    expect(r.steps).toContain('removed_stray_control_chars');
  });

  it('preserves valid JSON whitespace (tab, newline, CR)', () => {
    const input = '{\n\t"key":\r\n"value"\n}';
    const r = cleanOutput(input);
    // Tabs, newlines, CRs should be preserved
    expect(r.cleaned).toContain('\t');
    expect(r.cleaned).toContain('\n');
  });

  it('applies multiple steps when needed', () => {
    const r = cleanOutput('```json\nHere: {"slides": []}\n```\nExtra!');
    expect(r.steps.length).toBeGreaterThan(1);
  });

  it('is deterministic — same input always produces same output', () => {
    const input = '```json\n{"slides": []}\n```';
    const r1 = cleanOutput(input);
    const r2 = cleanOutput(input);
    expect(r1.cleaned).toBe(r2.cleaned);
    expect(r1.steps).toEqual(r2.steps);
  });

  it('handles empty string input', () => {
    const r = cleanOutput('');
    expect(r.cleaned).toBe('');
  });

  it('handles whitespace-only input', () => {
    const r = cleanOutput('   \n  ');
    expect(r.cleaned).toBe('');
  });
});


