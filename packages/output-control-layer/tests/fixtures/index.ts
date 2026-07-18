// ============================================================
// @brandos/output-control-layer — tests/fixtures/index.ts
//
// Shared test fixtures for OCL unit, integration, and mutation tests.
// ============================================================

import type { AIRuntimeOutput, NormalizeOptions, ContributorContext } from '@brandos/contracts';

// ─── Raw LLM output fixtures ──────────────────────────────────────────────────

export const RAW_CAROUSEL_VALID = JSON.stringify({
  slides: [
    { role: 'hook',      headline: 'The Founder Problem',    body: 'Most founders burn out before they find PMF.' },
    { role: 'problem',   headline: 'Signal vs Noise',        body: 'You are drowning in metrics that do not matter.' },
    { role: 'insight',   headline: 'One Number Changes All', body: 'Retention is the only metric that compounds.' },
    { role: 'framework', headline: 'The Retention Stack',    body: 'Onboarding → Habit → Loop. Three layers, one outcome.' },
    { role: 'evidence',  headline: '3x Growth, Same Team',   body: 'Companies that hit 40% retention grow 3x faster.' },
    { role: 'CTA',       headline: 'Start With Why They Stay', body: 'Interview 10 churned users this week.' },
  ],
});

export const RAW_CAROUSEL_FENCED = '```json\n' + RAW_CAROUSEL_VALID + '\n```';

export const RAW_CAROUSEL_WITH_PREAMBLE =
  'Here is your carousel content:\n\n' + RAW_CAROUSEL_VALID + '\n\nLet me know if you want changes!';

export const RAW_CAROUSEL_TRAILING_COMMA = `{
  "slides": [
    { "role": "hook", "headline": "Test", "body": "Body text here." },
    { "role": "CTA", "headline": "Act Now", "body": "Take action today." }
  ]
}`;

export const RAW_CAROUSEL_SINGLE_QUOTES = `{
  'slides': [
    { 'role': 'hook', 'headline': 'Test Hook', 'body': 'Hook body.' },
    { 'role': 'CTA', 'headline': 'CTA Slide', 'body': 'CTA body.' }
  ]
}`;

export const RAW_DECK_VALID = JSON.stringify({
  title: 'Q3 Product Strategy',
  slides: [
    { title: 'Overview', bullets: ['Three pillars', 'Six months', 'One team'], type: 'cover' },
    { title: 'Problem', bullets: ['Users churn at day 3', 'Activation rate 22%'], type: 'content' },
    { title: 'Solution', bullets: ['Redesign onboarding', 'Add progress indicators'], type: 'content' },
    { title: 'Timeline', bullets: ['Month 1: Discovery', 'Month 2-3: Build'], type: 'content' },
    { title: 'Success', bullets: ['DAU up 40%', 'Activation above 60%'], type: 'content' },
    { title: 'Next Steps', bullets: ['Kick off this Monday', 'Weekly check-ins'], type: 'closing' },
  ],
});

export const RAW_REPORT_VALID = JSON.stringify({
  title: 'Retention Analysis 2026',
  slides: [
    { title: 'Executive Summary', bullets: ['Retention improved 18% YoY'], type: 'cover' },
    { title: 'Methodology', bullets: ['Cohort analysis', 'N=12,000 users'], stats: [{ value: '12,000', label: 'Sample size' }], type: 'section' },
    { title: 'Key Findings', bullets: ['Day-7 retention: 41%'], stats: [{ value: '41%', label: 'Day-7 retention' }], type: 'data' },
    { title: 'Recommendations', bullets: ['Focus onboarding', 'Add social proof'], type: 'closing' },
  ],
});

export const RAW_COMPLETELY_INVALID = 'This is not JSON. It cannot be repaired. ~~~###';

export const RAW_EMPTY = '';

export const RAW_ONLY_TEXT = 'Write me a carousel about retention.';

// ─── AIRuntimeOutput wrappers ─────────────────────────────────────────────────

export function makeRuntimeOutput(content: string): AIRuntimeOutput {
  return {
    content,
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    usage: { inputTokens: 100, outputTokens: 200 },
  };
}

// ─── NormalizeOptions ─────────────────────────────────────────────────────────

export const CAROUSEL_OPTIONS: NormalizeOptions = {
  taskType: 'carousel',
  enableLLMRepair: false,
};

export const DECK_OPTIONS: NormalizeOptions = {
  taskType: 'deck',
  enableLLMRepair: false,
};

export const REPORT_OPTIONS: NormalizeOptions = {
  taskType: 'report',
  enableLLMRepair: false,
};

export const TEXT_OPTIONS: NormalizeOptions = {
  taskType: 'generate_post',
  enableLLMRepair: false,
};

// ─── ContributorContext ───────────────────────────────────────────────────────

export const MINIMAL_CONTRIBUTOR_CONTEXT: ContributorContext = {
  userId: 'test-user-001',
  // P0 — Implementation Wave 1A: workspaceId is now a required, distinct
  // field on ContributorContext (see generation-contract.ts). Pre-P0 fixtures
  // only had userId since the two were synonymous.
  workspaceId: 'test-workspace-001',
  requestId: 'test-request-001',
  userPrompt: 'Create a carousel about founder retention strategies',
  taskType: 'carousel',
  runtimeMode: 'cloud',
  attempt: 1,
};

export const CONTRIBUTOR_CONTEXT_WITH_BRAND: ContributorContext = {
  ...MINIMAL_CONTRIBUTOR_CONTEXT,
  // PLATFORM SPLIT: cognitionContext is the field IdentityContributor and
  // PersonaContributor actually read (see generation-contract.ts). The
  // former `resolvedSemanticIdentity` field this fixture used to set was
  // never read by either contributor — see IdentityContributor.ts and
  // AGENT_CONTEXT.md in packages/cognition-client for the history.
  cognitionContext: {
    contractVersion: '1.1.0',
    workspaceId: 'test-workspace-001',
    resolvedAt: '2026-05-28T00:00:00.000Z',
    confidence: 'high',
    voice: {
      tone: 'confident',
      cadence: 'medium',
      audienceType: 'founders',
      executiveLevel: false,
      domain: 'saas',
      bannedPhrases: [],
    },
    identity: {
      brandName: 'Acme',
      narrativeArcs: ['problem-solution'],
      argumentationStyle: 'evidence-led',
      namedFrameworks: [],
      preferredLength: 'medium',
      hookStyle: 'question',
      ctaIntent: 'Start today',
    },
    visualIdentity: null,
    provenance: { signalCount: 40, lastConsolidatedAt: '2026-05-27T00:00:00.000Z' },
    // EM-1.1 (Cognitive Platform Evolution Program) — these three fields
    // became required (nullable, not optional) when this fixture's
    // CognitionContext type gained ADR-004's sections. Populated with
    // realistic sample data here (rather than all-null) so
    // CONTRIBUTOR_CONTEXT_WITH_BRAND is also useful fixture data for
    // KnowledgeContributor.ts's tests (EM-4.1) — see
    // tests/contracts/contributors.test.ts.
    knowledge: {
      themes: [{ name: 'founder-led growth', description: 'content emphasizes the founder as the primary voice' }],
      confidence: 'high',
      hasConflict: false,
    },
    reasoning: {
      conclusions: [{ statement: 'Audience responds better to specific numbers than vague claims' }],
      confidence: 'medium',
      hasConflict: false,
    },
    positioning: {
      statements: [{ statement: 'Positioned as the founder-friendly alternative to enterprise tooling' }],
      confidence: 'high',
      hasConflict: false,
    },
  },
};


