/**
 * @brandos/cognition-client — src/CorrectionClient.ts
 *
 * Cognitive Platform Evolution Program — Milestone 3 (Experience Loop),
 * EM-3.3 (Correction HTTP Route).
 *
 * Thin HTTP adapter for IntelligenceOS's `POST /v1/intelligence/correction`
 * route, wrapping `IntelligenceOS.recordCorrection()` — described in that
 * method's own docblock as "the highest-authority signal in the system,"
 * and, like recordFeedbackEvent, fully implemented and completely
 * unreachable from BrandOS before this program.
 */

import { withRetry } from '@brandos/shared-utils'
import { FIRE_AND_FORGET_RETRY_OPTIONS } from './retryPolicy'

const DEFAULT_TIMEOUT_MS = 5000

export interface CorrectionClientConfig {
  readonly baseUrl: string
  readonly apiKey: string
  readonly timeoutMs?: number
}

/** Mirrors UserCorrectionInput (intelligence-os/src/types/domains.ts). */
export interface CorrectionInput {
  readonly userId: string
  readonly correctionType: 'vocabulary' | 'tone' | 'style' | 'fact' | 'goal' | 'other'
  readonly taxonomyCategory?: string | null
  readonly correctedValue: unknown
  readonly context?: string | null
}

export class CorrectionClient {
  constructor(private readonly config: CorrectionClientConfig) {}

  /** Fire-and-forget from the caller's point of view — same convention as FeedbackEventClient.
   *  G-14 (Architecture Verification Report, P1) — now retries transient
   *  failures (see retryPolicy.ts) before giving up. */
  async record(correction: CorrectionInput): Promise<void> {
    await withRetry(() => this._attempt(correction), FIRE_AND_FORGET_RETRY_OPTIONS)
  }

  private async _attempt(correction: CorrectionInput): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )

    try {
      const res = await fetch(`${this.config.baseUrl}/v1/intelligence/correction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(correction),
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(`IntelligenceOS API POST /v1/intelligence/correction returned ${res.status}`)
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
