/**
 * @brandos/cognition-client — src/global-correction-client.ts
 * Cognitive Platform Evolution Program, EM-3.3. Same globalThis singleton
 * pattern as the other clients in this package.
 */

import { CorrectionClient, type CorrectionClientConfig } from './CorrectionClient'

declare global {
  // eslint-disable-next-line no-var
  var __BRANDOS_CORRECTION_CLIENT__: CorrectionClient | null | undefined
}

function _get(): CorrectionClient | null {
  return globalThis.__BRANDOS_CORRECTION_CLIENT__ ?? null
}

export function initCorrectionClient(config: CorrectionClientConfig): void {
  if (_get()) {
    console.warn('[cognition-client] initCorrectionClient called more than once — ignoring')
    return
  }
  globalThis.__BRANDOS_CORRECTION_CLIENT__ = new CorrectionClient(config)
  console.info('[cognition-client] Correction client initialized')
}

/** Returns null instead of throwing when not configured. */
export function getGlobalCorrectionClient(): CorrectionClient | null {
  return _get()
}

/** Only for tests. Never call in production. */
export function _resetGlobalCorrectionClientForTests(): void {
  globalThis.__BRANDOS_CORRECTION_CLIENT__ = null
}
