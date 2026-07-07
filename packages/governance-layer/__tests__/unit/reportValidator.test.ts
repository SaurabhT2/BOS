/**
 * Unit tests — report/validator.ts
 */

import { describe, it, expect, vi } from 'vitest'
import { validateReportArtifact, runReportSemanticGovernance } from '../../src/report/validator'
import type { ReportArtifact } from '@brandos/contracts'
import { REPORT_GOVERNANCE_THRESHOLDS as T } from '@brandos/governance-config'

function makeMinimalReport(): ReportArtifact {
  return {
    artifact_type: 'report',
    title: 'Founder-Led Sales Outperforms Hired Sales in the First 18 Months: Evidence from 312 B2B Startups',
    hook: 'Founders who stay in sales for the first 18 months grow 40% faster than those who delegate early.',
    cta: 'Download the full dataset and share with your go-to-market team before your next board meeting.',
    executive_summary: 'Founder-led sales produces meaningfully better outcomes across every measured dimension: higher win rates, shorter cycles, and stronger retention. The implication for early-stage founders is direct: staying in the sales seat through $2M ARR is not a time cost — it is a compounding investment.',
    sections: [
      {
        id: 'executive-summary',
        heading: 'Founder-Led Sales Outperforms Hired Reps by 40% Across All B2B Segments',
        subheading: 'The performance gap widens at enterprise deal sizes and persists through Series A',
        body: 'Analysis of 312 B2B startups from 2021 to 2024 shows that companies where the founder remained the primary closer through $2M ARR achieved a 40% higher revenue growth rate than comparable companies that hired their first sales rep before reaching $500K ARR. The effect was strongest in enterprise deals above $50K ACV, where founder involvement in the close increased win rates from 23% to 41%. The mechanism appears to be trust compression: enterprise buyers assign higher credibility to founders, reducing the qualification-to-close timeline by an average of 34 days.',
        key_findings: [
          'Founder-led companies grew 40% faster through the first 18 months versus early-hire counterparts across all deal sizes',
          'Win rates in enterprise deals above $50K ACV improved from 23% to 41% when the founder personally closed',
          'Sales cycle length decreased by 34 days on average in founder-led deals — driven by trust compression with senior buyers',
          'The performance advantage persisted even after companies hired their first sales rep, suggesting a knowledge-transfer benefit',
        ],
        data_points: [
          { label: 'Revenue growth advantage (founder-led vs. early-hire)', value: '40%', source: '312-startup cohort study, 2021–2024' },
          { label: 'Enterprise win rate improvement with founder in close', value: '23% → 41%', source: 'Deal-level analysis, deals above $50K ACV' },
          { label: 'Sales cycle reduction (founder vs. hired rep)', value: '34 days shorter', source: 'Median across 1,847 closed deals' },
        ],
      },
      {
        id: 'pattern-analysis',
        heading: 'Three Behavioural Patterns Explain the Entire Performance Gap',
        subheading: 'Product authority, transparent qualification, and conviction-led closing account for 87% of the variance',
        body: 'Regression analysis across 1,847 closed deals identified three behavioural patterns that together explain 87% of the variance in win rate between founder-led and hired-rep deals. First, product authority: founders answer technical questions in the moment without deferring to an SE, which senior buyers interpret as organisational competence, not just individual knowledge. Second, transparent qualification: founders are more willing to disqualify bad-fit prospects early, which improves the quality of the pipeline and the conversion rate from SQL to close. Third, conviction-led closing: founders close with a directness that hired reps — who are optimising for relationship preservation — rarely match. The combination of these three patterns compresses the trust-building timeline that normally extends enterprise sales cycles.',
        key_findings: [
          'Product authority alone accounts for 31% of the win-rate variance — buyers equate founder knowledge with organisational capability',
          'Founders disqualify bad-fit prospects 2.7x more often than hired reps, producing a cleaner pipeline with higher conversion rates',
          'Conviction-led closing shortened the final negotiation stage by an average of 18 days in deals above $100K ACV',
          'The three patterns interact — founders who demonstrate all three outperform those who demonstrate only one by a factor of 4.2x',
        ],
        data_points: [
          { label: 'Share of win-rate variance explained by product authority', value: '31%', source: 'Regression analysis, 1,847 deals' },
          { label: 'Disqualification rate: founders vs. hired reps', value: '2.7x higher for founders', source: 'CRM data from 89 startups' },
          { label: 'Negotiation stage reduction with conviction-led closing', value: '18 days', source: 'Deals above $100K ACV, n=214' },
        ],
      },
      {
        id: 'transition-risk',
        heading: 'The Transition to a Hired Sales Rep Is the Highest-Risk Event in Early GTM',
        subheading: 'Companies that transition before $1M ARR experience a median 6-month growth stall',
        body: 'Of the 312 companies studied, 94 transitioned their primary sales function to a hired rep before reaching $1M ARR. Of those 94, 71% experienced a growth stall lasting a median of 6.3 months. The root cause was consistent: the hired rep lacked the product knowledge and buyer relationships to sustain the pipeline the founder had built, and the founder — having stepped back from sales — was unable to diagnose the problem until it appeared in lagging revenue metrics. Companies that transitioned after $1M ARR and implemented a structured founder-to-rep knowledge transfer avoided the stall in 78% of cases. The knowledge transfer protocol that worked involved the founder co-selling on at least 12 deals before handing over the primary closing responsibility.',
        key_findings: [
          'Companies transitioning before $1M ARR experienced a 6.3-month median growth stall — the most consistent pattern in the dataset',
          '71% of early-transition companies experienced measurable pipeline degradation within 90 days of the founder stepping back from sales',
          'Structured co-selling on 12+ deals before handover reduced stall probability from 71% to 22%',
          'Founders who documented their qualification criteria before transitioning retained 89% of their win rate through the handover period',
        ],
        data_points: [
          { label: 'Growth stall probability: transition before $1M ARR', value: '71%', source: '94 early-transition companies, 2021–2024' },
          { label: 'Median stall duration', value: '6.3 months', source: 'Revenue data from CRM exports' },
          { label: 'Stall reduction with structured co-selling protocol', value: '71% → 22%', source: 'Controlled comparison, 47 companies' },
        ],
      },
      {
        id: 'implications',
        heading: 'Founders Should Treat Sales Presence as a Strategic Asset, Not a Transitional Necessity',
        subheading: 'The data argues for a deliberate, protocol-driven transition at $2M ARR — not an instinctive one at $500K',
        body: 'The practical implication of this research is direct. Founders should plan to remain the primary closer through $2M ARR, using that period to build three assets: a documented qualification framework, a recorded library of winning calls, and a pipeline of at least 3 trained co-sellers before any transition. The transition itself should be protocol-driven — minimum 12 co-selling deals, documented hand-off criteria, and a 90-day founder re-engagement option if win rates fall below 80% of the baseline. Founders who treat their sales presence as a strategic asset rather than a necessary cost of early-stage operations generate measurably better outcomes at every subsequent stage of growth.',
        key_findings: [
          'Remain primary closer through $2M ARR: the 40% growth advantage is concentrated in this window and does not persist beyond it',
          'Document the qualification framework before any transition — the single highest-ROI activity in the handover process',
          'Set a 90-day re-engagement trigger: if win rates fall below 80% of the founder baseline, the founder returns to co-selling immediately',
          'The transition is a protocol, not a milestone — founders who execute it systematically retain their performance advantage through Series A',
        ],
      },
    ],
    richness_metrics: {
      overall_score: T.minRichnessOverall + 10,
      density_score: 72,
      evidence_score: 75,
      persuasion_score: 65,
      cta_quality_score: 55,
      narrative_coherence_score: 70,
      hook_strength_score: 72,
      total_content_words: T.minTotalContentWords + 250,
    },
    meta: {},
    generation_trace: {},
  } as unknown as ReportArtifact
}

describe('validateReportArtifact', () => {
  it('rejects null', () => expect(validateReportArtifact(null as unknown as ReportArtifact).valid).toBe(false))

  it('rejects missing sections', () => {
    const r = validateReportArtifact({ title: 'Test' } as unknown as ReportArtifact)
    expect(r.valid).toBe(false)
  })

  it('rejects empty sections', () => {
    const r = validateReportArtifact({ title: 'Test', sections: [] } as unknown as ReportArtifact)
    expect(r.valid).toBe(false)
  })

  it(`rejects fewer than ${T.minSections} sections`, () => {
    const rep = makeMinimalReport()
    rep.sections = rep.sections.slice(0, T.minSections - 1)
    const r = validateReportArtifact(rep)
    expect(r.valid).toBe(false)
    expect(r.valid === false && r.reason).toContain('too few sections')
  })

  it('rejects missing title', () => {
    const rep = makeMinimalReport()
    rep.title = ''
    expect(validateReportArtifact(rep).valid).toBe(false)
  })

  it('rejects missing richness_metrics', () => {
    const rep = makeMinimalReport()
    rep.richness_metrics = undefined as unknown as ReportArtifact['richness_metrics']
    expect(validateReportArtifact(rep).valid).toBe(false)
  })

  it(`rejects total_content_words < ${T.minTotalContentWords}`, () => {
    const rep = makeMinimalReport()
    rep.richness_metrics.total_content_words = T.minTotalContentWords - 1
    expect(validateReportArtifact(rep).valid).toBe(false)
  })

  it(`rejects overall_score < ${T.minRichnessOverall}`, () => {
    const rep = makeMinimalReport()
    rep.richness_metrics.overall_score = T.minRichnessOverall - 1
    expect(validateReportArtifact(rep).valid).toBe(false)
  })

  it('rejects section with short heading', () => {
    const rep = makeMinimalReport()
    rep.sections[0].heading = 'Hi'
    expect(validateReportArtifact(rep).valid).toBe(false)
  })

  it('rejects section with thin body (< 10 words)', () => {
    const rep = makeMinimalReport()
    rep.sections[0].body = 'Too short.'
    expect(validateReportArtifact(rep).valid).toBe(false)
  })

  it('accepts valid report', () => expect(validateReportArtifact(makeMinimalReport()).valid).toBe(true))

  it('returns sectionCount in slideCount field', () => {
    const r = validateReportArtifact(makeMinimalReport())
    if (r.valid) expect(r.slideCount).toBe(4)
  })
})

describe('runReportSemanticGovernance', () => {
  it('success for valid report without LLM call', async () => {
    const callLLM = vi.fn()
    const r = await runReportSemanticGovernance(makeMinimalReport(), 'Topic', callLLM)
    expect(r.success).toBe(true)
    expect(callLLM).not.toHaveBeenCalled()
  })

  it('attempts repair on invalid report', async () => {
    // SPRINT1-FIX (F-02): runReportSemanticGovernance is now a single-attempt helper.
    // Engine (ArtifactEngine.govern()) owns the retry loop (MAX_REPAIR_ATTEMPTS = 3).
    // This function makes exactly 1 LLM call and returns attempts = 1.
    // T.maxRepairAttempts is deprecated — it is no longer read by this function.
    const callLLM = vi.fn().mockResolvedValue('garbage')
    const rep = makeMinimalReport()
    rep.sections = []
    const r = await runReportSemanticGovernance(rep, 'Topic', callLLM)
    expect(r.success).toBe(false)
    expect(r.attempts).toBe(1) // single-attempt: engine owns retry loop
    expect(callLLM).toHaveBeenCalledTimes(1)
  })

  it('handles LLM error gracefully', async () => {
    const callLLM = vi.fn().mockRejectedValue(new Error('network error'))
    const rep = makeMinimalReport()
    rep.sections = []
    const r = await runReportSemanticGovernance(rep, 'Topic', callLLM)
    expect(r.success).toBe(false)
  })

  it('always returns artifact and validationOutcome', async () => {
    const callLLM = vi.fn().mockResolvedValue('bad')
    const rep = makeMinimalReport()
    rep.sections = []
    const r = await runReportSemanticGovernance(rep, 'Topic', callLLM)
    expect(r).toHaveProperty('artifact')
    expect(r).toHaveProperty('validationOutcome')
  })
})


