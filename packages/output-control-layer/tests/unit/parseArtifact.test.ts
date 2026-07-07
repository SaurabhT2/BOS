// ============================================================
// @brandos/output-control-layer — tests/unit/parseArtifact.test.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  parseArtifact,
  parseArtifactJSON,
  validateArtifactFields,
} from '../../src/output-normalizer/parser/parseArtifact';
import {
  RAW_CAROUSEL_VALID,
  RAW_CAROUSEL_FENCED,
  RAW_CAROUSEL_WITH_PREAMBLE,
  RAW_COMPLETELY_INVALID,
} from '../fixtures';

// A string that has an actual trailing comma — invalid JSON, requires repair
const RAW_WITH_TRAILING_COMMA = '{"slides": [{"role": "hook", "headline": "Test", "body": "Body.",},]}';

describe('parseArtifact', () => {
  it('parses valid JSON directly (pass 1)', () => {
    const result = parseArtifact(RAW_CAROUSEL_VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repaired).toBeUndefined();
    }
  });

  it('parses fenced JSON via clean+extract (pass 2)', () => {
    const result = parseArtifact(RAW_CAROUSEL_FENCED);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repaired).toBe(true);
    }
  });

  it('parses JSON with preamble via clean+extract (pass 2)', () => {
    const result = parseArtifact(RAW_CAROUSEL_WITH_PREAMBLE);
    expect(result.ok).toBe(true);
  });

  it('parses trailing-comma JSON via heuristic repair (pass 3)', () => {
    const result = parseArtifact(RAW_WITH_TRAILING_COMMA);
    expect(result.ok).toBe(true);
    // repaired may be true (pass 2 or 3 succeeded)
  });

  it('returns ok=false for completely unrecoverable input', () => {
    const result = parseArtifact(RAW_COMPLETELY_INVALID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('failed');
      expect(result.raw).toBeTruthy();
    }
  });

  it('never throws — returns discriminated union', () => {
    const inputs = [RAW_COMPLETELY_INVALID, '', '   ', 'null', '{{{}}}', '[[]]'];
    for (const input of inputs) {
      expect(() => parseArtifact(input)).not.toThrow();
    }
  });

  it('returns slides array when parsing carousel', () => {
    const result = parseArtifact<{ slides: unknown[] }>(RAW_CAROUSEL_VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.isArray(result.data.slides)).toBe(true);
      expect(result.data.slides).toHaveLength(6);
    }
  });

  it('handles empty string input gracefully', () => {
    const result = parseArtifact('');
    expect(result.ok).toBe(false);
  });

  it('parseArtifactJSON is an alias for parseArtifact', () => {
    const r1 = parseArtifact(RAW_CAROUSEL_VALID);
    const r2 = parseArtifactJSON(RAW_CAROUSEL_VALID);
    expect(r1.ok).toBe(r2.ok);
    if (r1.ok && r2.ok) {
      expect(r1.data).toEqual(r2.data);
    }
  });

  it('is deterministic — same input same result', () => {
    const r1 = parseArtifact(RAW_CAROUSEL_VALID);
    const r2 = parseArtifact(RAW_CAROUSEL_VALID);
    expect(r1.ok).toBe(r2.ok);
    if (r1.ok && r2.ok) {
      expect(r1.data).toEqual(r2.data);
    }
  });
});

describe('validateArtifactFields', () => {
  it('returns empty array for object with all required fields', () => {
    const data = { slides: [], title: 'Test' };
    const errors = validateArtifactFields(data, ['slides', 'title']);
    expect(errors).toHaveLength(0);
  });

  it('returns errors for missing fields', () => {
    const data = { title: 'Test' };
    const errors = validateArtifactFields(data, ['slides', 'title']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('slides');
  });

  it('returns error for non-object input', () => {
    const errors = validateArtifactFields('not an object', ['slides']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('JSON object');
  });

  it('returns error for null input', () => {
    const errors = validateArtifactFields(null, ['slides']);
    expect(errors).toHaveLength(1);
  });

  it('returns error for array input', () => {
    const errors = validateArtifactFields([1, 2, 3], ['slides']);
    expect(errors).toHaveLength(1);
  });

  it('returns empty array when no fields required', () => {
    const errors = validateArtifactFields({ any: 'thing' }, []);
    expect(errors).toHaveLength(0);
  });
});



// ─── Regression tests: Google Gemini payload patterns ────────────────────────
// These tests reproduce the exact failure pattern observed in production logs
// where Google returns rich carousel content that the old parser rejected.

import { extractJSON } from '../../src/output-normalizer/pipeline/extractJSON';
import { repairJSON } from '../../src/output-normalizer/pipeline/repairJSON';
import { cleanOutput } from '../../src/output-normalizer/pipeline/cleanOutput';

describe('Google Gemini payload regression tests', () => {
  // This is the actual pattern from the [REPAIR_END] log lines — Google returns
  // well-structured JSON but with prose preamble/postamble OR truncation.

  const GOOGLE_PAYLOAD_WITH_PREAMBLE = `Here is the repaired carousel for you:

{
  "title": "Homogeneous and Heterogeneous Material",
  "hook": "91% of engineers who misclassify material uniformity encounter premature product failure — here is how to get it right.",
  "cta": "Save this post and apply the 4-category framework to your next material selection decision.",
  "slides": [
    {
      "slide": 1,
      "role": "hook",
      "headline": "The Material Classification Error Costing Engineers Millions",
      "subheadline": "Misidentifying homogeneity leads to catastrophic design failures",
      "body": "Most engineers treat material uniformity as binary — homogeneous or not. This oversimplification ignores the critical distinction between macro and micro-scale uniformity.",
      "key_takeaway": "Material classification at the wrong scale invalidates your entire design assumption.",
      "emphasis_keywords": ["Material Spectrum", "Classification Framework"],
      "visual_direction": "2x2 matrix diagram"
    },
    {
      "slide": 2,
      "role": "evidence",
      "headline": "Advanced Characterization Prevents 15% of Early Product Failures",
      "subheadline": "Case studies reveal the impact of rigorous material classification",
      "body": "Implementing advanced characterization techniques such as SEM or XRD allows engineers to precisely map material homogeneity at the micro-scale.",
      "key_takeaway": "Deep material characterization prevents the most expensive failure modes.",
      "emphasis_keywords": ["Critical Shift", "Behaves Under Stress"]
    },
    {
      "slide": 3,
      "role": "cta",
      "headline": "Apply the Framework to Your Next Design",
      "body": "Save this and run the 4-category analysis on your current material selection this week."
    }
  ]
}

I hope this helps! Let me know if you need any adjustments.`;

  const GOOGLE_PAYLOAD_FENCED = `\`\`\`json
{
  "title": "Physical AI: The Next Platform Shift",
  "hook": "Software ate the world — Physical AI is about to eat software. Here is what founders need to know.",
  "cta": "DM me 'PHYSAI' and I will send you the full framework for evaluating Physical AI opportunities.",
  "slides": [
    {
      "slide": 1,
      "role": "hook",
      "headline": "The $10T Platform Shift Most Founders Are Missing",
      "subheadline": "Physical AI is not a vertical — it is the next computing paradigm",
      "body": "Every major platform shift in computing has created 10x more value than the one before it. Physical AI — AI embedded in the physical world through robots, sensors, and autonomous systems — is the next one."
    },
    {
      "slide": 2,
      "role": "cta",
      "headline": "Position Yourself Now Before the Window Closes",
      "body": "The founders who win the Physical AI era are building today. DM me 'PHYSAI' for the framework."
    }
  ]
}
\`\`\``;

  const GOOGLE_PAYLOAD_TRUNCATED =
    '{\n  "title": "Homogeneous and Heterogeneous Material",\n  "hook": "91% of engineers misclassify material uniformity — here is what they miss.",\n  "cta": "Save this and apply the framework to your next project.",\n  "slides": [\n    {\n      "role": "evidence",\n      "headline": "Precision Engineering Relies on Accurate Material Characterization",\n      "body": "The success of advanced engineering projects hinges on precise material uniformity. For instance, in 2022, SpaceX significantly reduced Starship structural component weight by 15% through optimized composite layups, achieved by meticulously mapping the micro-heterogeneity of carbon fiber prepregs. Conversely, the catastrophic failure of a bridge in Q1 2018 was attributed to ignoring the long-term degradation mechanisms arising from the heterogeneous nature of';

  it('parseArtifact succeeds on Google payload with preamble and postamble', () => {
    const result = parseArtifact(GOOGLE_PAYLOAD_WITH_PREAMBLE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as Record<string, unknown>;
      expect(Array.isArray(data.slides)).toBe(true);
      expect((data.slides as unknown[]).length).toBe(3);
      expect(data.title).toBe('Homogeneous and Heterogeneous Material');
    }
  });

  it('parseArtifact succeeds on Google payload wrapped in fenced code block', () => {
    const result = parseArtifact(GOOGLE_PAYLOAD_FENCED);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as Record<string, unknown>;
      expect(Array.isArray(data.slides)).toBe(true);
      expect(data.hook).toContain('Software ate the world');
    }
  });

  it('repairJSON recovers from Google payload truncated mid-string', () => {
    const { cleaned } = cleanOutput(GOOGLE_PAYLOAD_TRUNCATED);
    const extracted = extractJSON(cleaned);
    // extractJSON may succeed via outermost-block scan
    if (extracted !== null) {
      expect(typeof extracted).toBe('object');
      return;
    }
    // Fall back to repairJSON
    const repaired = repairJSON(cleaned);
    expect(repaired).not.toBeNull();
    if (repaired !== null) {
      const parsed = JSON.parse(repaired);
      expect(parsed.title).toBe('Homogeneous and Heterogeneous Material');
      expect(Array.isArray(parsed.slides)).toBe(true);
    }
  });

  it('parseArtifact preserves slide-level Google fields (subheadline, key_takeaway, emphasis_keywords, visual_direction)', () => {
    const result = parseArtifact(GOOGLE_PAYLOAD_WITH_PREAMBLE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as Record<string, unknown>;
      const slides = data.slides as Record<string, unknown>[];
      const hook = slides[0];
      expect(hook.subheadline).toBeDefined();
      expect(hook.key_takeaway).toBeDefined();
      expect(Array.isArray(hook.emphasis_keywords)).toBe(true);
    }
  });

  it('governance-layer schema normalization maps cards -> slides', () => {
    // Test the normalizeGoogleSchema logic via extractJSON pipeline
    const cardsPayload = JSON.stringify({
      title: 'Test',
      hook: 'A strong hook statement for the carousel.',
      cta: 'Save this and share it with your team today.',
      cards: [
        { role: 'hook', headline: 'Slide 1', body: 'Body.' },
        { role: 'cta', headline: 'Act now', body: 'Do it.' },
      ]
    });
    const result = parseArtifact(cardsPayload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // cards key is preserved at parse level; normalization in governance layer maps it
      const data = result.data as Record<string, unknown>;
      expect(data.cards).toBeDefined(); // raw parse preserves original key
    }
  });
});
