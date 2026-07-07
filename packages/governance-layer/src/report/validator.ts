/**
 * @brandos/governance-layer — report/validator.ts
 *
 * Report semantic governance — structural validation + LLM repair.
 *
 * RESPONSIBILITIES:
 *   1. Pure structural + semantic validation of ReportArtifact
 *   2. Richness gates (overall_score, total_content_words, section count)
 *   3. Per-section content checks (heading length, body word count)
 *   4. LLM-assisted repair with targeted prompts
 *   5. Returns GovernanceResult<ReportArtifact>
 *
 * INVARIANTS:
 *   - validateReportArtifact() is PURE — no I/O, no LLM calls
 *   - All thresholds sourced from @brandos/governance-config
 */

import type { ReportArtifact } from '@brandos/contracts'
import type { SemanticValidationOutcome, GovernanceResult } from '../contracts'
import { REPORT_GOVERNANCE_THRESHOLDS } from '@brandos/governance-config'
import { repairJSON } from '@brandos/shared-utils'

type GOVResult = GovernanceResult<ReportArtifact>

function govLog(
  level: 'INFO' | 'WARN' | 'ERROR',
  phase: string,
  message: string,
  extra?: Record<string, unknown>
): void {
  const ts  = new Date().toISOString()
  const pay = extra ? ` | ${JSON.stringify(extra)}` : ''
  const prefix = `[governance-layer][report][${level}][${phase}] ${ts} — ${message}${pay}`
  if (level === 'ERROR') console.error(prefix)
  else if (level === 'WARN') console.warn(prefix)
  else console.info(prefix)
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateReportArtifact(
  artifact: ReportArtifact,
  requestId?: string
): SemanticValidationOutcome {
  const T = REPORT_GOVERNANCE_THRESHOLDS

  if (!artifact || typeof artifact !== 'object') {
    return { valid: false, reason: 'artifact is null or not an object', details: [], slideCount: 0 }
  }
  if (!Array.isArray(artifact.sections) || artifact.sections.length === 0) {
    return { valid: false, reason: 'no sections array', details: ['sections must be a non-empty array'], slideCount: 0 }
  }

  const sectionCount = artifact.sections.length

  if (sectionCount < T.minSections) {
    return { valid: false, reason: `too few sections: ${sectionCount} < ${T.minSections}`, details: [`report needs at least ${T.minSections} sections`], slideCount: sectionCount }
  }
  if (!artifact.title || artifact.title.trim().length < 3) {
    return { valid: false, reason: 'missing or empty title', details: [], slideCount: sectionCount }
  }

  const metrics = artifact.richness_metrics
  if (!metrics) {
    return { valid: false, reason: 'richness_metrics not computed', details: ['OCL must compute richness metrics'], slideCount: sectionCount }
  }
  if (metrics.total_content_words < T.minTotalContentWords) {
    return { valid: false, reason: `insufficient content: ${metrics.total_content_words} words < ${T.minTotalContentWords}`, details: ['report needs more substantive content'], slideCount: sectionCount }
  }
  if (metrics.overall_score < T.minRichnessOverall) {
    return {
      valid: false,
      reason: `low richness score: ${metrics.overall_score} < ${T.minRichnessOverall}`,
      details: [
        `density_score=${metrics.density_score}`,
        `evidence_score=${metrics.evidence_score}`,
        `narrative_coherence=${metrics.narrative_coherence_score}`,
      ],
      slideCount: sectionCount,
    }
  }

  const sectionErrors: string[] = []
  for (const section of artifact.sections) {
    if (!section.heading || section.heading.trim().length < 5) {
      sectionErrors.push(`Section "${section.id}": heading too short`)
    }
    if (!section.body || section.body.trim().split(/\s+/).length < 10) {
      sectionErrors.push(`Section "${section.id}": body too thin (< 10 words)`)
    }
  }
  if (sectionErrors.length > 0) {
    return { valid: false, reason: `${sectionErrors.length} section(s) failed validation`, details: sectionErrors, slideCount: sectionCount }
  }

  govLog('INFO', 'validate', 'Validation PASSED', { requestId, sectionCount, overallScore: metrics.overall_score })
  return { valid: true, slideCount: sectionCount, warnings: [] }
}

// ─── Repair prompt ────────────────────────────────────────────────────────────

function buildReportRepairPrompt(
  topic: string,
  outcome: Extract<SemanticValidationOutcome, { valid: false }>,
  artifact: ReportArtifact,
  attempt: number
): string {
  const T = REPORT_GOVERNANCE_THRESHOLDS
  return `You are repairing a research report about: "${topic}"

VALIDATION FAILURE (attempt ${attempt}):
Current section count: ${artifact.sections?.length ?? 0}
Current richness score: ${artifact.richness_metrics?.overall_score ?? 'N/A'} (minimum required: ${T.minRichnessOverall})

FAILURE REASON: ${outcome.reason}
DETAILS: ${outcome.details.join('; ')}

REQUIREMENTS:
- Minimum ${T.minSections} sections, each with a clear heading and substantive body
- Total word count across all sections must exceed ${T.minTotalContentWords} words
- Each section body must be at least 2 full sentences
- Include key_findings or data_points where relevant

REQUIRED JSON OUTPUT FORMAT:
{
  "title": "...",
  "hook": "...",
  "cta": "...",
  "sections": [
    {
      "id": "section-1",
      "heading": "...",
      "subheading": "...",
      "body": "...",
      "key_findings": ["...", "..."],
      "data_points": [{ "label": "...", "value": "...", "source": "..." }]
    }
  ]
}

Respond ONLY with valid JSON. No preamble, no markdown fences.`
}

// ─── Parse repair response ────────────────────────────────────────────────────

function tryParseRepair(raw: string): Record<string, unknown> | null {
  const clean = raw.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim()
  const start = clean.search(/[{[]/)
  const candidate = start >= 0 ? clean.slice(start) : clean

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
// SPRINT1-CHANGE: runReportSemanticGovernance is now a SINGLE-ATTEMPT repair helper.
//
// BEFORE: This function contained its own while loop (up to T.maxRepairAttempts=3 iterations).
// The engine ALSO had a while loop (MAX_REPAIR_ATTEMPTS=3). Worst case: 3×3 = 9 LLM calls.
//
// AFTER: This function calls callLLM exactly once, returns the result to the engine.
// The engine's while loop is the single source of retry policy.
// ArtifactEngine.govern() owns retry orchestration. Governance owns zero retry loops.
//
// T.maxRepairAttempts is now deprecated and NOT read from REPORT_GOVERNANCE_THRESHOLDS.
// Retry cap lives exclusively in ArtifactEngine (MAX_REPAIR_ATTEMPTS = 3).
// Mirrors the carousel validator fix applied in Sprint 1 (2026-06-19).

export async function runReportSemanticGovernance(
  artifact: ReportArtifact,
  topic: string,
  callLLM: (repairPrompt: string) => Promise<string>,
  requestId?: string,
  recompile?: (raw: unknown, topic: string) => ReportArtifact
): Promise<GOVResult> {
  govLog('INFO', 'governance', 'Single-attempt report repair (engine owns retry loop)', {
    requestId,
    sectionCount: artifact.sections?.length ?? 0,
    overallScore: artifact.richness_metrics?.overall_score ?? 'N/A',
  })

  const validation = validateReportArtifact(artifact, requestId)

  if (validation.valid) {
    govLog('INFO', 'governance', 'Pre-repair validation already passes — no LLM call needed', { requestId })
    return { success: true, artifact, repaired: false, attempts: 0, validationOutcome: validation }
  }

  const repairPrompt = buildReportRepairPrompt(
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

  const parsed = tryParseRepair(repairResponse)

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

  let repairedArtifact: ReportArtifact
  if (recompile) {
    repairedArtifact = recompile({ sections: parsed.sections, meta: parsed }, topic)
  } else {
    repairedArtifact = {
      ...artifact,
      ...(Array.isArray(parsed.sections) && { sections: parsed.sections as ReportArtifact['sections'] }),
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

  const repairedValidation = validateReportArtifact(repairedArtifact, requestId)
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


