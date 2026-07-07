/**
 * @brandos/governance-layer — validatePackage.ts
 *
 * L5 SELF-VALIDATION: This package can validate its own health, contract
 * compliance, and architectural integrity at runtime.
 */

import { CAROUSEL_GOVERNANCE_THRESHOLDS, DECK_GOVERNANCE_THRESHOLDS, REPORT_GOVERNANCE_THRESHOLDS, DEFAULT_PASS_THRESHOLD, SCORE_PENALTIES } from '@brandos/governance-config'
import { validateCarouselArtifact } from './carousel/validator'
import { validateDeckArtifact } from './deck/validator'
import { validateReportArtifact } from './report/validator'
import { evaluateGovernance } from './governanceEngine'
import { GovernancePluginRegistry } from './GovernancePluginRegistry'
import type { CarouselArtifact, DeckArtifact, ReportArtifact } from '@brandos/contracts'

export interface PackageHealthCheck {
  name: string
  passed: boolean
  detail: string
}

export interface PackageHealthReport {
  package: string
  version: string
  level: string
  healthy: boolean
  checks: PackageHealthCheck[]
  checkedAt: string
}

function check(name: string, passed: boolean, detail: string): PackageHealthCheck {
  return { name, passed, detail }
}

export async function validatePackage(): Promise<PackageHealthReport> {
  const checks: PackageHealthCheck[] = []

  // ── Config imports resolve ──────────────────────────────────────────────
  checks.push(check('config.thresholds.carousel', typeof CAROUSEL_GOVERNANCE_THRESHOLDS.minSlides === 'number', `minSlides=${CAROUSEL_GOVERNANCE_THRESHOLDS.minSlides}`))
  checks.push(check('config.thresholds.deck', typeof DECK_GOVERNANCE_THRESHOLDS.minSlides === 'number', `minSlides=${DECK_GOVERNANCE_THRESHOLDS.minSlides}`))
  checks.push(check('config.thresholds.report', typeof REPORT_GOVERNANCE_THRESHOLDS.minSections === 'number', `minSections=${REPORT_GOVERNANCE_THRESHOLDS.minSections}`))
  checks.push(check('config.DEFAULT_PASS_THRESHOLD', typeof DEFAULT_PASS_THRESHOLD === 'number' && DEFAULT_PASS_THRESHOLD > 0 && DEFAULT_PASS_THRESHOLD <= 100, `value=${DEFAULT_PASS_THRESHOLD}`))
  checks.push(check('config.SCORE_PENALTIES.not_zero', Object.values(SCORE_PENALTIES).every(v => v > 0), `penalties=${JSON.stringify(SCORE_PENALTIES)}`))

  // ── Validators reject invalid artifacts ─────────────────────────────────
  const nullCarousel = validateCarouselArtifact(null as unknown as CarouselArtifact)
  checks.push(check('validator.carousel.rejects_null', !nullCarousel.valid, nullCarousel.valid ? 'UNEXPECTED PASS' : `reason=${nullCarousel.reason}`))

  const emptyCarousel = { title: 'Test', slides: [] } as unknown as CarouselArtifact
  const emptyCarouselR = validateCarouselArtifact(emptyCarousel)
  checks.push(check('validator.carousel.rejects_empty_slides', !emptyCarouselR.valid, emptyCarouselR.valid ? 'UNEXPECTED PASS' : `reason=${emptyCarouselR.reason}`))

  const nullDeck = validateDeckArtifact(null as unknown as DeckArtifact)
  checks.push(check('validator.deck.rejects_null', !nullDeck.valid, nullDeck.valid ? 'UNEXPECTED PASS' : `reason=${nullDeck.reason}`))

  const nullReport = validateReportArtifact(null as unknown as ReportArtifact)
  checks.push(check('validator.report.rejects_null', !nullReport.valid, nullReport.valid ? 'UNEXPECTED PASS' : `reason=${nullReport.reason}`))

  // ── Text governance scoring ─────────────────────────────────────────────
  const cleanText = 'This is a clean piece of writing with no clichés or buzzwords whatsoever. It makes a strong specific point.'
  const cleanResult = evaluateGovernance({ content: cleanText, taskType: 'post' })
  checks.push(check('engine.score.bounded_0_100', cleanResult.score >= 0 && cleanResult.score <= 100, `score=${cleanResult.score}`))
  checks.push(check('engine.score.clean_text_passes', cleanResult.passed, `score=${cleanResult.score}`))

  const clicheText = "Dive into this game-changer. In today's fast-paced landscape, synergy is key. Certainly, absolutely, of course."
  const clicheResult = evaluateGovernance({ content: clicheText, taskType: 'post' })
  checks.push(check('engine.score.cliche_lower_than_clean', clicheResult.score < cleanResult.score, `cliche=${clicheResult.score} < clean=${cleanResult.score}`))
  checks.push(check('engine.score.original_score_is_number', typeof clicheResult.original_score === 'number', `original_score=${clicheResult.original_score}`))
  checks.push(check('engine.score.approved_output_is_string', typeof clicheResult.approved_output === 'string', `length=${clicheResult.approved_output.length}`))

  // ── Plugin registry callable ────────────────────────────────────────────
  checks.push(check('registry.listCapabilities.returns_object', typeof GovernancePluginRegistry.listCapabilities() === 'object', 'callable'))

  // ── Forbidden module boundary (checks process module cache) ─────────────
  const forbiddenChecks = [
    { label: 'ai-runtime-layer', needle: 'ai-runtime-layer' },
    { label: 'control-plane-layer', needle: 'control-plane-layer' },
    { label: 'artifact-engine-layer', needle: 'artifact-engine-layer' },
    { label: 'supabase-js', needle: 'supabase-js' },
  ]
  for (const { label, needle } of forbiddenChecks) {
    const loaded = typeof require !== 'undefined'
      ? Object.keys(require.cache ?? {}).some(k => k.includes(needle))
      : false
    checks.push(check(`boundary.no_forbidden.${label}`, !loaded, loaded ? `VIOLATION: ${needle} in process` : 'not loaded'))
  }

  // ── Result fields present ──────────────────────────────────────────────
  const sample = evaluateGovernance({ content: 'Test content here.', taskType: 'chat' })
  const requiredFields = ['passed', 'score', 'original_score', 'annotations', 'recommendations', 'violations', 'flags_remaining', 'approved_output', 'engine_badge'] as const
  for (const field of requiredFields) {
    checks.push(check(`engine.result.has_field.${field}`, field in sample, field in sample ? 'present' : 'MISSING'))
  }

  const healthy = checks.every(c => c.passed)
  return {
    package: '@brandos/governance-layer',
    version: '2.0.0',
    level: 'L5',
    healthy,
    checks,
    checkedAt: new Date().toISOString(),
  }
}


