// ============================================================
// packages/contracts/src/airuntime-types.ts
// ============================================================

// ─────────────────────────────────────────────
// PRIMITIVES & ENUMS
// ─────────────────────────────────────────────

export type ExecutionMode =
  | 'local'
  | 'cloud'
  | 'auto'

/**
 * InvocationType — AI runtime invocation vocabulary.
 *
 * Owned by @brandos/ai-runtime-layer and @brandos/contracts (as the shared
 * contract). Describes how the runtime should execute a request: which prompt
 * template, json_mode, parsing strategy, and capability to select.
 *
 * Deliberately separate from the domain TaskType (content creation intent)
 * in contracts/index.ts. Bounded-context separation is intentional:
 *   domain TaskType  → what the user wants to create  (carousel, deck, post…)
 *   InvocationType   → how the runtime executes it    (generate_carousel, json…)
 *
 * Renamed from: TaskType (airuntime-types.ts)
 * See: packages/contracts/src/index.ts → TaskType (domain)
 */
export type InvocationType =
  | 'chat'
  | 'post'
  | 'article'
  | 'carousel'
  | 'analyze'
  | 'json'
  | 'image_analysis'
  | 'code'
  | 'summarize'
  | 'classify'
  | 'embed'
  | 'generate_deck'
  | 'generate_carousel'
  | 'generate_report'

export type ProviderName =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'lmstudio'
  | 'deepseek'
  | 'groq'
  | 'openrouter'
  | 'togetherai'
  | 'custom'

export type OutputStatus =
  | 'success'
  | 'retryable_failure'
  | 'terminal_failure'
  | 'degraded_success'

export type QualityFlag =
  | 'schema_valid'
  | 'schema_invalid'
  | 'truncated'
  | 'empty'
  | 'low_confidence'
  | 'fallback_used'
  | 'timeout_near'
  | 'corrupted'

export type ErrorCode =
  | 'NO_CAPABLE_PROVIDER'
  | 'ALL_PROVIDERS_FAILED'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'BUDGET_EXCEEDED'
  | 'POLICY_VIOLATION'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'INVALID_REQUEST'
  | 'PROVIDER_ERROR'
  | 'CIRCUIT_OPEN'

export type FallbackTrigger =
  | 'provider_unavailable'
  | 'timeout'
  | 'schema_failure'
  | 'rate_limited'
  | 'cost_exceeded'
  | 'quality_too_low'
  | 'provider_error'
  | 'circuit_open'
  | 'terminal_failure'

// ─────────────────────────────────────────────
// A. PROVIDER ADAPTER CONTRACT
// ─────────────────────────────────────────────

export interface ProviderCapabilityStatus {
  available:     boolean
  healthy:       boolean
  latency_ms?:   number | undefined
  reason?:       string | undefined
  rate_limited?: boolean | undefined
  checked_at:    number
}

export interface ProviderInvokeRequest {
  system_prompt?: string | undefined
  user_prompt:    string
  model?:         string | undefined
  max_tokens?:    number | undefined
  temperature?:   number | undefined
  timeout_ms:     number
  json_mode?:     boolean | undefined
  stream?:        boolean | undefined
  /**
   * P3 — BYOK: per-request API key override.
   *
   * When set, the adapter MUST use this key instead of its constructor-injected
   * platform key (this.apiKey). This is the F5 injection point — the actual
   * provider dispatch site in ExecutionEngine injects the workspace key here
   * so each request can carry its own credential without re-constructing adapters.
   *
   * Adapters that support BYOK: anthropic, openai, google, groq, deepseek, openrouter.
   * Local adapters (ollama, lmstudio) ignore this field (no API key concept).
   *
   * NEVER LOG. Contains a plaintext API key.
   */
  api_key?: string | undefined
  /**
   * P3 — Multimodal attachments forwarded from InvocationRequest.
   *
   * Each entry carries a base64-encoded image payload. The type field
   * identifies the encoding format:
   *   'image_base64' — raw base64 string; MIME type inferred by adapter
   *   'image_jpeg'   — base64 JPEG; adapter uses image/jpeg
   *   'image_png'    — base64 PNG;  adapter uses image/png
   *   'image_webp'   — base64 WebP; adapter uses image/webp
   *   'image_gif'    — base64 GIF;  adapter uses image/gif
   *
   * Adapters that support vision (anthropic, openai, google) MUST consume
   * this field and construct provider-specific multimodal message payloads.
   * Adapters that do not support vision (ollama text-only, lmstudio, deepseek,
   * openai-compatible) MUST ignore this field gracefully (no error, text-only response).
   *
   * When populated, the request is a vision/multimodal request. Adapters with
   * vision capability should include the image(s) in their API payload.
   *
   * Set by ExecutionEngine at the dispatch site (forwarded from
   * InvocationRequest.attachments). NEVER LOG — may contain sensitive image data.
   */
  attachments?: Array<{ type: string; data: string }> | undefined
}

export interface ProviderInvokeResult {
  content:       string
  /** The actual model ID used by the provider for this invocation. */
  model_used?:   string | undefined
  finish_reason: 'stop' | 'length' | 'error' | 'timeout'
  token_usage?:  { prompt: number; completion: number }
  latency_ms:    number
  raw?:          unknown | undefined
}

export interface IProviderAdapter {
  readonly name:           ProviderName
  readonly supportedModes: ExecutionMode[]
  healthCheck(timeout_ms: number): Promise<ProviderCapabilityStatus>
  invoke(request: ProviderInvokeRequest): Promise<ProviderInvokeResult>
}

// ─────────────────────────────────────────────
// B. CAPABILITY CONTRACT
// ─────────────────────────────────────────────

export interface CapabilityResult {
  available_modes:         ExecutionMode[]
  recommended_mode:        ExecutionMode
  providers:               Partial<Record<ProviderName, ProviderCapabilityStatus>>
  policy_restricted_modes: ExecutionMode[]
  cached:                  boolean
  checked_at:              number
}

export interface CapabilityCheckOptions {
  force_refresh?:     boolean | undefined
  timeout_ms?:        number | undefined
  include_providers?: ProviderName[] | undefined
}

export interface ICapabilityEngine {
  detect(options?: CapabilityCheckOptions): Promise<CapabilityResult>
  invalidateCache(): void
}

// ─────────────────────────────────────────────
// C. INVOCATION / PLANNER CONTRACT
// ─────────────────────────────────────────────

export interface RoutingHint {
  preferred_tiers?:     Array<'local' | 'cloud'>
  max_cost_usd?:        number
  max_latency_ms?:      number
  min_quality_ceiling?: number
  reason?:              string
  forceProvider?: ProviderName | undefined
  /**
   * P3 — W9: Workspace preferred provider name.
   *
   * When set, the router tries this provider first within the resolved mode.
   * Unlike forceProvider (dev/staging only), preferred_provider is a soft hint:
   * if the preferred provider is unhealthy or unavailable, normal mode-based
   * selection proceeds transparently.
   *
   * Values: any registered ProviderName (e.g. 'anthropic', 'openai', 'google').
   * Source: workspace_settings.preferred_provider → OrchestrationContext → callWithMode.
   */
  preferred_provider?: ProviderName | undefined
  /**
   * Phase 0 — Runtime Consolidation (Gate 1): optional per-request model override.
   *
   * When set, the runtime should prefer this model string over the adapter's
   * constructor-injected default. Soft hint, same precedence semantics as
   * preferred_provider: honored when present, otherwise the adapter's own
   * default_model applies. Added as a contract-only change in this gate — no
   * resolver, factory, or dispatch-site code reads this field yet.
   */
  preferred_model?: string | undefined
}

export interface OutputSchema {
  type:        'json' | 'text' | 'markdown' | 'array'
  shape?:      Record<string, unknown> | undefined
  max_tokens?: number | undefined
  strict?:     boolean | undefined
}

export interface InvocationRequest {
  task_type:         InvocationType
  user_intent:       string
  context?:          string | undefined
  preferred_mode?:   ExecutionMode | undefined
  latency_target_ms?: number | undefined
  quality_target?:   'fast' | 'balanced' | 'best' | undefined
  max_cost_usd?:     number | undefined
  output_schema?:    OutputSchema | undefined
  metadata?:         Record<string, unknown> | undefined
  user_id?:          string | undefined
  attachments?:      Array<{ type: string; data: string }> | undefined
  routing_hint?:     RoutingHint | undefined
  /**
   * P3 — BYOK: per-provider API key overrides.
   *
   * Map of provider name (e.g. 'anthropic', 'openai') → plaintext API key.
   * When present, the ExecutionEngine (F5 dispatch site) replaces the
   * platform environment key for that provider with the workspace-supplied key.
   *
   * Absent or empty object → runtime uses platform environment keys.
   * NEVER LOG. Contains plaintext keys.
   */
  api_key_overrides?: Record<string, string> | undefined
  /**
   * Phase 0 — Runtime Consolidation (Gate 1): optional per-request model override,
   * threaded through from RoutingHint.preferred_model. Contract-only addition —
   * no dispatch-site code consumes this yet (that is Gate 4 / Phase 4-5 scope).
   */
  preferred_model?: string | undefined
}

export interface FallbackRule {
  trigger:        FallbackTrigger
  from_provider?: ProviderName | undefined
  from_mode?:     ExecutionMode | undefined
  to_provider:    ProviderName
  to_mode:        ExecutionMode
  max_attempts:   number
}

export interface RetryBudget {
  max_total_attempts: number
  max_per_provider:   number
  backoff_ms:         number
}

export interface ExecutionPlan {
  primary_provider:      ProviderName
  primary_mode:          ExecutionMode
  fallback_chain:        Array<{ provider: ProviderName; mode: ExecutionMode }>
  estimated_latency_ms:  number
  estimated_cost_usd:    number
  retry_budget:          number
  timeout_ms:            number
}

export interface IRouterEngine {
  buildPlan(request: InvocationRequest, capability: CapabilityResult): ExecutionPlan
}

// ─────────────────────────────────────────────
// D. PROMPT BUILDER CONTRACT
// ─────────────────────────────────────────────

export interface BuiltPrompt {
  system_prompt?: string | undefined
  user_prompt:    string
  json_mode:      boolean
}

export interface IPromptBuilder {
  build(request: InvocationRequest): BuiltPrompt
}

// ─────────────────────────────────────────────
// E. VALIDATOR CONTRACT
// ─────────────────────────────────────────────

export interface ValidationResult {
  valid:   boolean
  reason?: string | undefined
  flags:   QualityFlag[]
  parsed?: unknown | undefined
}

export interface IValidatorEngine {
  validate(content: string, schema?: OutputSchema | undefined): ValidationResult
}

// ─────────────────────────────────────────────
// F. POLICY CONTRACT
// ─────────────────────────────────────────────

export interface AIRuntimePolicy {
  local_only?:               boolean | undefined
  no_external_providers?:    boolean | undefined
  allowed_modes?:            ExecutionMode[] | undefined
  blocked_providers?:        ProviderName[] | undefined
  max_cost_per_request_usd?: number | undefined
}

export interface AIRuntimeError {
  code:          ErrorCode
  message:       string
  user_message:  string
  provider?:     ProviderName | undefined
  retryable:     boolean
}

export interface IPolicyEngine {
  validate(
    request:  InvocationRequest,
    mode:     ExecutionMode,
    provider: ProviderName
  ): AIRuntimeError | null
}

// ─────────────────────────────────────────────
// G. TELEMETRY CONTRACT
// ─────────────────────────────────────────────

export interface TelemetrySnapshot {
  request_id:      string
  /**
   * Domain task type as a string — observability data, not a routing decision.
   * Accepts both domain TaskType ('carousel', 'post'…) and InvocationType
   * ('generate_carousel', 'chat'…) without requiring a cast at the call site.
   * Typed as string to preserve bounded-context separation between domain
   * vocabulary (contracts/index.ts TaskType) and runtime vocabulary
   * (InvocationType). Consumers that need to filter by task should use
   * discriminated unions at their own layer boundary.
   */
  task_type:       string
  mode_selected:   ExecutionMode
  provider_used:   ProviderName
  /** The model ID that actually executed (from ProviderInvokeResult.model_used). Sprint A Obj 1+5. */
  model_used?:     string | undefined
  /** The admin-configured default model for this provider at invocation time. */
  configured_model?: string | undefined
  latency_ms:      number
  fallback_count:  number
  retry_count:     number
  token_estimate?: number | undefined
  quality_flags:   QualityFlag[]
  success:         boolean
  timestamp:       number
}

export interface TelemetryStats {
  total_requests:  number
  success_rate:    number
  avg_latency_ms:  number
  fallback_rate:   number
  by_provider:     Partial<Record<ProviderName, { count: number; avg_latency_ms: number }>>
}

export interface TelemetrySink {
  emit(snapshot: TelemetrySnapshot): Promise<void>
}

export interface ITelemetryEngine {
  record(snapshot: TelemetrySnapshot): Promise<void>
  stats(): TelemetryStats
  getHistory(): TelemetrySnapshot[]
}

// ─────────────────────────────────────────────
// H. RUNTIME OUTPUT
// ─────────────────────────────────────────────

export interface AIRuntimeOutput {
  status:                   OutputStatus
  content:                  string | null
  parsed?:                  unknown | undefined
  engine_used:              ProviderName
  /** The model ID that actually ran. Set by adapter via ProviderInvokeResult.model_used. */
  model_used?:              string | undefined
  mode_used:                ExecutionMode
  providerKind:             'local' | 'cloud'
  latency_ms:               number
  quality_flags:            QualityFlag[]
  retry_count:              number
  fallback_used:            boolean
  fallback_chain_exhausted: boolean
  error?:                   AIRuntimeError | undefined
  telemetry:                TelemetrySnapshot
}

// ─────────────────────────────────────────────
// I. RUNTIME INTERFACE
// ─────────────────────────────────────────────

export interface IAIRuntime {
  run(request: InvocationRequest): Promise<AIRuntimeOutput>
  capabilities(options?: CapabilityCheckOptions): Promise<CapabilityResult>
  refreshCapabilities(): Promise<CapabilityResult>
  stats(): TelemetryStats
  telemetryHistory(): TelemetrySnapshot[]
}

// ─────────────────────────────────────────────
// J. PLUGIN REGISTRY CONTRACT
// ─────────────────────────────────────────────

export type HookEvent = 'before_invoke' | 'after_invoke' | 'on_fallback' | 'on_error'

export interface BeforeInvokeContext { request: InvocationRequest; provider: ProviderName }
export interface AfterInvokeContext  { request: InvocationRequest; output: AIRuntimeOutput }
export interface FallbackContext     { from_provider: ProviderName; to_provider: ProviderName; reason: string }
export interface ErrorContext        { request: InvocationRequest; provider: ProviderName; error: Error }
export type HookContext = BeforeInvokeContext | AfterInvokeContext | FallbackContext | ErrorContext
export type HookHandler = (ctx: HookContext) => void | Promise<void>

export interface IPluginRegistry {
  registerAdapter(adapter: IProviderAdapter): this
  on(event: HookEvent, handler: HookHandler): this
  runHooks(event: HookEvent, context: HookContext): Promise<void>
  mergeIntoProviderMap(existing: Map<ProviderName, IProviderAdapter>): Map<ProviderName, IProviderAdapter>
}

// ─────────────────────────────────────────────
// K. CIRCUIT BREAKER CONTRACT
// ─────────────────────────────────────────────

export interface ICircuitBreaker {
  isOpen(provider: ProviderName): boolean
  recordSuccess(provider: ProviderName): void
  recordFailure(provider: ProviderName): void
  reset(provider: ProviderName): void
  snapshot(): Record<string, { state: string; failures: number }>
}

// ─────────────────────────────────────────────
// L. RATE LIMITER CONTRACT
// ─────────────────────────────────────────────

export interface RateLimitResult {
  allowed:          boolean
  reason?:          'rpm_exceeded' | 'tpm_exceeded' | undefined
  retry_after_ms?:  number | undefined
}

export interface IRateLimiter {
  canProceed(provider: ProviderName, estimatedTokens?: number): RateLimitResult
  record(provider: ProviderName, tokensUsed?: number): void
}

// ─────────────────────────────────────────────
// M. COST TRACKER CONTRACT
// ─────────────────────────────────────────────

export interface CostSummary {
  total_spent_usd: number
  budget_usd:      number | null
  remaining_usd:   number | null
  by_provider:     Partial<Record<ProviderName, number>>
  entry_count:     number
}

export interface ICostTracker {
  estimate(provider: ProviderName, tokens: number): number
  record(provider: ProviderName, tokens: number, requestId: string): number
  withinBudget(additionalCost?: number): boolean
  summary(): CostSummary
}

// ─────────────────────────────────────────────
// N. RUNTIME CONFIG (bootstrap)
// ─────────────────────────────────────────────

export interface ProviderConfig {
  api_key?:       string | undefined
  base_url?:      string | undefined
  default_model?: string | undefined
  enabled?:       boolean | undefined
}

export interface AIRuntimeConfig {
  providers:               Partial<Record<ProviderName, ProviderConfig>>
  policy?:                 AIRuntimePolicy | undefined
  fallback_rules?:         FallbackRule[] | undefined
  retry_budget?:           RetryBudget | undefined
  capability_cache_ttl_ms?: number | undefined
  telemetry_sink?:         TelemetrySink | undefined
  default_timeout_ms?:     number | undefined
  task_timeouts?:          Partial<Record<InvocationType, number>> | undefined
  log_level?:              'silent' | 'error' | 'warn' | 'info' | 'debug' | undefined
  circuit_breaker?:        { threshold?: number; reset_ms?: number }
  rate_limits?:            Partial<Record<ProviderName, { rpm: number; tpm: number }>>
  budget_usd?:             number | undefined
  /**
   * Phase 0 — Runtime Consolidation (Gate 1).
   * Admin-configured provider priority order (array of ProviderName values,
   * highest priority first). When present, factory.ts's buildProviders() uses
   * this order for Map insertion (Phase 1). When absent — which is the case
   * for every request until Phase 3 wires this up in
   * assembleRuntimeOverrides() — buildProviders() falls back to
   * PROVIDER_REGISTRY's priority_default order.
   *
   * NOT YET POPULATED by any live code path as of Gate 1. This is a contract
   * addition only; the assembler change that emits it is Phase 3 (Gate 3).
   */
  provider_priority?: string[] | undefined
}

/**
 * Phase 0 — Runtime Consolidation (Gate 1).
 *
 * The fully-resolved set of execution decisions for a single generation
 * request: which runtime mode, which provider, which model, and where the
 * API key came from. Intended as the single source of truth a caller can log
 * or inspect after a request completes, replacing ad-hoc casts like
 * `(cpResponse as any).resolvedProvider`.
 *
 * NOT YET ASSEMBLED OR POPULATED by any live code path as of Gate 1. This is
 * a contract-only addition. Assembling and logging this type inside
 * runtime-engine (and surfacing it in the generate route) is Phase 5 (Gate 4)
 * scope, per the Runtime Consolidation Implementation Plan.
 */
export interface RuntimeExecutionProfile {
  runtimeMode:  RuntimeMode
  provider:     ProviderName
  model:        string
  apiKeySource: 'user' | 'platform'
}

// ─────────────────────────────────────────────
// O. STREAMING CONTRACT
// ─────────────────────────────────────────────

export interface StreamChunk {
  text:     string
  done:     boolean
  provider: ProviderName
}

export interface IStreamable {
  [Symbol.asyncIterator](): AsyncIterator<string>
  collected(): string
}

// ─────────────────────────────────────────────
// P. RUNTIME MODE — Two-mode canonical model
//
// local:  only providers where ProviderKind === 'local' (Ollama, LM Studio).
//         Explicit terminal failure if none available. No cloud fallback.
//
// cloud:  only providers where ProviderKind === 'cloud'.
//         Selection by admin-configured priority. Explicit failure if none
//         enabled and healthy. No local fallback.
//
// auto:   routing strategy (not a selectable user mode). All enabled providers
//         participate in priority order. Default when no explicit choice made.
// ─────────────────────────────────────────────

export type RuntimeMode = 'local' | 'cloud'

export const RUNTIME_MODE_LABELS: Record<RuntimeMode, { label: string; desc: string }> = {
  local: {
    label: 'Local',
    desc:  'Local providers only (Ollama, LM Studio). Explicit failure if none available. No cloud fallback.',
  },
  cloud: {
    label: 'Cloud',
    desc:  'Cloud providers only. Explicit failure if none enabled. No local fallback.',
  },
}

/**
 * Translate RuntimeMode to internal preferred_mode for InvocationRequest.
 * This is the ONLY correct translation point.
 *
 * 'local' → 'local'   local-only restriction
 * 'cloud' → 'cloud'   cloud-only restriction
 */
export function runtimeModeToExecutionMode(mode: RuntimeMode): ExecutionMode {
  switch (mode) {
    case 'local': return 'local'
    case 'cloud': return 'cloud'
  }
}

/**
 * Translate legacy string values to RuntimeMode.
 * Called once at API/persistence read boundaries — not inside the runtime.
 * Returns 'cloud' as the safe default for unrecognised values.
 */
export function fromLegacyToRuntimeMode(s: string | null | undefined): RuntimeMode {
  if (!s) return 'cloud'
  switch (s.toLowerCase().trim()) {
    case 'local':
    case 'bespoke':     return 'local'
    case 'cloud_pro':
    case 'cloud_free':
    case 'premium':
    case 'cloud':       return 'cloud'
    case 'auto':
    case 'free':
    default:            return 'cloud'
  }
}


