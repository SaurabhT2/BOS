// ============================================================
// packages/ai-runtime-layer/src/public/IAIRuntime.ts
//
// PUBLIC INTERFACE CONTRACT — ai-runtime-layer
//
// This file is the change-management boundary between the ai-runtime-layer
// package and all of its consumers (control-plane-layer, apps/web, tests).
//
// RULES:
//   - Any change to this interface is a BREAKING CHANGE and requires
//     coordinated updates in all consumers before publishing.
//   - All types are imported from @brandos/contracts — never redeclare
//     runtime types here. This file only exposes the surface, not the shape.
//   - Implementation classes (RuntimeEngine, AIRuntimeAdapter) satisfy
//     this interface but are NOT exported from this file.
//   - The configProvider injection pattern (RuntimeConfigProvider) is the
//     only approved coupling between this package and control-plane-layer.
//
// USAGE (consuming packages):
//   import type { IAIRuntime } from '@brandos/ai-runtime-layer/public'
//   import type { IRuntimeBridge } from '@brandos/ai-runtime-layer/public'
//
// USAGE (implementation):
//   export class MyRuntime implements IAIRuntime { ... }
// ============================================================

import type {
  // Core invocation
  InvocationRequest,
  AIRuntimeOutput,

  // Capability detection
  CapabilityResult,
  CapabilityCheckOptions,

  // Telemetry
  TelemetryStats,
  TelemetrySnapshot,

  // Config
  AIRuntimeConfig,
} from '@brandos/contracts'

// ─────────────────────────────────────────────────────────────
// IAIRuntime
//
// The canonical runtime interface. Implemented by:
//   - RuntimeEngine       (full DI-wired implementation)
//   - AIRuntimeAdapter    (platform integration seam)
//
// Consumers must depend on this interface, never on concrete classes.
// This ensures mocking, testing, and future runtime implementations
// can be swapped without changing consumer code.
// ─────────────────────────────────────────────────────────────
export interface IAIRuntime {
  /**
   * Execute an AI invocation.
   *
   * - Handles capability detection, routing, prompt building, provider
   *   invocation, retries, fallbacks, circuit breaking, and telemetry.
   * - Never throws. Terminal failures are returned as AIRuntimeOutput
   *   with status: 'terminal_failure'.
   * - Artifact task types (generate_deck, generate_carousel, generate_report)
   *   are automatically enriched with structured-output prompts and JSON mode
   *   by AIRuntimeAdapter before reaching RuntimeEngine.
   *
   * @param request - Fully-specified invocation request.
   * @returns AIRuntimeOutput — always resolved, never rejected.
   */
  run(request: InvocationRequest): Promise<AIRuntimeOutput>

  /**
   * Detect which execution modes and providers are currently available.
   *
   * Results are cached (default TTL: 60s). Pass force_refresh: true
   * to bypass the cache (e.g. after a provider config change).
   *
   * @param options - Optional detection parameters.
   * @returns CapabilityResult with available modes, provider statuses, policy restrictions.
   */
  capabilities(options?: CapabilityCheckOptions): Promise<CapabilityResult>

  /**
   * Force a fresh capability detection, bypassing the cache.
   *
   * Equivalent to capabilities({ force_refresh: true }) but surfaced
   * separately for admin UIs that need an explicit "check now" action.
   *
   * @returns Fresh CapabilityResult — never returns cached data.
   */
  refreshCapabilities(): Promise<CapabilityResult>

  /**
   * Return aggregated telemetry statistics for this runtime instance.
   *
   * Synchronous — no I/O. Computed from the in-memory snapshot buffer.
   * Covers: total_requests, success_rate, avg_latency_ms, fallback_rate,
   * and per-provider breakdowns.
   *
   * @returns TelemetryStats snapshot.
   */
  stats(): TelemetryStats

  /**
   * Return the full history of TelemetrySnapshots for this runtime instance.
   *
   * Each snapshot corresponds to one invocation attempt (including fallbacks).
   * History is bounded by the in-memory buffer; it does not persist across
   * runtime rebuilds (invalidate() calls).
   *
   * @returns Array of TelemetrySnapshot, ordered by timestamp ascending.
   */
  telemetryHistory(): TelemetrySnapshot[]
}

// ─────────────────────────────────────────────────────────────
// RuntimeConfigProvider
//
// A zero-argument function that returns partial AIRuntimeConfig overrides.
// Injected by control-plane-layer via setRuntimeConfigProvider().
//
// The runtime calls this lazily — only when building/rebuilding the
// internal engine instance. It is NOT called on every invocation.
//
// DESIGN CONTRACT:
//   - Must be synchronous (no async providers).
//   - Must not throw. Errors silently degrade to env-only config.
//   - Must return a stable Partial<AIRuntimeConfig>. The runtime
//     merges it with env-derived config via ConfigLoader.merge().
//   - MUST NOT call back into the runtime (no circular dependency).
//
// EXAMPLE (control-plane-layer injection):
//   setRuntimeConfigProvider(() => assembleRuntimeOverrides(adminSettings))
// ─────────────────────────────────────────────────────────────
export type RuntimeConfigProvider = () => Partial<AIRuntimeConfig>

// ─────────────────────────────────────────────────────────────
// IRuntimeBridge
//
// The narrow slice of the runtime API that the llmRouter exposes to
// the rest of the application. Callers that only need to send prompts
// should depend on this instead of IAIRuntime.
//
// This interface deliberately excludes telemetry and capability management
// to prevent non-admin callers from triggering expensive operations.
// ─────────────────────────────────────────────────────────────
export interface IRuntimeBridge {
  /**
   * Execute a prompt in the given mode.
   *
   * Wraps IAIRuntime.run() with mode resolution, legacy string translation,
   * and structured failure response handling.
   *
   * @param prompt - User-facing prompt text.
   * @param mode   - 'local' | 'cloud' or legacy string (auto-translated).
   * @param opts   - Optional system prompt, image, userId, task type, routing hint.
   */
  callWithMode(
    prompt: string,
    mode: string,
    opts?: RuntimeBridgeCallOptions
  ): Promise<RuntimeBridgeResult>

  /**
   * Set the configuration provider used to override env-derived settings.
   * Call once at startup (before first invocation) via control-plane-layer.
   *
   * Calling this invalidates the current internal runtime instance.
   * The next callWithMode() will rebuild the runtime with the new provider.
   *
   * @param fn - Config provider function (see RuntimeConfigProvider).
   */
  setConfigProvider(fn: RuntimeConfigProvider): void

  /**
   * Invalidate the internal runtime instance without changing the config provider.
   * The next callWithMode() will rebuild from the current config provider.
   *
   * Use after admin changes that don't require a new config provider
   * (e.g. provider toggled, model changed).
   */
  resetRuntime(): void
}

// ─────────────────────────────────────────────────────────────
// Supporting types for IRuntimeBridge
// ─────────────────────────────────────────────────────────────

/**
 * Optional parameters for IRuntimeBridge.callWithMode().
 * Mirrors the CallOptions shape used internally in llmRouter.ts.
 */
export interface RuntimeBridgeCallOptions {
  /** Override system prompt. When absent, PromptBuilder uses task-type defaults. */
  systemPrompt?: string | undefined
  /** Base64-encoded image for VLM invocations. */
  imageBase64?: string | undefined
  /** Optional user ID for per-user telemetry attribution. */
  userId?: string | undefined
  /** Execution task type. Defaults to 'text' (maps to InvocationType 'chat'). */
  taskType?: 'text' | 'carousel' | 'vlm' | 'extraction' | undefined
  /** Routing hint for advanced provider selection (dev/staging use). */
  routingHint?: import('@brandos/contracts').RoutingHint | undefined
}

/**
 * Discriminated union result from IRuntimeBridge.callWithMode().
 * Use isUnavailable() to narrow the type.
 */
export type RuntimeBridgeResult = RuntimeBridgeSuccess | RuntimeBridgeUnavailable

export interface RuntimeBridgeSuccess {
  content: string
  /** 'local' for Ollama/LMStudio; 'cloud' for all external providers. */
  providerKind: 'local' | 'cloud'
  /** Human-readable model name from the model registry. */
  model: string
  /** Registry ID (e.g. 'claude-sonnet', 'gpt-4o-mini'). */
  modelId: string
  /** Internal provider name (e.g. 'anthropic', 'openai'). */
  provider: string
  /** The mode that was requested (not necessarily the mode used). */
  runtimeMode: import('@brandos/contracts').RuntimeMode
  latency_ms: number
  /** True when the response came from a fallback provider, not the primary. */
  fallback?: boolean | undefined
  /** Attribution badge string for display in UI. */
  engine_badge: string
}

export interface RuntimeBridgeUnavailable {
  unavailable: true
  runtimeMode: import('@brandos/contracts').RuntimeMode
  /** Technical message for logging. */
  message: string
  /** User-facing message explaining the issue and next steps. */
  userMessage: string
  /** Suggested actions to render as buttons in the UI. */
  actions: Array<{ label: string; action: string }>
}


