// ============================================================
// @brandos/output-control-layer — output-normalizer/pipeline/repairJSON.ts
//
// Fix C2: repairJSON() is now canonical in @brandos/shared-utils.
//   This file retains only OCL-domain content:
//     - repairWithLLM()        — LLM-assisted repair (domain orchestration)
//     - CAROUSEL_REPAIR_HINT   — carousel schema hint (domain knowledge)
//
// repairJSON is re-exported from shared-utils for internal module consumers
// within OCL that import from this file path directly.
// ============================================================

// Re-export the canonical implementation from shared-utils.
// Consumers that import from this internal path continue to work.
export { repairJSON } from '@brandos/shared-utils'

// CAROUSEL SCHEMA FIX (domain knowledge — stays in OCL):
// CAROUSEL_REPAIR_HINT matches the canonical schema defined in
// prompt-compiler/compilePromptFromContract.ts CAROUSEL_SCHEMA_INSTRUCTION.
// Shape: { slides: [{ role, headline, body, visualNote? }] }
// No title wrapper, no bullets array — same as generation schema.
const CAROUSEL_REPAIR_HINT = JSON.stringify({
  slides: [
    {
      role: 'hook | problem | insight | framework | evidence | CTA',
      headline: 'string (max 10 words)',
      body: 'string (1–3 sentences)',
      visualNote: 'string (optional)',
    },
  ],
})

/**
 * repairWithLLM — optional LLM-assisted last-resort repair.
 *
 * Only invoked when heuristic repair fails AND options.enableLLMRepair is true.
 * Uses an injected callLLM function from the orchestrator to avoid
 * cross-package imports.
 *
 * Adds ~1–2 s latency. Gate via AdminSettingsService.getLLMRepairEnabled().
 */
export async function repairWithLLM(
  brokenJSON: string,
  callLLM: (prompt: string) => Promise<string>
): Promise<string | null> {
  const prompt = [
    'You are a JSON repair tool. Return ONLY valid JSON, nothing else.',
    'No explanation. No markdown fences. No preamble. Pure JSON only.',
    `Expected schema: ${CAROUSEL_REPAIR_HINT}`,
    `Broken JSON to repair:\n${brokenJSON}`,
  ].join('\n\n')

  try {
    const raw = await callLLM(prompt)
    const clean = raw.replace(/```(?:json)?|```/gi, '').trim()
    JSON.parse(clean)
    return clean
  } catch {
    return null
  }
}
