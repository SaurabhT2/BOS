/**
 * @platform/cognition-contract — CognitionProvider.ts
 *
 * The complete behavioral surface between BrandOS and IntelligenceOS.
 * Exactly five operations. Per INTELLIGENCE_PLATFORM_IMPLEMENTATION.md §3:
 * if a new need doesn't fit one of these five, the answer is a richer
 * CognitionContext (see CognitionContext.ts), not a sixth method.
 *
 * BrandOS's `@brandos/cognition-client` package is the ONLY BrandOS package
 * that may hold a concrete CognitionProvider. IntelligenceOS's `api/`
 * module is the only place that may implement it. No other package in
 * either repository may depend on this interface directly.
 *
 * See this package's README, "Known contract gaps", for two product
 * surfaces (raw-signal review UI, explicit persona/brand-voice
 * configuration ingestion) that do not yet have a home in this interface
 * and require an explicit decision before they can be fully migrated.
 */

import type {
  CognitionContext,
  CognitionHealth,
  CognitionRequest,
  CognitionReviewDecision,
  CognitionSummary,
  ObservationInput,
} from './CognitionContext'

export interface CognitionProvider {
  /**
   * 1. Resolve — the primary read path. Returns the complete, immutable
   * CognitionContext for a workspace. Called once per generation request,
   * synchronously in the critical path.
   */
  resolveCognitionContext(request: CognitionRequest): Promise<CognitionContext>

  /**
   * 2. Observe — report what happened. Fire-and-forget from BrandOS's
   * point of view; IntelligenceOS decides what, if anything, to learn from
   * it. Must never block or fail the generation path that triggered it.
   */
  observe(input: ObservationInput): Promise<void>

  /**
   * 3. Review — pass through a human decision about previously surfaced
   * cognitive material. BrandOS supplies only an opaque entryId; it never
   * interprets what the entry contains.
   */
  review(decision: CognitionReviewDecision): Promise<void>

  /**
   * 4. Summarize — a display-ready summary for BrandOS UI surfaces (e.g. a
   * brand profile page). Not for driving generation — use
   * resolveCognitionContext for that.
   */
  summarizeCognition(workspaceId: string): Promise<CognitionSummary>

  /**
   * 5. Health — whether IntelligenceOS can currently serve requests, so
   * BrandOS can apply its own degraded-mode handling.
   */
  checkHealth(): Promise<CognitionHealth>
}

/**
 * The CognitionContext BrandOS must fall back to when IntelligenceOS is
 * unavailable, degraded, or times out. Pure data — constructing this value
 * performs no reasoning and calls no cognition capability.
 *
 * Kept in the contract package (rather than in `@brandos/cognition-client`)
 * because IntelligenceOS's own tests, and any other future consumer of
 * this contract, need the exact same fallback shape without depending on
 * BrandOS's adapter package.
 */
export function createDegradedCognitionContext(workspaceId: string): CognitionContext {
  return {
    contractVersion: '1.0.0',
    workspaceId,
    resolvedAt: new Date().toISOString(),
    confidence: 'degraded',
    voice: {
      tone: 'professional',
      cadence: 'medium',
      audienceType: 'general',
      executiveLevel: false,
      domain: 'general',
      bannedPhrases: [],
    },
    identity: null,
    visualIdentity: null,
    provenance: {
      signalCount: 0,
      lastConsolidatedAt: null,
    },
  }
}
