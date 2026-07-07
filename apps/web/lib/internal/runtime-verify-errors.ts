/**
 * apps/web/lib/internal/runtime-verify-errors.ts
 *
 * Classifies errors thrown by the real generation pipeline
 * (runControlPlane / executeArtifactPipeline) into transient-infrastructure
 * conditions (rate limit, circuit breaker, all-providers-failed) vs genuine
 * bugs — so a route can respond with a status code the verifier can act on,
 * instead of every failure looking like an undifferentiated 500.
 *
 * THIS FILE DOES NOT TOUCH THE PRODUCTION RUNTIME. It only inspects the
 * already-thrown Error's message after the fact. The classification below
 * is grounded in the actual strings the runtime produces today:
 *
 *   - packages/ai-runtime-layer/src/runtime-engine/index.ts:
 *       `Rate limit exceeded: ${rateCheck.reason}`        (RATE_LIMITED)
 *       `Circuit breaker open for ${attempt.provider}`     (CIRCUIT_OPEN)
 *       `'All providers in the fallback chain failed'`     (terminal_failure)
 *   - packages/ai-runtime-layer/src/llmRouter.ts:
 *       wraps the above into UnavailableResponse.message via makeUnavailable()
 *   - packages/control-plane-layer/src/orchestrator.ts:
 *       `[CPLOrchestrator] AI runtime unavailable: ${runtimeResult.message}`
 *       (this is the actual thrown Error our service layer catches)
 *
 * If any of those source strings are ever reworded, this classifier should
 * be updated alongside them — it is intentionally string-matching the
 * production runtime's OWN vocabulary rather than inventing a parallel one,
 * so there is exactly one place that has to change.
 *
 * HONEST LIMITATION: the production runtime does not currently propagate a
 * numeric retry-after duration for RATE LIMITING through this throw path
 * (RateLimitResult.retry_after_ms is computed in shared-utils's RateLimiter
 * but is dropped before it reaches the orchestrator's thrown Error —
 * verified directly in source, not assumed). retryAfterSeconds below is
 * therefore usually undefined today for rate-limit classifications; the
 * field exists so this becomes forward-compatible the moment that's fixed,
 * without changing this classifier's callers. CIRCUIT BREAKER timing does
 * not have this limitation — `AdminSettingsService.getCircuitBreakerConfig()`
 * already exposes the live reset window (see circuitResetMs below).
 */

import { AdminSettingsService } from '@brandos/control-plane-layer'

export type TransientErrorKind = 'rate_limited' | 'circuit_open' | 'all_providers_failed' | 'none'

export interface TransientErrorClassification {
  kind: TransientErrorKind
  /** True for rate_limited/circuit_open/all_providers_failed; false for 'none' (a genuine bug). */
  retryable: boolean
  /** The original error message, preserved for the report's root-cause field. */
  message: string
  /**
   * Seconds to wait before retrying, when the runtime told us explicitly.
   * Usually undefined today — see HONEST LIMITATION above. Callers should
   * fall back to exponential backoff (15s → 30s → 60s) when this is absent.
   */
  retryAfterSeconds?: number
  /**
   * For circuit_open specifically: the circuit breaker's configured reset
   * window in ms, so callers know the EARLIEST a retry could possibly
   * succeed. Sourced live from `AdminSettingsService.getCircuitBreakerConfig()`
   * (control-plane-layer's own public accessor — `reset_ms:
   * this.getAIRuntime().circuitBreakerCooldown * 1000`), not hardcoded, so
   * this stays correct if an admin changes the cooldown. Falls back to the
   * ai-runtime-layer factory default (60_000ms — see
   * packages/ai-runtime-layer/src/config/factory.ts
   * `new CircuitBreaker({ threshold: 3, reset_ms: 60_000 })`) only if
   * AdminSettingsService itself is unavailable.
   */
  circuitResetMs?: number
}

/** Fallback only — see circuitResetMs doc above for why the live value is preferred. */
export const CIRCUIT_BREAKER_FALLBACK_RESET_MS = 60_000

/**
 * getLiveCircuitResetMs — reads the circuit breaker's configured reset
 * window from the live AdminSettingsService, falling back to the documented
 * ai-runtime-layer factory default if that read fails for any reason (e.g.
 * settings not yet hydrated). Never throws.
 */
export function getLiveCircuitResetMs(): number {
  try {
    return AdminSettingsService.getCircuitBreakerConfig().reset_ms
  } catch {
    return CIRCUIT_BREAKER_FALLBACK_RESET_MS
  }
}

/**
 * classifyTransientError — inspect a caught error and decide whether it
 * represents a transient infrastructure condition the verifier should
 * retry, or a genuine failure that should be reported immediately.
 */
export function classifyTransientError(err: unknown): TransientErrorClassification {
  const message = err instanceof Error ? err.message : String(err)

  if (/circuit breaker open/i.test(message)) {
    return {
      kind: 'circuit_open',
      retryable: true,
      message,
      circuitResetMs: getLiveCircuitResetMs(),
    }
  }

  if (/rate limit exceeded/i.test(message)) {
    return {
      kind: 'rate_limited',
      retryable: true,
      message,
      retryAfterSeconds: extractRetryAfterSeconds(message),
    }
  }

  if (/all providers in the fallback chain failed/i.test(message) || /ai runtime unavailable/i.test(message)) {
    return {
      kind: 'all_providers_failed',
      retryable: true,
      message,
    }
  }

  return { kind: 'none', retryable: false, message }
}

/**
 * extractRetryAfterSeconds — best-effort parse of a retry-after duration
 * from an error message, for forward-compatibility with a future runtime
 * change that includes one (see HONEST LIMITATION above — today's runtime
 * does not). Recognizes "retry after Ns" / "retry_after_ms: N" patterns;
 * returns undefined rather than guessing when no such pattern is present.
 */
function extractRetryAfterSeconds(message: string): number | undefined {
  const secondsMatch = message.match(/retry[\s_-]?after[\s_-]?(\d+(?:\.\d+)?)\s*s/i)
  if (secondsMatch) return Number(secondsMatch[1])

  const msMatch = message.match(/retry[\s_-]?after[\s_-]?ms[:\s]+(\d+)/i)
  if (msMatch) return Number(msMatch[1]) / 1000

  return undefined
}

/** HTTP status this classification should be reported as, for a route's catch block. */
export function statusForTransientError(kind: TransientErrorKind): number {
  switch (kind) {
    case 'rate_limited':
      return 429
    case 'circuit_open':
    case 'all_providers_failed':
      return 503
    default:
      return 500
  }
}
