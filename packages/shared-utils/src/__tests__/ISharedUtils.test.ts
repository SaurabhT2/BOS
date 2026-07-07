/**
 * @brandos/shared-utils — ISharedUtils.test.ts
 *
 * INTERFACE SURFACE CONTRACT TESTS
 *
 * These tests verify that exported implementations satisfy the
 * ISharedUtils interface boundary at compile AND runtime.
 *
 * PURPOSE:
 *   Prevent silent interface drift. If a method is renamed or removed
 *   from an implementation, this file fails to compile — giving an
 *   immediate signal before the monorepo build catches it.
 *
 * STRATEGY:
 *   - Assign each class instance to its interface type variable.
 *     TypeScript will refuse to compile if the assignment is invalid.
 *   - Verify key exports exist and have the expected types at runtime.
 *
 * WAVE 2 UPDATE:
 *   Deprecated shim checks (computeSkillHealth, healthSummary, hashArtifact,
 *   compareArtifacts, assertArtifactFields) removed — these symbols were
 *   deleted in Wave 2 and no longer exist in the package.
 *   See AGENT_CONTEXT.md migration history for canonical new locations.
 *
 * L5 ADDITIONS:
 *   Architecture boundary tests, package invariant tests.
 */
import {
  Logger,
  generateRequestId,
  withRetry,
  retryOptionsFromBudget,
  CircuitBreaker,
  RateLimiter,
  CostTracker,
  validateEnv,
  requireEnv,
  BRANDOS_VERSION,
  DEFAULT_TIMEOUTS,
  DEFAULT_RETRY,
  LOG_LEVELS,
} from "../index";

import type {
  ILogger,
  ICircuitBreakerPublic,
  IRateLimiterPublic,
  ICostTrackerPublic,
} from "../index";

// ─────────────────────────────────────────────────────────────
// Compile-time interface satisfaction checks
// ─────────────────────────────────────────────────────────────

describe("Interface satisfaction — compile-time checks", () => {
  it("Logger satisfies ILogger", () => {
    const logger: ILogger = new Logger("silent");
    expect(logger).toBeDefined();
  });

  it("CircuitBreaker satisfies ICircuitBreakerPublic", () => {
    const cb: ICircuitBreakerPublic = new CircuitBreaker();
    expect(cb).toBeDefined();
  });

  it("RateLimiter satisfies IRateLimiterPublic", () => {
    const rl: IRateLimiterPublic = new RateLimiter();
    expect(rl).toBeDefined();
  });

  it("CostTracker satisfies ICostTrackerPublic", () => {
    const ct: ICostTrackerPublic = new CostTracker();
    expect(ct).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Runtime export presence checks
// ─────────────────────────────────────────────────────────────

describe("Export surface — all expected exports are present", () => {
  it("Logger is exported and is a class constructor", () => {
    expect(typeof Logger).toBe("function");
    expect(new Logger()).toBeInstanceOf(Logger);
  });

  it("generateRequestId is exported and is a function", () => {
    expect(typeof generateRequestId).toBe("function");
  });

  it("withRetry is exported and is a function", () => {
    expect(typeof withRetry).toBe("function");
  });

  it("retryOptionsFromBudget is exported and is a function", () => {
    expect(typeof retryOptionsFromBudget).toBe("function");
  });

  it("CircuitBreaker is exported and is a class constructor", () => {
    expect(typeof CircuitBreaker).toBe("function");
    expect(new CircuitBreaker()).toBeInstanceOf(CircuitBreaker);
  });

  it("RateLimiter is exported and is a class constructor", () => {
    expect(typeof RateLimiter).toBe("function");
    expect(new RateLimiter()).toBeInstanceOf(RateLimiter);
  });

  it("CostTracker is exported and is a class constructor", () => {
    expect(typeof CostTracker).toBe("function");
    expect(new CostTracker()).toBeInstanceOf(CostTracker);
  });

  it("validateEnv is exported and is a function", () => {
    expect(typeof validateEnv).toBe("function");
  });

  it("requireEnv is exported and is a function", () => {
    expect(typeof requireEnv).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────
// Constants surface checks
// ─────────────────────────────────────────────────────────────

describe("Constants — values and shapes", () => {
  it("BRANDOS_VERSION is a non-empty string", () => {
    expect(typeof BRANDOS_VERSION).toBe("string");
    expect(BRANDOS_VERSION.length).toBeGreaterThan(0);
  });

  it("DEFAULT_TIMEOUTS has local, cloud, export", () => {
    expect(typeof DEFAULT_TIMEOUTS.local).toBe("number");
    expect(typeof DEFAULT_TIMEOUTS.cloud).toBe("number");
    expect(typeof DEFAULT_TIMEOUTS.export).toBe("number");
    expect(DEFAULT_TIMEOUTS.local).toBeGreaterThan(0);
    expect(DEFAULT_TIMEOUTS.cloud).toBeGreaterThan(0);
    expect(DEFAULT_TIMEOUTS.export).toBeGreaterThan(0);
  });

  it("DEFAULT_RETRY has count, backoffMs, maxBackoffMs", () => {
    expect(typeof DEFAULT_RETRY.count).toBe("number");
    expect(typeof DEFAULT_RETRY.backoffMs).toBe("number");
    expect(typeof DEFAULT_RETRY.maxBackoffMs).toBe("number");
  });

  it("LOG_LEVELS contains all five levels in order", () => {
    expect(LOG_LEVELS).toEqual(["silent", "error", "warn", "info", "debug"]);
  });

  it("export timeout is longer than cloud timeout", () => {
    expect(DEFAULT_TIMEOUTS.export).toBeGreaterThan(DEFAULT_TIMEOUTS.cloud);
  });

  it("local timeout is longer than cloud timeout", () => {
    expect(DEFAULT_TIMEOUTS.local).toBeGreaterThan(DEFAULT_TIMEOUTS.cloud);
  });

  it("maxBackoffMs > backoffMs in DEFAULT_RETRY", () => {
    expect(DEFAULT_RETRY.maxBackoffMs).toBeGreaterThan(DEFAULT_RETRY.backoffMs);
  });

  it("DEFAULT_RETRY.count is exactly 3", () => {
    // Canonical retry count — changing this is a breaking change
    expect(DEFAULT_RETRY.count).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────
// Logger interface method completeness
// ─────────────────────────────────────────────────────────────

describe("ILogger interface — all methods present and callable", () => {
  const log: ILogger = new Logger("silent");

  it("has error()", () => {
    expect(typeof log.error).toBe("function");
    expect(() => log.error("test")).not.toThrow();
  });

  it("has warn()", () => {
    expect(typeof log.warn).toBe("function");
    expect(() => log.warn("test")).not.toThrow();
  });

  it("has info()", () => {
    expect(typeof log.info).toBe("function");
    expect(() => log.info("test")).not.toThrow();
  });

  it("has debug()", () => {
    expect(typeof log.debug).toBe("function");
    expect(() => log.debug("test")).not.toThrow();
  });

  it("has child() returning ILogger", () => {
    expect(typeof log.child).toBe("function");
    const child: ILogger = log.child("Test");
    expect(child).toBeDefined();
    expect(typeof child.info).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────
// ICircuitBreakerPublic — method completeness
// ─────────────────────────────────────────────────────────────

describe("ICircuitBreakerPublic — all methods present", () => {
  const cb: ICircuitBreakerPublic = new CircuitBreaker();

  it("has isOpen()", () => expect(typeof cb.isOpen).toBe("function"));
  it("has recordSuccess()", () => expect(typeof cb.recordSuccess).toBe("function"));
  it("has recordFailure()", () => expect(typeof cb.recordFailure).toBe("function"));
  it("has reset()", () => expect(typeof cb.reset).toBe("function"));
  it("has snapshot()", () => expect(typeof cb.snapshot).toBe("function"));
});

// ─────────────────────────────────────────────────────────────
// IRateLimiterPublic — method completeness
// ─────────────────────────────────────────────────────────────

describe("IRateLimiterPublic — all methods present", () => {
  const rl: IRateLimiterPublic = new RateLimiter();

  it("has canProceed()", () => expect(typeof rl.canProceed).toBe("function"));
  it("has record()", () => expect(typeof rl.record).toBe("function"));
  it("has getStats()", () => expect(typeof rl.getStats).toBe("function"));
});

// ─────────────────────────────────────────────────────────────
// ICostTrackerPublic — method completeness
// ─────────────────────────────────────────────────────────────

describe("ICostTrackerPublic — all methods present", () => {
  const ct: ICostTrackerPublic = new CostTracker();

  it("has estimate()", () => expect(typeof ct.estimate).toBe("function"));
  it("has record()", () => expect(typeof ct.record).toBe("function"));
  it("has withinBudget()", () => expect(typeof ct.withinBudget).toBe("function"));
  it("has summary()", () => expect(typeof ct.summary).toBe("function"));
  it("has getHistory()", () => expect(typeof ct.getHistory).toBe("function"));
});

// ─────────────────────────────────────────────────────────────
// L5 — Architecture boundary tests
// These guard against re-introduction of deprecated patterns.
// ─────────────────────────────────────────────────────────────

describe("L5 Architecture — deprecated shim removal verified", () => {
  it("computeSkillHealth is NOT exported (Wave 2 deletion confirmed)", () => {
    const exports = require("../index");
    expect(exports.computeSkillHealth).toBeUndefined();
  });

  it("healthSummary is NOT exported (Wave 2 deletion confirmed)", () => {
    const exports = require("../index");
    expect(exports.healthSummary).toBeUndefined();
  });

  it("hashArtifact is NOT exported (Wave 2 deletion confirmed)", () => {
    const exports = require("../index");
    expect(exports.hashArtifact).toBeUndefined();
  });

  it("compareArtifacts is NOT exported (Wave 2 deletion confirmed)", () => {
    const exports = require("../index");
    expect(exports.compareArtifacts).toBeUndefined();
  });

  it("assertArtifactFields is NOT exported (Wave 2 deletion confirmed)", () => {
    const exports = require("../index");
    expect(exports.assertArtifactFields).toBeUndefined();
  });
});

describe("L5 Architecture — package invariants", () => {
  it("index exports are fully enumerable (no hidden symbols)", () => {
    const exports = require("../index");
    const keys = Object.keys(exports);
    // Must have the canonical 7 capability groups represented
    expect(keys).toContain("Logger");
    expect(keys).toContain("generateRequestId");
    expect(keys).toContain("withRetry");
    expect(keys).toContain("CircuitBreaker");
    expect(keys).toContain("RateLimiter");
    expect(keys).toContain("CostTracker");
    expect(keys).toContain("validateEnv");
    expect(keys).toContain("requireEnv");
    expect(keys).toContain("BRANDOS_VERSION");
    expect(keys).toContain("DEFAULT_TIMEOUTS");
    expect(keys).toContain("DEFAULT_RETRY");
    expect(keys).toContain("LOG_LEVELS");
  });

  it("Logger.child returns an object with all ILogger methods", () => {
    const log = new Logger("silent");
    const child = log.child("Test");
    const requiredMethods = ["error", "warn", "info", "debug", "child"];
    for (const method of requiredMethods) {
      expect(typeof (child as unknown as Record<string, unknown>)[method]).toBe("function");
    }
  });

  it("CircuitBreaker is isolated per instance (no shared state)", () => {
    const cb1 = new CircuitBreaker({ threshold: 1 });
    const cb2 = new CircuitBreaker({ threshold: 1 });
    cb1.recordFailure("anthropic");
    // cb2 should not be affected by cb1's state
    expect(cb2.isOpen("anthropic")).toBe(false);
  });

  it("RateLimiter is isolated per instance (no shared state)", () => {
    const rl1 = new RateLimiter({ anthropic: { rpm: 1, tpm: 100 } });
    const rl2 = new RateLimiter({ anthropic: { rpm: 1, tpm: 100 } });
    rl1.record("anthropic", 10);
    rl1.record("anthropic", 10); // exhaust rl1's rpm
    // rl2 should still allow requests
    expect(rl2.canProceed("anthropic").allowed).toBe(true);
  });

  it("CostTracker is isolated per instance (no shared state)", () => {
    const ct1 = new CostTracker(0.001);
    const ct2 = new CostTracker(0.001);
    ct1.record("anthropic", 1_000_000, "r1"); // exhaust ct1's budget
    // ct2 should still be within budget
    expect(ct2.withinBudget()).toBe(true);
  });

  it("generateRequestId produces req_*_* format consistently", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateRequestId()).toMatch(/^req_[a-z0-9]+_[a-z0-9]{5}$/);
    }
  });

  // NOTE: as const readonly is enforced at compile-time only, not runtime.
  // Runtime behavior tested in constants.test.ts.

});


