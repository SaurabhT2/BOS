// ============================================================
// @brandos/shared-utils — index.ts
//
// PUBLIC API — The ONLY file consumers should import from.
//
// Wave 2 change: Deprecated shims removed.
//   computeSkillHealth, healthSummary → @brandos/iskill-runtime
//   hashArtifact, compareArtifacts, assertArtifactFields → @brandos/artifact-engine-layer
//
// Migration completed. skillHealth.ts and artifactCompare.ts are
// now DELETED from this package. See AGENT_CONTEXT.md for history.
//
// RULES:
//   1. Every public symbol must be re-exported through this file.
//   2. Never add implementation logic here — re-exports only.
//   3. This package owns ONLY infrastructure primitives.
//      No domain logic. No artifact logic. No skill logic.
//
// GROUPED BY DOMAIN:
//   A) Logger & Request IDs         → utils.logger
//   B) Retry                        → utils.retry
//   C) Resilience                   → utils.circuitbreaker, utils.ratelimiter
//   D) Environment Validation       → utils.env
//   E) Constants                    → utils.constants
//   F) Interface Boundary           → (types only)
// ============================================================

// ─── A) Logger & Request IDs ──────────────────────────────────────────────────
export { Logger, generateRequestId } from './logger'

// ─── B) Retry ─────────────────────────────────────────────────────────────────
export { withRetry, retryOptionsFromBudget } from './retry'
export type { RetryOptions } from './retry'

// ─── C) Resilience ────────────────────────────────────────────────────────────
export { CircuitBreaker, RateLimiter, CostTracker } from './resilience'
export type { CircuitBreakerConfig, RateLimitConfig, CostEntry } from './resilience'

// ─── D) Environment Validation ────────────────────────────────────────────────
export { validateEnv, requireEnv } from './env'
export type { EnvValidationResult } from './env'

// ─── E) Constants ─────────────────────────────────────────────────────────────
export * from './constants'

// ─── G) JSON Utilities ────────────────────────────────────────────────────────
// Moved from @brandos/output-control-layer (Fix C2).
// Pure heuristic repair/extraction — no domain knowledge, no LLM calls.
export { repairJSON, extractJSON } from './json-utils'

// ─── H) Crypto (P3 — BYOK key encryption) ────────────────────────────────────
// AES-256-GCM encrypt/decrypt for workspace API key storage.
// Server-side only — uses Node.js built-in crypto module.
export { encryptKey, decryptKey, AuthDecryptionError } from './crypto'
export type { EncryptedKeyParts } from './crypto'

// ─── F) Interface Boundary ────────────────────────────────────────────────────
// ISharedUtils.ts is the machine-readable interface boundary file.
// All public interface types are re-exported here for consumers to type-check against.
export type {
  // Logger
  LogLevel,
  ILogger,
  // Retry
  IRetryOptions,
  IRetryBudgetInput,
  // CircuitBreaker
  ICircuitBreakerConfig,
  ICircuitBreakerSnapshot,
  ICircuitBreakerPublic,
  // RateLimiter
  IRateLimitConfig,
  IRateLimiterStats,
  IRateLimiterPublic,
  // CostTracker
  ICostEntry,
  ICostTrackerPublic,
  // Environment
  IEnvValidationResult,
  // Constants
  IDefaultTimeouts,
  IDefaultRetry,
} from './ISharedUtils'

// ─── REMOVED: Deprecated backward-compat shims ───────────────────────────────
//
// computeSkillHealth, healthSummary   → import from '@brandos/iskill-runtime'
// hashArtifact, compareArtifacts      → import from '@brandos/artifact-engine-layer'
// assertArtifactFields, ArtifactDiff  → import from '@brandos/artifact-engine-layer'
//
// Files deleted: skillHealth.ts, artifactCompare.ts
// Tests moved: __tests__/skillHealth.test.ts → @brandos/iskill-runtime
// Tracked in migration history: AGENT_CONTEXT.md TODO-SU-1, TODO-SU-2 (COMPLETE)


