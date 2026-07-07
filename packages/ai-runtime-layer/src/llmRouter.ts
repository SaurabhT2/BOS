// ============================================================
// packages/ai-runtime-layer/src/llmRouter.ts
//
// SINGLETON RUNTIME ROUTER — PUBLIC CALL SURFACE
//
// This is the primary entry point for the rest of the application
// when it wants to invoke an AI model. It manages:
//
//   1. SINGLETON RUNTIME: One AIRuntimeAdapter instance per process.
//      Lazily built on first use. Rebuilt when config changes or
//      resetRuntime() is called. Module-level state is intentional;
//      the runtime is expensive to construct (provider health checks).
//
//   2. CONFIG PROVIDER: control-plane-layer injects its config assembly
//      function via setRuntimeConfigProvider(). This is the only path
//      for admin settings to reach the runtime. Never call AdminSettingsService
//      directly from this file.
//
//   3. TASK TYPE MAPPING: Maps the public TaskType vocabulary
//      ('text', 'carousel', 'vlm', 'extraction') to InvocationType
//      values the runtime understands ('chat', 'carousel', 'image_analysis', 'summarize').
//
//   4. LEGACY MODE TRANSLATION: Accepts legacy string modes (e.g. 'cloud_pro',
//      'cloud_free') and translates them to 'cloud' or 'local' via fromLegacyToRuntimeMode.
//      This boundary is explicit: one translation point, not scattered across callers.
//
//   5. UNAVAILABLE RESPONSES: When the runtime fails terminally, returns a
//      structured UnavailableResponse (not a throw) so callers can render
//      actionable UI (retry button, open settings, etc.).
//
// PHASE 6 CHANGES (previously documented):
//   - EngineMode removed. engine field removed from LLMResponse.
//   - providerKind: 'local' | 'cloud' added (derived from LOCAL_PROVIDERS set).
//   - MODE_MAP replaced with direct runtimeMode → preferred_mode.
//   - engineMode route parameter rejected at call site.
//   - modeToEngineMode, modeToTier removed.
//
// INVARIANTS (see AGENT_CONTEXT.md §5):
//   I-1: Config comes only via setRuntimeConfigProvider(). Never read Supabase here.
// ============================================================

import { AIRuntimeAdapter, type RuntimeConfigProvider } from './AIRuntimeAdapter'
import type { InvocationRequest, AIRuntimeOutput, RuntimeMode, TelemetryStats,TelemetrySnapshot } from '@brandos/contracts'

import { fromLegacyToRuntimeMode } from '@brandos/contracts'

import { MODEL_REGISTRY } from './registry'
import { buildOutputBadge } from './generationModes'
import { PROVIDER_REGISTRY, isLocalProvider } from '@brandos/contracts'

/**
 * Resolve the kind discriminator for a given provider name.
 * Uses the canonical isLocalProvider() from @brandos/contracts/provider-registry.
 *
 * @param provider - Provider name from AIRuntimeOutput.engine_used.
 * @returns 'local' for local providers; 'cloud' for all external providers.
 */
function resolveProviderKind(provider: string): 'local' | 'cloud' {
  return isLocalProvider(provider) ? 'local' : 'cloud'
}

// ─────────────────────────────────────────────────────────────
// Public Types
// ─────────────────────────────────────────────────────────────

/**
 * The simplified task type vocabulary exposed to the rest of the app.
 * Mapped to InvocationType values internally via TASK_TYPE_MAP.
 *
 * Do NOT add new values here without also adding entries to TASK_TYPE_MAP.
 */
export type TaskType = 'text' | 'carousel' | 'vlm' | 'extraction'

/**
 * Successful response from callWithMode() / callLLM().
 *
 * All fields are always present on success (no optional chains needed).
 * Use isUnavailable() to check before accessing these fields.
 */
export interface LLMResponse {
  /** The model's text output. */
  content: string
  /** 'local' for Ollama/LMStudio; 'cloud' for external providers. */
  providerKind: 'local' | 'cloud'
  /** Human-readable model name from MODEL_REGISTRY. Falls back to provider name. */
  model: string
  /** Registry model ID (e.g. 'claude-sonnet', 'gpt-4o-mini'). Falls back to provider name. */
  modelId: string
  /** Internal provider name (e.g. 'anthropic', 'openai', 'ollama'). */
  provider: string
  /** The mode requested by the caller (not necessarily the mode used by the runtime). */
  runtimeMode: RuntimeMode
  /** Wall-clock time from request start to response complete, in milliseconds. */
  latency_ms: number
  /**
   * True when the response came from a fallback provider, not the primary.
   * Surface in UI as a quality indicator ("Response via fallback model").
   */
  fallback?: boolean | undefined
  /** Attribution badge string. Render in UI footers, export metadata, etc. */
  engine_badge: string
  /**
   * Sprint A — model traceability fields.
   * configuredModel: the admin-selected default for this provider.
   * resolvedModel:   the model ID that actually ran (from adapter).
   * These are always equal unless request.model was set explicitly.
   */
  configuredModel?: string | undefined
  resolvedModel?:   string | undefined
}

/**
 * Unavailable response from callWithMode() when the runtime cannot complete the request.
 *
 * Returned (not thrown) when all providers fail. Callers should render
 * userMessage and actions to help the user recover.
 *
 * Use isUnavailable() to narrow RouterResult to this type.
 */
export interface UnavailableResponse {
  readonly unavailable: true
  /** The mode that was requested. Useful for analytics. */
  runtimeMode: RuntimeMode
  /** Technical reason string for logging. Never display to end users. */
  message: string
  /** User-facing explanation with recovery steps. Safe to render in UI. */
  userMessage: string
  /**
   * Suggested recovery actions. Render as buttons or links.
   * Each action.action is a stable string key (e.g. 'retry', 'open_settings').
   */
  actions: Array<{ label: string; action: string }>
}

/** The full result type from callWithMode(). Narrow with isUnavailable(). */
export type RouterResult = LLMResponse | UnavailableResponse

/**
 * Type guard: narrows RouterResult to UnavailableResponse.
 *
 * Usage:
 *   const result = await callWithMode(prompt, mode)
 *   if (isUnavailable(result)) { renderError(result.userMessage); return }
 *   renderContent(result.content)
 */
export function isUnavailable(r: RouterResult): r is UnavailableResponse {
  return 'unavailable' in r && r.unavailable === true
}

// ─────────────────────────────────────────────────────────────
// Task Type Mapping
//
// Maps the public TaskType vocabulary to InvocationType values.
// InvocationType is the internal runtime vocabulary. This mapping
// is the single translation point — do not spread this logic to callers.
//
// 'text'       → 'chat'           (standard text generation)
// 'carousel'   → 'carousel'       (JSON slide array, JSON mode activated)
// 'vlm'        → 'image_analysis' (vision model invocation)
// 'extraction' → 'summarize'      (content extraction, no JSON mode)
// ─────────────────────────────────────────────────────────────
const TASK_TYPE_MAP: Record<TaskType, string> = {
  text:       'chat',
  carousel:   'carousel',
  vlm:        'image_analysis',
  extraction: 'summarize',
}

// ─────────────────────────────────────────────────────────────
// Singleton Runtime State
//
// _runtime: the single AIRuntimeAdapter instance for this process.
//   null = not yet built. Built lazily on first getRuntime() call.
//   Rebuilt when invalidate() is called (config change or explicit reset).
//
// _configProvider: the function that returns admin setting overrides.
//   Starts as a no-op. Replaced by setRuntimeConfigProvider() at startup.
//   The runtime is invalidated whenever this is replaced.
//
// THREAD SAFETY: Node.js is single-threaded. No locks needed.
// PROCESS LIFETIME: Both singletons live for the life of the process.
//   In Next.js dev mode, module re-evaluation may reset them — this is fine
//   because the runtime will lazily rebuild on the next request.
// ─────────────────────────────────────────────────────────────
const _DEFAULT_CONFIG_PROVIDER: RuntimeConfigProvider = () => ({})

// ─── globalThis store (defense-in-depth against Next.js module splits) ────────
// See packages/cognition-client/src/global-client.ts for full
// explanation. Same pattern applied here: _configProvider and _runtime live on
// globalThis so they survive across webpack chunk boundaries.

declare global {
  // eslint-disable-next-line no-var
  var __BRANDOS_ARL_CONFIG_PROVIDER__: RuntimeConfigProvider | undefined
  // eslint-disable-next-line no-var
  var __BRANDOS_ARL_RUNTIME__: AIRuntimeAdapter | null | undefined
}

function _getConfigProvider(): RuntimeConfigProvider {
  return globalThis.__BRANDOS_ARL_CONFIG_PROVIDER__ ?? _DEFAULT_CONFIG_PROVIDER
}
function _setConfigProvider(fn: RuntimeConfigProvider): void {
  globalThis.__BRANDOS_ARL_CONFIG_PROVIDER__ = fn
}
function _getRuntime(): AIRuntimeAdapter | null {
  return globalThis.__BRANDOS_ARL_RUNTIME__ ?? null
}
function _setRuntime(r: AIRuntimeAdapter | null): void {
  globalThis.__BRANDOS_ARL_RUNTIME__ = r
}

// Legacy module-level variables kept as fallback for non-Next.js environments
// (tests, standalone gateway). In Next.js, globalThis accessors above take over.
let _configProvider: RuntimeConfigProvider = _DEFAULT_CONFIG_PROVIDER
let _runtime: AIRuntimeAdapter | null = null

// ─────────────────────────────────────────────────────────────
// Config Provider Management
// ─────────────────────────────────────────────────────────────

/**
 * Set the configuration provider used to merge admin overrides into the runtime config.
 *
 * CALL ONCE at application startup (in layout.tsx, instrumentation.ts, or
 * control-plane-layer bootstrap). Calling more than once is safe — it invalidates
 * the current runtime and rebuilds on the next request.
 *
 * The provider function is called lazily (not immediately). It must:
 *   - Be synchronous
 *   - Not throw
 *   - Return a stable Partial<AIRuntimeConfig>
 *   - Not call back into the runtime
 *
 * @param fn - Config provider from control-plane-layer (e.g. assembleRuntimeOverrides).
 */
export function setRuntimeConfigProvider(fn: RuntimeConfigProvider): void {
  _configProvider = fn
  _setConfigProvider(fn)
  // Invalidate the existing runtime so the next call rebuilds with the new provider.
  const rt = _getRuntime()
  if (rt) rt.invalidate()
  else if (_runtime) _runtime.invalidate()
}

/**
 * Wire the config provider only if it has not already been set by a prior call.
 *
 * Called by instrumentation.ts or layout bootstrappers that may run in
 * development mode with hot module replacement — avoids overwriting a provider
 * that was already set by the primary bootstrap path.
 *
 * @param providerFactory - A factory function that returns the config provider.
 *                          Called lazily only if the current provider is the default no-op.
 */
export function ensureRuntimeInitialized(providerFactory: () => RuntimeConfigProvider): void {
  // Use module-local check as primary (reliable in test environments).
  // Also check globalThis for the case where another module instance already set a provider.
  const moduleLocal = _configProvider === _DEFAULT_CONFIG_PROVIDER
  const globalStore = !globalThis.__BRANDOS_ARL_CONFIG_PROVIDER__ ||
    globalThis.__BRANDOS_ARL_CONFIG_PROVIDER__ === _DEFAULT_CONFIG_PROVIDER
  // Only skip if a real (non-default) provider is wired in EITHER location
  if (moduleLocal && globalStore) {
    setRuntimeConfigProvider(providerFactory())
    console.info('[LLMRouter] ensureRuntimeInitialized: configProvider wired')
  }
}

// ─────────────────────────────────────────────────────────────
// Singleton Lifecycle
// ─────────────────────────────────────────────────────────────

/**
 * Get the singleton runtime adapter, building it if needed.
 *
 * Lazy construction: the adapter is not built until the first invocation.
 * This avoids triggering provider health checks at module load time.
 */
function getRuntime(): AIRuntimeAdapter {
  // Prefer globalThis store — survives module splits
  let rt = _getRuntime()
  if (!rt) {
    rt = new AIRuntimeAdapter({ configProvider: _getConfigProvider() })
    _setRuntime(rt)
    _runtime = rt
    // Expose on globalThis so artifact-engine-layer's bootstrapArtifactEngine()
    // can call registerArtifactPrompt() without importing from this package.
    // This completes the Phase 1.1 bridge (Fix C1).
    ;(globalThis as Record<string, unknown>).__brandos_runtime_adapter = rt
    console.info('[LLMRouter] Runtime initialised')
  } else {
    _runtime = rt // keep module-local in sync for non-Next.js callers
    // Ensure globalThis bridge is always set (handles module re-evaluation in dev)
    if (!(globalThis as Record<string, unknown>).__brandos_runtime_adapter) {
      ;(globalThis as Record<string, unknown>).__brandos_runtime_adapter = rt
    }
  }
  return rt
}

/**
 * Invalidate the internal runtime instance.
 *
 * The next callWithMode() will rebuild the runtime from the current config provider.
 * Does NOT change the config provider — use setRuntimeConfigProvider() for that.
 *
 * Call after: admin disables/enables a provider, model changed, timeout adjusted.
 * The control-plane-layer's admin routes call this after persisting settings.
 */
export function resetRuntime(): void {
  const rt = _getRuntime() ?? _runtime
  if (rt) rt.invalidate()
  _setRuntime(null)
  _runtime = null
  console.info('[LLMRouter] Runtime invalidated — will rebuild on next request')
}

// ─────────────────────────────────────────────────────────────
// Response Builders
// ─────────────────────────────────────────────────────────────

/**
 * Build a structured unavailable response for terminal failures.
 * Never throws. Returns a message the UI can render with action buttons.
 *
 * @param mode   - The runtime mode that was attempted.
 * @param reason - Technical reason string for logging. Not shown to users.
 */
function makeUnavailable(mode: RuntimeMode, reason: string): UnavailableResponse {
  const label = mode === 'local' ? 'Local' : 'Cloud'
  console.warn(`[LLMRouter] ${label} unavailable: ${reason}`)

  return {
    unavailable: true,
    runtimeMode: mode,
    message: reason,
    userMessage:
      'No generation engine is currently available.\n\nTo continue:\n' +
      '1. Enable Local mode (local models via Ollama)\n' +
      '2. Add a cloud API key in Settings\n' +
      '3. Retry in a moment',
    actions: [
      { label: 'Retry',         action: 'retry' },
      { label: 'Open Settings', action: 'open_settings' },
    ],
  }
}

/**
 * Build a successful LLMResponse from a successful AIRuntimeOutput.
 *
 * Enriches the raw runtime output with registry metadata (model name, modelId)
 * and provider-kind labelling for UI rendering.
 *
 * @param output        - Successful AIRuntimeOutput from the runtime.
 * @param requestedMode - The mode the caller requested (for runtimeMode field).
 * @param fallback      - True when output.fallback_used is set.
 */
function buildResponse(
  output: AIRuntimeOutput,
  requestedMode: RuntimeMode,
  fallback: boolean,
): LLMResponse {
  const provider     = output.engine_used ?? 'unknown'
  const providerKind = resolveProviderKind(provider)

  // Look up model metadata from the registry for human-readable names.
  // Falls back to the provider name if the model is not in the registry.
  const registryModel = MODEL_REGISTRY.find(m => m.provider === provider)
  const modelName     = registryModel?.name ?? provider

  // Sprint A — Obj 1: structured execution trace
  // resolvedModel: what adapter actually ran (output.model_used from ProviderInvokeResult)
  // configuredModel: the admin-configured default for this provider, propagated through
  //   the telemetry snapshot (TelemetrySnapshot.configured_model) by ExecutionEngine.
  //   This is the actual value from assembleRuntimeOverrides → adapter constructor →
  //   invokeReq.model. Falls back to registry lookup or provider name.
  //
  // FIX-MODEL-2: configuredModel previously always read from MODEL_REGISTRY which returns
  // the FIRST model registered for a provider — not the admin-selected model. If an admin
  // configured google to use gemini-1.5-pro-latest but the registry had gemini-2.5-flash
  // as its entry, configuredModel would report gemini-2.5-flash even when the real
  // configured value was gemini-1.5-pro-latest. Now we read from telemetry which carries
  // the actual value from the execution path (set in ExecutionEngine via invokeReq.model).
  const resolvedModel   = output.model_used ?? registryModel?.apiModel ?? provider
  const configuredModel = output.telemetry?.configured_model
                       ?? registryModel?.apiModel
                       ?? provider

  console.info('[LLMRouter] execution trace', JSON.stringify({
    runtimeMode:     requestedMode,
    provider,
    configuredModel,
    resolvedModel,
    fallbackUsed:    fallback,
    latencyMs:       output.latency_ms,
  }))

  return {
    content:        output.content ?? '',
    providerKind,
    model:          modelName,
    modelId:        registryModel?.id ?? provider,
    provider,
    runtimeMode:    requestedMode,
    latency_ms:     output.latency_ms,
    fallback,
    engine_badge:   buildOutputBadge(),
    configuredModel,
    resolvedModel,
  }
}

// ─────────────────────────────────────────────────────────────
// Core Call Helper (internal)
// ─────────────────────────────────────────────────────────────

/**
 * Options for callRuntime — internal only.
 * Exposed via callWithMode's public CallOptions parameter.
 */
interface CallOptions {
  systemPrompt?:    string | undefined
  imageBase64?:     string | undefined
  userId?:          string | undefined
  taskType?:        TaskType | undefined
  routingHint?:     import('@brandos/contracts').RoutingHint | undefined
  /**
   * P3 — BYOK: per-provider API key overrides.
   *
   * Map of provider name → plaintext API key. When present, the runtime uses
   * the workspace-supplied key instead of the platform environment key for
   * that provider. Passed through to InvocationRequest as api_key_overrides
   * and consumed at the ExecutionEngine dispatch site (F5).
   *
   * Absent or empty object → runtime falls through to platform env keys.
   * NEVER LOG. Contains plaintext keys.
   */
  apiKeyOverrides?: Record<string, string> | undefined
}

/**
 * Assemble and dispatch an InvocationRequest to the runtime.
 *
 * This is the single point where all callWithMode / callLLM calls are
 * translated into InvocationRequests. Keeping it centralised ensures
 * all callers get the same retry budget, timeout, and schema defaults.
 *
 * max_tokens defaults:
 *   - local: 2048 — local models have shorter context; avoid truncation
 *   - cloud: 1500 — tighter for cost control; callers can override via opts
 *
 * @param prompt - User-facing prompt text (user_intent in the request).
 * @param mode   - Runtime mode to request (local | cloud).
 * @param opts   - Optional system prompt, image, userId, task type, hint.
 * @returns Raw AIRuntimeOutput from the runtime.
 */
async function callRuntime(
  prompt: string,
  mode:   RuntimeMode,
  opts:   CallOptions,
): Promise<AIRuntimeOutput> {
  const runtime = getRuntime()

  // RuntimeMode ('local' | 'cloud') maps directly to ExecutionMode for the plan.
  // 'auto' is not exposed to callers — the runtime uses it internally for cascade.
  const preferredMode = mode as any

  console.debug(`[LLMRouter] callRuntime runtimeMode=${mode} → preferred_mode=${preferredMode}`)

  const request: InvocationRequest = {
    user_intent:    prompt,
    task_type:      (TASK_TYPE_MAP[opts.taskType ?? 'text'] as any),
    preferred_mode: preferredMode,
    context:        opts.systemPrompt,
    // Vision requests attach the image as a base64 attachment.
    // The adapter reads this via request.attachments[0].data.
    ...(opts.imageBase64
      ? { attachments: [{ type: 'image_base64', data: opts.imageBase64 }] }
      : {}),
    output_schema: {
      type:       'text',
      max_tokens: mode === 'local' ? 2048 : 4096,
      strict:     false,
    },
    ...(opts.userId ? { user_id: opts.userId } : {}),
    routing_hint: opts.routingHint,
    // Phase 4: per-request model override forwarded from routingHint.preferred_model.
    // Consumed by ExecutionEngine at the dispatch site (replaces adapter default when set).
    ...(opts.routingHint?.preferred_model
      ? { preferred_model: opts.routingHint.preferred_model }
      : {}),
    // P3 — BYOK: workspace API key overrides (F5: consumed at ExecutionEngine dispatch)
    ...(opts.apiKeyOverrides && Object.keys(opts.apiKeyOverrides).length > 0
      ? { api_key_overrides: opts.apiKeyOverrides }
      : {}),
  }

  return runtime.run(request)
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Call the AI runtime with a mode and optional configuration.
 *
 * PRIMARY ENTRY POINT for all AI generation in the application.
 * Used by: Studio page, generation routes, agent runners.
 *
 * LEGACY MODE SUPPORT:
 *   Accepts legacy string modes (e.g. 'cloud_pro', 'cloud_free') and
 *   translates them to 'cloud' or 'local' via fromLegacyToRuntimeMode.
 *   This translation happens once here — callers do not need to handle it.
 *
 * NEVER THROWS:
 *   Terminal failures are returned as UnavailableResponse.
 *   Check with isUnavailable() before accessing LLMResponse fields.
 *
 * @param prompt - The user's prompt or generation instruction.
 * @param mode   - 'local' | 'cloud' or a legacy string mode.
 * @param opts   - Optional call configuration (systemPrompt, image, taskType, etc.)
 * @returns LLMResponse on success, UnavailableResponse on terminal failure.
 */
export async function callWithMode(
  prompt: string,
  mode:   RuntimeMode | string,
  opts?:  CallOptions | undefined,
): Promise<RouterResult> {
  const options = opts ?? {}

  // Translate legacy modes at this boundary. fromLegacyToRuntimeMode is idempotent
  // for valid RuntimeMode values ('local', 'cloud') — they pass through unchanged.
  const runtimeMode: RuntimeMode = (mode === 'local' || mode === 'cloud')
    ? mode
    : fromLegacyToRuntimeMode(mode as string)

  try {
    const output = await callRuntime(prompt, runtimeMode, options)

    // A terminal_failure or empty content means no usable response was produced.
    // Return an UnavailableResponse so the caller can surface recovery options.
    if (output.status === 'terminal_failure' || !output.content) {
      return makeUnavailable(runtimeMode, output.error?.message ?? 'All providers failed')
    }

    return buildResponse(output, runtimeMode, output.fallback_used ?? false)
  } catch (err) {
    // callRuntime itself should not throw (AIRuntimeAdapter.run never throws),
    // but defensive catch here ensures this function signature holds.
    const msg = (err as Error).message
    console.error(`[LLMRouter] callWithMode(${runtimeMode}) threw:`, msg)
    return makeUnavailable(runtimeMode, msg)
  }
}

/**
 * Simplified call helper that throws on failure instead of returning UnavailableResponse.
 *
 * Use in contexts where the caller wants to handle errors via try/catch
 * (e.g. agent runners, background jobs) rather than by rendering an UnavailableResponse.
 *
 * @param prompt  - The user's prompt.
 * @param mode    - 'local' | 'cloud' (defaults to 'cloud').
 * @param userId  - Optional user ID for telemetry attribution.
 * @returns LLMResponse on success.
 * @throws Error with userMessage when the runtime is unavailable.
 */
export async function callLLM(
  prompt:  string,
  mode:    RuntimeMode = 'cloud',
  userId?: string | undefined,
): Promise<LLMResponse> {
  const result = await callWithMode(prompt, mode, { userId })
  if (isUnavailable(result)) throw new Error(result.userMessage)
  return result
}

/**
 * Return a static attribution label for UI display.
 *
 * The mode parameter is accepted for API compatibility but not used.
 * All modes return the same platform attribution string.
 *
 * @param _mode - Ignored. Kept for API compatibility.
 */
export function engineLabel(_mode: RuntimeMode | string): string {
  return 'Model-Assisted • BrandOS Powered'
}

/**
 * Return all available models from the registry, enriched with providerKind.
 *
 * Used by: admin AI-runtime page, model selector UI, provider availability checks.
 * The list is static (from MODEL_REGISTRY) — not filtered by current availability.
 * Use capabilities() for live provider health status.
 *
 * @returns Array of model descriptors with providerKind and vision support flags.
 */
export function getAvailableModels() {
  return MODEL_REGISTRY.map(m => ({
    id:             m.id,
    name:           m.name,
    providerKind:   resolveProviderKind(m.provider) as 'local' | 'cloud',
    provider:       m.provider,
    supportsVision: m.supportsVision,
    notes:          m.notes,
  }))
}
// ============================================================
// ADDITION TO packages/ai-runtime-layer/src/llmRouter.ts
//
// ADD THESE EXPORTS at the bottom of the file (after getAvailableModels).
// These allow apps/web/lib/ai-runtime.ts to read from the live singleton
// without creating a second runtime instance.
//
// PURPOSE:
//   apps/web/lib/ai-runtime.ts previously created a hollow
//   AIRuntimeFactory.create({providers:{}}) singleton. That singleton had
//   no providers and returned zero stats. It has been replaced with
//   getLiveRuntimeStats() / getLiveRuntimeHistory() which read from
//   this module's _runtime singleton directly.
//
// INVARIANT:
//   These functions must NOT expose the _runtime reference itself.
//   They return only value types (TelemetryStats, TelemetrySnapshot[]).
//   The singleton remains internal.
// ============================================================

/**
 * Return telemetry stats from the active runtime singleton.
 *
 * Returns zero-value stats if the runtime has not been initialized yet.
 * Safe to call at any time — never throws.
 *
 * Used by: apps/web/lib/ai-runtime.ts → getLiveRuntimeStats()
 */
export function getActiveTelemetryStats(): TelemetryStats {
  if (!_runtime) {
    return {
      total_requests: 0,
      success_rate: 0,
      avg_latency_ms: 0,
      fallback_rate: 0,
      by_provider: {},
    }
  }
  return _runtime.stats()
}

/**
 * Return telemetry history from the active runtime singleton.
 *
 * Returns an empty array if the runtime has not been initialized yet.
 * Safe to call at any time — never throws.
 *
 * Used by: apps/web/lib/ai-runtime.ts → getLiveRuntimeHistory()
 */
export function getActiveTelemetryHistory(): TelemetrySnapshot[] {
  if (!_runtime) return []
  return _runtime.telemetryHistory()
}

/**
 * Return true if the runtime singleton has been initialized.
 *
 * Used by tests and health checks to verify startup completion.
 * Does NOT build the runtime if absent (use getRuntime() for that).
 */
export function isRuntimeInitialized(): boolean {
  return _runtime !== null
}

/**
 * Prime the runtime singleton so globalThis.__brandos_runtime_adapter is set.
 *
 * BOOTSTRAP USE ONLY. Call this in instrumentation.ts BEFORE bootstrapArtifactEngine()
 * so that registerArtifactPrompt() finds the adapter on globalThis when AEL bootstrap runs.
 *
 * Without this, the adapter is created lazily on the first carousel/deck/report request,
 * which is after bootstrapArtifactEngine() has already attempted (and silently failed) to
 * register the artifact task prompts. The Phase 1.1 bridge (schema prompt injection,
 * JSON mode, temperature-0) would never activate.
 *
 * Calling primeRuntime() twice is safe — getRuntime() is idempotent (builds once).
 */
export function primeRuntime(): void {
  getRuntime() // constructs adapter + sets globalThis.__brandos_runtime_adapter
  console.info('[LLMRouter] Runtime primed at bootstrap — registerArtifactPrompt() bridge active')
}

/**
 * Reset the runtime singleton for test isolation.
 *
 * TESTS ONLY. Calling this in production code is an architectural violation.
 * Each test file that exercises singleton behavior must call this in beforeEach.
 *
 * Resets both _runtime and _configProvider to their default no-op state.
 */
export function _resetRuntimeForTest(): void {
  _runtime = null
  _configProvider = _DEFAULT_CONFIG_PROVIDER
  // Also clear globalThis store so tests start from a clean slate
  _setRuntime(null)
  _setConfigProvider(_DEFAULT_CONFIG_PROVIDER)
}


