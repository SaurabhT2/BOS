/**
 * apps/web/lib/ai-runtime.ts
 *
 * TELEMETRY ACCESSOR — reads live stats from the authoritative singleton.
 *
 * ARCHITECTURE:
 *   The authoritative AI runtime singleton lives entirely in:
 *     packages/ai-runtime-layer/src/llmRouter.ts → _runtime
 *
 *   This file does NOT create a runtime instance. It exposes the live
 *   telemetry from the existing singleton via the exported accessor functions
 *   below.
 *
 * PREVIOUS VIOLATION (now fixed):
 *   This file previously called AIRuntimeFactory.create({ providers: {} }),
 *   creating a hollow second singleton with zero providers. That hollow instance
 *   was used by /api/v2/telemetry/stats and returned empty data because it was
 *   disconnected from the live singleton. This has been corrected.
 *
 * CURRENT PATTERN:
 *   getLiveRuntimeStats() — returns stats from the live llmRouter singleton.
 *   getLiveRuntimeHistory() — returns telemetry history from the live singleton.
 *
 *   These functions call getActiveTelemetry() / getActiveHistory() which are
 *   exported from llmRouter.ts and read directly from the module-level _runtime.
 *
 * DO NOT:
 *   - Create a new AIRuntimeFactory.create() instance in this file.
 *   - Import AIRuntimeFactory or AIRuntimeAdapter here.
 *   - Add new singleton creation anywhere in apps/web.
 *
 * FOR GENERATION REQUESTS:
 *   Use callWithMode() from @brandos/ai-runtime-layer directly, or route
 *   through control-plane-layer's executeArtifactPipeline().
 */

import {
  getActiveTelemetryStats,
  getActiveTelemetryHistory,
} from '@brandos/ai-runtime-layer'

import type { TelemetryStats, TelemetrySnapshot } from '@brandos/contracts'

/**
 * Return live telemetry stats from the active runtime singleton.
 *
 * Returns zero-value stats if the runtime has not been initialized yet
 * (before setRuntimeConfigProvider() is called in instrumentation.ts).
 *
 * Safe to call from server routes — never throws.
 */
export function getLiveRuntimeStats(): TelemetryStats {
  try {
    return getActiveTelemetryStats()
  } catch {
    return {
      total_requests: 0,
      success_rate: 0,
      avg_latency_ms: 0,
      fallback_rate: 0,
      by_provider: {},
    }
  }
}

/**
 * Return live telemetry history from the active runtime singleton.
 *
 * Returns an empty array if the runtime has not been initialized yet.
 * Safe to call from server routes — never throws.
 */
export function getLiveRuntimeHistory(): TelemetrySnapshot[] {
  try {
    return getActiveTelemetryHistory()
  } catch {
    return []
  }
}


