// ============================================================
// packages/ai-runtime-layer/src/runtime-engine/resilience.ts
//
// RESILIENCE PRIMITIVES — Re-export from @brandos/shared-utils
//
// CircuitBreaker, RateLimiter, and CostTracker are generic resilience
// primitives that live in @brandos/shared-utils. They are not specific
// to the AI runtime — they can be used by any package.
//
// This file re-exports them so imports within ai-runtime-layer can
// use the short local path without knowing where the primitives live.
//
// ARCHITECTURAL RULE:
//   DO NOT add ai-runtime-specific logic here.
//   This file is a pure re-export — no wiring, no defaults, no config.
//   ai-runtime-specific logic belongs in:
//     - runtime-engine/index.ts (ExecutionEngine — uses these in the retry loop)
//     - config/factory.ts (instantiates and holds module-level singletons)
//
// MODULE-LEVEL SINGLETONS (see factory.ts):
//   CircuitBreaker, RateLimiter, and CostTracker are instantiated as
//   module-level singletons in factory.ts. They are NOT re-created when
//   AIRuntimeAdapter.invalidate() is called. This preserves state:
//     - CircuitBreaker: open circuits stay open across config reloads
//     - RateLimiter: accumulated token counts persist across reloads
//     - CostTracker: cumulative cost persists across reloads
// ============================================================

export {
  CircuitBreaker,
  RateLimiter,
  CostTracker,
} from '@brandos/shared-utils'

export type {
  CircuitBreakerConfig,
  CostEntry,
} from '@brandos/shared-utils'


