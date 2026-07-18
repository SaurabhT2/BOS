/**
 * @brandos/cognition-client — src/global-feedback-event-client.ts
 * Cognitive Platform Evolution Program, EM-3.1. Same globalThis singleton
 * pattern as global-knowledge-client.ts / global-workspace-configuration-client.ts.
 */

import { FeedbackEventClient, type FeedbackEventClientConfig } from './FeedbackEventClient'

declare global {
  // eslint-disable-next-line no-var
  var __BRANDOS_FEEDBACK_EVENT_CLIENT__: FeedbackEventClient | null | undefined
}

function _get(): FeedbackEventClient | null {
  return globalThis.__BRANDOS_FEEDBACK_EVENT_CLIENT__ ?? null
}

export function initFeedbackEventClient(config: FeedbackEventClientConfig): void {
  if (_get()) {
    console.warn('[cognition-client] initFeedbackEventClient called more than once — ignoring')
    return
  }
  globalThis.__BRANDOS_FEEDBACK_EVENT_CLIENT__ = new FeedbackEventClient(config)
  console.info('[cognition-client] Feedback event client initialized')
}

/** Returns null instead of throwing when not configured — same degrade posture as the other clients in this package. */
export function getGlobalFeedbackEventClient(): FeedbackEventClient | null {
  return _get()
}

/** Only for tests. Never call in production. */
export function _resetGlobalFeedbackEventClientForTests(): void {
  globalThis.__BRANDOS_FEEDBACK_EVENT_CLIENT__ = null
}
