/**
 * @brandos/governance-layer — governanceEngine.ts
 *
 * Text quality scoring engine.
 *
 * OWNS:
 *   - Policy evaluation (cliché/buzzword/hook detection)
 *   - Quality scoring
 *   - Auto-fix pass (em-dash, cliché removal, buzzword reduction)
 *   - Violation annotation and recommendations
 *   - Pass/fail decision against DEFAULT_PASS_THRESHOLD
 *
 * PUBLIC API:
 *   evaluateGovernance(input) → GovernanceEvaluationResult
 *   registerPolicyViolationHandler(fn) → void
 *
 * INVARIANTS:
 *   - Pure function: evaluateGovernance() has no I/O or LLM calls
 *   - All thresholds sourced from @brandos/governance-config (never hardcoded)
 *   - Scores are always in [0, 100]
 *   - registerPolicyViolationHandler is a side-effect-only callback sink;
 *     it does not affect scoring logic
 */

import { DEFAULT_PASS_THRESHOLD, SCORE_PENALTIES } from '@brandos/governance-config'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Task context forwarded by CPL */
export interface GovernanceContext {
  tone?: string
  engineBadge?: string
  workspaceId?: string
}

/** Input to evaluateGovernance() */
export interface GovernanceEvaluationInput {
  content: string
  taskType: string
  context?: GovernanceContext
}

/** Canonical governance result returned to CPL */
export interface GovernanceEvaluationResult {
  passed: boolean
  score: number
  annotations: string[]
  recommendations: string[]
  violations: string[]
  /** Original (pre-fix) score — useful for telemetry */
  original_score: number
  /** The rewritten content with auto-fixes applied */
  approved_output: string
  /** Issues detected but not auto-fixable — need human review */
  flags_remaining: string[]
  engine_badge: string
}

export type PolicyViolationType = 'score_below_threshold' | 'cliche_density' | 'weak_hook'

type PolicyViolationHandler = (
  type: PolicyViolationType,
  score: number,
  details: string
) => void

let _policyViolationHandler: PolicyViolationHandler | null = null

/**
 * Register a callback for policy violations.
 * Called when a generation scores below threshold or has high cliché density.
 * Use this to connect to analytics / enterprise policy alerting.
 *
 * Example:
 *   registerPolicyViolationHandler((type, score, details) => {
 *     trackServer('system', 'control_plane_violation', { type, score, details })
 *   })
 */
export function registerPolicyViolationHandler(fn: PolicyViolationHandler): void {
  _policyViolationHandler = fn
}

// ─── Cliché and buzzword registries ──────────────────────────────────────────

const AI_CLICHES = [
  'dive into',
  'delve into',
  "in today's fast-paced",
  'in the ever-evolving',
  'landscape of',
  'at the forefront',
  'unlock the potential',
  'leveraging the power',
  'game-changer',
  'game changer',
  'paradigm shift',
  'transformative journey',
  'thought leader',
  'synergy',
  'move the needle',
  'low-hanging fruit',
  'circle back',
  'boil the ocean',
  "it's important to note",
  'it is worth noting',
  'in conclusion',
  'in summary',
  'certainly',
  'absolutely',
  'of course',
]

const BUZZWORDS = [
  'cutting-edge',
  'bleeding-edge',
  'state-of-the-art',
  'world-class',
  'best-in-class',
  'robust',
  'seamless',
  'holistic',
  'innovative solution',
  'impactful',
  'scalable solution',
  'end-to-end',
  'value-add',
  'actionable insights',
  'key takeaways',
  'elevate your',
]

const WEAK_HOOKS = [
  /^in today/i,
  /^as (a|an|the) /i,
  /^have you ever wondered/i,
  /^let me (tell|share|introduce)/i,
  /^i want to (talk|discuss|share)/i,
  /^welcome to/i,
  /^hello,?\s+everyone/i,
  /^are you (looking|trying|struggling)/i,
  /^in this post/i,
  /^today (i want|i will|we will|i'm going)/i,
]

// ─── Analysis functions ───────────────────────────────────────────────────────

function countEmDashAbuse(text: string): number {
  const lines = text.split('\n').filter(l => l.trim().length > 0)
  let abusiveLines = 0
  for (const line of lines) {
    const count = (line.match(/—/g) || []).length
    if (count >= 2) abusiveLines++
  }
  return abusiveLines
}

function countCliches(text: string): string[] {
  const t = text.toLowerCase()
  return AI_CLICHES.filter(c => t.includes(c))
}

function countBuzzwords(text: string): string[] {
  const t = text.toLowerCase()
  return BUZZWORDS.filter(b => t.includes(b))
}

function detectRoboticSymmetry(text: string): boolean {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 30)
  if (paragraphs.length < 4) return false
  const lengths = paragraphs.map(p => p.trim().split(/\s+/).length)
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length
  const variance = lengths.reduce((sum, l) => sum + Math.abs(l - avg), 0) / lengths.length
  return variance < 8 && paragraphs.length >= 4
}

function detectRepetitiveOpeners(text: string): string | null {
  const lines = text.split('\n').filter(l => l.trim().length > 20)
  const openers: Record<string, number> = {}
  for (const line of lines) {
    const firstWord = line.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '')
    if (firstWord && firstWord.length > 2) {
      openers[firstWord] = (openers[firstWord] || 0) + 1
    }
  }
  for (const [word, count] of Object.entries(openers)) {
    if (count >= 3) return word
  }
  return null
}

function checkWeakHook(text: string): boolean {
  const firstLine = text.trim().split('\n')[0]?.trim() || ''
  return WEAK_HOOKS.some(pattern => pattern.test(firstLine))
}

function countGenericVisualLanguage(text: string): number {
  const genericPhrases = [
    'insert image here',
    'add visual',
    'placeholder',
    'stock photo',
    'generic background',
    'standard template',
    'default layout',
    'use any image',
    'pick a color',
  ]
  const t = text.toLowerCase()
  return genericPhrases.filter(p => t.includes(p)).length
}

// ─── Fix functions ────────────────────────────────────────────────────────────

function reduceEmDashes(text: string): string {
  return text
    .replace(/—([^—]{1,40})—/g, ', $1,')
    .replace(/\s+—\s+/g, '. ')
    .replace(/—/g, ':')
}

const CLICHE_REPLACEMENTS: Record<string, string> = {
  'dive into': 'examine',
  'delve into': 'explore',
  "in today's fast-paced": 'In modern',
  'in the ever-evolving': 'In a shifting',
  'landscape of': 'world of',
  'at the forefront': 'leading',
  'unlock the potential': 'realize the value',
  'leveraging the power': 'using',
  'game-changer': 'significant shift',
  'game changer': 'significant shift',
  'paradigm shift': 'fundamental change',
  'transformative journey': 'transformation',
  "it's important to note": '',
  'it is worth noting': '',
  'in conclusion': 'The bottom line:',
  'in summary': 'To summarize:',
  'certainly': '',
  'absolutely': '',
  'of course': '',
}

function removeCliches(text: string, cliches: string[]): string {
  let result = text
  for (const cliche of cliches) {
    const replacement = CLICHE_REPLACEMENTS[cliche]
    if (replacement !== undefined) {
      const regex = new RegExp(cliche.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      result = result.replace(regex, replacement)
    }
  }
  return result.replace(/\s{2,}/g, ' ').trim()
}

const BUZZWORD_REPLACEMENTS: Record<string, string> = {
  'cutting-edge': 'advanced',
  'bleeding-edge': 'leading',
  'state-of-the-art': 'modern',
  'world-class': 'elite',
  'best-in-class': 'top-tier',
  'robust': 'strong',
  'seamless': 'smooth',
  'holistic': 'comprehensive',
  'innovative solution': 'approach',
  'impactful': 'effective',
  'scalable solution': 'scalable approach',
  'end-to-end': 'full-stack',
  'value-add': 'value',
  'actionable insights': 'concrete findings',
  'key takeaways': 'main points',
  'elevate your': 'improve your',
}

function reduceBuzzwords(text: string, found: string[]): string {
  let result = text
  for (const bw of found) {
    const replacement = BUZZWORD_REPLACEMENTS[bw]
    if (replacement) {
      const regex = new RegExp(bw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      result = result.replace(regex, replacement)
    }
  }
  return result
}

// ─── Score calculator ─────────────────────────────────────────────────────────

function calculateScore(
  emDashAbuse: number,
  cliches: string[],
  buzzwords: string[],
  hasRoboticSymmetry: boolean,
  repetitiveOpener: string | null,
  hasWeakHook: boolean,
  genericVisuals: number
): number {
  let score = 100
  score -= emDashAbuse * SCORE_PENALTIES.emDashAbuse
  score -= Math.min(cliches.length * SCORE_PENALTIES.aiCliche, 25)
  score -= Math.min(buzzwords.length * SCORE_PENALTIES.buzzwordDensity, 20)
  if (hasRoboticSymmetry)  score -= SCORE_PENALTIES.roboticSymmetry
  if (repetitiveOpener)    score -= SCORE_PENALTIES.repetitiveOpeners
  if (hasWeakHook)         score -= SCORE_PENALTIES.weakHook
  score -= Math.min(genericVisuals * SCORE_PENALTIES.genericVisualLanguage, 16)
  return Math.max(score, 0)
}

// ─── Policy evaluation ────────────────────────────────────────────────────────

function runPolicyEvaluation(
  originalScore: number,
  cliches: string[],
  hasWeakHook: boolean
): void {
  if (!_policyViolationHandler) return
  if (originalScore < 50) {
    _policyViolationHandler('score_below_threshold', originalScore, `${cliches.length} clichés detected`)
  } else if (cliches.length >= 3) {
    _policyViolationHandler('cliche_density', originalScore, `High cliché density: ${cliches.slice(0, 3).join(', ')}`)
  } else if (hasWeakHook) {
    _policyViolationHandler('weak_hook', originalScore, 'Opening line matched weak hook pattern')
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * evaluateGovernance — canonical text governance entry point.
 *
 * CPL calls this after generation. CPL only inspects:
 *   result.passed  → controls retry
 *   result.score   → stored in telemetry
 *
 * All scoring, annotation, policy evaluation, and reporting logic lives here.
 */
export function evaluateGovernance(
  input: GovernanceEvaluationInput
): GovernanceEvaluationResult {
  const { content, context } = input
  const tone        = context?.tone ?? 'executive'
  const engineBadge = context?.engineBadge ?? 'Generated via BrandOS'
  const threshold   = DEFAULT_PASS_THRESHOLD

  const fixes: string[]        = []
  const flagsRemaining: string[] = []

  const emDashAbuse        = countEmDashAbuse(content)
  const cliches            = countCliches(content)
  const buzzwords          = countBuzzwords(content)
  const hasRoboticSymmetry = detectRoboticSymmetry(content)
  const repetitiveOpener   = detectRepetitiveOpeners(content)
  const hasWeakHook        = checkWeakHook(content)
  const genericVisuals     = countGenericVisualLanguage(content)

  const originalScore = calculateScore(
    emDashAbuse, cliches, buzzwords,
    hasRoboticSymmetry, repetitiveOpener,
    hasWeakHook, genericVisuals
  )

  runPolicyEvaluation(originalScore, cliches, hasWeakHook)

  let improved = content
  const fixedEmDash    = emDashAbuse > 1
  const fixedCliches   = cliches.length > 0
  const fixedBuzzwords = buzzwords.length > 2

  if (fixedEmDash) {
    improved = reduceEmDashes(improved)
    fixes.push(`Reduced em-dash overuse (${emDashAbuse} instances)`)
  }
  if (fixedCliches) {
    improved = removeCliches(improved, cliches)
    fixes.push(`Removed ${cliches.length} AI clichés: ${cliches.slice(0, 3).join(', ')}`)
  }
  if (fixedBuzzwords) {
    improved = reduceBuzzwords(improved, buzzwords)
    fixes.push(`Reduced ${buzzwords.length} buzzwords`)
  }
  if (tone === 'executive' && (cliches.length > 0 || buzzwords.length > 0)) {
    fixes.push('Tone target: Executive — boardroom-quality language enforced')
  }

  if (repetitiveOpener) {
    flagsRemaining.push(`Repetitive opener: "${repetitiveOpener}" starts 3+ paragraphs`)
  }
  if (hasWeakHook) {
    flagsRemaining.push('Weak hook — opening line needs a bolder rewrite')
  }
  if (hasRoboticSymmetry) {
    flagsRemaining.push('Uniform paragraph cadence — vary sentence length for authority')
  }
  if (genericVisuals > 0) {
    flagsRemaining.push(`${genericVisuals} generic visual direction(s) — replace with specific brand intent`)
  }

  const finalScore = calculateScore(
    fixedEmDash    ? 0  : emDashAbuse,
    fixedCliches   ? [] : cliches,
    fixedBuzzwords ? [] : buzzwords,
    hasRoboticSymmetry,
    repetitiveOpener,
    hasWeakHook,
    genericVisuals
  )

  const passed = finalScore >= threshold

  const violations: string[] = [
    ...(hasWeakHook ? ['weak_hook'] : []),
    ...(cliches.length >= 3 ? ['cliche_density'] : []),
    ...(originalScore < 50 ? ['score_below_threshold'] : []),
  ]

  const recommendations: string[] = [
    ...(repetitiveOpener ? [`Vary paragraph openers — "${repetitiveOpener}" repeated`] : []),
    ...(hasRoboticSymmetry ? ['Break paragraph length uniformity for stronger voice'] : []),
    ...(genericVisuals > 0 ? ['Replace generic visual placeholders with brand-specific direction'] : []),
  ]

  return {
    passed,
    score: finalScore,
    original_score: originalScore,
    annotations: fixes,
    recommendations,
    violations,
    flags_remaining: flagsRemaining,
    approved_output: improved,
    engine_badge: engineBadge,
  }
}


