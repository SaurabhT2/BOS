// ============================================================
// packages/ai-runtime-layer/src/AIRuntimeAdapter.ts
//
// PLATFORM INTEGRATION SEAM
//
// This file is the boundary between the platform (control-plane-layer,
// output-control-layer, apps/web) and the ai-runtime-layer internals.
//
// WHAT IT DOES:
//   1. Implements IAIRuntime so callers depend on the interface, not
//      the concrete RuntimeEngine class.
//   2. Intercepts artifact-specific task types (generate_deck, generate_carousel,
//      generate_report) and enriches the InvocationRequest before passing it
//      to the internal RuntimeEngine:
//        - Injects an artifact-specific system prompt from ARTIFACT_TASK_PROMPTS
//          (owned by output-control-layer, injected via import)
//        - Forces output_schema.type = 'json' to activate native JSON mode
//          in provider adapters (OpenAI response_format, Anthropic JSON mode)
//        - Sets temperature = 0 via metadata for deterministic structured output
//        - Preserves the original task_type so RouterEngine uses the correct
//          timeout (carousel = 20s, not the json fallback of 15s)
//   3. Wraps config construction behind a RuntimeConfigProvider so
//      control-plane-layer can inject live admin overrides without the
//      runtime importing from Supabase or app state directly.
//   4. Exposes invalidate() so the singleton llmRouter can force a runtime
//      rebuild after admin settings change.
//
// DEPENDENCY INJECTION CONTRACT:
//   Options priority (highest to lowest):
//     1. configProvider — dynamic: env defaults + provider overrides on every rebuild
//     2. config         — static:  use this exact config, no merging
//     3. configPath     — static:  load from file, no merging
//     4. (none)         — fallback: ConfigLoader.fromEnv() only, no overrides
//
// INVARIANTS (see AGENT_CONTEXT.md §5):
//   I-1: Never import AdminSettingsService or Supabase from this file.
//   I-4: IAIRuntime must be fully implemented (all 5 methods).
//   I-10: Preserve task_type when enriching artifact requests.
//         Only output_schema.type is changed to 'json'.
// ============================================================

import type {
  IAIRuntime,
  AIRuntimeConfig,
  AIRuntimeOutput,
  InvocationRequest,
  CapabilityResult,
  CapabilityCheckOptions,
  TelemetryStats,
  TelemetrySnapshot,
} from '@brandos/contracts'

import { AIRuntimeFactory } from './config/factory'
import { ConfigLoader } from './config/loader'

// ─────────────────────────────────────────────────────────────
// Artifact Prompt Registry (Fix C1)
//
// ARL no longer imports ARTIFACT_TASK_PROMPTS from output-control-layer.
//
// Instead, artifact-engine-layer's bootstrapArtifactEngine() calls
// registerArtifactPrompt() on the adapter (via globalThis.__brandos_runtime_adapter)
// at startup time. This decouples ARL from OCL's domain content entirely.
//
// The registry lives on globalThis so it survives Next.js module splits.
// Prompts are registered once at bootstrap; the map is read-only thereafter.
// ─────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __BRANDOS_ARTIFACT_PROMPTS__: Map<string, string> | undefined
}

function _getPromptRegistry(): Map<string, string> {
  if (!globalThis.__BRANDOS_ARTIFACT_PROMPTS__) {
    globalThis.__BRANDOS_ARTIFACT_PROMPTS__ = new Map<string, string>()
  }
  return globalThis.__BRANDOS_ARTIFACT_PROMPTS__
}

// ─────────────────────────────────────────────────────────────
// RuntimeConfigProvider
//
// A zero-argument function that returns partial AIRuntimeConfig overrides.
// Control-plane-layer injects this via setRuntimeConfigProvider() in llmRouter.ts.
//
// CALLED LAZILY: only when the internal runtime instance is (re)built.
// NOT called on every invocation — this is not a per-request hook.
//
// Must be synchronous. Must not throw. Must not call back into the runtime.
// ─────────────────────────────────────────────────────────────
export type RuntimeConfigProvider = () => Partial<AIRuntimeConfig>

// ─────────────────────────────────────────────────────────────
// AIRuntimeAdapterOptions
//
// Passed to the AIRuntimeAdapter constructor. Only one of config /
// configPath / configProvider should be provided. If multiple are
// provided, the priority order is: config > configPath > configProvider.
// ─────────────────────────────────────────────────────────────
export interface AIRuntimeAdapterOptions {
  /**
   * Provide a fully-assembled AIRuntimeConfig directly.
   * Used in tests and isolated environments where env vars are unreliable.
   * No merging occurs — this config is used as-is.
   */
  config?: AIRuntimeConfig | undefined

  /**
   * Path to a JSON config file. Loaded once at construction time.
   * No merging occurs — the file contents become the config.
   * Use for standalone deployments (e.g. AIRuntimeGateway server mode).
   */
  configPath?: string | undefined

  /**
   * Dynamic config provider.
   * When supplied, the adapter merges ConfigLoader.fromEnv() with the
   * provider's return value on every rebuild (invalidate() call).
   *
   * This is the PRIMARY path in production:
   *   control-plane-layer → setRuntimeConfigProvider(assembleRuntimeOverrides)
   *   → AIRuntimeAdapter receives the fn here
   *   → called on every rebuild to incorporate latest admin settings
   */
  configProvider?: RuntimeConfigProvider | undefined
}

// ─────────────────────────────────────────────────────────────
// AIRuntimeAdapter
//
// Implements IAIRuntime. This is the class external consumers hold.
// The internal RuntimeEngine is lazily built and rebuilt as needed.
//
// Lazy construction avoids startup-time provider health checks.
// The first call to run() / capabilities() triggers the build.
// ─────────────────────────────────────────────────────────────
export class AIRuntimeAdapter implements IAIRuntime {
  // baseConfig is set once at construction for static paths (config / configPath).
  // For the dynamic path (configProvider), baseConfig is undefined and env is used each rebuild.
  private readonly baseConfig: AIRuntimeConfig | undefined

  // configProvider is only set for the dynamic path.
  // Stored as a field so invalidate() + inner getter can re-call it on rebuild.
  private readonly configProvider: RuntimeConfigProvider | undefined

  // The internal runtime engine. null means "not yet built" or "needs rebuild".
  // Built lazily on first access via the `inner` getter.
  private _inner: IAIRuntime | null = null

  constructor(options: AIRuntimeAdapterOptions = {}) {
    if (options.config) {
      // STATIC PATH: caller provided a complete config — use it directly.
      // configProvider is not needed; env merging does not apply.
      this.baseConfig = options.config
      this.configProvider = undefined
    } else if (options.configPath) {
      // STATIC PATH: load config from file once at construction.
      // configProvider is not needed; file contents are authoritative.
      this.baseConfig = ConfigLoader.fromFile(options.configPath)
      this.configProvider = undefined
    } else if (options.configProvider) {
      // DYNAMIC PATH (production): no static base config.
      // ConfigLoader.fromEnv() + configProvider() are merged on each rebuild.
      this.baseConfig = undefined
      this.configProvider = options.configProvider
    } else {
      // FALLBACK PATH (env-only): no overrides, no dynamic config.
      // Used in test environments and simple deployments without admin settings.
      this.baseConfig = ConfigLoader.fromEnv()
      this.configProvider = undefined
    }
  }

  /**
   * Lazily-built internal runtime engine.
   *
   * Called by all public methods (run, capabilities, stats, etc.).
   * On first call: builds the engine from config.
   * On subsequent calls after invalidate(): rebuilds from current config.
   *
   * MERGE LOGIC (dynamic path only):
   *   base  = ConfigLoader.fromEnv()         — always the floor (api keys from env)
   *   over  = this.configProvider()          — admin overrides (enabled, priority, timeouts)
   *   final = ConfigLoader.merge(base, over) — provider-level deep merge, array atomic replace
   */
  private get inner(): IAIRuntime {
    if (!this._inner) {
      const base = this.baseConfig ?? ConfigLoader.fromEnv()
      const overrides = this.configProvider ? this.configProvider() : {}
      const config = ConfigLoader.merge(base, overrides)
      this._inner = AIRuntimeFactory.create(config)
    }
    return this._inner
  }

  /**
   * Invalidate the internal runtime instance.
   *
   * Sets _inner to null. The next call to any public method will trigger
   * a full rebuild of the RuntimeEngine, ExecutionEngine, CapabilityEngine,
   * and RouterEngine from the current config.
   *
   * Note: CircuitBreaker, RateLimiter, and CostTracker are module-level
   * singletons in factory.ts — they survive invalidation to preserve state.
   *
   * Called by:
   *   - llmRouter.resetRuntime()            — manual admin reset
   *   - llmRouter.setRuntimeConfigProvider() — config provider change
   */
  invalidate(): void {
    this._inner = null
  }

  /**
   * Register an artifact-specific system prompt for a given invocation type.
   *
   * CALLED BY: artifact-engine-layer's bootstrapArtifactEngine() via
   *   globalThis.__brandos_runtime_adapter.registerArtifactPrompt()
   *
   * This completes Phase 1.1 of the Architecture Evolution Roadmap:
   *   - ARL no longer imports ARTIFACT_TASK_PROMPTS from output-control-layer.
   *   - Prompts are pushed to the runtime at bootstrap time by AEL.
   *   - The runtime stays prompt-agnostic; AEL owns prompt→runtime wiring.
   *
   * Prompts are stored on globalThis to survive Next.js module splits.
   *
   * @param invocationType - e.g. 'generate_carousel', 'generate_deck', 'generate_report'
   * @param prompt - The full system prompt string for this invocation type.
   */
  registerArtifactPrompt(invocationType: string, prompt: string): void {
    _getPromptRegistry().set(invocationType, prompt)
    console.info(`[AIRuntimeAdapter] Registered artifact prompt for: ${invocationType}`)
  }

  /**
   * Execute an AI invocation.
   *
   * ARTIFACT ENRICHMENT:
   * When task_type maps to a registered artifact prompt, the request is
   * enriched before being passed to the inner RuntimeEngine:
   *
   *   - context: registered prompt prepended to any existing context.
   *              This injects the artifact schema instructions as the system prompt.
   *
   *   - output_schema.type = 'json': activates native JSON mode in provider adapters
   *     (e.g. OpenAI response_format: { type: 'json_object' }).
   *
   *   - metadata.temperature = 0: passed through to adapters for deterministic output.
   *     Structured artifact generation must be temperature-0 to avoid JSON parse failures.
   *
   *   - task_type: PRESERVED unchanged.
   *     Critical: RouterEngine uses task_type to look up timeout in task_timeouts.
   *     If we changed task_type to 'json', carousel would use the 15s json timeout
   *     instead of the 20s carousel timeout.
   *
   * NON-ARTIFACT REQUESTS:
   * Passed directly to inner.run() with no modification.
   *
   * @param request - The invocation request from the caller.
   * @returns AIRuntimeOutput — always resolved, never thrown.
   */
  async run(request: InvocationRequest): Promise<AIRuntimeOutput> {
    // Check if this task type has a registered artifact system prompt.
    // Prompts are registered at bootstrap time by artifact-engine-layer via
    // registerArtifactPrompt(). If none is registered yet (bootstrap hasn't run),
    // the request passes through unchanged — same degraded behavior as before.
    const artifactSystemPrompt = _getPromptRegistry().get(request.task_type as string)

    if (artifactSystemPrompt) {
      // Build an enriched request for structured artifact generation.
      // Spread to a new object — never mutate the caller's request.
      const enrichedRequest: InvocationRequest = {
        ...request,

        // Preserve original task_type — see ARTIFACT ENRICHMENT note above.
        task_type: request.task_type,

        // Prepend artifact system prompt to any existing context.
        // The orchestrator may have already provided a partial context; we
        // extend it, not replace it. null/undefined context is filtered out.
        context: [artifactSystemPrompt, request.context].filter(Boolean).join('\n\n'),

        // Activate JSON mode in provider adapters without changing max_tokens
        // or strict settings the caller may have deliberately set.
        output_schema: {
          type: 'json',
          max_tokens: request.output_schema?.max_tokens ?? 4096,
          strict: request.output_schema?.strict ?? false,
          // Preserve caller-supplied shape for downstream ValidatorEngine checks.
          // ValidatorEngine uses shape to verify required keys are present.
          shape: request.output_schema?.shape,
          // schema field intentionally cleared — not used by provider adapters.
          schema: undefined,
        } as typeof request.output_schema & { schema?: unknown },

        // temperature=0 signals provider adapters to use deterministic sampling.
        // Passed via metadata because InvocationRequest has no direct temperature field.
        // ExecutionEngine reads this via request.metadata?.temperature.
        metadata: {
          ...request.metadata,
          temperature: 0,
        },
      }

      return this.inner.run(enrichedRequest)
    }

    // Non-artifact request: pass through unchanged.
    return this.inner.run(request)
  }

  /**
   * Detect which execution modes and providers are currently available.
   * Delegated to the inner RuntimeEngine (which delegates to CapabilityEngine).
   * Results are cached with TTL from config.capability_cache_ttl_ms (default 60s).
   */
  capabilities(options?: CapabilityCheckOptions): Promise<CapabilityResult> {
    return this.inner.capabilities(options)
  }

  /**
   * Return aggregated telemetry statistics.
   * Synchronous. Computed from the in-memory TelemetryEngine history.
   */
  stats(): TelemetryStats {
    return this.inner.stats()
  }

  /**
   * Return the full invocation history as TelemetrySnapshots.
   * Bounded by in-memory buffer. Cleared on invalidate().
   */
  telemetryHistory(): TelemetrySnapshot[] {
    return this.inner.telemetryHistory()
  }

  /**
   * Force a fresh capability detection, bypassing the cache.
   * Delegated to the inner RuntimeEngine.
   */
  refreshCapabilities(): Promise<CapabilityResult> {
    return this.inner.refreshCapabilities()
  }
}


