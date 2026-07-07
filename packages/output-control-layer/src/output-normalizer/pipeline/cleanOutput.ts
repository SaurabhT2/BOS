// ============================================================
// @brandos/output-control-layer — cleanOutput.ts
//
// Strips non-JSON noise from raw LLM text before extraction.
// No imports from sibling packages.
// ============================================================

import type { CleaningStep } from '@brandos/contracts'

export interface CleanResult {
  cleaned: string
  steps: CleaningStep[]
}

/**
 * cleanOutput — removes common LLM output contamination patterns:
 *   • Markdown code fences  (```json ... ```)
 *   • Bold markers          (**text**)
 *   • Prose preambles       ("Here is your carousel:")
 *   • Prose postambles      ("Let me know if you'd like changes!")
 *   • Stray control chars   (breaks JSON.parse)
 *
 * Order matters: fence stripping must happen BEFORE preamble detection
 * because the preamble detector looks for the first { or [.
 */
export function cleanOutput(raw: string): CleanResult {
  const steps: CleaningStep[] = []
  let text = raw

  // 1. Strip markdown code fences — ```json ... ``` or ``` ... ```
  //    Non-greedy to handle multiple fenced blocks; take the first.
  const fenceMatch = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    const extracted = fenceMatch[1];

if (extracted !== undefined) {
  text = extracted;
}
    steps.push('stripped_markdown_fences')
  }

  // 2. Remove bold markers **...**  (common in GPT-4 and Claude outputs)
  if (text.includes('**')) {
    text = text.replace(/\*\*(.*?)\*\*/gs, '$1')
    steps.push('removed_bold_markers')
  }

  // 3. Remove preamble — any text before the first { or [
  const firstBrace = text.search(/[{[]/)
  if (firstBrace > 0) {
    text = text.slice(firstBrace)
    steps.push('removed_preamble')
  }

  // 4. Remove postamble — any text after the last } or ]
  const lastClose = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))
  if (lastClose !== -1 && lastClose < text.length - 1) {
    text = text.slice(0, lastClose + 1)
    steps.push('removed_postamble')
  }

  // 5. Strip stray control characters that break JSON.parse
  //    Keeps tab (\x09), newline (\x0A), carriage return (\x0D) — valid JSON whitespace
  const stripped = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  if (stripped !== text) {
    text = stripped
    steps.push('removed_stray_control_chars')
  }

  // 6. Trim outer whitespace
  const final = text.trim()
  if (final !== text) {
    steps.push('trimmed_whitespace')
  }

  return { cleaned: final, steps }
}


