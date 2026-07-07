// ============================================================
// packages/ai-runtime-layer/src/generationModes.ts
//
// GENERATION MODES — Output Attribution Badge
//
// PHASE 6 CLEANUP (previously documented):
//   Removed: modeToTier, tierToMode, modeToEngineMode, EngineMode
//   Removed: runtimeMode export (use RuntimeMode from @brandos/contracts)
//   Removed: GENERATION_MODE_CONFIG re-declaration (lives in @brandos/contracts)
//   Retained: buildOutputBadge() — attribution string for UI display
//
// IMPORTANT:
//   Do NOT redeclare GENERATION_MODE_CONFIG or GENERATION_MODE_ORDER here.
//   Those types live exclusively in @brandos/contracts.
//   Any re-declaration here causes duplicate type errors and breaks the
//   single-source-of-truth contract.
// ============================================================

/**
 * Build the standard output attribution badge string.
 *
 * Rendered in:
 *   - Studio page footer (below generated content)
 *   - Export metadata (attribution field)
 *   - API responses (LLMResponse.engine_badge)
 *
 * The string is intentionally static — no provider or model name
 * is included. Individual provider attribution is handled by
 * LLMResponse.provider and LLMResponse.providerKind.
 *
 * @returns Attribution badge string.
 */
export function buildOutputBadge(): string {
  return 'Model-Assisted • BrandOS Powered'
}


