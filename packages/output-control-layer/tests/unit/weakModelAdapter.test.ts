// ============================================================
// @brandos/output-control-layer — tests/unit/weakModelAdapter.test.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  detectRichness,
  adaptWeakOutput,
  richPassthrough,
  WEAK_RICHNESS_THRESHOLD,
} from '../../src/artifact-compiler/adapters/weakModelAdapter';

import type { DraftArtifactInput } from '@brandos/contracts';

const RICH_DRAFT: DraftArtifactInput = {
  slides: [
    { role: 'hook',      headline: 'Hook headline',      body: 'Hook body with detail.',     bullets: ['point 1', 'point 2'] },
    { role: 'problem',   headline: 'Problem headline',   body: 'Problem body with detail.',  bullets: ['point 1'] },
    { role: 'insight',   headline: 'Insight headline',   body: 'Insight body.',              bullets: ['insight detail'] },
    { role: 'framework', headline: 'Framework headline', body: 'Framework body.',             bullets: ['step 1', 'step 2', 'step 3'] },
    { role: 'evidence',  headline: 'Evidence headline',  body: 'Evidence body.',              bullets: ['stat 1'] },
    { role: 'CTA',       headline: 'CTA headline',       body: 'CTA body.',                  bullets: ['action'] },
  ],
  meta: { title: 'Rich carousel', hook: 'hook text', cta: 'cta text' },
};

const SPARSE_DRAFT: DraftArtifactInput = {
  slides: [
    { headline: 'Only a headline' },
    { headline: 'Another headline' },
  ],
};

const EMPTY_DRAFT: DraftArtifactInput = { slides: [] };

describe('WEAK_RICHNESS_THRESHOLD', () => {
  it('equals 40 (aligned with ISkill MIN_RICHNESS_OVERALL)', () => {
    expect(WEAK_RICHNESS_THRESHOLD).toBe(40);
  });
});

describe('detectRichness', () => {
  it('classifies rich draft as non-weak', () => {
    const result = detectRichness(RICH_DRAFT);
    expect(result.isWeak).toBe(false);
    expect(result.estimatedScore).toBeGreaterThanOrEqual(WEAK_RICHNESS_THRESHOLD);
  });

  it('classifies sparse draft as weak', () => {
    const result = detectRichness(SPARSE_DRAFT);
    expect(result.isWeak).toBe(true);
    expect(result.estimatedScore).toBeLessThan(WEAK_RICHNESS_THRESHOLD);
  });

  it('classifies empty draft as weak', () => {
    const result = detectRichness(EMPTY_DRAFT);
    expect(result.isWeak).toBe(true);
    expect(result.estimatedScore).toBeLessThan(WEAK_RICHNESS_THRESHOLD);
  });

  it('returns signals array', () => {
    const result = detectRichness(RICH_DRAFT);
    expect(Array.isArray(result.signals)).toBe(true);
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it('score is between 0 and 100', () => {
    for (const draft of [RICH_DRAFT, SPARSE_DRAFT, EMPTY_DRAFT]) {
      const result = detectRichness(draft);
      expect(result.estimatedScore).toBeGreaterThanOrEqual(0);
      expect(result.estimatedScore).toBeLessThanOrEqual(100);
    }
  });

  it('is deterministic', () => {
    const r1 = detectRichness(RICH_DRAFT);
    const r2 = detectRichness(RICH_DRAFT);
    expect(r1.estimatedScore).toBe(r2.estimatedScore);
    expect(r1.isWeak).toBe(r2.isWeak);
  });
});

describe('adaptWeakOutput', () => {
  it('returns a WeakAdaptationResult with a draft field', () => {
    const richness = detectRichness(SPARSE_DRAFT);
    const result = adaptWeakOutput(SPARSE_DRAFT, richness);
    expect(result.draft).toBeDefined();
    expect(result.wasAdapted).toBe(true);
  });

  it('produces slides when input had slides', () => {
    const richness = detectRichness(SPARSE_DRAFT);
    const result = adaptWeakOutput(SPARSE_DRAFT, richness);
    const slides = result.draft.slides ?? result.draft.cards ?? [];
    expect(Array.isArray(slides)).toBe(true);
  });

  it('never mutates the original draft', () => {
    const original = JSON.stringify(SPARSE_DRAFT);
    const richness = detectRichness(SPARSE_DRAFT);
    adaptWeakOutput(SPARSE_DRAFT, richness);
    expect(JSON.stringify(SPARSE_DRAFT)).toBe(original);
  });
});

describe('richPassthrough', () => {
  it('returns the original draft in the draft field', () => {
    const result = richPassthrough(RICH_DRAFT);
    expect(result.draft).toBe(RICH_DRAFT);
    expect(result.wasAdapted).toBe(false);
  });

  it('marks wasAdapted=false', () => {
    const result = richPassthrough(SPARSE_DRAFT);
    expect(result.wasAdapted).toBe(false);
  });
});


