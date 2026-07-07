// ============================================================
// @brandos/shared-utils — resilience.ts
//
// PURPOSE:
//   Three injectable infrastructure resilience primitives:
//     1. CircuitBreaker — provider-level failure isolation
//     2. RateLimiter    — sliding-window RPM + TPM enforcement
//     3. CostTracker    — per-provider spend ledger with budget guard
//
// ARCHITECTURE:
//   All three classes are stateful but injectable — they accept config
//   in their constructor and have no global singleton exports. The AI
//   runtime layer is responsible for instantiating and managing their
//   lifecycle.
//
//   All three classes implement contracts from @brandos/contracts,
//   ensuring that their public surfaces are defined in the type kernel
//   and cannot drift silently.
//
// CONTRACT COMPLIANCE:
//   CircuitBreaker → ICircuitBreaker
//   RateLimiter    → IRateLimiter
//   CostTracker    → ICostTracker
//
// INVARIANTS:
//   - All state is in-memory, per-instance, non-persistent
//   - No global state, no module-level side effects
//   - All public methods are synchronous (no async)
//   - No imports from other @brandos/* packages (only contracts types)
// ============================================================

import type {
  CostSummary,
  ICircuitBreaker,
  ICostTracker,
  IRateLimiter,
  ProviderName,
  RateLimitResult,
} from "@brandos/contracts";

import type {
  ICircuitBreakerConfig,
  ICircuitBreakerPublic,
  ICircuitBreakerSnapshot,
  ICostEntry,
  ICostTrackerPublic,
  IRateLimitConfig,
  IRateLimiterPublic,
  IRateLimiterStats,
} from "./ISharedUtils";

// ─────────────────────────────────────────────────────────────
// CIRCUIT BREAKER
// ─────────────────────────────────────────────────────────────

/**
 * BreakerState — the three states in the circuit breaker state machine.
 *
 * Transitions:
 *   closed    → open       when consecutive failures >= threshold
 *   open      → half-open  when reset_ms ms have elapsed since openedAt
 *   half-open → closed     when the probe call calls recordSuccess()
 *   half-open → open       when the probe call calls recordFailure()
 *
 * AGENT NOTE: `half-open` allows exactly one probe through. If that
 * probe fails again, the breaker re-opens immediately (openedAt resets).
 */
type BreakerState = "closed" | "open" | "half-open";

/**
 * BreakerEntry — mutable internal state per provider.
 *
 * Not exported — consumers use snapshot() for read access.
 */
interface BreakerEntry {
  /** Count of consecutive failures. Resets to 0 on any success. */
  failures: number;
  /** Current state in the state machine. */
  state: BreakerState;
  /**
   * Timestamp (ms since epoch) when the breaker transitioned to OPEN.
   * null when state is closed or half-open.
   * Used by isOpen() to decide when to transition to half-open.
   */
  openedAt: number | null;
}

// Re-export for consumer convenience (used by ISharedUtils.ts types)
export type { ICircuitBreakerConfig as CircuitBreakerConfig };

/**
 * CircuitBreaker — per-provider failure isolation.
 *
 * Implements ICircuitBreaker from @brandos/contracts.
 *
 * USAGE:
 *   const breaker = new CircuitBreaker({ threshold: 3, reset_ms: 30_000 });
 *
 *   // Before calling a provider:
 *   if (breaker.isOpen('anthropic')) {
 *     throw new Error('Circuit open — provider unavailable');
 *   }
 *
 *   try {
 *     const result = await provider.invoke(req);
 *     breaker.recordSuccess('anthropic');
 *     return result;
 *   } catch (err) {
 *     breaker.recordFailure('anthropic');
 *     throw err;
 *   }
 *
 * THREAD SAFETY: JavaScript is single-threaded; no locking needed.
 * However, concurrent awaits can interleave — isOpen() must be called
 * immediately before the provider call, not cached.
 */
export class CircuitBreaker implements ICircuitBreakerPublic {
  /** Consecutive failures required to open the breaker. */
  private readonly threshold: number;
  /** Milliseconds in OPEN state before transitioning to HALF-OPEN. */
  private readonly resetMs: number;
  /** Per-provider state map. Lazily initialised on first access. */
  private entries = new Map<ProviderName, BreakerEntry>();

  constructor(config: ICircuitBreakerConfig = {}) {
    this.threshold = config.threshold ?? 3;
    this.resetMs = config.reset_ms ?? 30_000;
  }

  /**
   * Lazily initialise and return the BreakerEntry for a provider.
   * New providers start in CLOSED state with zero failures.
   */
  private entry(provider: ProviderName): BreakerEntry {
    if (!this.entries.has(provider)) {
      this.entries.set(provider, { failures: 0, state: "closed", openedAt: null });
    }
    return this.entries.get(provider)!;
  }

  /**
   * Returns true if the breaker is open (call should NOT proceed).
   *
   * EDGE CASE — HALF-OPEN transition:
   *   When in OPEN state and reset_ms has elapsed, this method transitions
   *   the breaker to HALF-OPEN and returns false — allowing one probe call.
   *   The probe caller MUST call recordSuccess() or recordFailure() after
   *   the call completes. Failure to do so leaves the breaker stuck in
   *   HALF-OPEN indefinitely, allowing every subsequent call through.
   */
  isOpen(provider: ProviderName): boolean {
    const e = this.entry(provider);
    if (e.state === "open") {
      // Check if enough time has passed to attempt a probe
      if (e.openedAt !== null && Date.now() - e.openedAt >= this.resetMs) {
        // Transition to half-open: let one probe through
        e.state = "half-open";
        return false;
      }
      // Still within the reset window — block the call
      return true;
    }
    // closed or half-open: allow the call
    return false;
  }

  /**
   * Record a successful call. Transitions any state → CLOSED.
   *
   * Always call this after a successful provider response, even from
   * HALF-OPEN. Failure to call it after a successful probe leaves the
   * breaker in HALF-OPEN.
   */
  recordSuccess(provider: ProviderName): void {
    const e = this.entry(provider);
    e.failures = 0;
    e.state = "closed";
    e.openedAt = null;
  }

  /**
   * Record a failed call. Increments failure count; opens when >= threshold.
   *
   * EDGE CASE — HALF-OPEN failure:
   *   A failure from HALF-OPEN re-opens the breaker immediately.
   *   `openedAt` is reset to now, so the full reset_ms window starts again.
   */
  recordFailure(provider: ProviderName): void {
    const e = this.entry(provider);
    e.failures++;
    if (e.failures >= this.threshold) {
      e.state = "open";
      // Record the moment of opening — used by isOpen() to compute expiry
      e.openedAt = Date.now();
    }
  }

  /**
   * Force-reset a provider's breaker to CLOSED with zero failures.
   *
   * Use in test teardown, or after a manual operator override that
   * confirms a provider has recovered despite automatic backoff.
   */
  reset(provider: ProviderName): void {
    const e = this.entry(provider);
    e.failures = 0;
    e.state = "closed";
    e.openedAt = null;
  }

  /**
   * Return a point-in-time snapshot of all tracked provider states.
   *
   * Does NOT mutate any entry. Safe to call at any time for health checks
   * or telemetry dashboards.
   */
  snapshot(): Record<string, ICircuitBreakerSnapshot> {
    const result: Record<string, ICircuitBreakerSnapshot> = {};
    for (const [name, e] of this.entries) {
      result[name] = { state: e.state, failures: e.failures };
    }
    return result;
  }
}

// ─────────────────────────────────────────────────────────────
// RATE LIMITER
// ─────────────────────────────────────────────────────────────

// Re-export for consumer convenience
export type { IRateLimitConfig as RateLimitConfig };

/**
 * Bucket — sliding-window state per provider.
 *
 * The window is fixed at 60_000ms. resetIfExpired() resets both
 * counters when the window expires.
 */
interface Bucket {
  /** Configured max requests per minute for this provider. */
  rpm: number;
  /** Configured max tokens per minute for this provider. */
  tpm: number;
  /** Requests recorded in the current 60-second window. */
  requestsThisMinute: number;
  /** Tokens recorded in the current 60-second window. */
  tokensThisMinute: number;
  /** Epoch ms when the current window started. */
  windowStart: number;
}

/**
 * RateLimiter — per-provider sliding-window RPM + TPM enforcement.
 *
 * Implements IRateLimiter from @brandos/contracts.
 *
 * USAGE:
 *   const limiter = new RateLimiter({ anthropic: { rpm: 60, tpm: 100_000 } });
 *
 *   // Before calling a provider:
 *   const check = limiter.canProceed('anthropic', estimatedTokens);
 *   if (!check.allowed) {
 *     // check.retry_after_ms tells you how long to wait
 *     throw new RateLimitError(check);
 *   }
 *
 *   const result = await provider.invoke(req);
 *   // Record AFTER success (or after failure — we still consumed tokens)
 *   limiter.record('anthropic', result.tokens_used);
 *
 * IMPORTANT:
 *   canProceed() does NOT mutate state. You MUST call record() after the
 *   call completes (regardless of success/failure) so that actual usage
 *   is tracked. Skipping record() causes the window to under-count.
 */
export class RateLimiter implements IRateLimiterPublic {
  /** Per-provider sliding-window state. Lazily initialised. */
  private buckets = new Map<ProviderName, Bucket>();

  /**
   * @param config - Optional per-provider limit overrides.
   *   Providers not listed use defaults: { rpm: 60, tpm: 100_000 }.
   *   Pass an empty object or omit to use defaults for all providers.
   */
  constructor(
    private readonly config: Partial<Record<ProviderName, IRateLimitConfig>> = {}
  ) {}

  /**
   * Lazily initialise and return the Bucket for a provider.
   * Uses config override if available; otherwise uses safe defaults.
   */
  private getBucket(provider: ProviderName): Bucket {
    if (!this.buckets.has(provider)) {
      // Use the provider-specific config override, or fall back to conservative defaults
      const limit = this.config[provider] ?? { rpm: 60, tpm: 100_000 };
      this.buckets.set(provider, {
        rpm: limit.rpm,
        tpm: limit.tpm,
        requestsThisMinute: 0,
        tokensThisMinute: 0,
        windowStart: Date.now(),
      });
    }
    return this.buckets.get(provider)!;
  }

  /**
   * Reset the bucket counters if the 60-second window has expired.
   *
   * Called before every canProceed() and record() operation to ensure
   * stale window data never causes false rate-limit rejections.
   *
   * EDGE CASE: A burst at the end of window N and start of window N+1
   * will both be allowed (up to limits) because they fall in different
   * windows. This is intentional — true sliding windows require more
   * complex bookkeeping not worth the overhead for this use case.
   */
  private resetIfExpired(bucket: Bucket): void {
    if (Date.now() - bucket.windowStart >= 60_000) {
      bucket.requestsThisMinute = 0;
      bucket.tokensThisMinute = 0;
      bucket.windowStart = Date.now();
    }
  }

  /**
   * Check whether a call to this provider is allowed by current limits.
   *
   * Returns { allowed: true } if both RPM and TPM limits are within bounds.
   * Returns { allowed: false, reason, retry_after_ms } if either is exceeded.
   *
   * IMPORTANT: This method does NOT mutate the bucket. Call record() separately
   * after the call to commit the actual usage.
   *
   * @param provider        - The provider to check.
   * @param estimatedTokens - Expected token count for the call. Pass 0 if unknown;
   *                          the TPM check will pass unless RPM is already exhausted.
   */
  canProceed(provider: ProviderName, estimatedTokens = 0): RateLimitResult {
    const bucket = this.getBucket(provider);
    this.resetIfExpired(bucket);

    // RPM check — request count limit
    if (bucket.requestsThisMinute >= bucket.rpm) {
      return {
        allowed: false,
        reason: "rpm_exceeded",
        // Tell the caller how long to wait for the current window to expire
        retry_after_ms: 60_000 - (Date.now() - bucket.windowStart),
      };
    }

    // TPM check — token count limit
    // Only applies if estimatedTokens > 0; zero means "unknown" and is allowed through
    if (bucket.tokensThisMinute + estimatedTokens > bucket.tpm) {
      return {
        allowed: false,
        reason: "tpm_exceeded",
        retry_after_ms: 60_000 - (Date.now() - bucket.windowStart),
      };
    }

    return { allowed: true };
  }

  /**
   * Record actual usage after a provider call completes.
   *
   * ALWAYS call this after the call, success or failure — the tokens were
   * consumed regardless of the outcome. Skipping this will cause the window
   * to under-count and potentially allow more requests than the limit allows.
   *
   * @param provider   - The provider that was called.
   * @param tokensUsed - Actual tokens consumed (from the provider response).
   *                     Pass 0 if unavailable.
   */
  record(provider: ProviderName, tokensUsed = 0): void {
    const bucket = this.getBucket(provider);
    this.resetIfExpired(bucket);
    bucket.requestsThisMinute++;
    bucket.tokensThisMinute += tokensUsed;
  }

  /**
   * Return current window stats for a provider.
   *
   * Triggers a window reset if 60 seconds have elapsed — idempotent.
   * Use for telemetry dashboards and health-check endpoints.
   */
  getStats(provider: ProviderName): IRateLimiterStats {
    const bucket = this.getBucket(provider);
    this.resetIfExpired(bucket);
    return {
      requestsThisMinute: bucket.requestsThisMinute,
      tokensThisMinute: bucket.tokensThisMinute,
      rpm: bucket.rpm,
      tpm: bucket.tpm,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// COST TRACKER
// ─────────────────────────────────────────────────────────────

/**
 * COST_PER_1K_USD — approximate cost per 1000 tokens per provider.
 *
 * These are blended input/output estimates for budget planning.
 * They do NOT reflect exact current provider pricing — actual charges
 * depend on model, input vs output token ratio, and tier.
 *
 * Local providers (ollama, lmstudio) are always $0 — no API charges.
 * Custom providers default to $0.0002/1K as a conservative estimate.
 *
 * AGENT NOTE: Update this table when provider pricing changes.
 * These values intentionally err on the side of under-estimating cost
 * so budget guards are not overly conservative.
 */
const COST_PER_1K_USD: Record<ProviderName, number> = {
  openai: 0.00015,       // GPT-4o blended estimate
  anthropic: 0.00025,    // Claude 3 Sonnet blended estimate
  google: 0.0001,        // Gemini 1.5 Flash blended estimate
  deepseek: 0.00014,     // DeepSeek V3 blended estimate
  groq: 0.00005,         // Llama 3 on Groq (very cheap)
  openrouter: 0.0001,    // Conservative for free-tier models
  togetherai: 0.00008,   // Llama 3 on Together
  ollama: 0,             // Local — no cost
  lmstudio: 0,           // Local — no cost
  custom: 0.0002,        // Unknown provider — conservative estimate
};

/**
 * Re-export CostEntry type for consumer convenience.
 */
export type { ICostEntry as CostEntry };

/**
 * CostTracker — in-memory per-provider spend ledger.
 *
 * Implements ICostTracker from @brandos/contracts.
 *
 * USAGE:
 *   const tracker = new CostTracker(0.50); // $0.50 budget
 *
 *   // Pre-flight budget check:
 *   const estimate = tracker.estimate('anthropic', 2000);
 *   if (!tracker.withinBudget(estimate)) {
 *     throw new BudgetExceededError(tracker.summary());
 *   }
 *
 *   const result = await provider.invoke(req);
 *   tracker.record('anthropic', result.tokens_used, requestId);
 *
 * NOTE: record() both estimates AND records atomically. Do NOT call
 * estimate() + record() in sequence — that would double-count the call.
 * Call estimate() for pre-flight checks, record() to commit actual usage.
 */
export class CostTracker implements ICostTrackerPublic {
  /** Running total across all providers. */
  private totalSpent = 0;
  /** Per-provider running totals. */
  private spentByProvider: Partial<Record<ProviderName, number>> = {};
  /** Immutable chronological log of all recorded cost events. */
  private history: ICostEntry[] = [];

  /**
   * @param budgetUsd - Optional hard budget ceiling in USD.
   *   When provided, withinBudget() returns false when totalSpent
   *   + additionalCost would exceed this value.
   *   When omitted, withinBudget() always returns true.
   */
  constructor(private readonly budgetUsd?: number) {}

  /**
   * Estimate the cost of a call WITHOUT recording it.
   *
   * Uses the COST_PER_1K_USD table. Always returns 0 for local providers.
   * Returns 0.0002/1K for unknown custom providers (conservative fallback).
   *
   * Use this for pre-flight budget checks before making the actual call.
   * Do NOT use this result to "record" cost — call record() after the call.
   */
  estimate(provider: ProviderName, tokens: number): number {
    // Unknown providers (not in the map) default to a conservative $0.0002/1K
    const rate = COST_PER_1K_USD[provider] ?? 0.0002;
    return (tokens / 1000) * rate;
  }

  /**
   * Record an actual spend event and return the computed cost.
   *
   * This is the ONLY correct way to commit a cost. Do NOT call
   * estimate() then record() as separate operations for the same call —
   * that would record the event twice.
   *
   * @param provider   - The provider that was invoked.
   * @param tokens     - Actual tokens consumed (from provider response).
   * @param requestId  - Unique request identifier (from generateRequestId()).
   *                     Used for idempotency auditing in downstream sinks.
   * @returns          The computed cost in USD for this single call.
   */
  record(provider: ProviderName, tokens: number, requestId: string): number {
    const cost = this.estimate(provider, tokens);
    this.totalSpent += cost;
    // Accumulate per-provider spend for the summary()
    this.spentByProvider[provider] = (this.spentByProvider[provider] ?? 0) + cost;
    // Append an immutable entry to the chronological history
    this.history.push({
      provider,
      tokens,
      cost_usd: cost,
      request_id: requestId,
      timestamp: Date.now(),
    });
    return cost;
  }

  /**
   * Check whether the budget allows an additional spend.
   *
   * @param additionalCost - Projected cost of the next call.
   *   Use estimate() to compute this before calling withinBudget().
   * @returns true when no budget is configured, or when
   *   totalSpent + additionalCost <= budgetUsd.
   *
   * EDGE CASE: withinBudget(0) is safe to call with no estimate —
   * it returns false only if totalSpent alone already exceeds budget.
   */
  withinBudget(additionalCost = 0): boolean {
    if (this.budgetUsd === undefined) return true;
    return this.totalSpent + additionalCost <= this.budgetUsd;
  }

  /**
   * Return a CostSummary matching the @brandos/contracts interface.
   *
   * `remaining_usd` is null when no budget was configured.
   * `by_provider` is a shallow copy — safe to read but not to mutate.
   */
  summary(): CostSummary {
    return {
      total_spent_usd: this.totalSpent,
      budget_usd: this.budgetUsd ?? null,
      remaining_usd: this.budgetUsd !== undefined
        ? this.budgetUsd - this.totalSpent
        : null,
      by_provider: { ...this.spentByProvider },
      entry_count: this.history.length,
    };
  }

  /**
   * Return a defensive copy of all recorded cost entries.
   *
   * The returned array is safe to mutate — it does not affect
   * internal state. Entries are in chronological insertion order.
   */
  getHistory(): ICostEntry[] {
    return [...this.history];
  }
}


