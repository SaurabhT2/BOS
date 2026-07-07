/**
 * @brandos/contracts — governance-feedback.ts
 *
 * CLOSED-LOOP GOVERNANCE FEEDBACK CONTRACTS
 *
 * PURPOSE:
 *   These contracts form the structured information channel from Governance
 *   back to the Prompt Compiler. Governance remains a pure validator — it
 *   NEVER generates content. Instead, after every validation pass (pass or
 *   fail), it emits a structured IGovernanceFeedback payload.
 *
 *   The Prompt Compiler consumes IAttemptHistory (a list of prior
 *   IGovernanceFeedback records) to produce progressively stronger prompts
 *   on subsequent attempts.
 *
 * DESIGN INVARIANTS:
 *   - Governance emits feedback; it does NOT modify prompts or content.
 *   - The Prompt Compiler consumes feedback; it does NOT call governance.
 *   - IAttemptRecord is the single source of truth for one generation cycle.
 *   - IAttemptHistory is accumulated in the artifact pipeline across retries.
 *   - These contracts are ARTIFACT-TYPE AGNOSTIC — no carousel/deck/report
 *     specific fields anywhere in this file.
 *   - All fields are optional where the value may be absent on a first pass.
 *
 * DATA FLOW:
 *   ArtifactEngine.govern()
 *     → IGovernanceFeedback (structured result, emitted every validation call)
 *     → IAttemptRecord (stored in attempt history by ArtifactPipeline)
 *     → IAttemptHistory (accumulated list passed to ContractAssembler)
 *     → compilePromptFromContract() (consumes history to build evolved prompt)
 *
 * ZERO CIRCULAR DEPS:
 *   This file imports nothing from @brandos/* packages.
 */

// ─── Severity levels ──────────────────────────────────────────────────────────

export type GovernanceViolationSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

// ─── Structured violation ─────────────────────────────────────────────────────

/**
 * A single structured governance violation.
 *
 * Violations describe WHAT went wrong, WHERE it went wrong, and optionally
 * WHAT the actual vs expected values were. This gives the Prompt Compiler
 * actionable information to request a correction.
 *
 * EXAMPLES:
 *   code: 'WEAK_HOOK'         → the opening line matched a weak hook pattern
 *   code: 'CLICHE_DENSITY'    → too many AI clichés (actual=5, expected<2)
 *   code: 'SLIDE_COUNT_LOW'   → carousel had 3 slides (actual=3, expected>=5)
 *   code: 'SCORE_THRESHOLD'   → score=47 (actual=47, expected>=65)
 *   code: 'MISSING_ROLE'      → required role 'cta' absent from slides
 *   code: 'ROBOTIC_SYMMETRY'  → all paragraphs are same length
 */
export interface IGovernanceViolationDetail {
  /**
   * Machine-readable violation code. Used by the Prompt Compiler to apply
   * targeted corrections per violation type. Always UPPER_SNAKE_CASE.
   * Codes are stable across versions — do not rename without a migration.
   */
  code: string

  /**
   * How severely this violation affects output quality.
   * CRITICAL violations (e.g. schema failure) cause immediate rejection.
   * LOW violations trigger a recommendation but not immediate repair.
   */
  severity: GovernanceViolationSeverity

  /**
   * Human-readable explanation of what the violation means.
   * Included verbatim in the repair section of the evolved prompt.
   */
  message: string

  /**
   * The measured value that triggered this violation (e.g. cliché count,
   * score, slide count). Absent when the violation is binary (present/absent).
   */
  actual?: number

  /**
   * The threshold or required value that was not met.
   * Combined with 'actual', gives the Prompt Compiler a precise correction target.
   */
  expected?: number

  /**
   * Optional pointer to the artifact location where the violation was detected.
   * For slide-level violations: 'slides[2].content'
   * For document-level violations: 'title', 'sections[0].body', etc.
   * Used to focus the repair instruction on the specific problem location.
   */
  artifactLocation?: string

  /**
   * The specific content fragment that triggered this violation.
   * For clichés: the actual cliché phrase found.
   * For weak hooks: the first line of content.
   * Included in the repair prompt to give the LLM a concrete target.
   */
  offendingContent?: string
}

// ─── Structured recommendation ────────────────────────────────────────────────

/**
 * A structured governance recommendation.
 *
 * Recommendations describe HOW to improve the output on the next attempt.
 * They are advisory — violations are mandatory. The Prompt Compiler includes
 * recommendations in progressively stronger prompt sections.
 */
export interface IGovernanceRecommendationDetail {
  /**
   * Machine-readable recommendation code. Grouped by category:
   *   VARY_*     → stylistic variation suggestions
   *   ADD_*      → additive content suggestions
   *   REMOVE_*   → removal suggestions
   *   REPLACE_*  → substitution suggestions
   *   STRENGTHEN_* → quality-boost suggestions
   */
  code: string

  /**
   * Human-readable instruction for the LLM.
   * Written as a direct command: "Vary paragraph opening words."
   * Included in the RECOMMENDATIONS section of the evolved prompt.
   */
  instruction: string

  /**
   * Estimated quality impact of applying this recommendation.
   * Helps the Prompt Compiler prioritize which recommendations to include
   * when the prompt is getting long.
   * Score delta is in governance score points (0-100 scale).
   */
  estimatedScoreDelta?: number

  /**
   * Category tag for grouping related recommendations in the prompt.
   * Examples: 'style', 'structure', 'specificity', 'voice', 'hook'
   */
  category?: string
}

// ─── IGovernanceFeedback ──────────────────────────────────────────────────────

/**
 * IGovernanceFeedback — the structured output of every governance evaluation.
 *
 * Emitted by the governance evaluation step (GovernanceEvaluationResult
 * is translated into this at the artifact engine level).
 * Consumed by IAttemptRecord and ultimately by compilePromptFromContract().
 *
 * IMPORTANT: This is emitted even on PASS — a passing artifact generates
 * feedback with violations=[] and a high score. This allows the Prompt
 * Compiler to learn from successful generations (future enhancement).
 */
export interface IGovernanceFeedback {
  /**
   * Whether this governance evaluation passed.
   * If false, violations will be populated with the reasons for failure.
   */
  passed: boolean

  /**
   * Final governance score in [0, 100].
   * 0 = completely failing. 100 = perfect.
   * The prompt compiler uses score trends across attempts to calibrate
   * how aggressively to strengthen instructions.
   */
  score: number

  /**
   * The pre-fix score before auto-corrections were applied.
   * Useful for understanding how much value the auto-fix pass added.
   * Absent when no auto-fix was applied.
   */
  originalScore?: number

  /**
   * Structured violations from this governance pass.
   * Empty array on pass. Populated on fail.
   * The Prompt Compiler iterates this list to inject targeted corrections.
   */
  violations: IGovernanceViolationDetail[]

  /**
   * Structured recommendations for the next attempt.
   * Present on both pass and fail — even passing artifacts can have recommendations.
   * Sorted by estimatedScoreDelta descending (highest impact first).
   */
  recommendations: IGovernanceRecommendationDetail[]

  /**
   * Issues detected by governance that cannot be auto-fixed and need
   * explicit LLM instruction. Forwarded verbatim into the repair section
   * of the evolved prompt.
   */
  flagsRemaining?: string[]

  /**
   * ISO timestamp of this governance evaluation.
   * Used to sort and correlate attempts in history.
   */
  evaluatedAt: string
}

// ─── IAttemptRecord ───────────────────────────────────────────────────────────

/**
 * IAttemptRecord — a complete record of one generation + governance cycle.
 *
 * Accumulated in IAttemptHistory across all attempts for a single user request.
 * The Prompt Compiler reads this to understand why previous attempts failed
 * and how to progressively strengthen the next prompt.
 */
export interface IAttemptRecord {
  /**
   * 1-based attempt number (1 = first attempt, 2 = first retry, etc.)
   */
  attemptNumber: number

  /**
   * The prompt version used for this attempt.
   * Incremented each time the Prompt Compiler evolves the prompt.
   * Format: 'v1' | 'v2' | 'v3' (or more descriptive: 'v2-targeted-repair')
   */
  promptVersion: string

  /**
   * The full compiled system prompt used for this attempt.
   * Stored so we can diff prompt evolution across attempts in the control plane.
   * May be truncated for very long prompts (first 2000 chars).
   */
  systemPromptSnapshot?: string

  /**
   * The governance feedback from this attempt.
   * Contains score, violations, recommendations, and pass/fail status.
   */
  governanceFeedback: IGovernanceFeedback

  /**
   * Wall-clock time of this attempt in milliseconds.
   * Used for latency tracking across the repair loop.
   */
  durationMs?: number

  /**
   * The artifact type that was generated in this attempt.
   * Stored for type-level analytics (which types fail most often).
   */
  artifactType: string
}

// ─── IAttemptHistory ──────────────────────────────────────────────────────────

/**
 * IAttemptHistory — the accumulated record of all attempts for one user request.
 *
 * Passed into ContributorContext and consumed by compilePromptFromContract().
 * The Prompt Compiler reads this to determine how aggressively to strengthen
 * the next prompt.
 *
 * LIFECYCLE:
 *   - Created empty at the start of a generation request.
 *   - Populated after each governance evaluation.
 *   - Passed into the next ContractAssembler.assemble() call.
 *   - Discarded after the request completes (not persisted — see controlPlaneMeta
 *     for the persistent representation).
 */
export interface IAttemptHistory {
  /**
   * Ordered list of all attempt records, oldest first.
   * Length = number of completed attempts (0 before first attempt).
   */
  records: IAttemptRecord[]

  /**
   * The most recent governance score across all attempts.
   * null before any attempt has completed.
   */
  latestScore: number | null

  /**
   * Whether any previous attempt passed governance.
   * If true, the current failure is a regression (rare, log as error).
   */
  anyPreviousPassed: boolean

  /**
   * The set of violation codes that have recurred across multiple attempts.
   * Used by the Prompt Compiler to identify "persistent violations" that need
   * a more aggressive correction instruction.
   * Example: if 'WEAK_HOOK' appears in 3 consecutive attempts, the prompt
   * should include a very explicit hook rewriting instruction.
   */
  persistentViolationCodes: string[]

  /**
   * The total number of governance failures across all attempts.
   * Used to scale prompt escalation (more failures = more prescriptive prompt).
   */
  totalFailures: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * createEmptyAttemptHistory — factory for a fresh attempt history.
 * Call this at the start of every generation request.
 */
export function createEmptyAttemptHistory(): IAttemptHistory {
  return {
    records:                [],
    latestScore:            null,
    anyPreviousPassed:      false,
    persistentViolationCodes: [],
    totalFailures:          0,
  }
}

/**
 * appendAttemptRecord — immutably append a new attempt record to history.
 *
 * Recomputes derived fields (persistentViolationCodes, latestScore, etc.)
 * so the Prompt Compiler always reads a consistent view.
 *
 * @param history  - The current attempt history.
 * @param record   - The new attempt record to append.
 * @returns        A new IAttemptHistory with the record appended.
 */
export function appendAttemptRecord(
  history: IAttemptHistory,
  record: IAttemptRecord
): IAttemptHistory {
  const newRecords = [...history.records, record]
  const feedback   = record.governanceFeedback

  // Recompute persistent violation codes: codes that appear in >= 2 consecutive attempts
  const violationCodeFrequency: Record<string, number> = {}
  for (const r of newRecords) {
    for (const v of r.governanceFeedback.violations) {
      violationCodeFrequency[v.code] = (violationCodeFrequency[v.code] ?? 0) + 1
    }
  }
  const persistentViolationCodes = Object.entries(violationCodeFrequency)
    .filter(([, count]) => count >= 2)
    .map(([code]) => code)

  return {
    records:               newRecords,
    latestScore:           feedback.score,
    anyPreviousPassed:     history.anyPreviousPassed || feedback.passed,
    persistentViolationCodes,
    totalFailures:         history.totalFailures + (feedback.passed ? 0 : 1),
  }
}

/**
 * buildGovernanceFeedbackFromEvaluation — translates the raw GovernanceEvaluationResult
 * (string-based violations/recommendations) into a structured IGovernanceFeedback.
 *
 * This is the boundary where governance-layer's raw string arrays get lifted
 * into typed, actionable feedback. Lives here (in contracts) so both
 * governance-layer and artifact-engine-layer can import it without circular deps.
 *
 * @param passed           - Whether governance passed.
 * @param score            - Final governance score.
 * @param originalScore    - Pre-fix score (may equal score if no auto-fix ran).
 * @param violations       - Raw violation strings from GovernanceEvaluationResult.
 * @param recommendations  - Raw recommendation strings from GovernanceEvaluationResult.
 * @param flagsRemaining   - Raw flags from GovernanceEvaluationResult.
 */
export function buildGovernanceFeedbackFromEvaluation(params: {
  passed: boolean
  score: number
  originalScore?: number
  violations: string[]
  recommendations: string[]
  flagsRemaining?: string[]
}): IGovernanceFeedback {
  const { passed, score, originalScore, violations, recommendations, flagsRemaining } = params

  return {
    passed,
    score,
    originalScore,
    violations: violations.map(v => parseViolationString(v)),
    recommendations: recommendations.map(r => parseRecommendationString(r)),
    flagsRemaining,
    evaluatedAt: new Date().toISOString(),
  }
}

// ─── Internal parsers ─────────────────────────────────────────────────────────
//
// These convert the string-based violation/recommendation formats from
// governance-layer's GovernanceEvaluationResult into typed structs.
// They are resilient — unknown violation strings become LOW severity items.

function parseViolationString(violation: string): IGovernanceViolationDetail {
  // Known violation codes from governanceEngine.ts
  const knownMappings: Array<{
    pattern: RegExp | string
    code: string
    severity: GovernanceViolationSeverity
  }> = [
    { pattern: 'weak_hook',           code: 'WEAK_HOOK',           severity: 'HIGH' },
    { pattern: 'cliche_density',      code: 'CLICHE_DENSITY',      severity: 'HIGH' },
    { pattern: 'score_below_threshold', code: 'SCORE_THRESHOLD',   severity: 'CRITICAL' },
    { pattern: /slide.count/i,        code: 'SLIDE_COUNT',         severity: 'HIGH' },
    { pattern: /missing.role/i,       code: 'MISSING_ROLE',        severity: 'CRITICAL' },
    { pattern: /robotic.symmet/i,     code: 'ROBOTIC_SYMMETRY',    severity: 'MEDIUM' },
    { pattern: /repetitive.opener/i,  code: 'REPETITIVE_OPENER',   severity: 'MEDIUM' },
    { pattern: /generic.visual/i,     code: 'GENERIC_VISUAL',      severity: 'LOW' },
    { pattern: /buzzword/i,           code: 'BUZZWORD_DENSITY',     severity: 'MEDIUM' },
    { pattern: /em.dash/i,            code: 'EM_DASH_OVERUSE',      severity: 'LOW' },
    { pattern: /schema/i,             code: 'SCHEMA_VIOLATION',     severity: 'CRITICAL' },
    { pattern: /section.count/i,      code: 'SECTION_COUNT',        severity: 'HIGH' },
  ]

  const v = violation.toLowerCase()
  for (const { pattern, code, severity } of knownMappings) {
    const matches = typeof pattern === 'string'
      ? v.includes(pattern)
      : pattern.test(v)
    if (matches) {
      return { code, severity, message: violation }
    }
  }

  // Unknown violation — preserve it as a LOW severity item
  return {
    code:     'UNKNOWN_VIOLATION',
    severity: 'LOW',
    message:  violation,
  }
}

function parseRecommendationString(recommendation: string): IGovernanceRecommendationDetail {
  // Known recommendation categories
  const categoryMappings: Array<{ pattern: RegExp; category: string; code: string }> = [
    { pattern: /opener|paragraph.*open/i, category: 'style',       code: 'VARY_OPENERS' },
    { pattern: /paragraph.*length|sentence.*length/i, category: 'style', code: 'VARY_PARAGRAPH_LENGTH' },
    { pattern: /hook|opening.*line/i,     category: 'hook',        code: 'STRENGTHEN_HOOK' },
    { pattern: /visual|image|placeholder/i, category: 'visual',   code: 'REPLACE_GENERIC_VISUAL' },
    { pattern: /specific|concrete|evidence/i, category: 'specificity', code: 'ADD_SPECIFICITY' },
    { pattern: /cta|call.to.action/i,     category: 'structure',   code: 'STRENGTHEN_CTA' },
    { pattern: /slide|section/i,          category: 'structure',   code: 'STRUCTURE_IMPROVEMENT' },
  ]

  for (const { pattern, category, code } of categoryMappings) {
    if (pattern.test(recommendation)) {
      return {
        code,
        instruction:          recommendation,
        category,
        estimatedScoreDelta:  5,
      }
    }
  }

  return {
    code:        'GENERAL_RECOMMENDATION',
    instruction: recommendation,
    category:    'general',
  }
}

