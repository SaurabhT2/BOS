// ============================================================
// @brandos/output-control-layer — tests/unit/repairJSON.test.ts
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { repairJSON, repairWithLLM } from '../../src/output-normalizer/pipeline/repairJSON';

describe('repairJSON', () => {
  it('fixes trailing comma before }', () => {
    const result = repairJSON('{"key": "value",}');
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ key: 'value' });
  });

  it('fixes trailing comma before ]', () => {
    const result = repairJSON('{"arr": [1, 2, 3,]}');
    expect(result).not.toBeNull();
    expect(JSON.parse(result!).arr).toEqual([1, 2, 3]);
  });

  it('fixes single-quoted strings', () => {
    const result = repairJSON("{'key': 'value'}");
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ key: 'value' });
  });

  it('fixes unquoted property keys', () => {
    const result = repairJSON('{key: "value"}');
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ key: 'value' });
  });

  it('closes unclosed brace', () => {
    const result = repairJSON('{"key": "value"');
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ key: 'value' });
  });

  it('closes unclosed bracket', () => {
    const result = repairJSON('[1, 2, 3');
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual([1, 2, 3]);
  });

  it('returns null when repair cannot produce valid JSON', () => {
    // Completely invalid, unrepairable input
    const result = repairJSON('this is: not :: json at all === ~~~');
    expect(result).toBeNull();
  });

  it('returned string always parses cleanly', () => {
    const inputs = [
      '{"key": "value",}',
      "{'a': 'b', 'c': 'd'}",
      '{x: 1, y: 2}',
      '[1, 2,]',
    ];
    for (const input of inputs) {
      const repaired = repairJSON(input);
      if (repaired !== null) {
        expect(() => JSON.parse(repaired)).not.toThrow();
      }
    }
  });

  it('handles already-valid JSON without corruption', () => {
    const valid = '{"slides": [{"role": "hook", "headline": "Test"}]}';
    const result = repairJSON(valid);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual(JSON.parse(valid));
  });
});

// ─── Regression tests: truncated string recovery (Google Gemini patterns) ───────

describe('repairJSON — truncated string recovery', () => {
  it('recovers from mid-string truncation (LLM cut off inside a field value)', () => {
    // Simulates Google Gemini truncating inside a body string value
    // This is the exact pattern seen in production logs
    const truncated = '{\n  "slides": [\n    {\n      "role": "evidence",\n      "headline": "Advanced Characterization Prevents 15% of Early Product Failures",\n      "body": "micro-heterogeneities can reduce expected component lifespan by up to 40% compared to designs based on comprehensive material characterization, as reported by a 2023 study on automotive components by the SAE International.'
    const result = repairJSON(truncated)
    expect(result).not.toBeNull()
    if (result !== null) {
      const parsed = JSON.parse(result)
      expect(Array.isArray(parsed.slides)).toBe(true)
      expect(parsed.slides[0].role).toBe('evidence')
      expect(parsed.slides[0].headline).toContain('15%')
    }
  })

  it('recovers from truncation inside a headline string', () => {
    const truncated = '{"slides": [{"role": "hook", "headline": "Precision Engineering Relies on Accurate Material Char'
    const result = repairJSON(truncated)
    expect(result).not.toBeNull()
    if (result !== null) {
      const parsed = JSON.parse(result)
      expect(Array.isArray(parsed.slides)).toBe(true)
    }
  })

  it('does not corrupt already-closed strings', () => {
    const valid = '{"slides": [{"role": "hook", "headline": "Complete headline", "body": "Complete body."}]}'
    const result = repairJSON(valid)
    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!)
    expect(parsed.slides[0].body).toBe('Complete body.')
  })

  it('handles truncation with nested objects mid-string', () => {
    const truncated = '{\n  "title": "Homogeneous and Heterogeneous Material",\n  "slides": [\n    {\n      "role": "insight",\n      "headline": "Critical Shift in How Material Behaves Under Stress",\n      "body": "Understanding the micro-scale uniformity of materials is critical. For instance, a leading aerospace manufacturer'
    const result = repairJSON(truncated)
    expect(result).not.toBeNull()
    if (result !== null) {
      const parsed = JSON.parse(result)
      expect(parsed.title).toBe('Homogeneous and Heterogeneous Material')
      expect(Array.isArray(parsed.slides)).toBe(true)
    }
  })
})

describe('repairWithLLM', () => {
  it('calls callLLM with a repair prompt', async () => {
    const callLLM = vi.fn().mockResolvedValue('{"slides": []}');
    const result = await repairWithLLM('{"broken":', callLLM);
    expect(callLLM).toHaveBeenCalledOnce();
    expect(callLLM.mock.calls[0][0]).toContain('JSON repair');
    expect(result).toBe('{"slides": []}');
  });

  it('strips markdown fences from LLM response', async () => {
    const callLLM = vi.fn().mockResolvedValue('```json\n{"slides": []}\n```');
    const result = await repairWithLLM('{"broken":', callLLM);
    expect(result).toBe('{"slides": []}');
  });

  it('returns null when LLM produces invalid JSON', async () => {
    const callLLM = vi.fn().mockResolvedValue('still broken json ~~~');
    const result = await repairWithLLM('{"broken":', callLLM);
    expect(result).toBeNull();
  });

  it('returns null when callLLM throws', async () => {
    const callLLM = vi.fn().mockRejectedValue(new Error('LLM timeout'));
    const result = await repairWithLLM('{"broken":', callLLM);
    expect(result).toBeNull();
  });
});


