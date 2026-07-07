// ============================================================
// @brandos/shared-utils — src/json-utils.ts
//
// Pure JSON utility functions with no domain knowledge.
// Moved here from @brandos/output-control-layer as part of Fix C2.
//
// INVARIANTS:
//   - No imports from any @brandos/* package (domain-free)
//   - No artifact-domain knowledge (schema shapes live in OCL)
//   - Pure functions only — no side effects
// ============================================================

/**
 * repairJSON — heuristic repair for common LLM JSON malformations:
 *   • Trailing commas before } or ]
 *   • Single-quoted strings instead of double-quoted
 *   • Unquoted property keys
 *   • Unclosed braces / brackets (best-effort)
 *   • Truncated string values (mid-string LLM cutoff)
 *
 * Returns the repaired string if the result parses cleanly, null otherwise.
 * Does NOT call an LLM — pure heuristic repair only.
 */
export function repairJSON(text: string): string | null {
  let s = text

  // Pass 0: recover from mid-string truncation (LLM cut off inside a string value)
  s = truncatedStringRecovery(s)

  // Fix trailing commas: ,} or ,]
  // P0-2 FIX: was /,([\s*[}\]])/g — a broken character class that matched
  // spaces between array numbers, corrupting e.g. [1, 2, 3,] → [1 2 3] → parse fail.
  // Fix: correct non-capturing group with quantified whitespace before closing bracket.
  s = s.replace(/,(\s*[}\]])/g, '$1')

  // Fix single-quoted strings → double-quoted
  // Only safe for values without internal apostrophes
  s = s.replace(/'([^'\\]*)'/g, '"$1"')

  // Fix unquoted property keys: { key: "value" } → { "key": "value" }
  s = s.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":')

  // Attempt to close unclosed structures
  s = closeUnclosedStructures(s)

  try {
    JSON.parse(s)
    return s
  } catch {
    return null
  }
}

/**
 * extractJSON — three-pass extraction:
 *   1. Direct JSON.parse on the full cleaned text
 *   2. Bracket-depth extraction of outermost { } block
 *   3. Bracket-depth extraction of outermost [ ] block
 *
 * Returns the parsed JS value or null if all three passes fail.
 */
export function extractJSON(text: string): unknown | null {
  // Pass 1 — direct parse (cheapest, handles well-formed output)
  try {
    return JSON.parse(text)
  } catch {
    // fall through
  }

  // Pass 2 — extract outermost object
  const objBlock = extractOutermostBlock(text, '{', '}')
  if (objBlock !== null) {
    try {
      return JSON.parse(objBlock)
    } catch {
      // fall through to array pass
    }
  }

  // Pass 3 — extract outermost array
  const arrBlock = extractOutermostBlock(text, '[', ']')
  if (arrBlock !== null) {
    try {
      return JSON.parse(arrBlock)
    } catch {
      // all passes failed
    }
  }

  return null
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * closeUnclosedStructures — appends missing " } ] in reverse open order.
 *
 * Handles:
 *   - Unclosed string literals (LLM output truncated mid-string)
 *   - Unclosed objects and arrays
 *   - Proper escape sequence tracking
 */
function closeUnclosedStructures(text: string): string {
  const stack: string[] = []
  let inString = false
  let escape = false

  for (const ch of text) {
    if (escape)                    { escape = false; continue }
    if (ch === '\\' && inString)   { escape = true;  continue }
    if (ch === '"') {
      if (inString) {
        inString = false
        // Pop the matching '"' from stack
        if (stack[stack.length - 1] === '"') stack.pop()
      } else {
        inString = true
        stack.push('"')
      }
      continue
    }
    if (inString) { continue }

    if (ch === '{')               { stack.push('}') }
    else if (ch === '[')          { stack.push(']') }
    else if (ch === '}' || ch === ']') {
      // Pop any dangling open-string markers before matching bracket
      while (stack.length > 0 && stack[stack.length - 1] === '"') {
        stack.pop()
      }
      stack.pop()
    }
  }

  // Close in reverse order: unclosed strings first, then brackets
  return text + stack.reverse().join('')
}

/**
 * truncatedStringRecovery — attempts to recover from mid-string truncation.
 *
 * When an LLM response is cut off inside a JSON string value, this heuristic
 * closes the string with '"'. closeUnclosedStructures then closes any brackets.
 */
function truncatedStringRecovery(text: string): string {
  let inString = false
  let escape = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (escape)                  { escape = false; continue }
    if (ch === '\\' && inString) { escape = true;  continue }
    if (ch === '"')              { inString = !inString; continue }
  }

  // If we ended inside a string, the response was truncated mid-value.
  if (inString) {
    return text.trimEnd() + '"'
  }

  return text
}

/**
 * extractOutermostBlock — bracket-depth scanner.
 * Returns the substring from the first `open` char to its matching `close`,
 * respecting nested structures and string literals.
 */
function extractOutermostBlock(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open)
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]

    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue

    if (ch === open)  { depth++ }
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  return null
}
