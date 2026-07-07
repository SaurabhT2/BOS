/**
 * @brandos/shared-utils — resilience.test.ts
 *
 * Tests for CircuitBreaker, RateLimiter, and CostTracker.
 * Verifies state machine transitions, window resets, budget math,
 * and contract compliance with @brandos/contracts interfaces.
 */
import { CircuitBreaker, RateLimiter, CostTracker } from "../resilience";
import type { ProviderName } from "@brandos/contracts";

const ANTHROPIC: ProviderName = "anthropic";
const OPENAI: ProviderName = "openai";

// ─────────────────────────────────────────────────────────────
// CircuitBreaker
// ─────────────────────────────────────────────────────────────

describe("CircuitBreaker — initial state", () => {
  it("starts closed for unknown providers", () => {
    const cb = new CircuitBreaker();
    expect(cb.isOpen(ANTHROPIC)).toBe(false);
  });

  it("snapshot returns empty object before any access", () => {
    const cb = new CircuitBreaker();
    // snapshot() has side effect of initialising nothing until accessed
    const snap = cb.snapshot();
    expect(Object.keys(snap)).toHaveLength(0);
  });
});

describe("CircuitBreaker — closed → open transition", () => {
  it("opens after threshold failures (default: 3)", () => {
    const cb = new CircuitBreaker({ threshold: 3 });
    cb.recordFailure(ANTHROPIC);
    cb.recordFailure(ANTHROPIC);
    expect(cb.isOpen(ANTHROPIC)).toBe(false); // 2 failures, not yet open
    cb.recordFailure(ANTHROPIC);
    expect(cb.isOpen(ANTHROPIC)).toBe(true); // 3rd failure opens it
  });

  it("resets failure count on success (closed)", () => {
    const cb = new CircuitBreaker({ threshold: 3 });
    cb.recordFailure(ANTHROPIC);
    cb.recordFailure(ANTHROPIC);
    cb.recordSuccess(ANTHROPIC);
    cb.recordFailure(ANTHROPIC);
    cb.recordFailure(ANTHROPIC);
    // Only 2 failures since the success — should still be closed
    expect(cb.isOpen(ANTHROPIC)).toBe(false);
  });

  it("custom threshold works", () => {
    const cb = new CircuitBreaker({ threshold: 1 });
    cb.recordFailure(ANTHROPIC);
    expect(cb.isOpen(ANTHROPIC)).toBe(true);
  });
});

describe("CircuitBreaker — open → half-open → closed", () => {
  it("transitions to half-open after reset_ms and returns false once", () => {
    jest.useFakeTimers();
    const cb = new CircuitBreaker({ threshold: 1, reset_ms: 1000 });
    cb.recordFailure(ANTHROPIC);
    expect(cb.isOpen(ANTHROPIC)).toBe(true);

    // Fast-forward past reset window
    jest.advanceTimersByTime(1001);

    // isOpen() returns false (half-open — one probe allowed through)
    expect(cb.isOpen(ANTHROPIC)).toBe(false);
    jest.useRealTimers();
  });

  it("closes on success after half-open probe", () => {
    jest.useFakeTimers();
    const cb = new CircuitBreaker({ threshold: 1, reset_ms: 1000 });
    cb.recordFailure(ANTHROPIC);
    jest.advanceTimersByTime(1001);
    cb.isOpen(ANTHROPIC); // triggers half-open transition
    cb.recordSuccess(ANTHROPIC);
    expect(cb.isOpen(ANTHROPIC)).toBe(false);

    // snapshot confirms closed state
    const snap = cb.snapshot();
    expect(snap[ANTHROPIC]?.state).toBe("closed");
    expect(snap[ANTHROPIC]?.failures).toBe(0);
    jest.useRealTimers();
  });

  it("re-opens on failure during half-open probe", () => {
    jest.useFakeTimers();
    const cb = new CircuitBreaker({ threshold: 1, reset_ms: 1000 });
    cb.recordFailure(ANTHROPIC);
    jest.advanceTimersByTime(1001);
    cb.isOpen(ANTHROPIC); // half-open
    cb.recordFailure(ANTHROPIC); // probe failed → re-open
    expect(cb.isOpen(ANTHROPIC)).toBe(true);
    jest.useRealTimers();
  });
});

describe("CircuitBreaker — reset()", () => {
  it("force-resets to closed with zero failures", () => {
    const cb = new CircuitBreaker({ threshold: 1 });
    cb.recordFailure(ANTHROPIC);
    expect(cb.isOpen(ANTHROPIC)).toBe(true);
    cb.reset(ANTHROPIC);
    expect(cb.isOpen(ANTHROPIC)).toBe(false);
    const snap = cb.snapshot();
    expect(snap[ANTHROPIC]?.failures).toBe(0);
    expect(snap[ANTHROPIC]?.state).toBe("closed");
  });
});

describe("CircuitBreaker — isolation between providers", () => {
  it("openai failures do not affect anthropic", () => {
    const cb = new CircuitBreaker({ threshold: 1 });
    cb.recordFailure(OPENAI);
    expect(cb.isOpen(ANTHROPIC)).toBe(false);
    expect(cb.isOpen(OPENAI)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// RateLimiter
// ─────────────────────────────────────────────────────────────

describe("RateLimiter — canProceed", () => {
  it("allows the first request", () => {
    const rl = new RateLimiter({ [ANTHROPIC]: { rpm: 10, tpm: 10_000 } });
    const result = rl.canProceed(ANTHROPIC, 100);
    expect(result.allowed).toBe(true);
  });

  it("blocks when RPM is exceeded", () => {
    const rl = new RateLimiter({ [ANTHROPIC]: { rpm: 2, tpm: 100_000 } });
    rl.record(ANTHROPIC, 10);
    rl.record(ANTHROPIC, 10);
    const result = rl.canProceed(ANTHROPIC);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("rpm_exceeded");
  });

  it("blocks when TPM is exceeded", () => {
    const rl = new RateLimiter({ [ANTHROPIC]: { rpm: 100, tpm: 500 } });
    rl.record(ANTHROPIC, 400);
    // Next request would exceed tpm (400 + 200 = 600 > 500)
    const result = rl.canProceed(ANTHROPIC, 200);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("tpm_exceeded");
  });

  it("canProceed does NOT record usage", () => {
    const rl = new RateLimiter({ [ANTHROPIC]: { rpm: 1, tpm: 10_000 } });
    // Call canProceed 5 times without recording — should still be allowed
    for (let i = 0; i < 5; i++) {
      expect(rl.canProceed(ANTHROPIC).allowed).toBe(true);
    }
  });

  it("defaults to rpm=60, tpm=100_000 for unconfigured providers", () => {
    const rl = new RateLimiter();
    const stats = rl.getStats(ANTHROPIC);
    expect(stats.rpm).toBe(60);
    expect(stats.tpm).toBe(100_000);
  });
});

describe("RateLimiter — window reset", () => {
  it("resets counters after 60s window expires", () => {
    jest.useFakeTimers();
    const rl = new RateLimiter({ [ANTHROPIC]: { rpm: 2, tpm: 10_000 } });
    rl.record(ANTHROPIC, 10);
    rl.record(ANTHROPIC, 10);
    expect(rl.canProceed(ANTHROPIC).allowed).toBe(false);

    // Advance past the 60s window
    jest.advanceTimersByTime(61_000);
    expect(rl.canProceed(ANTHROPIC).allowed).toBe(true);
    jest.useRealTimers();
  });
});

describe("RateLimiter — getStats", () => {
  it("returns accurate counts after recording", () => {
    const rl = new RateLimiter({ [ANTHROPIC]: { rpm: 100, tpm: 10_000 } });
    rl.record(ANTHROPIC, 500);
    rl.record(ANTHROPIC, 300);
    const stats = rl.getStats(ANTHROPIC);
    expect(stats.requestsThisMinute).toBe(2);
    expect(stats.tokensThisMinute).toBe(800);
  });
});

// ─────────────────────────────────────────────────────────────
// CostTracker
// ─────────────────────────────────────────────────────────────

describe("CostTracker — estimate", () => {
  it("returns 0 for local providers (ollama)", () => {
    const ct = new CostTracker();
    expect(ct.estimate("ollama", 100_000)).toBe(0);
  });

  it("returns 0 for local providers (lmstudio)", () => {
    const ct = new CostTracker();
    expect(ct.estimate("lmstudio", 100_000)).toBe(0);
  });

  it("returns non-zero for cloud providers", () => {
    const ct = new CostTracker();
    expect(ct.estimate(ANTHROPIC, 1000)).toBeGreaterThan(0);
  });

  it("estimate scales with token count", () => {
    const ct = new CostTracker();
    const e1 = ct.estimate(ANTHROPIC, 1000);
    const e2 = ct.estimate(ANTHROPIC, 2000);
    expect(e2).toBeCloseTo(e1 * 2);
  });
});

describe("CostTracker — record and withinBudget", () => {
  it("withinBudget returns true when no budget set", () => {
    const ct = new CostTracker(); // no budget
    ct.record(ANTHROPIC, 1_000_000, "req_1"); // huge spend
    expect(ct.withinBudget()).toBe(true);
  });

  it("withinBudget returns false when budget is exceeded", () => {
    const ct = new CostTracker(0.001); // tiny $0.001 budget
    ct.record(ANTHROPIC, 100_000, "req_1"); // should exceed
    expect(ct.withinBudget()).toBe(false);
  });

  it("withinBudget(additionalCost) respects projected spend", () => {
    const ct = new CostTracker(1.0); // $1 budget
    // Record a small amount — well within budget
    ct.record(OPENAI, 100, "req_1");
    // Projected huge spend should fail the check
    const projected = ct.estimate(ANTHROPIC, 10_000_000); // ~$2.50
    expect(ct.withinBudget(projected)).toBe(false);
  });

  it("record returns the cost for that call", () => {
    const ct = new CostTracker();
    const cost = ct.record(ANTHROPIC, 1000, "req_x");
    expect(cost).toBeGreaterThan(0);
    expect(typeof cost).toBe("number");
  });
});

describe("CostTracker — summary", () => {
  it("summary reflects total and per-provider spend", () => {
    const ct = new CostTracker(1.0);
    ct.record(ANTHROPIC, 1000, "r1");
    ct.record(OPENAI, 1000, "r2");
    const s = ct.summary();
    expect(s.total_spent_usd).toBeGreaterThan(0);
    expect(s.budget_usd).toBe(1.0);
    expect(s.remaining_usd).not.toBeNull();
    expect(s.by_provider[ANTHROPIC]).toBeGreaterThan(0);
    expect(s.by_provider[OPENAI]).toBeGreaterThan(0);
    expect(s.entry_count).toBe(2);
  });

  it("remaining_usd is null when no budget configured", () => {
    const ct = new CostTracker(); // no budget
    const s = ct.summary();
    expect(s.remaining_usd).toBeNull();
    expect(s.budget_usd).toBeNull();
  });
});

describe("CostTracker — getHistory", () => {
  it("returns a copy — mutations do not affect internal state", () => {
    const ct = new CostTracker();
    ct.record(ANTHROPIC, 100, "r1");
    const history = ct.getHistory();
    history.pop(); // mutate the returned copy
    expect(ct.getHistory()).toHaveLength(1); // internal history unchanged
  });

  it("history is in chronological insertion order", () => {
    const ct = new CostTracker();
    ct.record(ANTHROPIC, 100, "r1");
    ct.record(OPENAI, 200, "r2");
    const h = ct.getHistory();
    expect(h[0]?.request_id).toBe("r1");
    expect(h[1]?.request_id).toBe("r2");
  });
});


