// ============================================================
// @brandos/output-control-layer — tests/integration/normalizeOutput.test.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import { normalizeOutput } from '../../src/output-normalizer/normalizeOutput';
import {
  makeRuntimeOutput,
  CAROUSEL_OPTIONS,
  DECK_OPTIONS,
  REPORT_OPTIONS,
  TEXT_OPTIONS,
  RAW_CAROUSEL_VALID,
  RAW_CAROUSEL_FENCED,
  RAW_CAROUSEL_WITH_PREAMBLE,
  RAW_CAROUSEL_TRAILING_COMMA,
  RAW_DECK_VALID,
  RAW_REPORT_VALID,
  RAW_COMPLETELY_INVALID,
  RAW_EMPTY,
  RAW_ONLY_TEXT,
} from '../fixtures';

// ─── Carousel ─────────────────────────────────────────────────────────────────

describe('normalizeOutput — carousel', () => {
  it('succeeds on valid carousel JSON', async () => {
    const result = await normalizeOutput(makeRuntimeOutput(RAW_CAROUSEL_VALID), CAROUSEL_OPTIONS);
    expect(result.success).toBe(true);
    expect(result.type).toBe('carousel');
    expect(result.trace.validationPassed).toBe(true);
  });

  it('returns structured content (not rawText) for carousel', async () => {
    const result = await normalizeOutput(makeRuntimeOutput(RAW_CAROUSEL_VALID), CAROUSEL_OPTIONS);
    expect(result.success).toBe(true);
    const content = result.content;
    expect(Array.isArray(content.slides)).toBe(true);
    expect((content.slides?.length ?? 0)).toBeGreaterThan(0);
  });

  it('succeeds on fenced carousel JSON', async () => {
    const result = await normalizeOutput(makeRuntimeOutput(RAW_CAROUSEL_FENCED), CAROUSEL_OPTIONS);
    expect(result.success).toBe(true);
  });

  it('succeeds on carousel JSON with preamble', async () => {
    const result = await normalizeOutput(makeRuntimeOutput(RAW_CAROUSEL_WITH_PREAMBLE), CAROUSEL_OPTIONS);
    expect(result.success).toBe(true);
  });

  it('succeeds on carousel JSON with no trailing commas', async () => {
    const result = await normalizeOutput(makeRuntimeOutput(RAW_CAROUSEL_TRAILING_COMMA), CAROUSEL_OPTIONS);
    expect(result.success).toBe(true);
  });

  it('fails gracefully on completely invalid input', async () => {
    const result = await normalizeOutput(makeRuntimeOutput(RAW_COMPLETELY_INVALID), CAROUSEL_OPTIONS);
    expect(result.success).toBe(false);
    expect(result.trace.strategy).toBe('fallback_empty');
  });

  it('fails gracefully on empty input', async () => {
    const result = await normalizeOutput(makeRuntimeOutput(RAW_EMPTY), CAROUSEL_OPTIONS);
    expect(result.success).toBe(false);
  });

  it('populates trace with strategy information', async () => {
    const result = await normalizeOutput(makeRuntimeOutput(RAW_CAROUSEL_VALID), CAROUSEL_OPTIONS);
    expect(result.trace.strategy).toBeTruthy();
    expect(result.trace.strategy).not.toBe('fallback_empty');
  });
});

// ─── Deck ─────────────────────────────────────────────────────────────────────

describe('normalizeOutput — deck', () => {
  it('succeeds on valid deck JSON', async () => {
    const result = await normalizeOutput(makeRuntimeOutput(RAW_DECK_VALID), DECK_OPTIONS);
    expect(result.success).toBe(true);
    expect(result.type).toBe('deck');
  });

  it('returns structured content for deck (not rawText)', async () => {
    const result = await normalizeOutput(makeRuntimeOutput(RAW_DECK_VALID), DECK_OPTIONS);
    expect(result.success).toBe(true);
    const content = result.content;
    expect(content).toBeDefined();
    const hasSlidesOrMeta = content.slides !== undefined || content.meta !== undefined;
    expect(hasSlidesOrMeta).toBe(true);
  });

  it('fails gracefully on invalid deck input', async () => {
    const result = await normalizeOutput(makeRuntimeOutput(RAW_COMPLETELY_INVALID), DECK_OPTIONS);
    expect(result.success).toBe(false);
  });
});

// ─── Report ───────────────────────────────────────────────────────────────────

describe('normalizeOutput — report', () => {
  it('succeeds on valid report JSON', async () => {
    const result = await normalizeOutput(makeRuntimeOutput(RAW_REPORT_VALID), REPORT_OPTIONS);
    expect(result.success).toBe(true);
    expect(result.type).toBe('report');
  });

  it('falls back to rawText for JSON that fails report schema', async () => {
    // An object that parses but doesn't match report schema → rawText fallback path
    const unknownJSON = JSON.stringify({ message: 'A plain report section.' });
    const result = await normalizeOutput(makeRuntimeOutput(unknownJSON), REPORT_OPTIONS);
    // success=true with rawText populated (report text fallback)
    expect(result.success).toBe(true);
    expect(result.content.rawText).toBeTruthy();
  });
});

// ─── Text passthrough ─────────────────────────────────────────────────────────

describe('normalizeOutput — text passthrough', () => {
  it('passes through non-structured task types', async () => {
    const result = await normalizeOutput(makeRuntimeOutput(RAW_ONLY_TEXT), TEXT_OPTIONS);
    expect(result.success).toBe(true);
    expect(result.trace.strategy).toBe('text_passthrough');
    expect(result.content.rawText).toBe(RAW_ONLY_TEXT);
  });

  it('does not attempt JSON extraction for text tasks', async () => {
    const result = await normalizeOutput(makeRuntimeOutput(RAW_ONLY_TEXT), TEXT_OPTIONS);
    expect(result.trace.extractionAttempted).toBe(false);
  });
});

// ─── LLM repair ───────────────────────────────────────────────────────────────

describe('normalizeOutput — LLM repair path', () => {
  it('invokes callLLM when enableLLMRepair=true and repair needed', async () => {
    let called = false;
    const callLLM = async (_prompt: string): Promise<string> => {
      called = true;
      return RAW_CAROUSEL_VALID;
    };

    const result = await normalizeOutput(
      makeRuntimeOutput(RAW_COMPLETELY_INVALID),
      { ...CAROUSEL_OPTIONS, enableLLMRepair: true, callLLM }
    );

    expect(called).toBe(true);
    expect(result.success).toBe(true);
  });

  it('does not invoke callLLM when enableLLMRepair=false', async () => {
    let called = false;
    const callLLM = async (_prompt: string): Promise<string> => {
      called = true;
      return RAW_CAROUSEL_VALID;
    };

    await normalizeOutput(
      makeRuntimeOutput(RAW_COMPLETELY_INVALID),
      { ...CAROUSEL_OPTIONS, enableLLMRepair: false, callLLM }
    );

    expect(called).toBe(false);
  });
});


