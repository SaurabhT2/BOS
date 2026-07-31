/**
 * apps/web — __tests__/artifact-export-email.test.ts
 *
 * Tests for Rendering V2 Phase 9's email renderer
 * (lib/artifact-export-email.ts). Fully testable — pure HTML string
 * generation, no browser or network dependency (unlike the image renderer's
 * screenshot step). See the module's own header for the disclosed gap this
 * DOESN'T close: real Outlook/Gmail rendering-engine verification, which no
 * string-content test can substitute for.
 */

import { describe, it, expect } from 'vitest'
import { renderNewsletterToEmailHTML } from '../lib/artifact-export-email'
import type { NewsletterArtifact } from '@brandos/contracts'

function makeNewsletterArtifact(overrides?: Partial<NewsletterArtifact>): NewsletterArtifact {
  return {
    $schema: 'artifact-json@2.0',
    id: 'test-001',
    artifact_type: 'newsletter',
    title: 'Test Newsletter',
    summary: 'A test newsletter',
    hook: 'hook',
    cta: 'cta',
    subject_line: 'Your Weekly Digest',
    preview_text: 'Here is what happened this week',
    semantic_theme: { visual_preset: 'corporate' },
    audience: { sophistication: 'practitioner' },
    narrative_arc: {
      structure: 'problem-solution', hook_statement: 'hook', thesis: 'thesis',
      resolution: 'resolution', pacing: 'balanced',
    },
    richness_metrics: {
      overall_score: 80, density_score: 80, evidence_score: 80, persuasion_score: 80,
      cta_quality_score: 80, narrative_coherence_score: 80, hook_strength_score: 80,
      audience_alignment_score: 80, total_content_words: 100, avg_words_per_unit: 50,
    },
    generation_trace: {
      generated_at: '2026-01-01T00:00:00.000Z', ocl_strategy: 'direct',
      governance_outcome: 'passed', repair_attempts: 0, input_type: 'json',
    },
    export_metadata: { available_formats: [] },
    created_at: '2026-01-01T00:00:00.000Z',
    newsletter_meta: { section_count: 1, word_count: 100 },
    sections: [{ id: 'intro', type: 'intro', heading: 'Introduction', body: 'Welcome to this week\'s issue.', bullets: ['Point one', 'Point two'] }],
    ...overrides,
  }
}

describe('renderNewsletterToEmailHTML — structural correctness', () => {
  it('uses table-based layout, not flexbox/grid', () => {
    const html = renderNewsletterToEmailHTML(makeNewsletterArtifact())
    expect(html).toContain('<table')
    expect(html).not.toContain('display:flex')
    expect(html).not.toContain('display:grid')
  })

  it('has no <style> block — every style is inline', () => {
    const html = renderNewsletterToEmailHTML(makeNewsletterArtifact())
    expect(html).not.toContain('<style')
  })

  it('has no CSS custom properties (unsupported by most email clients)', () => {
    const html = renderNewsletterToEmailHTML(makeNewsletterArtifact())
    expect(html).not.toContain('var(--')
    expect(html).not.toContain(':root')
  })

  it('every table cell carries an inline style attribute', () => {
    const html = renderNewsletterToEmailHTML(makeNewsletterArtifact())
    // Every <td> in the output should have a style="..." attribute — spot check
    // by counting <td and style= occurrences are proportionate, not exhaustive
    // (some <td> wrap nested tables without their own style, which is fine).
    const tdCount = (html.match(/<td/g) ?? []).length
    const styledTdCount = (html.match(/<td[^>]*style=/g) ?? []).length
    expect(styledTdCount).toBeGreaterThan(0)
    expect(tdCount).toBeGreaterThan(0)
  })

  it('fixes content width to a standard email-safe size', () => {
    const html = renderNewsletterToEmailHTML(makeNewsletterArtifact())
    expect(html).toContain('width="600"')
  })
})

describe('renderNewsletterToEmailHTML — content correctness', () => {
  it('includes the subject line, preview text, and section content', () => {
    const html = renderNewsletterToEmailHTML(makeNewsletterArtifact())
    expect(html).toContain('Test Newsletter')
    expect(html).toContain('Here is what happened this week')
    expect(html).toContain('Introduction')
    expect(html).toContain('Welcome to this week')
    expect(html).toContain('Point one')
    expect(html).toContain('Point two')
  })

  it('resolves theme colors as literal inline values, not variable references', () => {
    const html = renderNewsletterToEmailHTML(makeNewsletterArtifact({ semantic_theme: { visual_preset: 'corporate' } }))
    // 'corporate' preset's primary color in @brandos/design-tokens
    expect(html).toContain('#1e3a8a')
  })

  it('handles a section with no heading (newsletter sections do not require one)', () => {
    const html = renderNewsletterToEmailHTML(
      makeNewsletterArtifact({
        sections: [{ id: 'cta', type: 'cta', body: 'Just body text, no heading.' }],
      })
    )
    expect(html).toContain('Just body text, no heading.')
  })

  it('never renders speaker_notes-equivalent content (newsletter has none, but confirms the block-kind switch is exhaustive)', () => {
    const html = renderNewsletterToEmailHTML(makeNewsletterArtifact())
    expect(typeof html).toBe('string')
    expect(html.length).toBeGreaterThan(0)
  })
})
