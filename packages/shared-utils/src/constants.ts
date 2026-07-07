// ============================================================
// @brandos/shared-utils — constants.ts
//
// PURPOSE:
//   Monorepo-wide constants that cross package boundaries.
//   All values are `as const` — never mutable at runtime.
//
// ARCHITECTURE:
//   This file has zero imports. It exports pure compile-time
//   constants used by multiple packages. Keeping constants
//   centralised here prevents magic-number drift and makes
//   global tuning (e.g. timeout adjustments) a single-file change.
//
// INVARIANTS:
//   - No imports from any package
//   - All exported values are `as const` (readonly deep)
//   - Do not add functions or classes here — only constants
//
// AGENT NOTES:
//   When changing numeric values, search for consuming packages first:
//     grep -r "DEFAULT_TIMEOUTS\|DEFAULT_RETRY\|BRANDOS_VERSION" packages/ apps/ -l
// ============================================================

/**
 * BRANDOS_VERSION — current monorepo version.
 *
 * Used for telemetry tagging, API response headers, and
 * compatibility checks in provider adapters.
 *
 * This value is NOT automatically synchronised with package.json
 * versions — update manually on minor/major releases.
 */
export const BRANDOS_VERSION = "3.0.0";

/**
 * DEFAULT_TIMEOUTS — HTTP/Promise timeout presets in milliseconds.
 *
 * Choose the preset that matches the operation's expected latency:
 *
 * `local` (60s)  — On-machine inference (Ollama, LM Studio).
 *   Local models can be slow on first load but are not network-bound.
 *   60s accommodates cold-start model loading.
 *
 * `cloud` (30s)  — External AI provider API calls.
 *   30s is generous for most providers. Reduce to 15s for latency-
 *   sensitive paths where a slow provider should fail fast.
 *
 * `export` (120s) — PPTX/PDF rendering operations.
 *   Export is CPU-bound on complex decks. 120s prevents premature
 *   timeouts on large presentations while still bounding runaway jobs.
 *
 * USAGE:
 *   import { DEFAULT_TIMEOUTS } from '@brandos/shared-utils';
 *   const controller = new AbortController();
 *   setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.cloud);
 */
export const DEFAULT_TIMEOUTS = {
  local: 60_000,
  cloud: 30_000,
  export: 120_000,
} as const;

/**
 * DEFAULT_RETRY — retry defaults for use with withRetry().
 *
 * These values are conservative production-safe defaults that avoid
 * overwhelming failing services while giving transient errors time to resolve.
 *
 * `count` (3)         — 1 initial call + 2 retries.
 *   3 total attempts is the industry standard for API resilience.
 *   Reduce to 1 (no retries) for idempotency-unsafe write operations.
 *
 * `backoffMs` (500)   — Base delay before the first retry.
 *   With exponential doubling: 500ms → 1000ms → 2000ms (before jitter).
 *
 * `maxBackoffMs` (10s) — Hard ceiling on backoff delay.
 *   Prevents the backoff from growing unboundedly on long retry chains.
 *   Note: withRetry() defaults to 30s; this constant is more conservative.
 *
 * USAGE:
 *   import { DEFAULT_RETRY } from '@brandos/shared-utils';
 *   await withRetry(fn, {
 *     attempts: DEFAULT_RETRY.count,
 *     backoffMs: DEFAULT_RETRY.backoffMs,
 *     maxBackoffMs: DEFAULT_RETRY.maxBackoffMs,
 *   });
 */
export const DEFAULT_RETRY = {
  count: 3,
  backoffMs: 500,
  maxBackoffMs: 10_000,
} as const;

/**
 * LOG_LEVELS — ordered tuple of all valid log level strings.
 *
 * Use for validating user-supplied log level config:
 *   if (!LOG_LEVELS.includes(userLevel)) throw new Error('Invalid log level');
 *
 * The type `typeof LOG_LEVELS[number]` is the LogLevel union type,
 * equivalent to "silent" | "error" | "warn" | "info" | "debug".
 */
export const LOG_LEVELS = ["silent", "error", "warn", "info", "debug"] as const;


