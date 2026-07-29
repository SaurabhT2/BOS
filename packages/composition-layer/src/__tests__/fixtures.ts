// ============================================================
// packages/composition-layer/src/__tests__/fixtures.ts
//
// Full, schema-valid ArtifactV2 fixtures for all four supported
// artifact types. Every field here was checked directly against
// packages/contracts/src/artifact-v2.ts before being written —
// NOT copied from packages/presentation-layer's existing contract-test
// fixtures, which were found during this work to use a stale shape
// (e.g. ReportSection fields that no longer exist on the current
// schema) that happens to typecheck-clean only because that
// package's tsconfig excludes __tests__ from `tsc --noEmit`, and
// vitest's esbuild transform does not type-check either. See the
// Phase 2 status report for this finding — it is a pre-existing,
// unrelated repo issue, noted here so these fixtures are not
// mistaken for a copy of that stale pattern.
// ============================================================

import type { CarouselArtifact, DeckArtifact, ReportArtifact, NewsletterArtifact } from '@brandos/contracts'

const BASE_FIELDS = {
  $schema: 'artifact-json@2.0' as const,
  id: 'test-artifact-001',
  title: 'Test Artifact',
  summary: 'Test summary',
  hook: 'Test hook',
  cta: 'Test CTA',
  semantic_theme: {},
  audience: {
    sophistication: 'practitioner' as const,
  },
  narrative_arc: {
    structure: 'problem-solution' as const,
    hook_statement: 'Test hook statement',
    thesis: 'Test thesis',
    resolution: 'Test resolution',
    pacing: 'balanced' as const,
  },
  richness_metrics: {
    overall_score: 75,
    density_score: 70,
    evidence_score: 70,
    persuasion_score: 70,
    cta_quality_score: 70,
    narrative_coherence_score: 70,
    hook_strength_score: 70,
    audience_alignment_score: 70,
    total_content_words: 100,
    avg_words_per_unit: 33,
  },
  generation_trace: {
    generated_at: '2026-05-28T00:00:00.000Z',
    ocl_strategy: 'direct',
    governance_outcome: 'passed' as const,
    repair_attempts: 0,
    input_type: 'json' as const,
  },
  export_metadata: {
    available_formats: [] as import('@brandos/contracts').ExportFormat[],
  },
  created_at: '2026-05-28T00:00:00.000Z',
}

export function makeCarouselFixture(overrides?: Partial<CarouselArtifact>): CarouselArtifact {
  return {
    ...BASE_FIELDS,
    artifact_type: 'carousel',
    carousel_meta: {
      palette: [],
      slide_count: 1,
    },
    slides: [
      {
        slide: 1,
        role: 'hook',
        headline: 'Test Slide Headline',
        body: 'Test body text for the carousel slide.',
      },
    ],
    ...overrides,
  }
}

export function makeDeckFixture(overrides?: Partial<DeckArtifact>): DeckArtifact {
  return {
    ...BASE_FIELDS,
    artifact_type: 'deck',
    deck_meta: {
      section_count: 1,
      slide_count: 1,
    },
    slides: [
      {
        slide: 1,
        type: 'cover',
        title: 'Test Deck Slide',
      },
    ],
    ...overrides,
  }
}

export function makeReportFixture(overrides?: Partial<ReportArtifact>): ReportArtifact {
  return {
    ...BASE_FIELDS,
    artifact_type: 'report',
    report_meta: {
      section_count: 1,
      word_count: 100,
    },
    sections: [
      {
        id: 'executive-summary',
        heading: 'Executive Summary',
        body: 'Test body text for the report section.',
      },
    ],
    ...overrides,
  }
}

export function makeNewsletterFixture(overrides?: Partial<NewsletterArtifact>): NewsletterArtifact {
  return {
    ...BASE_FIELDS,
    artifact_type: 'newsletter',
    subject_line: 'Test Newsletter Subject',
    preview_text: 'Preview text for the newsletter',
    newsletter_meta: {
      section_count: 1,
      word_count: 100,
    },
    sections: [
      {
        id: 'intro',
        type: 'intro',
        heading: 'Introduction',
        body: 'Test newsletter intro section body text.',
      },
    ],
    ...overrides,
  }
}
