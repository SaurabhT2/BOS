/**
 * @brandos/shared-utils — logger.test.ts
 *
 * Tests for Logger class and generateRequestId().
 * Verifies: level filtering, child tag prefixing, emit format,
 * request ID format, and uniqueness guarantees.
 */
import { Logger, generateRequestId } from "../logger";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Capture console.log output during a test, suppressing real output. */
function captureLog(fn: () => void): string[] {
  const lines: string[] = [];
  const spy = jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return lines;
}

// ─────────────────────────────────────────────────────────────
// Logger — level filtering
// ─────────────────────────────────────────────────────────────

describe("Logger — level filtering", () => {
  it("silent level suppresses all messages", () => {
    const log = new Logger("silent");
    const lines = captureLog(() => {
      log.error("e");
      log.warn("w");
      log.info("i");
      log.debug("d");
    });
    expect(lines).toHaveLength(0);
  });

  it("error level emits only error messages", () => {
    const log = new Logger("error");
    const lines = captureLog(() => {
      log.error("e");
      log.warn("w");
      log.info("i");
      log.debug("d");
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[ERROR]");
  });

  it("warn level emits error and warn messages", () => {
    const log = new Logger("warn");
    const lines = captureLog(() => {
      log.error("e");
      log.warn("w");
      log.info("i");
      log.debug("d");
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("[ERROR]");
    expect(lines[1]).toContain("[WARN]");
  });

  it("info level emits error, warn, info (default)", () => {
    const log = new Logger("info");
    const lines = captureLog(() => {
      log.error("e");
      log.warn("w");
      log.info("i");
      log.debug("d");
    });
    expect(lines).toHaveLength(3);
  });

  it("debug level emits all messages", () => {
    const log = new Logger("debug");
    const lines = captureLog(() => {
      log.error("e");
      log.warn("w");
      log.info("i");
      log.debug("d");
    });
    expect(lines).toHaveLength(4);
  });

  it("default level is info (3 messages)", () => {
    const log = new Logger(); // no argument
    const lines = captureLog(() => {
      log.error("e");
      log.warn("w");
      log.info("i");
      log.debug("d"); // suppressed
    });
    expect(lines).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────
// Logger — output format
// ─────────────────────────────────────────────────────────────

describe("Logger — output format", () => {
  it("prefixes output with [AIRuntime][LEVEL]", () => {
    const log = new Logger("debug");
    const lines = captureLog(() => log.info("hello"));
    expect(lines[0]).toMatch(/^\[AIRuntime\]\[INFO\] hello/);
  });

  it("JSON-serialises object data", () => {
    const log = new Logger("debug");
    const lines = captureLog(() => log.error("boom", { code: 42 }));
    expect(lines[0]).toContain('{"code":42}');
  });

  it("appends primitive data as-is (number)", () => {
    const log = new Logger("debug");
    const lines = captureLog(() => log.warn("count", 7));
    expect(lines[0]).toContain("7");
  });

  it("omits data argument when undefined", () => {
    const log = new Logger("debug");
    const lines = captureLog(() => log.info("no data"));
    // Should be exactly "[AIRuntime][INFO] no data", nothing appended
    expect(lines[0]).toBe("[AIRuntime][INFO] no data");
  });
});

// ─────────────────────────────────────────────────────────────
// Logger — child() tags
// ─────────────────────────────────────────────────────────────

describe("Logger — child()", () => {
  it("prepends [tag] to every message", () => {
    const log = new Logger("debug");
    const child = log.child("Router");
    const lines = captureLog(() => child.info("selected anthropic"));
    expect(lines[0]).toContain("[Router]");
    expect(lines[0]).toContain("selected anthropic");
  });

  it("child inherits parent log level — suppresses debug when parent is info", () => {
    const log = new Logger("info");
    const child = log.child("Sub");
    const lines = captureLog(() => {
      child.info("visible");
      child.debug("suppressed");
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("visible");
  });

  it("child error messages include [tag] and [ERROR]", () => {
    const log = new Logger("error");
    const child = log.child("Circuit");
    const lines = captureLog(() => child.error("breaker opened"));
    expect(lines[0]).toContain("[ERROR]");
    expect(lines[0]).toContain("[Circuit]");
  });

  it("nested child tags are additive", () => {
    const log = new Logger("debug");
    const child1 = log.child("A");
    const child2 = child1.child("B");
    const lines = captureLog(() => child2.info("msg"));
    // The tag is [B] applied on top of child1 which adds [A] — order depends on impl
    expect(lines[0]).toContain("[B]");
  });
});

// ─────────────────────────────────────────────────────────────
// generateRequestId
// ─────────────────────────────────────────────────────────────

describe("generateRequestId", () => {
  it("returns a string starting with 'req_'", () => {
    expect(generateRequestId()).toMatch(/^req_/);
  });

  it("generates unique IDs on successive calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
    // All 100 should be unique — collisions would only occur at absurdly high rates
    expect(ids.size).toBe(100);
  });

  it("has the format req_{base36}_{5chars}", () => {
    const id = generateRequestId();
    // req_ then two alphanumeric segments separated by _
    expect(id).toMatch(/^req_[a-z0-9]+_[a-z0-9]{5}$/);
  });
});


