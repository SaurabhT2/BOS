// ============================================================
// packages/ai-runtime-layer/src/runtime-engine/index.ts
//
// RUNTIME ORCHESTRATION & EXECUTION ENGINES
//
// This file contains two classes:
//
//   RuntimeEngine   — Orchestrates the full invocation lifecycle:
//                     detect → plan → prompt → execute → telemetry.
//                     Implements IAIRuntime. Delegates each phase to
//                     injected engines (CapabilityEngine, RouterEngine, etc.)
//                     It does not contain retry, fallback, or resilience logic.
//
//   ExecutionEngine — Handles the retry/fallback/circuit-breaker loop
//                     within an execution plan. Separated from RuntimeEngine
//                     for testability (can be unit-tested without full DI).
//
// DESIGN PRINCIPLES:
//   - Both classes depend only on @brandos/contracts interfaces.
//     No provider SDK imports here — adapters are injected.
//   - ExecutionEngine stores per-attempt results in a Map to avoid
//     the unsafe `attempt.__result` cast pattern (Bug M-4, now fixed).
//   - providerKind in terminal failures is derived from the actual
//     provider name, not from plan.primary_mode (Bug M-5, now fixed).
//   - retryCount increments ONLY in withRetry's onRetry callback (Bug B fix).
//     The .catch() handler must not increment retryCount.
//   - Plugin hooks must never propagate errors to the runtime (I-9).
//
// DEPENDENCY GRAPH:
//   RuntimeEngine
//     ← ICapabilityEngine (detect)
//     ← IRouterEngine (buildPlan)
//     ← IPromptBuilder (build)
//     ← IExecutionEngine (execute)
//     ← ITelemetryEngine (record)
//     ← IPluginRegistry (before_invoke, after_invoke)
//
//   ExecutionEngine
//     ← Map<ProviderName, IProviderAdapter> (invoke, healthCheck)
//     ← IValidatorEngine (validate)
//     ← IPolicyEngine (validate)
//     ← ITelemetryEngine (record)
//     ← ICircuitBreaker (isOpen, recordFailure, recordSuccess)
//     ← IRateLimiter (canProceed, record)
//     ← ICostTracker (record)
//     ← IPluginRegistry (on_fallback, on_error)
// ============================================================

import type { InvocationType } from '@brandos/contracts'
import {
  AIRuntimeConfig,
  AIRuntimeError,
  AIRuntimeOutput,
  BuiltPrompt,
  CapabilityCheckOptions,
  CapabilityResult,
  ErrorCode,
  ExecutionMode,
  ExecutionPlan,
  IAIRuntime,
  ICapabilityEngine,
  ICircuitBreaker,
  ICostTracker,
  IPolicyEngine,
  IPluginRegistry,
  IPromptBuilder,
  IProviderAdapter,
  IRateLimiter,
  IRouterEngine,
  ITelemetryEngine,
  IValidatorEngine,
  InvocationRequest,
  ProviderInvokeRequest,
  ProviderName,
  QualityFlag,
  RuntimeExecutionProfile,
  TelemetrySnapshot,
  TelemetryStats,
} from '@brandos/contracts'
import { Logger, generateRequestId } from './logger'
import { withRetry } from '@brandos/shared-utils'
import { normalizeError } from '../utils/normalizeError'

// ─────────────────────────────────────────────────────────────
// RuntimeEngine Dependencies
// ─────────────────────────────────────────────────────────────

export interface RuntimeEngineOptions {
  /** All registered provider adapters. Built by AIRuntimeFactory. */
  providers:    Map<ProviderName, IProviderAdapter>
  /** Detects which modes and providers are healthy. */
  capability:   ICapabilityEngine
  /** Selects primary provider and fallback chain given capabilities. */
  router:       IRouterEngine
  /** Assembles system + user prompts from InvocationRequest. */
  promptBuilder: IPromptBuilder
  /** Handles retry, fallback, circuit-breaker loop per execution plan. */
  executor:     IExecutionEngine
  /** Records telemetry snapshots and exposes stats. */
  telemetry:    ITelemetryEngine
  /** Shared logger instance. RuntimeEngine creates a child logger. */
  logger:       Logger
  /** Optional plugin/hook registry. Missing = no hooks fired. */
  plugins?:     IPluginRegistry | undefined
}

// ─────────────────────────────────────────────────────────────
// IExecutionEngine
//
// Separated from RuntimeEngine for testability.
// Unit tests can exercise ExecutionEngine without standing up the
// full RuntimeEngine pipeline (capability detection, routing, prompt building).
// ─────────────────────────────────────────────────────────────
export interface IExecutionEngine {
  /**
   * Execute an invocation plan.
   *
   * Handles the retry/fallback/circuit-breaker loop. Calls each provider
   * adapter in the plan's attempt sequence until one succeeds or all fail.
   *
   * @param request - The original InvocationRequest (for schema, policy checks).
   * @param plan    - Execution plan from RouterEngine (primary + fallback chain).
   * @param prompt  - Built prompt from PromptBuilder (system + user + json_mode).
   * @returns AIRuntimeOutput — always resolved, never thrown.
   */
  execute(
    request: InvocationRequest,
    plan:    ExecutionPlan,
    prompt:  BuiltPrompt,
  ): Promise<AIRuntimeOutput>
}

// ─────────────────────────────────────────────────────────────
// RuntimeEngine
//
// Implements IAIRuntime. Delegates each phase to an injected engine.
// This class contains NO retry logic, NO provider invocation, NO
// circuit-breaker calls. Those all live in ExecutionEngine.
// ─────────────────────────────────────────────────────────────
export class RuntimeEngine implements IAIRuntime {
  private readonly capability:   ICapabilityEngine
  private readonly router:       IRouterEngine
  private readonly promptBuilder: IPromptBuilder
  private readonly executor:     IExecutionEngine
  private readonly telemetry:    ITelemetryEngine
  private readonly logger:       Logger
  private readonly plugins:      IPluginRegistry | undefined

  constructor(opts: RuntimeEngineOptions) {
    this.capability    = opts.capability
    this.router        = opts.router
    this.promptBuilder = opts.promptBuilder
    this.executor      = opts.executor
    this.telemetry     = opts.telemetry
    this.logger        = opts.logger.child('RuntimeEngine')
    this.plugins       = opts.plugins
  }

  /**
   * Execute an AI invocation.
   *
   * FLOW:
   *   1. Validate user_intent (non-empty required).
   *   2. Fire before_invoke plugin hook.
   *   3. CapabilityEngine.detect() — health-check all providers (cached 60s).
   *   4. RouterEngine.buildPlan() — select primary + fallback chain.
   *   5. PromptBuilder.build() — assemble system + user prompt.
   *   6. ExecutionEngine.execute() — retry/fallback/resilience loop.
   *   7. Fire after_invoke plugin hook.
   *
   * Never throws. Terminal failures at any step return { status: 'terminal_failure' }.
   */
  async run(request: InvocationRequest): Promise<AIRuntimeOutput> {
    this.logger.info('run()', { task: request.task_type })

    // STEP 1: Validate request. user_intent is required for all invocation types.
    if (!request.user_intent?.trim()) {
      return this.terminalError(
        'INVALID_REQUEST',
        'user_intent is required',
        'Please provide a valid request.',
        request.task_type ?? 'chat',
        'unknown' as ProviderName,
      )
    }

    // STEP 2: Plugin — before_invoke hook.
    // Failures are swallowed (I-9): hooks must never crash the runtime.
    if (this.plugins) {
      await this.plugins.runHooks('before_invoke', { request, provider: 'openai' })
    }

    // STEP 3: Detect capabilities.
    // Uses a 60s cache to avoid hammering providers on every request.
    // Force-refresh via capabilities({ force_refresh: true }) from admin UI.
    let capability: CapabilityResult
    try {
      capability = await this.capability.detect()
    } catch (err) {
      return this.terminalError(
        'NO_CAPABLE_PROVIDER',
        `Capability detection failed: ${normalizeError(err, 'capability').message}`,
        'Unable to determine available AI services.',
        request.task_type ?? 'chat',
        'unknown' as ProviderName,
      )
    }

    if (capability.available_modes.length === 0) {
      return this.terminalError(
        'NO_CAPABLE_PROVIDER',
        'No capable providers detected',
        'No AI services are currently available.',
        request.task_type ?? 'chat',
        'unknown' as ProviderName,
      )
    }

    // STEP 4: Build execution plan.
    // RouterEngine selects primary provider and constructs fallback chain
    // based on the request's preferred_mode and provider health statuses.
    const plan = this.router.buildPlan(request, capability)
    this.logger.debug('Execution plan', plan)

    // STEP 5: Build prompt.
    // PromptBuilder assembles system + user prompts from the request.
    // If request.context is present, it becomes the system prompt (orchestrator path).
    // Otherwise, SYSTEM_PROMPTS fallback is used.
    const prompt = this.promptBuilder.build(request)

    // STEP 6: Execute.
    // ExecutionEngine handles the retry/fallback/circuit-breaker loop.
    const output = await this.executor.execute(request, plan, prompt)

    // STEP 7: Plugin — after_invoke hook.
    // Failures are swallowed (I-9).
    if (this.plugins) {
      await this.plugins.runHooks('after_invoke', { request, output })
    }

    return output
  }

  /**
   * Detect which execution modes and providers are currently available.
   * Wraps CapabilityEngine.detect() with optional parameters.
   */
  async capabilities(options?: CapabilityCheckOptions): Promise<CapabilityResult> {
    return this.capability.detect(options)
  }

  /** Return aggregated telemetry statistics. Synchronous. */
  stats(): TelemetryStats {
    return this.telemetry.stats()
  }

  /** Return the full invocation history as TelemetrySnapshots. */
  telemetryHistory(): TelemetrySnapshot[] {
    return this.telemetry.getHistory()
  }

  /** Force a fresh capability detection, bypassing the cache. */
  async refreshCapabilities(): Promise<CapabilityResult> {
    return this.capability.detect({ force_refresh: true })
  }

  /**
   * Build a terminal failure AIRuntimeOutput.
   *
   * Called when a request cannot proceed (validation failure, no capable provider).
   * This is NOT used for provider invocation failures — those go through
   * ExecutionEngine's attempt loop and return their own terminal_failure.
   *
   * @param code         - Stable error code from ErrorCode union.
   * @param message      - Technical message for logs. Not shown to users.
   * @param user_message - User-facing message. Safe to render.
   * @param taskType     - The invocation type (for telemetry).
   * @param providerName - The provider that would have been used (for telemetry).
   */
  private terminalError(
    code:         ErrorCode,
    message:      string,
    user_message: string,
    taskType:     InvocationType,
    providerName: ProviderName,
  ): AIRuntimeOutput {
    const now = Date.now()
    const snapshot: TelemetrySnapshot = {
      request_id:     generateRequestId(),
      task_type:      taskType,
      mode_selected:  'auto',
      provider_used:  providerName,
      latency_ms:     0,
      fallback_count: 0,
      retry_count:    0,
      quality_flags:  [],
      success:        false,
      timestamp:      now,
    }
    // Record to the TelemetryEngine so stats() and telemetryHistory() reflect
    // all invocations including early-exit failures (no provider, invalid request).
    void this.telemetry.record(snapshot)
    return {
      status:                  'terminal_failure',
      content:                 null,
      engine_used:             'unknown' as ProviderName,
      providerKind:            'cloud',
      mode_used:               'auto',
      latency_ms:              0,
      quality_flags:           [],
      retry_count:             0,
      fallback_used:           false,
      fallback_chain_exhausted: false,
      error:                   { code, message, user_message, retryable: false },
      telemetry:               snapshot,
    }
  }
}

// ─────────────────────────────────────────────────────────────
// ExecutionEngine Dependencies
// ─────────────────────────────────────────────────────────────

export interface ExecutionEngineOptions {
  /** All registered provider adapters. */
  providers:      Map<ProviderName, IProviderAdapter>
  /** Validates model output against the expected schema. */
  validator:      IValidatorEngine
  /** Enforces governance rules (local_only, blocked_providers, cost caps). */
  policy:         IPolicyEngine
  /** Records telemetry snapshots. */
  telemetry:      ITelemetryEngine
  /** Tracks provider failure counts and controls retry/open state. */
  circuitBreaker: ICircuitBreaker
  /** Tracks token usage and enforces rate limits. */
  rateLimiter:    IRateLimiter
  /** Tracks cumulative cost per provider. */
  costTracker:    ICostTracker
  /** Shared logger instance. ExecutionEngine creates a child logger. */
  logger:         Logger
  /** Base backoff delay for retry attempts. Jitter is applied on top. */
  backoffMs?:     number | undefined
  /** Optional plugin/hook registry. */
  plugins?:       IPluginRegistry | undefined
}

// ─────────────────────────────────────────────────────────────
// deriveParseForJsonTask
//
// Ensures AIRuntimeOutput.parsed is populated for structured task types
// even when ValidatorEngine did not set it (e.g. strict:false + no schema check).
//
// Returns undefined for non-JSON tasks to preserve backward compatibility
// with callers that don't expect a parsed field on text responses.
//
// The JSON_TASK_TYPES set mirrors InvocationType values that always produce JSON.
// AIRuntimeAdapter enriches these to output_schema.type='json', so providers
// should have already returned JSON — but this is the safety net.
// ─────────────────────────────────────────────────────────────
function deriveParseForJsonTask(
  content:  string,
  taskType: InvocationType,
): unknown | undefined {
  const JSON_TASK_TYPES = new Set<InvocationType>([
    'json',
    'generate_deck',
    'generate_carousel',
    'generate_report',
  ])
  if (!JSON_TASK_TYPES.has(taskType)) return undefined

  try {
    // Strip optional ```json ... ``` fences that some models wrap JSON in
    // despite being instructed not to. This is a resilience measure.
    const cleaned = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()
    return JSON.parse(cleaned)
  } catch {
    return undefined
  }
}

// ─────────────────────────────────────────────────────────────
// ExecutionEngine
//
// Implements IExecutionEngine. Handles the retry/fallback/resilience
// loop for a single invocation plan. Each call to execute() is
// independent — no shared mutable state between calls.
//
// ATTEMPT SEQUENCE:
//   [primary_provider, ...fallback_chain]
//   For each attempt:
//     1. Circuit breaker check
//     2. Rate limit check
//     3. Policy check
//     4. Find adapter in providers Map
//     5. withRetry loop (max maxPerProvider attempts):
//        a. invoke()
//        b. Record usage (rate limiter, cost tracker)
//        c. Handle timeout → skip to next fallback
//        d. ValidatorEngine.validate()
//        e. On success → record telemetry, store result, return
//        f. On schema failure (strict) → throw to withRetry for retry
//     6. On provider exhausted → record error, continue to next fallback
//   After all attempts: record failure telemetry, return terminal_failure
// ─────────────────────────────────────────────────────────────
export class ExecutionEngine implements IExecutionEngine {
  private readonly providers:      Map<ProviderName, IProviderAdapter>
  private readonly validator:      IValidatorEngine
  private readonly policy:         IPolicyEngine
  private readonly telemetry:      ITelemetryEngine
  private readonly circuitBreaker: ICircuitBreaker
  private readonly rateLimiter:    IRateLimiter
  private readonly costTracker:    ICostTracker
  private readonly logger:         Logger
  private readonly backoffMs:      number
  private readonly plugins:        IPluginRegistry | undefined

  constructor(opts: ExecutionEngineOptions) {
    this.providers      = opts.providers
    this.validator      = opts.validator
    this.policy         = opts.policy
    this.telemetry      = opts.telemetry
    this.circuitBreaker = opts.circuitBreaker
    this.rateLimiter    = opts.rateLimiter
    this.costTracker    = opts.costTracker
    this.logger         = opts.logger.child('ExecutionEngine')
    this.backoffMs      = opts.backoffMs ?? 500
    this.plugins        = opts.plugins
  }

  async execute(
    request: InvocationRequest,
    plan:    ExecutionPlan,
    prompt:  BuiltPrompt,
  ): Promise<AIRuntimeOutput> {
    const requestId   = generateRequestId()
    const startTime   = Date.now()
    let retryCount    = 0
    let fallbackCount = 0
    let lastError:    AIRuntimeError | undefined

    // Build the full attempt sequence: [primary, ...fallbacks].
    const attempts = [
      { provider: plan.primary_provider, mode: plan.primary_mode },
      ...plan.fallback_chain,
    ]

    // FIX M-4: Store per-attempt results in a Map instead of mutating attempt objects.
    // The old pattern used `(attempt as any).__result = ...` which is type-unsafe
    // and causes issues with object freezing, strict mode, and static analysis.
    // Map key is the provider name from the current attempt iteration.
    const attemptResults = new Map<ProviderName, AIRuntimeOutput>()

    for (const attempt of attempts) {
      const isFirstAttempt = attempt.provider === plan.primary_provider

      // Fire on_fallback hook for all attempts after the primary.
      if (!isFirstAttempt) {
        fallbackCount++
        if (this.plugins) {
          await this.plugins.runHooks('on_fallback', {
            from_provider: plan.primary_provider,
            to_provider:   attempt.provider,
            reason:        lastError?.code ?? 'unknown',
          })
        }
        this.logger.info(`Fallback → ${attempt.provider} (${attempt.mode})`, {
          requestId,
          fallback_count: fallbackCount,
        })
      }

      // ── CIRCUIT BREAKER CHECK ─────────────────────────────────────────────
      // If this provider's circuit is open (too many recent failures),
      // skip immediately to the next fallback. Do not invoke the provider.
      if (this.circuitBreaker.isOpen(attempt.provider)) {
        this.logger.warn(`Circuit open for ${attempt.provider}`, { requestId })
        lastError = {
          code:         'CIRCUIT_OPEN',
          message:      `Circuit breaker open for ${attempt.provider}`,
          user_message: 'Provider temporarily unavailable.',
          provider:     attempt.provider,
          retryable:    false,
        }
        continue
      }

      // ── RATE LIMIT CHECK ─────────────────────────────────────────────────
      // Check if the rate limiter allows this provider to proceed.
      // Uses estimated token count (output_schema.max_tokens) as the budget estimate.
      const estimatedTokens = request.output_schema?.max_tokens ?? 512
      const rateCheck = this.rateLimiter.canProceed(attempt.provider, estimatedTokens)
      if (!rateCheck.allowed) {
        this.logger.warn(`Rate limited on ${attempt.provider}`, {
          requestId,
          reason: rateCheck.reason,
        })
        lastError = {
          code:         'RATE_LIMITED',
          message:      `Rate limit exceeded: ${rateCheck.reason}`,
          user_message: 'Too many requests. Please wait and try again.',
          provider:     attempt.provider,
          retryable:    true,
        }
        continue
      }

      // ── POLICY CHECK ─────────────────────────────────────────────────────
      // PolicyEngine checks: local_only, no_external_providers, blocked_providers,
      // allowed_modes, max_cost_per_request_usd.
      const policyError = this.policy.validate(request, attempt.mode, attempt.provider)
      if (policyError) {
        this.logger.warn(`Policy blocked ${attempt.provider}`, {
          requestId,
          code: policyError.code,
        })
        lastError = policyError
        continue
      }

      // ── ADAPTER LOOKUP ────────────────────────────────────────────────────
      // The adapter must be in the providers Map. If not, it was not registered
      // (likely disabled by admin). Skip to next fallback.
      const adapter = this.providers.get(attempt.provider)
      if (!adapter) {
        this.logger.warn(`Provider ${attempt.provider} not registered`, { requestId })
        continue
      }

      // ── RETRY LOOP ───────────────────────────────────────────────────────
      // withRetry handles exponential backoff with jitter.
      // maxPerProvider is capped by remaining retry budget to avoid
      // exhausting the total budget on a single provider.
      const maxPerProvider = Math.min(plan.retry_budget - retryCount, 2)
      let providerSucceeded = false
      let breakToFallback   = false

      await withRetry(
        async () => {
          // Assemble the provider-level request from the built prompt + plan.
          // FIX-MODEL-1: Resolve the configured model for this provider.
          // The adapter's defaultModel is set from config.providers[name].default_model
          // which is populated by assembleRuntimeOverrides() from admin settings.
          // Previously invokeReq had NO model field, so adapters always fell back
          // to their constructor-injected defaultModel — which worked correctly
          // when admin settings flowed in, but produced a stale trace in telemetry
          // (configured_model was undefined instead of the resolved default).
          //
          // We now read the adapter's configured defaultModel via the `describeCapability`
          // model_id field (available on all Phase 2 adapters) or fall back to undefined
          // (which causes adapters to use their own defaultModel — same runtime behavior
          // but now the telemetry configured_model field is populated correctly).
          //
          // IMPORTANT: InvocationRequest does NOT carry a per-request model override
          // (RoutingHint has no model field). The model comes exclusively from the
          // adapter's constructor config (admin setting → assembleRuntimeOverrides →
          // ConfigLoader.merge → factory.buildProviders → Adapter constructor).
          // The model field on invokeReq is advisory: adapters use request.model ?? this.defaultModel.
          const adapterModelId = (adapter as any).describeCapability?.('text.generation')?.model_id
                              ?? (adapter as any).defaultModel
                              ?? undefined

          // Phase 4: preferred_model from InvocationRequest overrides the adapter default.
          // The request carries this from RoutingHint.preferred_model → InvocationRequest.preferred_model
          // (threaded by llmRouter.ts callRuntime). Soft hint — if the adapter cannot honor
          // the model string, it falls back to its own defaultModel; we surface the discrepancy
          // via the model_used vs configured_model fields in telemetry.
          const resolvedInvokeModel = request.preferred_model ?? adapterModelId

          const invokeReq: ProviderInvokeRequest = {
            system_prompt: prompt.system_prompt,
            user_prompt:   prompt.user_prompt,
            json_mode:     prompt.json_mode,
            timeout_ms:    plan.timeout_ms,
            max_tokens:    request.output_schema?.max_tokens,
            // Phase 4 / FIX-MODEL-1: forward the resolved model so:
            //   (a) adapters receive explicit model = preferred override or configured default
            //   (b) telemetry.configured_model is populated (was always undefined before)
            //   (c) model_used vs configured_model discrepancy is detectable
            //   (d) per-request model selection is honored when preferred_model is set
            model: resolvedInvokeModel,
            // Forward temperature hint set by AIRuntimeAdapter for artifact tasks.
            // Adapters that support temperature (OpenAI, Anthropic) read this.
            temperature: typeof request.metadata?.temperature === 'number'
              ? request.metadata.temperature
              : undefined,
            // P3 — BYOK (F5): inject per-request API key override at the real dispatch site.
            // request.api_key_overrides[provider] is the workspace-supplied plaintext key.
            // When present, the adapter uses this instead of its constructor platform key.
            // Absent → adapter uses its own this.apiKey (platform environment key).
            // NEVER LOG invokeReq — it may carry a plaintext api_key.
            ...(request.api_key_overrides?.[attempt.provider]
              ? { api_key: request.api_key_overrides[attempt.provider] }
              : {}),
            // P3 — Multimodal: forward attachments from InvocationRequest to the adapter.
            // Vision-capable adapters (anthropic, openai, google) consume this to build
            // multimodal message payloads. Non-vision adapters ignore it gracefully.
            // NEVER LOG invokeReq — may contain base64 image data.
            ...(request.attachments && request.attachments.length > 0
              ? { attachments: request.attachments }
              : {}),
          }

          this.logger.info(`Invoking ${attempt.provider}`, {
            requestId,
            task: request.task_type,
          })

          const result = await adapter.invoke(invokeReq)

          // Record actual token usage for rate limiter and cost tracker.
          // Falls back to estimatedTokens if the provider didn't return usage.
          const tokensUsed = result.token_usage
            ? result.token_usage.prompt + result.token_usage.completion
            : estimatedTokens
          this.rateLimiter.record(attempt.provider, tokensUsed)
          this.costTracker.record(attempt.provider, tokensUsed, requestId)

          // ── TIMEOUT ────────────────────────────────────────────────────
          // Provider returned a timeout finish_reason. Record circuit failure
          // and skip to the next fallback (do not retry the same provider —
          // a longer wait on the same provider will also time out).
          if (result.finish_reason === 'timeout') {
            this.circuitBreaker.recordFailure(attempt.provider)
            lastError = {
              code:         'TIMEOUT',
              message:      `${attempt.provider} timed out after ${plan.timeout_ms}ms`,
              user_message: 'The request took too long. Please try again.',
              provider:     attempt.provider,
              retryable:    true,
            }
            this.logger.warn('Timeout', { requestId, provider: attempt.provider })
            breakToFallback = true
            return // exit withRetry callback; isRetryable() will return false
          }

          // ── TRUNCATION ─────────────────────────────────────────────────
          // Provider hit its output token limit mid-response (finish_reason='length').
          // For JSON-structured tasks (carousel, deck, report) this produces an
          // incomplete payload that JSON.parse and repairJSON cannot recover.
          // Treat as a retryable failure so the engine falls through to the next
          // provider or attempt rather than forwarding broken content downstream.
          // Non-JSON tasks (chat, text) receive the partial content as-is —
          // truncation there is annoying but not a parse-loop blocker.
          if (result.finish_reason === 'length') {
            const isStructuredTask = request.task_type === 'generate_carousel'
              || request.task_type === 'generate_deck'
              || request.task_type === 'generate_report'
            if (isStructuredTask) {
              this.logger.warn('Output truncated (finish_reason=length) on structured task — treating as retryable failure', {
                requestId,
                provider:  attempt.provider,
                task_type: request.task_type,
                max_tokens: request.output_schema?.max_tokens,
              })
              lastError = {
                code:         'PROVIDER_ERROR',
                message:      `${attempt.provider} response truncated at token limit — JSON payload incomplete`,
                user_message: 'Response was cut short. Retrying with next provider.',
                provider:     attempt.provider,
                retryable:    true,
              }
              breakToFallback = true
              return // skip to fallback provider
            }
          }

          // ── VALIDATION ────────────────────────────────────────────────
          const validation  = this.validator.validate(result.content, request.output_schema)
          const qualityFlags: QualityFlag[] = [...validation.flags]
          if (fallbackCount > 0) qualityFlags.push('fallback_used')

          const latency = Date.now() - startTime

          // Schema validation failure with strict mode: throw so withRetry
          // retries this provider before moving to the next fallback.
          if (!validation.valid && request.output_schema?.strict) {
            this.circuitBreaker.recordFailure(attempt.provider)
            lastError = {
              code:         'SCHEMA_VALIDATION_FAILED',
              message:      `Schema validation failed: ${validation.reason}`,
              user_message: 'Response format was not as expected. Retrying.',
              provider:     attempt.provider,
              retryable:    true,
            }
            this.logger.warn('Schema validation failed', {
              requestId,
              reason: validation.reason,
            })
            throw lastError // withRetry will handle the retry
          }

          // ── SUCCESS ───────────────────────────────────────────────────
          this.circuitBreaker.recordSuccess(attempt.provider)

          const snapshot: TelemetrySnapshot = {
            request_id:      requestId,
            task_type:       request.task_type,
            mode_selected:   attempt.mode,
            provider_used:   attempt.provider,
            // Sprint A — Obj 1+5: model traceability + benchmark data
            model_used:      result.model_used,
            configured_model: resolvedInvokeModel,
            latency_ms:      latency,
            fallback_count:  fallbackCount,
            retry_count:   retryCount,
            token_estimate: result.token_usage
              ? result.token_usage.prompt + result.token_usage.completion
              : undefined,
            quality_flags: qualityFlags,
            success:       true,
            timestamp:     Date.now(),
          }
          await this.telemetry.record(snapshot)

          // Phase 5 — RuntimeExecutionProfile: assemble and log the fully-resolved
          // execution profile for this request. This is the single structured log
          // that captures all six required fields (requested vs resolved vs actual
          // provider and model) so runtime execution can be verified rather than inferred.
          const executionProfile: RuntimeExecutionProfile = {
            runtimeMode:  attempt.mode === 'local' ? 'local' : 'cloud',
            provider:     attempt.provider,
            model:        result.model_used ?? resolvedInvokeModel ?? attempt.provider,
            apiKeySource: request.api_key_overrides?.[attempt.provider] ? 'user' : 'platform',
          }
          this.logger.info('[RuntimeExecutionProfile]', {
            ...executionProfile,
            requestId,
            workspaceId:       request.metadata?.workspaceId,
            userId:            request.user_id,
            requestedProvider: request.routing_hint?.preferred_provider ?? null,
            requestedModel:    request.preferred_model ?? request.routing_hint?.preferred_model ?? null,
            fallbackUsed:      fallbackCount > 0,
            primaryProvider:   plan.primary_provider,
          })

          // FIX M-4: Store the result in a Map keyed by provider name.
          // Previously stored as `(attempt as any).__result = ...` which is
          // type-unsafe and breaks with frozen objects or strict mode.
          providerSucceeded = true
          attemptResults.set(attempt.provider, {
            status:                  validation.valid ? 'success' : 'degraded_success',
            content:                 result.content,
            // FIX M-5: Resolve providerKind from the actual provider name,
            // not from plan.primary_mode. A local provider in a partially-misconfigured
            // execution could have mode='cloud' if the RouterEngine defaulted.
            // Using the adapter's name gives the correct answer.
            providerKind: attempt.provider === 'ollama' || attempt.provider === 'lmstudio'
              ? 'local'
              : 'cloud',
            parsed:                  validation.parsed ?? deriveParseForJsonTask(result.content, request.task_type),
            engine_used:             attempt.provider,
            // Sprint A — Obj 1: carry model_used from adapter invoke result
            model_used:              result.model_used,
            mode_used:               attempt.mode,
            latency_ms:              latency,
            quality_flags:           qualityFlags,
            retry_count:             retryCount,
            fallback_used:           fallbackCount > 0,
            fallback_chain_exhausted: false,
            telemetry:               snapshot,
          })
        },
        {
          attempts:    maxPerProvider,
          backoffMs:   this.backoffMs,
          maxBackoffMs: 30_000,
          jitter:      0.2,
          onRetry: (attempt_n, retryErr) => {
            // FIX Bug B: retryCount is incremented ONLY here — the single source of
            // truth for retry accounting. The old code also incremented retryCount
            // in the .catch() handler, causing every provider error to count as 2
            // retries and hiding the true retry depth in telemetry.
            retryCount++

            // P0-GROQ-RETRY-FIX: if the adapter surfaced a Retry-After hint
            // (retryAfterMs), it is now actually honoured via getDelayMs below —
            // this log line just reports what will be used.
            const hint = (retryErr as any)?.retryAfterMs as number | undefined
            this.logger.info(`[P0-GROQ-RETRY] Retry ${attempt_n} for ${attempt.provider}`, {
              requestId,
              retryAfterMs: hint ?? 'none (using exponential backoff)',
            })
          },
          // P0-GROQ-RETRY-FIX: previously this hint was extracted and logged
          // (see onRetry above) but never actually used to delay the retry —
          // withRetry always slept on its fixed exponential-backoff schedule
          // (500ms, 1000ms, ...), which is far shorter than the 12-14s a
          // Groq TPM rate-limit window typically needs to clear. That caused
          // the very next attempt to hit the same 429 deterministically,
          // burning the provider's retry budget (and, one level up, the
          // governance repair budget) without ever actually waiting out the
          // rate limit. Honour the server's hint when present so the retry
          // has a real chance of succeeding; fall back to exponential backoff
          // for every other error type (still capped at maxBackoffMs).
          getDelayMs: (retryErr) => (retryErr as any)?.retryAfterMs as number | undefined,
          isRetryable: (retryErr) => {
            // Do not retry if this attempt was flagged to move to the next fallback.
            if (breakToFallback) return false

            // P0-GROQ-RETRY: permanent failures must not consume retry budget.
            // auth_error (401/403): the key is wrong — retrying will not fix it.
            // client_error (4xx other than 429): configuration problem — retry won't help.
            // context_length: prompt is too long — retry won't reduce it.
            // Only 429 (rate_limited) and 5xx (server_error, network_error) are retryable.
            const errCode = (retryErr as any)?.code as string | undefined
            const nonRetryableCodes = new Set(['auth_error', 'context_length', 'model_not_found', 'quota_exceeded'])
            if (errCode && nonRetryableCodes.has(errCode)) {
              this.logger.warn(`[P0-GROQ-RETRY] Non-retryable error code="${errCode}" — skipping to fallback`, {
                requestId,
                provider: attempt.provider,
              })
              return false
            }

            return true
          },
        },
      ).catch((err) => {
        // normalizeError converts any throwable (Error, SDK error, string, undefined)
        // to a stable RuntimeError shape. This prevents "Cannot read properties of
        // undefined (reading 'code')" when providers throw non-Error objects.
        const rErr = normalizeError(err, attempt.provider)

        // If lastError was already set with a structured code inside the retry loop
        // (e.g. SCHEMA_VALIDATION_FAILED set before throw), preserve it.
        // Only overwrite with PROVIDER_ERROR if we don't have a structured error.
        const alreadyStructured = lastError?.code && lastError.code !== 'PROVIDER_ERROR'
        if (!alreadyStructured) {
          this.circuitBreaker.recordFailure(attempt.provider)

          if (this.plugins) {
            void this.plugins.runHooks('on_error', {
              request,
              provider: attempt.provider,
              error:    err,
            })
          }

          this.logger.warn(`${attempt.provider} threw`, {
            requestId,
            code:       rErr.code,
            message:    rErr.message,
            statusCode: rErr.statusCode,
          })

          lastError = {
            code:         'PROVIDER_ERROR',
            message:      rErr.message,
            user_message: 'An error occurred while processing your request.',
            provider:     attempt.provider,
            retryable:    rErr.retryable ?? true,
          }

          // FIX Bug B (continued): retryCount is NOT incremented here.
          // The sole increment point is onRetry above.
        }
      })

      // If this attempt produced a result, return it immediately.
      // FIX M-4: Read from the Map instead of the unsafe __result cast.
      const result = attemptResults.get(attempt.provider)
      if (providerSucceeded && result) {
        return result
      }

      // Timeout case: move to next fallback without retrying this provider.
      if (breakToFallback) {
        continue
      }
    }

    // ── ALL ATTEMPTS EXHAUSTED ────────────────────────────────────────────────
    // No provider succeeded. Record a failure telemetry snapshot and return
    // a terminal_failure output.
    const latency = Date.now() - startTime
    const failSnapshot: TelemetrySnapshot = {
      request_id:    requestId,
      task_type:     request.task_type,
      mode_selected: plan.primary_mode,
      provider_used: plan.primary_provider,
      latency_ms:    latency,
      fallback_count: fallbackCount,
      retry_count:   retryCount,
      quality_flags: [],
      success:       false,
      timestamp:     Date.now(),
    }
    await this.telemetry.record(failSnapshot)

    const finalError: AIRuntimeError = lastError ?? {
      code:         'ALL_PROVIDERS_FAILED',
      message:      'All providers in the fallback chain failed',
      user_message: 'We were unable to complete your request. Please try again later.',
      retryable:    false,
    }

    return {
      status:                  'terminal_failure',
      content:                 null,
      engine_used:             plan.primary_provider,
      // FIX M-5: Derive providerKind from the actual primary provider name.
      // Previously used plan.primary_mode which could be misleading if the
      // RouterEngine assigned mode='cloud' to an ollama provider due to
      // mode resolution fallback.
      providerKind: plan.primary_provider === 'ollama' || plan.primary_provider === 'lmstudio'
        ? 'local'
        : 'cloud',
      mode_used:               plan.primary_mode,
      latency_ms:              latency,
      quality_flags:           [],
      retry_count:             retryCount,
      fallback_used:           fallbackCount > 0,
      fallback_chain_exhausted: true,
      error:                   finalError,
      telemetry:               failSnapshot,
    }
  }
}


