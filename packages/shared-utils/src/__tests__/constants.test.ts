/**
 * @brandos/shared-utils — constants.test.ts
 *
 * Tests for monorepo-wide constants (constants.ts).
 * Verifies: correct values, type shapes, immutability intent.
 *
 * Added in L5 migration — constants were previously untested.
 *
 * NOTE: `as const` in TypeScript enforces readonly at compile-time.
 * Runtime freezing is NOT applied by TypeScript — tests verify values
 * and shapes rather than runtime mutation behavior.
 */
import {
  BRANDOS_VERSION,
  DEFAULT_TIMEOUTS,
  DEFAULT_RETRY,
  LOG_LEVELS,
} from "../constants";

describe("BRANDOS_VERSION", () => {
  it("is a non-empty string", () => {
    expect(typeof BRANDOS_VERSION).toBe("string");
    expect(BRANDOS_VERSION.length).toBeGreaterThan(0);
  });

  it("follows semver major.minor.patch format", () => {
    expect(BRANDOS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("DEFAULT_TIMEOUTS", () => {
  it("local is 60_000ms", () => {
    expect(DEFAULT_TIMEOUTS.local).toBe(60_000);
  });

  it("cloud is 30_000ms", () => {
    expect(DEFAULT_TIMEOUTS.cloud).toBe(30_000);
  });

  it("export is 120_000ms", () => {
    expect(DEFAULT_TIMEOUTS.export).toBe(120_000);
  });

  it("local > cloud (local models need more time)", () => {
    expect(DEFAULT_TIMEOUTS.local).toBeGreaterThan(DEFAULT_TIMEOUTS.cloud);
  });

  it("export > local (rendering takes longer than inference)", () => {
    expect(DEFAULT_TIMEOUTS.export).toBeGreaterThan(DEFAULT_TIMEOUTS.local);
  });

  it("all values are positive integers", () => {
    for (const [, v] of Object.entries(DEFAULT_TIMEOUTS)) {
      expect(v).toBeGreaterThan(0);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("has exactly 3 keys: local, cloud, export", () => {
    expect(Object.keys(DEFAULT_TIMEOUTS)).toHaveLength(3);
    expect(Object.keys(DEFAULT_TIMEOUTS).sort()).toEqual(["cloud", "export", "local"]);
  });
});

describe("DEFAULT_RETRY", () => {
  it("count is 3", () => {
    expect(DEFAULT_RETRY.count).toBe(3);
  });

  it("backoffMs is 500", () => {
    expect(DEFAULT_RETRY.backoffMs).toBe(500);
  });

  it("maxBackoffMs is 10_000", () => {
    expect(DEFAULT_RETRY.maxBackoffMs).toBe(10_000);
  });

  it("maxBackoffMs > backoffMs (cap must be above base)", () => {
    expect(DEFAULT_RETRY.maxBackoffMs).toBeGreaterThan(DEFAULT_RETRY.backoffMs);
  });

  it("count is a positive integer", () => {
    expect(DEFAULT_RETRY.count).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_RETRY.count)).toBe(true);
  });

  it("has exactly 3 keys: count, backoffMs, maxBackoffMs", () => {
    expect(Object.keys(DEFAULT_RETRY).sort()).toEqual(["backoffMs", "count", "maxBackoffMs"]);
  });
});

describe("LOG_LEVELS", () => {
  it("contains exactly 5 levels", () => {
    expect(LOG_LEVELS).toHaveLength(5);
  });

  it("contains all required levels", () => {
    expect(LOG_LEVELS).toContain("silent");
    expect(LOG_LEVELS).toContain("error");
    expect(LOG_LEVELS).toContain("warn");
    expect(LOG_LEVELS).toContain("info");
    expect(LOG_LEVELS).toContain("debug");
  });

  it("is in order from least to most verbose", () => {
    expect(LOG_LEVELS).toEqual(["silent", "error", "warn", "info", "debug"]);
  });

  it("contains no duplicate levels", () => {
    expect(new Set(LOG_LEVELS).size).toBe(LOG_LEVELS.length);
  });

  it("all entries are non-empty strings", () => {
    for (const level of LOG_LEVELS) {
      expect(typeof level).toBe("string");
      expect(level.length).toBeGreaterThan(0);
    }
  });
});


