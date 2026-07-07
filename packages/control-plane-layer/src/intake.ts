/**
 * BrandOS Control Plane — Intake Module
 *
 * GOVERNANCE MIGRATION:
 *   UNSAFE_CONTENT_PATTERNS now imported from @brandos/governance-config
 *   instead of being hardcoded here. Pattern set is now auditable and
 *   co-located with all other policy constants.
 */

import type { IntentAnalysis, TaskType } from '@brandos/contracts'
import { UNSAFE_CONTENT_PATTERNS } from '@brandos/governance-config'

// ─── Task keyword maps ────────────────────────────────────────────────────────

const TASK_SIGNALS: Record<TaskType, string[]> = {
  carousel:   ['carousel', 'slides', 'swipe', 'scroll post', 'multi-slide'],
  deck:       ['deck', 'presentation', 'pptx', 'pitch deck', 'keynote', 'slides deck'],
  report:     ['report', 'analysis', 'summary', 'writeup', 'white paper', 'research'],
  newsletter: ['newsletter', 'email newsletter', 'email blast', 'subscribers', 'inbox', 'subject line'],
  campaign:   ['campaign', 'multi-post', 'series', 'sequence', 'content plan'],
  post:       ['post', 'linkedin', 'tweet', 'caption', 'social', 'article'],
  remix:      ['remix', 'rewrite', 'transform', 'adapt', 'repurpose'],
  export:     ['export', 'download', 'convert', 'pdf', 'pptx'],
  chat:       ['explain', 'what is', 'how does', 'tell me', 'help me understand'],
  unknown:    [],
}

const SPAM_PATTERNS = [
  /(.)\\1{8,}/,
  /^[A-Z\s!?]{30,}$/,
  /^\s*$/,
]

const CONTRADICTION_PAIRS = [
  ['formal', 'casual'],
  ['short', 'long'],
  ['simple', 'complex'],
  ['funny', 'serious'],
  ['professional', 'playful'],
]

// ─── Token estimation ─────────────────────────────────────────────────────────

function estimateTokens(prompt: string, taskType: TaskType): number {
  const inputTokens = Math.ceil(prompt.split(/\s+/).length * 1.3)
  const outputMultiplier: Record<TaskType, number> = {
    chat: 200, post: 300, carousel: 800, deck: 1200,
    report: 1500, newsletter: 800, campaign: 1000, remix: 400, export: 100, unknown: 300,
  }
  return inputTokens + (outputMultiplier[taskType] ?? 300)
}

// ─── Task detection ───────────────────────────────────────────────────────────

function detectTaskType(prompt: string): { task: TaskType; confidence: number } {
  const lower  = prompt.toLowerCase()
  const scores: Partial<Record<TaskType, number>> = {}

  for (const [task, signals] of Object.entries(TASK_SIGNALS)) {
    if (task === 'unknown') continue
    let score = 0
    for (const signal of signals) {
      if (lower.includes(signal)) score += signal.split(' ').length
    }
    if (score > 0) scores[task as TaskType] = score
  }

  const entries = Object.entries(scores).sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
  if (entries.length === 0) return { task: 'post', confidence: 0.4 }

  const top = entries[0]
  if (!top) return { task: 'unknown', confidence: 0 }

  const [topTask, topScore] = top
  const secondScore = entries[1]?.[1] ?? 0
  const confidence  = (topScore ?? 0) === 0 ? 0.4 : Math.min(0.95, 0.5 + ((topScore ?? 0) - secondScore) * 0.1)
  return { task: topTask as TaskType, confidence }
}

function detectAmbiguity(prompt: string, taskType: TaskType): 'low' | 'medium' | 'high' {
  const wordCount = prompt.trim().split(/\s+/).length
  if (wordCount < 5)  return 'high'
  if (wordCount < 15) return 'medium'
  if (taskType === 'carousel' && wordCount < 20) return 'medium'
  if (taskType === 'deck'     && wordCount < 25) return 'medium'
  return 'low'
}

function detectMissingData(prompt: string, taskType: TaskType): string[] {
  const missing: string[] = []
  const lower = prompt.toLowerCase()
  if (taskType === 'carousel' || taskType === 'deck') {
    if (!lower.match(/\b(about|for|on|regarding|topic)\b/i) && prompt.split(/\s+/).length < 10) {
      missing.push('Specific topic or subject matter')
    }
    if (!lower.match(/\b(audience|for|target)\b/i)) {
      missing.push('Target audience (optional but improves quality)')
    }
  }
  if (taskType === 'campaign' && !lower.match(/\b(goal|objective|aim|purpose)\b/i)) {
    missing.push('Campaign objective or goal')
  }
  return missing
}

function suggestImprovements(prompt: string, taskType: TaskType, ambiguity: string): string[] {
  const suggestions: string[] = []
  if (ambiguity === 'high') suggestions.push("Add more context: Who is the audience? What's the goal?")
  if (prompt.split(/\s+/).length < 8) suggestions.push('Longer prompts consistently produce better output. Try 20+ words.')
  if (taskType === 'carousel' && !prompt.toLowerCase().includes('slide')) {
    suggestions.push('Specify number of slides (e.g., "5-slide carousel about…")')
  }
  if (taskType === 'post' && !prompt.toLowerCase().match(/\b(linkedin|twitter|instagram)\b/i)) {
    suggestions.push('Specify the platform for optimized formatting')
  }
  return suggestions
}

// ─── Main intake function ─────────────────────────────────────────────────────

export function analyzeIntent(prompt: string, hintedTask?: TaskType): IntentAnalysis {
  // Safety checks — patterns sourced from governance-config
  const is_unsafe = UNSAFE_CONTENT_PATTERNS.some(p => p.test(prompt))
  const is_spam   = SPAM_PATTERNS.some(p => p.test(prompt)) || prompt.trim().length < 3

  if (is_spam) {
    return {
      detected_task: 'unknown', confidence: 0, ambiguity_level: 'high',
      missing_data: ['Meaningful content'], is_unsafe: false, is_spam: true,
      has_contradictions: false, complexity: 'simple', estimated_tokens: 0,
      suggested_improvements: ['Please provide a real prompt to generate content.'],
    }
  }

  if (is_unsafe) {
    return {
      detected_task: 'unknown', confidence: 0, ambiguity_level: 'low',
      missing_data: [], is_unsafe: true, unsafe_reason: 'Prompt contains policy-violating patterns.',
      is_spam: false, has_contradictions: false, complexity: 'simple',
      estimated_tokens: 0, suggested_improvements: [],
    }
  }

  const { task: detected_task, confidence } = hintedTask
    ? { task: hintedTask, confidence: 0.99 }
    : detectTaskType(prompt)

  const ambiguity_level      = detectAmbiguity(prompt, detected_task)
  const missing_data         = detectMissingData(prompt, detected_task)
  const has_contradictions   = CONTRADICTION_PAIRS.some(([a, b]) => {
    if (!a || !b) return false
    const lower = prompt.toLowerCase()
    return lower.includes(a) && lower.includes(b)
  })

  const wordCount  = prompt.trim().split(/\s+/).length
  const complexity: 'simple' | 'moderate' | 'complex' =
    wordCount < 15 ? 'simple' : wordCount < 50 ? 'moderate' : 'complex'

  return {
    detected_task,
    confidence,
    ambiguity_level,
    missing_data,
    is_unsafe,
    is_spam,
    has_contradictions,
    complexity,
    estimated_tokens:       estimateTokens(prompt, detected_task),
    suggested_improvements: suggestImprovements(prompt, detected_task, ambiguity_level),
  }
}


