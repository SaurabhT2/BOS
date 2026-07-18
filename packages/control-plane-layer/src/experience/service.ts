/**
 * @brandos/control-plane-layer — experience/service.ts
 *
 * Cognitive Platform Evolution Program, Milestone 3 (Experience Loop),
 * EM-3.1 (Feedback Event HTTP Route) / EM-3.3 (Correction HTTP Route).
 *
 * CPL proxies for FeedbackEventClient.record() and CorrectionClient.record()
 * — same apps/web → CPL → cognition-client routing rule as
 * brand-memory/service.ts and workspace-configuration/service.ts enforce.
 */

import { getGlobalFeedbackEventClient, getGlobalCorrectionClient } from '@brandos/cognition-client'
import type { FeedbackEventInput, CorrectionInput } from '@brandos/cognition-client'

export type { FeedbackEventInput, CorrectionInput }

/**
 * recordArtifactFeedback — report an accept/edit/reject/deploy/explicit-
 * feedback event to IntelligenceOS.
 * Proxy for: IntelligenceOS.recordFeedbackEvent()
 *
 * Fire-and-forget-tolerant: returns without throwing when unconfigured or
 * on failure — same posture as syncWorkspaceConfiguration and
 * recordBrandMemoryObservation. A feedback-recording failure must never
 * fail the user-facing action (accepting/editing/rejecting/deploying an
 * artifact, or submitting explicit feedback) that produced it.
 */
export async function recordArtifactFeedback(event: FeedbackEventInput): Promise<void> {
  const client = getGlobalFeedbackEventClient()
  if (!client) {
    console.warn('[control-plane-layer] recordArtifactFeedback: no FeedbackEventClient configured — skipping')
    return
  }
  try {
    await client.record(event)
  } catch (err) {
    console.error('[control-plane-layer] recordArtifactFeedback failed:', err)
  }
}

/**
 * recordUserCorrection — report a correction to IntelligenceOS.
 * Proxy for: IntelligenceOS.recordCorrection()
 *
 * Same fire-and-forget-tolerant posture as recordArtifactFeedback above.
 */
export async function recordUserCorrection(correction: CorrectionInput): Promise<void> {
  const client = getGlobalCorrectionClient()
  if (!client) {
    console.warn('[control-plane-layer] recordUserCorrection: no CorrectionClient configured — skipping')
    return
  }
  try {
    await client.record(correction)
  } catch (err) {
    console.error('[control-plane-layer] recordUserCorrection failed:', err)
  }
}
