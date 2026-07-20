/**
 * @brandos/cognition-client — src/retryPolicy.ts
 *
 * G-14 (Architecture Verification Report, P1) — "start narrow" slice.
 * Internal-only (not exported from index.ts) — shared by every client in
 * this package, unlike the wire-shape types (KnowledgeAssetIngestInput,
 * CorrectionInput, etc.), which are deliberately duplicated per the
 * cross-repository convention documented on each of those types. This is
 * intra-package sharing, not a cross-repo boundary, so a single shared
 * helper is the right call here — no reason to hand-roll the same
 * isRetryable predicate five times.
 *
 * SCOPE: this is the retry-wrapper extension explicitly recommended as
 * step 1 of G-14's approach — NOT the "durable delivery guarantee" (outbox
 * table / queue) the finding explicitly scopes out as a separate, larger
 * follow-on. A cognition-client call whose retries are all exhausted still
 * has nowhere to land except its caller's existing fire-and-forget
 * catch-and-log — exactly as before this change, just less likely to be
 * needed in the first place.
 *
 * IDEMPOTENCY CAVEAT (residual, known, deliberately not solved here): none
 * of these HTTP calls carry a request-level idempotency key. If a call's
 * response is lost after IntelligenceOS already processed it server-side
 * (e.g. the connection drops on the way back), a retry cannot distinguish
 * that from "never received" and will resubmit — for
 * observe()/record()/record(), this means a rare possible duplicate
 * signal/feedback/correction row (bounded, self-correcting: the Learning
 * Pipeline's corroboration-count model tolerates an occasional duplicate
 * observation without materially skewing confidence). Solving this
 * properly needs a server-side idempotency key, which is squarely
 * "durable delivery guarantee" territory — out of scope for this narrow
 * slice, called out explicitly rather than silently accepted.
 */

import type { RetryOptions } from '@brandos/shared-utils'

/**
 * Retryable iff the failure could plausibly succeed on a second attempt:
 * network-level failures, aborts/timeouts, and 5xx server responses. NOT
 * retryable: 4xx client errors (a validation/auth failure will fail
 * identically on retry — wasting the retry budget and adding latency for
 * no chance of success), EXCEPT 429 (rate limited — the one 4xx that a
 * backoff-and-retry genuinely helps with).
 *
 * Every client in this package throws a generic `Error` with a message of
 * the form `IntelligenceOS API <METHOD> <path> returned <status>` for any
 * non-ok HTTP response (see each client's `_request`/inline fetch
 * wrapper) — there is no structured error type to switch on, so this
 * parses the status code back out of that message. Falls back to
 * "retryable" for anything that doesn't match that shape (network errors,
 * AbortError on timeout, etc.) — those are exactly the transient failures
 * retries exist for.
 */
export function isRetryableCognitionTransportError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  const match = /returned (\d{3})$/.exec(message)
  if (!match) return true // network error / timeout / abort — retryable

  const status = Number(match[1])
  if (status === 429) return true
  return status >= 500
}

/**
 * Fire-and-forget calls (observe, feedback, correction): short per-attempt
 * timeout already set by each client (5s), so a modest attempt count keeps
 * worst-case background completion time bounded (~5-10s) without
 * meaningfully changing anything from the caller's point of view — these
 * are already `void`-called and were never awaited.
 */
export const FIRE_AND_FORGET_RETRY_OPTIONS: RetryOptions = {
  attempts: 2,
  backoffMs: 300,
  maxBackoffMs: 2000,
  isRetryable: isRetryableCognitionTransportError,
}

/**
 * Knowledge ingestion: each attempt already carries a 30s timeout (see
 * KnowledgeIngestClient's own docblock — IntelligenceOS's extraction
 * pipeline runs synchronously server-side). A second attempt on top of
 * that is already a meaningful worst-case wait (~60s+), so this stays at
 * 2 attempts, not 3 — this is fire-and-forget from the upload route's
 * point of view (see G-25), so the wait itself is invisible to the user,
 * but an unbounded attempt count would let a single stuck asset occupy
 * resources indefinitely.
 */
export const KNOWLEDGE_INGEST_RETRY_OPTIONS: RetryOptions = {
  attempts: 2,
  backoffMs: 1000,
  maxBackoffMs: 5000,
  isRetryable: isRetryableCognitionTransportError,
}
