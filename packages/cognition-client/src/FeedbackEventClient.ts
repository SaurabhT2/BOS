/**
 * @brandos/cognition-client — src/FeedbackEventClient.ts
 *
 * Cognitive Platform Evolution Program — Milestone 3 (Experience Loop),
 * EM-3.1 (Feedback Event HTTP Route).
 *
 * Thin HTTP adapter for IntelligenceOS's `POST /v1/intelligence/feedback`
 * route, wrapping `IntelligenceOS.recordFeedbackEvent()` — a method that
 * was already real, tested, and completely unreachable from BrandOS before
 * this program (see the Cross-Repository Cognitive Integration Audit).
 *
 * Mirrors `FeedbackEvent` (`@intelligence-os/shared-types`) exactly —
 * duplicated here rather than imported, same reasoning as every other
 * wire-shape duplication in this package (KnowledgeAssetIngestInput,
 * WorkspaceConfigurationSyncInput): this is the agreed wire shape, not a
 * shared package import.
 */

import { withRetry } from '@brandos/shared-utils'
import { FIRE_AND_FORGET_RETRY_OPTIONS } from './retryPolicy'

const DEFAULT_TIMEOUT_MS = 5000

export interface FeedbackEventClientConfig {
  readonly baseUrl: string
  readonly apiKey: string
  readonly timeoutMs?: number
}

export type FeedbackEventType = 'accepted' | 'edited' | 'rejected' | 'deployed' | 'explicit_feedback'

export interface EditDiffInput {
  sectionsAdded: string[]
  sectionsRemoved: string[]
  sectionsReordered: boolean
  /** positive = made longer, negative = shorter */
  lengthDelta: number
  vocabularyChanges: { before: string; after: string }[]
  toneShift?: 'more_formal' | 'more_casual' | 'more_authoritative' | 'other'
}

export interface FeedbackEventInput {
  readonly userId: string
  readonly artifactId: string
  readonly artifactType: string
  readonly projectId?: string
  readonly blueprintId?: string
  readonly eventType: FeedbackEventType
  readonly editDiff?: EditDiffInput
  readonly explicitReason?: string
}

export class FeedbackEventClient {
  constructor(private readonly config: FeedbackEventClientConfig) {}

  /**
   * Fire-and-forget from the caller's point of view, same convention as
   * every other client in this package — a feedback-recording failure
   * must never fail whatever user-facing action (accept/edit/reject/
   * deploy/explicit feedback submission) triggered it.
   *
   * G-14 (Architecture Verification Report, P1) — now retries transient
   * failures (see retryPolicy.ts) before giving up. Each attempt gets its
   * own AbortController/timeout — a retry after a timed-out attempt must
   * not inherit an already-aborted signal.
   */
  async record(event: FeedbackEventInput): Promise<void> {
    await withRetry(() => this._attempt(event), FIRE_AND_FORGET_RETRY_OPTIONS)
  }

  private async _attempt(event: FeedbackEventInput): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )

    try {
      const res = await fetch(`${this.config.baseUrl}/v1/intelligence/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(event),
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(`IntelligenceOS API POST /v1/intelligence/feedback returned ${res.status}`)
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
