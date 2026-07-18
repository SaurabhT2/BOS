/**
 * @platform/cognition-contract — CognitionProvider.ts
 *
 * The complete behavioral surface between BrandOS and IntelligenceOS.
 * Exactly four operations. Per INTELLIGENCE_PLATFORM_IMPLEMENTATION.md §3:
 * if a new need doesn't fit one of these four, the answer is a richer
 * CognitionContext (see CognitionContext.ts), not a fifth method.
 *
 * BrandOS's `@brandos/cognition-client` package is the ONLY BrandOS package
 * that may hold a concrete CognitionProvider. IntelligenceOS's `api/`
 * module is the only place that may implement it. No other package in
 * either repository may depend on this interface directly.
 *
 * Option B (cognition-consumer split): review() and CognitionReviewDecision
 * have been removed from this BrandOS-local contract. BrandOS no longer
 * exposes, reviews, or passes through decisions about raw learning signals
 * or raw memory — that responsibility belongs entirely to IntelligenceOS.
 * If IntelligenceOS needs a review surface, it is IntelligenceOS's own
 * concern and out of scope for BrandOS's copy of this contract.
 */

import type {
  CognitionContext,
  CognitionHealth,
  CognitionRequest,
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
   * 3. Summarize — a display-ready summary for BrandOS UI surfaces (e.g. a
   * brand profile page). Not for driving generation — use
   * resolveCognitionContext for that.
   */
  summarizeCognition(workspaceId: string): Promise<CognitionSummary>

  /**
   * 4. Health — whether IntelligenceOS can currently serve requests, so
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
    contractVersion: '1.1.0',
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
    // ADR-004 (Cognitive Consolidation) — degraded mode has nothing
    // synthesized, the same honest null identity/visualIdentity above
    // already establish.
    knowledge: null,
    reasoning: null,
    positioning: null,
  }
}
