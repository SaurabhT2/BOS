/**
 * @brandos/governance-layer — carousel/validator.ts
 *
 * Carousel semantic validation + LLM-assisted repair.
 *
 * RESPONSIBILITIES:
 *   1. Pure structural + semantic validation of CarouselArtifact
 *   2. Richness gates (overall_score, total_content_words, density per slide)
 *   3. Narrative roles check (hook + cta slide presence)
 *   4. LLM-assisted repair with targeted failure-aware prompts
 *   5. Returns GovernanceResult<CarouselArtifact>
 *
 * INVARIANTS:
 *   - validateCarouselArtifact() is PURE — no I/O, no LLM calls
 *   - runCarouselSemanticGovernance() accepts callLLM as an injected callback
 *   - All thresholds sourced from @brandos/governance-config
 */

import type { CarouselArtifact } from '@brandos/contracts'
import type { SemanticValidationOutcome, GovernanceResult } from '../contracts'
import { CAROUSEL_GOVERNANCE_THRESHOLDS, CAROUSEL_STRUCTURAL_CONSTRAINTS } from '@brandos/governance-config'
import { repairJSON, extractJSON } from '@brandos/shared-utils'

// ─── Parser telemetry ─────────────────────────────────────────────────────────

function parserLog(tag: string, detail: string, extra?: Record<string, unknown>): void {
  const pay = extra ? ` ${JSON.stringify(extra)}` : ''
  console.info(`[${tag}]${pay} ${detail}`)
}

// ─── Schema normalization ─────────────────────────────────────────────────────
//
// Google Gemini returns the full rich schema (with subheadline, key_takeaway,
// emphasis_keywords, visual_direction, layout_hint) plus a top-level wrapper
// with title / hook / cta or sometimes wraps slides under a different key.
// This normalizer maps Google field names → canonical CarouselArtifact shape.

const FIELD_ALIASES: Record<string, string> = {
  // slide-level field aliases
  title:          'headline',
  subtitle:       'subheadline',
  content:        'body',
  description:    'body',
  text:           'body',
  takeaway:       'key_takeaway',
  summary:        'key_takeaway',
  // top-level aliases
  cards:          'slides',
  items:          'slides',
  carousel:       'slides',
}

/**
 * normalizeGoogleSlide — map Google field names to canonical field names
 * on individual slide objects.  Preserves all canonical fields as-is.
 */
function normalizeGoogleSlide(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    const mapped = FIELD_ALIASES[k] ?? k
    // Don't overwrite if canonical field already present
    if (!(mapped in out) || out[mapped] === undefined) {
      out[mapped] = v
    }
  }
  return out
}

/**
 * normalizeGoogleSchema — normalize a parsed Google response object
 * to the canonical { title, hook, cta, slides[] } shape.
 *
 * Handles:
 *   • slides[] at top level (direct array)
 *   • { slides: [...] } wrapper
 *   • { cards: [...] } or { items: [...] } alternate keys
 *   • Missing top-level title/hook/cta (inferred from slide data)
 *   • Extra fields beyond the schema (preserved transparently)
 */
function normalizeGoogleSchema(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw }

  // Normalize top-level array-valued keys that should be 'slides'
  for (const alias of ['cards', 'items', 'carousel']) {
    if (Array.isArray(out[alias]) && !Array.isArray(out.slides)) {
      out.slides = out[alias]
      delete out[alias]
    }
  }

  // Normalize individual slides
  if (Array.isArray(out.slides)) {
    out.slides = (out.slides as unknown[]).map(s => {
      if (s && typeof s === 'object' && !Array.isArray(s)) {
        return normalizeGoogleSlide(s as Record<string, unknown>)
      }
      return s
    })
  }

  return out
}

// ─── Parse repair response ────────────────────────────────────────────────────

function tryParseRepair(raw: string, requestId?: string): Record<string, unknown> | null {
  parserLog('PARSER_INPUT', 'tryParseRepair received response', {
    requestId,
    length: raw.length,
    preview: raw.slice(0, 120).replace(/\n/g, ' '),
  })

  // Stage 1: Strip markdown fences (multi-line aware)
  let text = raw
    .replace(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```/g, '$1')
    .trim()

  // Stage 2: Remove bold markers
  text = text.replace(/\*\*(.*?)\*\*/gs, '$1')

  // Stage 3: Use extractJSON (outermost block scanner) — handles prose before/after JSON
  parserLog('PARSER_CANDIDATE', 'running extractJSON outermost-block scan', { requestId })
  const extracted = extractJSON(text)

  if (extracted !== null && typeof extracted === 'object' && !Array.isArray(extracted)) {
    const normalized = normalizeGoogleSchema(extracted as Record<string, unknown>)
    parserLog('PARSER_SUCCESS', 'Stage 3 extractJSON succeeded', {
      requestId,
      hasSlides: Array.isArray(normalized.slides),
      slideCount: Array.isArray(normalized.slides) ? normalized.slides.length : 0,
    })
    return normalized
  }

  // Stage 4: If extractJSON returned an array, wrap it as slides
  if (Array.isArray(extracted)) {
    const normalized = normalizeGoogleSchema({ slides: extracted })
    parserLog('PARSER_SUCCESS', 'Stage 4 array-wrap succeeded', {
      requestId,
      slideCount: extracted.length,
    })
    return normalized
  }

  // Stage 5: extractJSON failed — try heuristic repairJSON on the candidate block
  // First isolate the JSON block manually (first { to last })
  const firstBrace = text.indexOf('{')
  const firstBracket = text.indexOf('[')
  const startIdx = firstBrace === -1 ? firstBracket
    : firstBracket === -1 ? firstBrace
    : Math.min(firstBrace, firstBracket)

  const candidate = startIdx >= 0 ? text.slice(startIdx) : text

  parserLog('PARSER_CANDIDATE', 'Stage 5: running repairJSON on candidate', {
    requestId,
    candidateLength: candidate.length,
    candidateTail: candidate.slice(-120).replace(/\n/g, ' '),
  })

  const repaired = repairJSON(candidate)
  if (repaired !== null) {
    try {
      const parsed = JSON.parse(repaired) as Record<string, unknown>
      const normalized = normalizeGoogleSchema(parsed)
      parserLog('PARSER_SUCCESS', 'Stage 5 repairJSON succeeded', {
        requestId,
        hasSlides: Array.isArray(normalized.slides),
        slideCount: Array.isArray(normalized.slides) ? normalized.slides.length : 0,
      })
      return normalized
    } catch {
      // fall through
    }
  }

  parserLog('PARSER_FAILURE_REASON', 'All parse stages failed', {
    requestId,
    inputLength: raw.length,
    tail: text.slice(-300).replace(/\n/g, ' '),
  })
  console.error('[PARSE_ERROR] tryParseRepair: heuristic repair also failed')
  console.error('[REPAIR_END]', text.slice(-1000))
  return null
}

type GOVResult = GovernanceResult<CarouselArtifact>

function govLog(
  level: 'INFO' | 'WARN' | 'ERROR',
  phase: string,
  message: string,
  extra?: Record<string, unknown>
): void {
  const ts  = new Date().toISOString()
  const pay = extra ? ` | ${JSON.stringify(extra)}` : ''
  const prefix = `[governance-layer][carousel][${level}][${phase}] ${ts} — ${message}${pay}`
  if (level === 'ERROR') console.error(prefix)
  else if (level === 'WARN') console.warn(prefix)
  else console.info(prefix)
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateCarouselArtifact(
  artifact: CarouselArtifact,
  requestId?: string
): SemanticValidationOutcome {
  const T = CAROUSEL_GOVERNANCE_THRESHOLDS
  const S = CAROUSEL_STRUCTURAL_CONSTRAINTS
  // All structural thresholds derive from CAROUSEL_STRUCTURAL_CONSTRAINTS (canonical source)
  const MIN_SLIDE_HEADLINE_CHARS = S.minSlideHeadlineChars

  if (!artifact || typeof artifact !== 'object') {
    return { valid: false, reason: 'artifact is null or not an object', details: [], slideCount: 0 }
  }
  if (!Array.isArray(artifact.slides) || artifact.slides.length === 0) {
    return { valid: false, reason: 'no slides array', details: ['slides must be a non-empty array'], slideCount: 0 }
  }

  const slideCount = artifact.slides.length

  if (slideCount < T.minSlides) {
    return { valid: false, reason: `too few slides: ${slideCount} < ${T.minSlides}`, details: [`carousel needs at least ${T.minSlides} slides`], slideCount }
  }
  if (!artifact.title || artifact.title.trim().length < S.minTitleChars) {
    return { valid: false, reason: 'missing or empty title', details: [], slideCount }
  }
  if (!artifact.hook || artifact.hook.trim().length < S.minHookChars) {
    return { valid: false, reason: 'missing or too-short hook', details: [`hook must be at least ${S.minHookChars} chars`], slideCount }
  }

  const hookWords = artifact.hook.trim().split(/\s+/).length
  if (hookWords < S.minHookWords) {
    return { valid: false, reason: 'hook too sparse', details: [`hook has only ${hookWords} word(s) — must be ≥${S.minHookWords} words`], slideCount }
  }

  const hookLower = artifact.hook.trim().toLowerCase()
  if (hookLower === (artifact.title?.trim().toLowerCase() ?? '') || hookLower === 'untitled' || hookLower === 'hook') {
    return { valid: false, reason: 'hook is a trivial placeholder or title repeat', details: ['hook must be an original provocative statement'], slideCount }
  }

  if (!artifact.cta || artifact.cta.trim().length < S.minCtaChars) {
    return { valid: false, reason: 'missing or empty CTA', details: ['cta must be present'], slideCount }
  }
  const ctaWords = artifact.cta.trim().split(/\s+/).length
  if (ctaWords < S.minCtaWords) {
    return { valid: false, reason: 'cta too sparse', details: [`cta has only ${ctaWords} word(s) — must be ≥${S.minCtaWords} words`], slideCount }
  }

  if (S.genericCtaPhrases.some(g => artifact.cta.trim().toLowerCase() === g)) {
    return { valid: false, reason: 'cta is a generic placeholder', details: [`"${artifact.cta}" is a generic CTA — specify a concrete action`], slideCount }
  }

  const metrics = artifact.richness_metrics
  if (!metrics) {
    return { valid: false, reason: 'richness_metrics not computed', details: ['OCL must compute richness metrics'], slideCount }
  }
  if (!metrics.overall_score || !metrics.total_content_words) {
    return { valid: false, reason: 'richness_metrics fields are missing or undefined', details: ['overall_score and total_content_words are required'], slideCount }
  }
  if (metrics.total_content_words < T.minTotalContentWords) {
    return { valid: false, reason: `insufficient content: ${metrics.total_content_words} words < ${T.minTotalContentWords}`, details: ['carousel needs more substantive content'], slideCount }
  }
  if (metrics.overall_score < T.minRichnessOverall) {
    return {
      valid: false,
      reason: `low richness score: ${metrics.overall_score} < ${T.minRichnessOverall}`,
      details: [
        `density_score=${metrics.density_score}`,
        `evidence_score=${metrics.evidence_score}`,
        `persuasion_score=${metrics.persuasion_score}`,
        `cta_quality=${metrics.cta_quality_score}`,
      ],
      slideCount,
    }
  }

  const slideErrors: string[] = []
  const slideWarnings: string[] = []
  for (const slide of artifact.slides) {
    if (!slide || typeof slide !== 'object') {
      slideErrors.push('Slide entry is null or not an object')
      continue
    }
    const prefix = `Slide ${slide.slide} (${slide.role})`
    if (!slide.headline || slide.headline.trim().length < MIN_SLIDE_HEADLINE_CHARS) {
      slideErrors.push(`${prefix}: headline too short (<${S.minSlideHeadlineChars} chars)`)
    }
    const density = slide.semantic_density_score ?? 0
    if (density < T.minSlideDensityScore) {
      slideErrors.push(`${prefix}: density score too low (${density} < ${T.minSlideDensityScore})`)
    }
    if (!slide.body && !slide.bullets?.length && !slide.insight) {
      slideWarnings.push(`${prefix}: no body, bullets, or insight — very thin content`)
    }
  }
  if (slideErrors.length > 0) {
    return { valid: false, reason: `${slideErrors.length} slide(s) failed validation`, details: slideErrors, slideCount }
  }

  const presentRoles = new Set(artifact.slides.map(s => s.role))
  const missingCritical: string[] = []
  if (!presentRoles.has('hook')) missingCritical.push('hook')
  if (!presentRoles.has('cta'))  missingCritical.push('cta')
  if (missingCritical.length > 0) {
    return {
      valid: false,
      reason: `missing critical narrative roles: ${missingCritical.join(', ')}`,
      details: [
        `Every carousel must include role="hook" and role="cta"`,
        `Present roles: ${[...presentRoles].join(', ')}`,
      ],
      slideCount,
    }
  }

  govLog('INFO', 'validate', 'Validation PASSED', {
    requestId,
    slideCount,
    overallScore: metrics.overall_score,
    warnings: slideWarnings.length,
  })
  return { valid: true, slideCount, warnings: slideWarnings }
}

// ─── Repair prompt ────────────────────────────────────────────────────────────

function buildRepairPrompt(
  topic: string,
  outcome: Extract<SemanticValidationOutcome, { valid: false }>,
  artifact: CarouselArtifact,
  attempt: number
): string {
  const T = CAROUSEL_GOVERNANCE_THRESHOLDS
  const reason  = outcome.reason
  const details = outcome.details.join('; ')
  const currentScore = artifact.richness_metrics?.overall_score ?? 'N/A'

  let focusedInstruction = ''
  if (reason.includes('hook')) {
    focusedInstruction = `\nHOOK REPAIR REQUIRED:\nThe hook "${artifact.hook ?? '(missing)'}" failed: ${details}\n\nA strong hook is 8–15 words — a specific, provocative statement using one of these proven structures:\n  CONTRARIAN STAT: "91% of B2B founders get their pricing wrong in the same direction."\n  COUNTERINTUITIVE CLAIM: "The best operators all share the same weakness."\n  RESULTS-FIRST: "We went from 12% to 41% conversion in 6 weeks. Here's every change."\n  UNCOMFORTABLE TRUTH: "Your pipeline problem is not a pipeline problem."\n  PATTERN BREAK: "Every founder who burned out in 2023 made the same decision 18 months earlier."\nNOT a question. NOT a repeat of the title. NOT a generic claim.\nWrite a new hook in the "hook" field.`
  } else if (reason.includes('cta') || reason.includes('CTA')) {
    focusedInstruction = `\nCTA REPAIR REQUIRED:\nThe CTA "${artifact.cta ?? '(missing)'}" failed: ${details}\n\nA strong CTA uses one of three patterns:\n  ASSET OFFER: "DM me 'FRAMEWORK' and I'll send you the full decision matrix."\n  REFLECTION PROMPT: "What's the most expensive mistake your team made with X? Comment below."\n  NEXT STEP: "Save this post — run this audit on your team this Friday in 20 minutes."\nNOT "learn more", "follow me", "like and share", or any generic close.\nWrite a new CTA in the "cta" field and update the cta-role slide body to match.`
  } else if (reason.includes('density') || reason.includes('words') || reason.includes('content')) {
    focusedInstruction = `\nCONTENT DENSITY REPAIR REQUIRED:\nFailure: ${details}\n\nEvery value slide (problem, insight, framework, evidence, reframe) must have:\n- headline: 10–14 words, active voice, tension-bearing\n- subheadline: 8–14 words amplifying or contrasting the headline\n- body: minimum 50 words with a named example, specific number, or concrete mechanism\n- bullets: 3–5 items, each minimum 12 words with a specific claim or evidence point\n- key_takeaway: the one sentence the reader remembers from this slide\n- insight (on insight/framework slides): the paradigm-shift idea, one complete sentence\n- supporting_evidence (on evidence slides): named data point or case study\nTotal word count must exceed ${T.minTotalContentWords} words across all slides.`
  } else if (reason.includes('evidence') || reason.includes('richness')) {
    focusedInstruction = `\nRICHNESS REPAIR REQUIRED:\nFailure: ${details}\n\nThe carousel lacks sufficient depth and evidence. For every slide:\n- Replace vague claims ("many companies", "recently", "significant") with specific facts (named company, percentage, quarter/year, dollar figure)\n- Add supporting_evidence to the evidence slide: use named companies, cited studies, or specific case data\n- Add subheadline to at least 3 slides — amplifying the mechanism behind the headline\n- Add key_takeaway to at least 3 slides — the one transferable insight from this slide\n- Every insight/framework slide must include an insight field stating the paradigm-shift in one sentence\nOverall richness must reach ${T.minRichnessOverall}.`
  } else {
    focusedInstruction = `\nREPAIR REQUIRED:\nReason: ${reason}\nDetails: ${details}\n\nImprove all value slides: substantive headlines (10–14 words), subheadlines amplifying the claim, 3–5 evidence-based bullets per slide, key_takeaway on each slide, supporting_evidence on the evidence slide.`
  }

  return `You are repairing a LinkedIn carousel about: "${topic}"

VALIDATION FAILURE (attempt ${attempt}):
Current slide count: ${artifact.slides.length}
Current richness score: ${currentScore} (minimum required: ${T.minRichnessOverall})

${focusedInstruction}

REQUIRED JSON OUTPUT FORMAT (return ALL slides, include all rich fields):
{
  "title": "...",
  "hook": "...",
  "cta": "...",
  "slides": [
    {
      "slide": 1,
      "role": "hook|problem|reframe|framework|evidence|insight|cta",
      "headline": "...",
      "subheadline": "...",
      "body": "...",
      "bullets": ["..."],
      "insight": "...",
      "supporting_evidence": ["..."],
      "key_takeaway": "...",
      "layout_hint": "centered|bullets-primary|data-callout|split|full-bleed",
      "emphasis_keywords": ["..."],
      "visual_direction": "..."
    }
  ]
}

HARD REQUIREMENTS:
- Minimum ${T.minSlides} slides, roles include "hook" and "cta"
- body minimum 40 words on value slides
- Total content ≥${T.minTotalContentWords} words
- Overall richness ≥${T.minRichnessOverall}
- subheadline present on at least 3 slides
- key_takeaway present on at least 3 slides
- supporting_evidence on evidence slide (required)

Respond ONLY with valid JSON. No preamble, no markdown fences.`
}


// ─── Main governance entry point ──────────────────────────────────────────────
//
// SPRINT1-CHANGE-A: runCarouselSemanticGovernance is now a SINGLE-ATTEMPT repair helper.
//
// BEFORE: This function contained its own while loop (up to T.maxRepairAttempts=3 iterations).
// The engine ALSO had a while loop (MAX_REPAIR_ATTEMPTS=3). Worst case: 3×3 = 9 LLM calls.
//
// AFTER: This function calls callLLM exactly once, returns the result to the engine.
// The engine's while loop is the single source of retry policy.
// ArtifactEngine.govern() owns retry orchestration. Governance owns zero retry loops.
//
// T.maxRepairAttempts is now deprecated and NOT read from CAROUSEL_GOVERNANCE_THRESHOLDS.
// Retry cap lives exclusively in ArtifactEngine (MAX_REPAIR_ATTEMPTS = 3).

export async function runCarouselSemanticGovernance(
  artifact: CarouselArtifact,
  topic: string,
  callLLM: (repairPrompt: string) => Promise<string>,
  requestId?: string,
  recompile?: (raw: unknown, topic: string) => CarouselArtifact
): Promise<GOVResult> {
  govLog('INFO', 'governance', 'Single-attempt carousel repair (engine owns retry loop)', {
    requestId,
    slideCount: artifact.slides?.length ?? 0,
    overallScore: artifact.richness_metrics?.overall_score ?? 'N/A',
  })

  const validation = validateCarouselArtifact(artifact, requestId)

  if (validation.valid) {
    govLog('INFO', 'governance', 'Pre-repair validation already passes — no LLM call needed', { requestId })
    return { success: true, artifact, repaired: false, attempts: 0, validationOutcome: validation }
  }

  // ── SPRINT1-CHANGE-C: Parse-failure fast-fail ─────────────────────────────
  // Before: parse failure hit `continue`, silently burning the attempt counter.
  // After: parse failure breaks immediately so the engine retries with a fresh
  // attempt — it never "succeeds at nothing".

  const repairPrompt = buildRepairPrompt(
    topic,
    validation as Extract<typeof validation, { valid: false }>,
    artifact,
    1 // attempt number context for prompt — engine manages actual counter
  )

  let repairResponse: string
  try {
    repairResponse = await callLLM(repairPrompt)
  } catch (err: unknown) {
    govLog('ERROR', 'governance', 'LLM repair call failed', {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    })
    return {
      success: false,
      artifact,
      repaired: false,
      attempts: 1,
      finalRejection: `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      validationOutcome: validation,
    }
  }

  const parsed = tryParseRepair(repairResponse, requestId)

  // SPRINT1-CHANGE-C: unrecoverable parse failure → return failure immediately.
  // The engine will decide whether to retry. We do NOT continue/loop here.
  if (!parsed) {
    govLog('WARN', 'governance', 'Repair response could not be parsed — returning failure (engine will retry if budget allows)', {
      requestId,
    })
    return {
      success: false,
      artifact,
      repaired: false,
      attempts: 1,
      finalRejection: 'governance-layer: repair response unparseable after heuristic repair',
      validationOutcome: validation,
    }
  }

  let repairedArtifact: CarouselArtifact
  if (recompile) {
    repairedArtifact = recompile({ slides: parsed.slides, meta: parsed }, topic)
  } else {
    repairedArtifact = {
      ...artifact,
      ...(Array.isArray(parsed.slides) && { slides: parsed.slides as CarouselArtifact['slides'] }),
    }
  }

  repairedArtifact = {
    ...repairedArtifact,
    generation_trace: {
      ...repairedArtifact.generation_trace,
      governance_outcome: 'passed_after_repair',
      repair_attempts: 1,
    },
  }

  const repairedValidation = validateCarouselArtifact(repairedArtifact, requestId)
  govLog(
    repairedValidation.valid ? 'INFO' : 'WARN',
    'governance',
    repairedValidation.valid ? 'Single-attempt repair SUCCEEDED' : 'Single-attempt repair still invalid — returning to engine for next attempt',
    { requestId }
  )

  if (repairedValidation.valid) {
    return { success: true, artifact: repairedArtifact, repaired: true, attempts: 1, validationOutcome: repairedValidation }
  }

  return {
    success: false,
    artifact: repairedArtifact,
    repaired: false,
    attempts: 1,
    finalRejection: `governance-layer: single repair attempt insufficient. Reason: ${repairedValidation.reason}. Details: ${(repairedValidation as Extract<typeof repairedValidation, { valid: false }>).details.join('; ')}`,
    validationOutcome: repairedValidation,
  }
}
