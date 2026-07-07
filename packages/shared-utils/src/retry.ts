// ============================================================
// @brandos/shared-utils — retry.ts
//
// PURPOSE:
//   Canonical exponential-backoff retry primitive for the BrandOS
//   monorepo. Every layer that needs retry logic MUST use this
//   function — no duplicate backoff implementations are permitted.
//
// ARCHITECTURE:
//   - withRetry<T>() is a pure async function. It has no global state
//     and no side effects beyond the provided onRetry callback.
//   - retryOptionsFromBudget() translates a RetryBudget-shaped plain
//     object into RetryOptions. It intentionally does NOT import
//     RetryBudget from @brandos/contracts to avoid creating a
//     type-coupling risk in circular-dependency scenarios.
//
// BACKOFF FORMULA:
//   base  = min(backoffMs × 2^i, maxBackoffMs)
//   delay = min(base × (1 + (rand*2 - 1) × jitter), maxBackoffMs)
//
//   With defaults (backoffMs=500, jitter=0.2):
//     attempt 1: ~500ms ± 20%  (400–600ms)
//     attempt 2: ~1000ms ± 20% (800–1200ms)
//     attempt 3: ~2000ms ± 20% (1600–2400ms)
//
// INVARIANTS:
//   - withRetry is the ONLY canonical retry primitive — no copies
//   - retryOptionsFromBudget uses duck typing, NOT RetryBudget import
//   - Both functions are stateless and have no module-level side effects
// ============================================================

import type { IRetryOptions, IRetryBudgetInput } from "./ISharedUtils";

/**
 * RetryOptions — re-exported from ISharedUtils for consumer convenience.
 * Callers may `import type { RetryOptions } from '@brandos/shared-utils'`.
 */
export type RetryOptions = IRetryOptions;

/**
 * withRetry — execute an async function with exponential-backoff retries.
 *
 * @param fn       - The async operation to execute. Called on every attempt.
 * @param options  - Retry configuration. All fields are optional with
 *                   production-safe defaults.
 * @returns        The resolved value of `fn` on the first successful attempt.
 * @throws         The last error after all attempts are exhausted, or the
 *                 first non-retryable error if `isRetryable` returns false.
 *
 * USAGE EXAMPLE — provider call with full options:
 *
 *   const result = await withRetry(
 *     () => providerAdapter.invoke(request),
 *     {
 *       attempts: 3,
 *       backoffMs: 500,
 *       isRetryable: (err) => !(err instanceof ValidationError),
 *       onRetry: (attempt, err) => log.warn('Retry', { attempt, err }),
 *     }
 *   );
 *
 * IMPORTANT EDGE CASES:
 *   - If `fn` succeeds on the first call, no backoff delay is ever applied.
 *   - If `isRetryable(err)` returns false, the error is rethrown immediately
 *     regardless of remaining budget. This is the fast-fail path.
 *   - `attempts: 1` disables retries entirely (only the initial call runs).
 *   - The delay is always capped at `maxBackoffMs` even with jitter.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    attempts = 3,
    backoffMs = 500,
    maxBackoffMs = 30_000,
    jitter = 0.2,
    onRetry,
    isRetryable,
    getDelayMs,
  } = options;

  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      // Attempt the operation — success returns immediately
      return await fn();
    } catch (err) {
      lastError = err;

      // Fast-fail path: non-retryable errors skip remaining budget
      // Example: 400 Bad Request should never be retried — rethrow now
      if (isRetryable && !isRetryable(err)) {
        throw err;
      }

      // If this was the last attempt, fall through to throw lastError
      if (i < attempts - 1) {
        // Notify caller before sleeping — useful for telemetry and logging
        onRetry?.(i + 1, err);

        // Exponential backoff: doubles each retry, capped at maxBackoffMs
        const base = Math.min(backoffMs * Math.pow(2, i), maxBackoffMs);

        // Jitter prevents thundering-herd: ±jitter% of the computed base
        // jitter=0 → deterministic; jitter=0.2 → ±20% randomisation
        const jitterFactor = jitter > 0 ? 1 + (Math.random() * 2 - 1) * jitter : 1;
        const defaultDelay = Math.min(base * jitterFactor, maxBackoffMs);

        // P0-GROQ-RETRY-FIX: honour a server-supplied backoff hint when the
        // caller provides one (e.g. a 429's Retry-After header, surfaced as
        // err.retryAfterMs). Previously this hint was only logged — the
        // sleep below always used the exponential formula, so retries after
        // a rate-limit error fired long before the provider's window reset
        // and deterministically failed again. Falls back to defaultDelay
        // (and is still capped at maxBackoffMs) when the hook returns
        // undefined or isn't provided.
        const hinted = getDelayMs?.(err, i, defaultDelay);
        const delay = Math.min(hinted ?? defaultDelay, maxBackoffMs);

        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // All attempts exhausted — throw the last error seen
  throw lastError;
}

/**
 * retryOptionsFromBudget — translate a RetryBudget-shaped config into RetryOptions.
 *
 * IMPORTANT: This function uses structural duck typing (IRetryBudgetInput) rather
 * than importing the `RetryBudget` interface from @brandos/contracts. This avoids
 * creating a hard type coupling that could cause circular-dependency issues in
 * build configurations where contracts is not yet compiled.
 *
 * The shape is intentionally compatible with RetryBudget from airuntime-types.ts:
 *   { max_total_attempts: number; backoff_ms: number }
 *
 * Consumers that hold a `RetryBudget` object can pass it directly — TypeScript
 * will accept it via structural subtyping without an explicit cast.
 *
 * USAGE:
 *   // In ai-runtime-layer, runtimeConfig.retry_budget is a RetryBudget
 *   const opts = retryOptionsFromBudget(runtimeConfig.retry_budget);
 *   const result = await withRetry(() => adapter.invoke(req), opts);
 */
export function retryOptionsFromBudget(budget: IRetryBudgetInput): RetryOptions {
  return {
    attempts: budget.max_total_attempts,
    backoffMs: budget.backoff_ms,
    // Hard ceiling stays at the monorepo default — never longer than 30s
    maxBackoffMs: 30_000,
    // Standard jitter — prevents thundering-herd on simultaneous budget-exhausted callers
    jitter: 0.2,
  };
}


