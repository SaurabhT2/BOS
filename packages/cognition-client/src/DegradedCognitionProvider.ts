/**
 * @brandos/cognition-client — src/DegradedCognitionProvider.ts
 *
 * A CognitionProvider implementation for when IntelligenceOS isn't
 * configured at all in this environment (no INTELLIGENCE_OS_API_URL /
 * INTELLIGENCE_OS_API_KEY) — as opposed to HttpCognitionProvider's own
 * internal degraded-mode fallback, which handles the *different* case of
 * "a real client is configured, but a specific HTTP call to it failed."
 *
 * Both cases produce the same CognitionContext shape
 * (createDegradedCognitionContext) so nothing downstream needs to know
 * which kind of degradation occurred. The difference is this class never
 * attempts network I/O in the first place — there is nowhere to attempt
 * it, since no baseUrl/apiKey exist to construct an HttpCognitionProvider
 * with.
 *
 * Registering this (via setGlobalCognitionClient) rather than leaving the
 * global client singleton unset is the whole point: getGlobalCognitionClient()
 * throws if nothing was ever registered, and CPLOrchestrator's constructor
 * calls it unconditionally. Every environment must register *some*
 * CognitionProvider at startup — a real one when IntelligenceOS is
 * configured, this one when it isn't — so getGlobalCognitionClient() can
 * never throw during a normal generation request.
 */

import type {
  CognitionContext,
  CognitionHealth,
  CognitionProvider,
  CognitionRequest,
  CognitionReviewDecision,
  CognitionSummary,
  ObservationInput,
} from '@platform/cognition-contract'
import { createDegradedCognitionContext } from '@platform/cognition-contract'
import { Logger } from '@brandos/shared-utils'

const logger = new Logger('info')

export class DegradedCognitionProvider implements CognitionProvider {
  async resolveCognitionContext(request: CognitionRequest): Promise<CognitionContext> {
    // No network call attempted — there's no baseUrl/apiKey to call.
    // Same fallback shape HttpCognitionProvider itself returns on a failed
    // HTTP call, so downstream code (PersonaContributor, etc.) sees
    // identical data regardless of which kind of degradation occurred.
    return createDegradedCognitionContext(request.workspaceId)
  }

  async observe(input: ObservationInput): Promise<void> {
    // Fire-and-forget by contract — must never fail the generation path
    // that triggered it. Nothing to send it to, so it's dropped, same as
    // HttpCognitionProvider does on its own observe() failures.
    logger.warn('[DegradedCognitionProvider] observe() dropped — IntelligenceOS not configured', {
      workspaceId: input.workspaceId,
      requestId: input.requestId,
    })
  }

  async review(decision: CognitionReviewDecision): Promise<void> {
    // Human-driven, out-of-band action (e.g. an admin approving a learned
    // signal) — not in the generation hot path. Dropped rather than thrown
    // for the same reason observe() is: there is no IntelligenceOS to
    // review anything, in an environment that was never configured to
    // have one.
    logger.warn('[DegradedCognitionProvider] review() dropped — IntelligenceOS not configured', {
      workspaceId: decision.workspaceId,
      entryId: decision.entryId,
    })
  }

  async summarizeCognition(_workspaceId: string): Promise<CognitionSummary> {
    // Display-only surface (e.g. a brand profile page) — an empty summary
    // renders as "nothing learned yet," which is accurate, rather than
    // throwing and breaking the page.
    return {
      preferredTone: null,
      audience: null,
      industry: null,
      positioning: null,
      keywords: null,
    }
  }

  async checkHealth(): Promise<CognitionHealth> {
    return {
      healthy: false,
      degradedReason: 'IntelligenceOS not configured (INTELLIGENCE_OS_API_URL / INTELLIGENCE_OS_API_KEY not set)',
    }
  }
}
