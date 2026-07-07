// ============================================================
// @brandos/shared-utils — ISharedUtils.ts
//
// PUBLIC INTERFACE BOUNDARY FILE
//
// PURPOSE:
//   This file is the strict, documented, agent-readable boundary
//   for the @brandos/shared-utils package. It declares every
//   public surface as named interface groups, documents invariants,
//   and serves as the single source of truth for what dependent
//   layers may rely on.
//
// RULES FOR THIS FILE:
//   1. Never add implementation logic here — type declarations only.
//   2. Never import from any @brandos/* package other than contracts.
//   3. Every interface group corresponds to one functional domain.
//   4. Keep method signatures 100% in sync with their implementation.
//
// CONSUMERS:
//   Import from '@brandos/shared-utils' (index.ts), NOT from this
//   file directly. This file exists for documentation and boundary
//   auditing — index.ts is the runtime entry point.
//
// AGENT NOTES:
//   When modifying a public method in any implementation file, you
//   MUST update the corresponding interface here first, then verify
//   the implementation satisfies it. The ISharedUtils.test.ts file
//   enforces interface satisfaction at compile time.
//
// Wave 2: Groups G (ISkillHealthShim) and H (IArtifactCompareShim) removed.
//   computeSkillHealth, healthSummary  → @brandos/iskill-runtime
//   hashArtifact, compareArtifacts     → @brandos/artifact-engine-layer
// ============================================================

import type {
  ICircuitBreaker,
  IRateLimiter,
  ICostTracker,
  CostSummary,
  RateLimitResult,
  ProviderName,
} from "@brandos/contracts";

// ─────────────────────────────────────────────────────────────
// GROUP A — LOGGER
// ─────────────────────────────────────────────────────────────

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export interface ILogger {
  error(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
  child(tag: string): ILogger;
}

// ─────────────────────────────────────────────────────────────
// GROUP B — RETRY
// ─────────────────────────────────────────────────────────────

export interface IRetryOptions {
  attempts?: number | undefined;
  backoffMs?: number | undefined;
  maxBackoffMs?: number | undefined;
  jitter?: number | undefined;
  onRetry?: ((attempt: number, error: unknown) => void) | undefined;
  isRetryable?: ((error: unknown) => boolean) | undefined;
  /**
   * P0-GROQ-RETRY-FIX: optional per-attempt delay override.
   *
   * When provided, withRetry calls this before computing the default
   * exponential-backoff delay. If it returns a number, that value (capped at
   * maxBackoffMs) is used as the sleep duration instead of the exponential
   * formula. Return undefined to fall back to the default backoff.
   *
   * This lets callers honour server-supplied backoff hints (e.g. a 429
   * response's Retry-After / x-ratelimit-reset-* headers, surfaced on the
   * thrown error as `retryAfterMs`) instead of always retrying on a fixed
   * exponential schedule that may be far shorter than the server requires.
   */
  getDelayMs?: ((error: unknown, attemptIndex: number, defaultDelayMs: number) => number | undefined) | undefined;
}

export interface IRetryBudgetInput {
  max_total_attempts: number;
  backoff_ms: number;
}

// ─────────────────────────────────────────────────────────────
// GROUP C — CIRCUIT BREAKER
// ─────────────────────────────────────────────────────────────

export interface ICircuitBreakerConfig {
  threshold?: number;
  reset_ms?: number;
}

export interface ICircuitBreakerSnapshot {
  state: "closed" | "open" | "half-open";
  failures: number;
}

export interface ICircuitBreakerPublic extends ICircuitBreaker {
  reset(provider: ProviderName): void;
  snapshot(): Record<string, ICircuitBreakerSnapshot>;
}

// ─────────────────────────────────────────────────────────────
// GROUP D — RATE LIMITER
// ─────────────────────────────────────────────────────────────

export interface IRateLimitConfig {
  rpm: number;
  tpm: number;
}

export interface IRateLimiterStats {
  requestsThisMinute: number;
  tokensThisMinute: number;
  rpm: number;
  tpm: number;
}

export interface IRateLimiterPublic extends IRateLimiter {
  getStats(provider: ProviderName): IRateLimiterStats;
}

// ─────────────────────────────────────────────────────────────
// GROUP E — COST TRACKER
// ─────────────────────────────────────────────────────────────

export interface ICostEntry {
  provider: ProviderName;
  tokens: number;
  cost_usd: number;
  request_id: string;
  timestamp: number;
}

export interface ICostTrackerPublic extends ICostTracker {
  estimate(provider: ProviderName, tokens: number): number;
  record(provider: ProviderName, tokens: number, requestId: string): number;
  withinBudget(additionalCost?: number): boolean;
  summary(): CostSummary;
  getHistory(): ICostEntry[];
}

// ─────────────────────────────────────────────────────────────
// GROUP F — ENVIRONMENT VALIDATION
// ─────────────────────────────────────────────────────────────

export interface IEnvValidationResult {
  valid: boolean;
  missing_required: string[];
  missing_optional: string[];
  ai_providers_configured: string[];
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────
// GROUP G — CONSTANTS
// ─────────────────────────────────────────────────────────────

export interface IDefaultTimeouts {
  readonly local: number;
  readonly cloud: number;
  readonly export: number;
}

export interface IDefaultRetry {
  readonly count: number;
  readonly backoffMs: number;
  readonly maxBackoffMs: number;
}


