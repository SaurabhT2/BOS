/**
 * @brandos/shared-utils — env.test.ts
 *
 * Tests for validateEnv() and requireEnv().
 * Verifies: required var detection, optional var bucketing,
 * AI provider coverage warning, requireEnv throw behavior.
 */
import { validateEnv, requireEnv } from "../env";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Save and restore process.env around each test. */
function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    original[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
}

/** Suppress console output during validation (side effects are not under test). */
function suppressConsole(fn: () => void): void {
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
  try {
    fn();
  } finally {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  }
}

const REQUIRED_VARS = {
  NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-test",
};

// ─────────────────────────────────────────────────────────────
// validateEnv — required vars
// ─────────────────────────────────────────────────────────────

describe("validateEnv — required variables", () => {
  it("returns valid=true when all required vars are present", () => {
    withEnv(REQUIRED_VARS, () => {
      suppressConsole(() => {
        const result = validateEnv();
        expect(result.valid).toBe(true);
        expect(result.missing_required).toHaveLength(0);
      });
    });
  });

  it("returns valid=false when SUPABASE_URL is missing", () => {
    withEnv(
      { ...REQUIRED_VARS, NEXT_PUBLIC_SUPABASE_URL: undefined },
      () => {
        suppressConsole(() => {
          const result = validateEnv();
          expect(result.valid).toBe(false);
          expect(result.missing_required).toContain("NEXT_PUBLIC_SUPABASE_URL");
        });
      }
    );
  });

  it("returns valid=false when SUPABASE_ANON_KEY is missing", () => {
    withEnv(
      { ...REQUIRED_VARS, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined },
      () => {
        suppressConsole(() => {
          const result = validateEnv();
          expect(result.valid).toBe(false);
          expect(result.missing_required).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
        });
      }
    );
  });

  it("collects ALL missing required vars (not just the first)", () => {
    withEnv(
      {
        NEXT_PUBLIC_SUPABASE_URL: undefined,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
      },
      () => {
        suppressConsole(() => {
          const result = validateEnv();
          expect(result.missing_required).toContain("NEXT_PUBLIC_SUPABASE_URL");
          expect(result.missing_required).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
        });
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────
// validateEnv — AI provider coverage
// ─────────────────────────────────────────────────────────────

describe("validateEnv — AI provider coverage", () => {
  it("warns when no AI provider keys are set", () => {
    withEnv(
      {
        ...REQUIRED_VARS,
        ANTHROPIC_API_KEY: undefined,
        OPENAI_API_KEY: undefined,
        GOOGLE_AI_API_KEY: undefined,
        GROQ_API_KEY: undefined,
        TOGETHER_API_KEY: undefined,
        OPENROUTER_API_KEY: undefined,
      },
      () => {
        suppressConsole(() => {
          const result = validateEnv();
          expect(result.ai_providers_configured).toHaveLength(0);
          expect(result.warnings.length).toBeGreaterThan(0);
        });
      }
    );
  });

  it("reports configured AI providers", () => {
    withEnv(
      { ...REQUIRED_VARS, ANTHROPIC_API_KEY: "sk-ant-test" },
      () => {
        suppressConsole(() => {
          const result = validateEnv();
          expect(result.ai_providers_configured).toContain("ANTHROPIC_API_KEY");
        });
      }
    );
  });

  it("reports multiple configured AI providers", () => {
    withEnv(
      {
        ...REQUIRED_VARS,
        ANTHROPIC_API_KEY: "sk-ant",
        OPENAI_API_KEY: "sk-openai",
        GROQ_API_KEY: "gsk-groq",
      },
      () => {
        suppressConsole(() => {
          const result = validateEnv();
          expect(result.ai_providers_configured).toHaveLength(3);
        });
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────
// validateEnv — optional vars
// ─────────────────────────────────────────────────────────────

describe("validateEnv — optional variables", () => {
  it("does not fail validation when optional vars are missing", () => {
    withEnv(
      {
        ...REQUIRED_VARS,
        POSTHOG_API_KEY: undefined,
        NEXT_PUBLIC_POSTHOG_KEY: undefined,
        NEXT_PUBLIC_APP_URL: undefined,
      },
      () => {
        suppressConsole(() => {
          const result = validateEnv();
          expect(result.valid).toBe(true);
        });
      }
    );
  });

  it("lists missing optional vars for informational use", () => {
    withEnv(
      { ...REQUIRED_VARS, POSTHOG_API_KEY: undefined },
      () => {
        suppressConsole(() => {
          const result = validateEnv();
          expect(result.missing_optional).toContain("POSTHOG_API_KEY");
        });
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────
// requireEnv
// ─────────────────────────────────────────────────────────────

describe("requireEnv", () => {
  it("returns the value when the key exists", () => {
    withEnv({ ANTHROPIC_API_KEY: "sk-test-123" }, () => {
      expect(requireEnv("ANTHROPIC_API_KEY")).toBe("sk-test-123");
    });
  });

  it("throws when the key is missing", () => {
    withEnv({ SOME_REQUIRED_KEY: undefined }, () => {
      expect(() => requireEnv("SOME_REQUIRED_KEY")).toThrow(
        "Missing required environment variable: SOME_REQUIRED_KEY"
      );
    });
  });

  it("throws when the value is an empty string", () => {
    withEnv({ SOME_REQUIRED_KEY: "" }, () => {
      expect(() => requireEnv("SOME_REQUIRED_KEY")).toThrow();
    });
  });

  it("error message mentions .env.example", () => {
    withEnv({ MISSING_KEY: undefined }, () => {
      expect(() => requireEnv("MISSING_KEY")).toThrow(".env.example");
    });
  });
});


