/**
 * @brandos/governance-layer — deck/validator.ts
 *
 * Deck semantic governance — structural and semantic validation + LLM repair.
 *
 * RESPONSIBILITIES:
 *   1. Pure structural validation of DeckArtifact
 *   2. Richness gates (overall_score, content words, slide count)
 *   3. Narrative structure check (cover + content/closing presence)
 *   4. LLM-assisted repair with failure-aware prompts
 *   5. Returns GovernanceResult<DeckArtifact>
 *
 * INVARIANTS:
 *   - validateDeckArtifact() is PURE — no I/O, no LLM calls
 *   - All thresholds sourced from @brandos/governance-config
 */

import type { DeckArtifact } from '@brandos/contracts'
import type { SemanticValidationOutcome, GovernanceResult } from '../contracts'
import { DECK_GOVERNANCE_THRESHOLDS } from '@brandos/governance-config'
import { repairJSON } from '@brandos/shared-utils'

type GOVResult = GovernanceResult<DeckArtifact>

function govLog(
  level: 'INFO' | 'WARN' | 'ERROR',
  phase: string,
  message: string,
  extra?: Record<string, unknown>
): void {
  const ts = new Date().toISOString()
  const payload = extra ? ` | ${JSON.stringify(extra)}` : ''
  const prefix = `[governance-layer][deck][${level}][${phase}] ${ts} — ${message}${payload}`
  if (level === 'ERROR') console.error(prefix)
  else if (level === 'WARN') console.warn(prefix)
  else console.info(prefix)
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateDeckArtifact(
  artifact: DeckArtifact,
  requestId?: string
): SemanticValidationOutcome {
  const T = DECK_GOVERNANCE_THRESHOLDS

  if (!artifact || typeof artifact !== 'object') {
    return { valid: false, reason: 'artifact is null or not an object', details: [], slideCount: 0 }
  }
  if (!Array.isArray(artifact.slides) || artifact.slides.length === 0) {
    return { valid: false, reason: 'no slides array', details: ['slides must be a non-empty array'], slideCount: 0 }
  }

  const slideCount = artifact.slides.length

  if (slideCount < T.minSlides) {
    return { valid: false, reason: `too few slides: ${slideCount} < ${T.minSlides}`, details: [`deck needs at least ${T.minSlides} slides`], slideCount }
  }
  if (!artifact.title || artifact.title.trim().length < 3) {
    return { valid: false, reason: 'missing or empty title', details: [], slideCount }
  }

  const metrics = artifact.richness_metrics
  if (!metrics) {
    return { valid: false, reason: 'richness_metrics not computed', details: ['OCL must compute richness metrics'], slideCount }
  }
  if (metrics.total_content_words < T.minTotalContentWords) {
    return { valid: false, reason: `insufficient content: ${metrics.total_content_words} words < ${T.minTotalContentWords}`, details: ['deck needs more substantive content across slides'], slideCount }
  }
  if (metrics.overall_score < T.minRichnessOverall) {
    return {
      valid: false,
      reason: `low richness score: ${metrics.overall_score} < ${T.minRichnessOverall}`,
      details: [
        `density_score=${metrics.density_score}`,
        `evidence_score=${metrics.evidence_score}`,
        `persuasion_score=${metrics.persuasion_score}`,
      ],
      slideCount,
    }
  }

  const slideErrors: string[] = []
  for (const slide of artifact.slides) {
    const prefix = `Slide ${slide.slide} (${slide.type})`
    if (!slide.title || slide.title.trim().length < 5) {
      slideErrors.push(`${prefix}: title too short (<5 chars)`)
    }
  }
  if (slideErrors.length > 0) {
    return { valid: false, reason: `${slideErrors.length} slide(s) failed validation`, details: slideErrors, slideCount }
  }

  const types = artifact.slides.map(s => s.type)
  const missingCritical: string[] = []
  if (!types.includes('cover')) missingCritical.push('cover')
  if (!types.includes('content') && !types.includes('closing')) missingCritical.push('content or closing')
  if (missingCritical.length > 0) {
    return {
      valid: false,
      reason: `missing critical slide types: ${missingCritical.join(', ')}`,
      details: [`Every deck must include at least one cover slide and one content slide`],
      slideCount,
    }
  }

  govLog('INFO', 'validate', 'Validation PASSED', { requestId, slideCount, overallScore: metrics.overall_score })
  return { valid: true, slideCount, warnings: [] }
}

// ─── Repair prompt ────────────────────────────────────────────────────────────

function buildDeckRepairPrompt(
  topic: string,
  outcome: Extract<SemanticValidationOutcome, { valid: false }>,
  artifact: DeckArtifact,
  attempt: number
): string {
  const T = DECK_GOVERNANCE_THRESHOLDS
  return `You are repairing a presentation deck about: "${topic}"

VALIDATION FAILURE (attempt ${attempt}):
Current slide count: ${artifact.slides.length}
Current richness score: ${artifact.richness_metrics?.overall_score ?? 'N/A'} (minimum required: ${T.minRichnessOverall})

FAILURE REASON: ${outcome.reason}
DETAILS: ${outcome.details.join('; ')}

REQUIREMENTS:
- Minimum ${T.minSlides} slides
- First slide must have type="cover" with a strong title and subtitle
- Must include content slides with 3-5 bullets each containing specific insights
- Total word count must exceed ${T.minTotalContentWords} words
- Include a closing slide summarizing the key takeaway

REQUIRED JSON OUTPUT FORMAT:
{
  "title": "...",
  "hook": "...",
  "cta": "...",
  "slides": [
    { "slide": 1, "type": "cover", "title": "...", "subtitle": "...", "body": "..." },
    { "slide": 2, "type": "content", "title": "...", "bullets": ["...", "...", "..."], "speaker_notes": "..." }
  ]
}

Respond ONLY with valid JSON. No preamble, no markdown fences.`
}

// ─── Parse repair response ────────────────────────────────────────────────────

function tryParseRepairResponse(raw: string): Record<string, unknown> | null {
  const clean = raw.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim()
  const jsonStart = clean.search(/[{[]/)
  const candidate = jsonStart >= 0 ? clean.slice(jsonStart) : clean

  // PASS 1: straight JSON.parse (fast path — well-formed output)
  try {
    return JSON.parse(candidate) as Record<string, unknown>
  } catch {
    // fall through to production-grade heuristic repair
  }

  // PASS 2: repairJSON from @brandos/output-control-layer.
  // Canonical implementation — single source of truth for JSON repair across the platform.
  const repaired = repairJSON(candidate)
  if (repaired === null) {
    return null
  }
  try {
    return JSON.parse(repaired) as Record<string, unknown>
  } catch {
    return null
  }
}

// ─── Main governance entry point ──────────────────────────────────────────────
//
// SPRINT1-CHANGE: runDeckSemanticGovernance is now a SINGLE-ATTEMPT repair helper.
//
// BEFORE: This function contained its own while loop (up to T.maxRepairAttempts=3 iterations).
// The engine ALSO had a while loop (MAX_REPAIR_ATTEMPTS=3). Worst case: 3×3 = 9 LLM calls.
//
// AFTER: This function calls callLLM exactly once, returns the result to the engine.
// The engine's while loop is the single source of retry policy.
// ArtifactEngine.govern() owns retry orchestration. Governance owns zero retry loops.
//
// T.maxRepairAttempts is now deprecated and NOT read from DECK_GOVERNANCE_THRESHOLDS.
// Retry cap lives exclusively in ArtifactEngine (MAX_REPAIR_ATTEMPTS = 3).
// Mirrors the carousel validator fix applied in Sprint 1 (2026-06-19).

export async function runDeckSemanticGovernance(
  artifact: DeckArtifact,
  topic: string,
  callLLM: (repairPrompt: string) => Promise<string>,
  requestId?: string,
  recompile?: (raw: unknown, topic: string) => DeckArtifact
): Promise<GOVResult> {
  govLog('INFO', 'governance', 'Single-attempt deck repair (engine owns retry loop)', {
    requestId,
    slideCount: artifact.slides?.length ?? 0,
    overallScore: artifact.richness_metrics?.overall_score ?? 'N/A',
  })

  const validation = validateDeckArtifact(artifact, requestId)

  if (validation.valid) {
    govLog('INFO', 'governance', 'Pre-repair validation already passes — no LLM call needed', { requestId })
    return { success: true, artifact, repaired: false, attempts: 0, validationOutcome: validation }
  }

  const repairPrompt = buildDeckRepairPrompt(
    topic,
    validation as Extract<SemanticValidationOutcome, { valid: false }>,
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

  const parsed = tryParseRepairResponse(repairResponse)

  // Unrecoverable parse failure → return failure immediately.
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

  let repairedArtifact: DeckArtifact
  if (recompile) {
    repairedArtifact = recompile({ slides: parsed.slides, meta: parsed }, topic)
  } else {
    repairedArtifact = {
      ...artifact,
      ...(Array.isArray(parsed.slides) && { slides: parsed.slides as DeckArtifact['slides'] }),
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

  const repairedValidation = validateDeckArtifact(repairedArtifact, requestId)
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


