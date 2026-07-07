/**
 * apps/web/lib/server-analytics.ts
 *
 * Server-side analytics bridge (stub).
 *
 * All functions are intentional no-ops pending @brandos/telemetry-store integration.
 * trackServer() is the canonical server-side event function used by route handlers.
 *
 * Migration target: @brandos/telemetry-store (Phase 3)
 *
 * DO NOT import posthog-node here until telemetry-store is wired — keep this
 * stub so routes compile and ship without a PostHog key requirement.
 */

export async function trackServer(
  _userId: string,
  _event: string,
  _properties?: Record<string, unknown>
): Promise<void> {
  // no-op — replace with @brandos/telemetry-store.trackServer() in Phase 3
}

/** @deprecated Use trackServer() instead. Kept for backward compatibility. */
export async function trackGeneration(..._args: unknown[]): Promise<void> {
  // no-op
}

/** @deprecated Not called from any live route. Retained for compatibility. */
export async function trackEvent(..._args: unknown[]): Promise<void> {
  // no-op
}

/** @deprecated Not called from any live route. Returns stub zeros. */
export async function getAnalyticsSummary() {
  return {
    totalGenerations: 0,
    avgLatency: 0,
    successRate: 100,
    experiments: [],
  }
}


