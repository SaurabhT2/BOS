// ============================================================
// packages/ai-runtime-layer/src/contracts/provider.ts
//
// INTERNAL PROVIDER NORMALISATION CONTRACTS
//
// These types are INTERNAL to @brandos/ai-runtime-layer.
// They define the normalisation boundary between raw provider API
// shapes (OpenAI SDK, Anthropic SDK, etc.) and the orchestration layer.
//
// PURPOSE:
//   Provider SDKs change frequently. This boundary ensures that:
//     - Orchestration logic (ExecutionEngine, RouterEngine) never
//       depends on raw SDK types or shapes.
//     - Provider-specific error codes, response structures, and status
//       semantics are translated to stable canonical shapes HERE and
//       nowhere else.
//     - Adding or updating a provider SDK only requires changes inside
//       the adapter file and its profile — not in orchestration.
//
// RELATIONSHIP TO @brandos/contracts:
//   @brandos/contracts defines the public runtime contracts (IAIRuntime,
//   IProviderAdapter, AIRuntimeOutput, etc.) that callers depend on.
//   This file defines the INTERNAL normalisation layer between raw provider
//   responses and those public contracts.
//
//   Translation chain:
//     raw SDK response → ProviderProfile.normalizeResponse() → ProviderResult
//     raw SDK error    → ProviderProfile.normalizeError()    → RuntimeError
//     RuntimeError     → ExecutionEngine                     → AIRuntimeError (@brandos/contracts)
//
// INVARIANTS:
//   - RuntimeError.message is always a non-empty string. Never undefined.
//   - ProviderProfile methods must NEVER throw. They are safety nets.
//   - ProviderSuccess.content is always non-empty. Empty content → ProviderFailure.
//   - RuntimeError.raw holds the original SDK object for logging ONLY.
//     Orchestration logic must never access .raw.
// ============================================================

// ─────────────────────────────────────────────────────────────
// RuntimeError
//
// Canonical error shape produced by ProviderProfile.normalizeError().
// This is the ONLY error shape that reaches ExecutionEngine from a provider.
//
// Stable code values (extend as needed, document each addition):
//   'auth_error'       — 401/403 from provider (bad or expired key)
//   'rate_limited'     — 429 from provider (too many requests or token limit)
//   'context_length'   — 400 context too long (model's context window exceeded)
//   'model_not_found'  — 404 model not available (wrong model ID or not deployed)
//   'server_error'     — 5xx from provider (transient, retryable)
//   'network_error'    — Connection refused, DNS failure, timeout (retryable)
//   'unknown'          — Catch-all for unrecognised error shapes
// ─────────────────────────────────────────────────────────────
export interface RuntimeError {
  /** Provider that originated this error (e.g. 'groq', 'deepseek', 'anthropic'). */
  provider: string

  /**
   * Stable machine-readable error code.
   * Must be one of the documented values above.
   * New codes must be documented here when added.
   */
  code: string

  /**
   * Human-readable error summary.
   * Must NEVER be undefined or empty. Profiles must guarantee this.
   * Use for logging and debugging — NOT for direct display to end users.
   */
  message: string

  /**
   * True when the caller should retry this request.
   *
   * Retryable: rate_limited (wait), server_error (transient), network_error (transient).
   * Not retryable: auth_error (configuration problem), model_not_found (wrong model ID),
   *   context_length (prompt too long — retry won't help).
   */
  retryable?: boolean | undefined

  /**
   * HTTP status code if available.
   * Used by ExecutionEngine for rate-limit retry window calculation.
   * undefined when error is not HTTP-originated (e.g. network_error).
   */
  statusCode?: number | undefined

  /**
   * The original throwable from the provider SDK.
   * Stored for debug logging ONLY. Never accessed by orchestration logic.
   * Accessing this in ExecutionEngine or RouterEngine is a contract violation.
   */
  raw?: unknown | undefined
}

// ─────────────────────────────────────────────────────────────
// ProviderSuccess / ProviderFailure / ProviderResult
//
// Discriminated union representing the normalised result from a
// provider adapter invocation.
//
// INVARIANTS:
//   ProviderSuccess.content must be a non-empty string.
//   If the raw response has empty choices or null content, produce ProviderFailure.
//   ProviderFailure.error must be a fully-populated RuntimeError.
// ─────────────────────────────────────────────────────────────

/** Normalised success response — content is always non-empty. */
export interface ProviderSuccess {
  success: true
  /** Model output text. Always non-empty. */
  content: string
  /**
   * Optional provider-specific metadata.
   * Use for logging or profile-level diagnostics only.
   * Never accessed by orchestration logic.
   */
  metadata?: Record<string, unknown> | undefined
}

/** Normalised failure response — produced when content is missing or response indicates failure. */
export interface ProviderFailure {
  success: false
  error: RuntimeError
}

/** Discriminated union. Narrow with success field: if (result.success) { ... } */
export type ProviderResult = ProviderSuccess | ProviderFailure

// ─────────────────────────────────────────────────────────────
// ProviderCapabilities
//
// Capability flags for a provider family.
// Used by CapabilityEngine to skip incompatible providers for task
// types they cannot handle (e.g. a text-only model for image_analysis).
//
// Set via ProviderProfile.capabilities. Adapters may also expose
// capabilities directly by implementing a `capabilities` property.
//
// Merge priority: adapter.capabilities > profile.capabilities > defaults.
// ─────────────────────────────────────────────────────────────
export interface ProviderCapabilities {
  /** Whether this provider supports streaming responses. */
  supportsStreaming?: boolean | undefined
  /** Whether this provider supports function/tool calling (OpenAI tools, Anthropic tool_use). */
  supportsTools?: boolean | undefined
  /** Whether this provider supports image/vision inputs. */
  supportsVision?: boolean | undefined
  /** Whether this provider supports native JSON mode (response_format, structured output). */
  supportsJsonMode?: boolean | undefined
  /** Maximum output tokens this provider supports. */
  maxTokens?: number | undefined
  /** Maximum context window in tokens (prompt + output combined). */
  maxContext?: number | undefined
}

// ─────────────────────────────────────────────────────────────
// ProviderProfile
//
// Pure-function normalisation contract. No I/O, no SDK calls, no state.
// One profile per semantic vendor family. Register in profiles/index.ts.
//
// EXISTING PROFILES:
//   'openai'    — openaiProfile.ts     (OpenAI-specific error codes and response shapes)
//   'groq'      — groqProfile.ts       (Groq-specific rate limit and error handling)
//   'deepseek'  — deepseekProfile.ts   (DeepSeek-specific quirks)
//   'generic'   — genericOpenAIProfile.ts (Fallback for all OAI-compatible endpoints)
//
// ADDING A NEW PROFILE:
//   1. Create profiles/<vendorName>Profile.ts implementing ProviderProfile.
//   2. Register it in profiles/index.ts under a stable key.
//   3. Set semanticProfile: '<key>' in the provider config.
//   No other changes needed.
//
// INVARIANTS:
//   - Both normalizeError and normalizeResponse must NEVER throw.
//     They must handle any input type (Error, string, undefined, unknown).
//   - normalizeError must always return a RuntimeError with non-empty code and message.
//   - normalizeResponse must return ProviderFailure (not ProviderSuccess with empty content)
//     when the raw response has no usable content.
// ─────────────────────────────────────────────────────────────
export interface ProviderProfile {
  /**
   * Convert any throwable into a RuntimeError.
   *
   * Input may be any type: Error, string, SDK error object, null, undefined.
   * The profile must handle all cases without throwing.
   *
   * @param error    - The raw throwable from the provider SDK or adapter.
   * @param provider - Optional provider name for attribution in the error.
   * @returns A fully-populated RuntimeError. code and message are always defined.
   */
  normalizeError(error: unknown, provider?: string): RuntimeError

  /**
   * Convert a raw provider API response into ProviderResult.
   *
   * Input is the raw response object from the provider SDK.
   * Handles: null/undefined choices, empty content arrays, refusal reasons,
   * content filter blocks, unexpected shapes.
   *
   * Must return ProviderFailure (not ProviderSuccess with empty string) when
   * the response has no usable content. Empty content causes downstream failures
   * that are harder to diagnose than an explicit ProviderFailure.
   *
   * @param response - Raw API response (type-unknown; profile knows the SDK shape).
   * @param provider - Optional provider name for attribution in errors.
   * @returns ProviderSuccess with non-empty content, or ProviderFailure with RuntimeError.
   */
  normalizeResponse(response: unknown, provider?: string): ProviderResult

  /**
   * Optional capability metadata for this provider family.
   *
   * When set, CapabilityEngine uses these to filter providers for task types
   * (e.g. skip non-vision providers for image_analysis tasks).
   * Individual adapters may override this with more specific values.
   */
  capabilities?: ProviderCapabilities | undefined
}

// ─────────────────────────────────────────────────────────────
// DynamicProviderConfig
//
// Configuration for runtime-registered providers.
// These are providers added by the admin through the UI, not statically
// compiled into factory.ts.
//
// Protocol determines which adapter class is used:
//   'openai-compatible' → OpenAICompatibleAdapter
//   'anthropic'         → AnthropicAdapter
//   'gemini'            → GoogleAdapter
//   'local'             → OllamaAdapter or LMStudioAdapter (by convention)
//
// Used by: admin provider onboarding UI, control-plane-layer dynamic registration.
// NOT used by: the static factory.ts provider block (that is compile-time).
// ─────────────────────────────────────────────────────────────

/** Wire protocol family. Determines which adapter class is instantiated. */
export type ProtocolFamily =
  | 'openai-compatible' // Standard OpenAI REST API (completion endpoint)
  | 'anthropic'         // Anthropic Messages API
  | 'gemini'            // Google Gemini API
  | 'local'             // Local HTTP server (Ollama/LMStudio protocol)

export interface DynamicProviderConfig {
  /**
   * Unique instance identifier.
   * Used as the Map key in the provider registry.
   * Must be stable across config reloads. Examples: 'groq-prod', 'my-vllm-001'.
   * Must be a valid ProviderName or a string the system treats as 'custom'.
   */
  providerId: string

  /** Wire protocol — determines adapter class instantiation. */
  protocol: ProtocolFamily

  /**
   * Semantic profile key for error/response normalisation.
   * Must match a key in PROVIDER_PROFILES (profiles/index.ts).
   * Defaults to 'generic' when the key is unknown — never hard-fails.
   */
  semanticProfile: string

  /**
   * Base URL for the API endpoint.
   * Required for all providers. Examples:
   *   'https://api.groq.com/openai/v1'
   *   'http://localhost:1234/v1'
   */
  baseUrl: string

  /** API key. Required for cloud protocols; omit for local providers. */
  apiKey?: string | undefined

  /** Default model ID. Falls back to the profile's default when absent. */
  defaultModel?: string | undefined

  /**
   * Additional HTTP headers sent on every request to this provider.
   * Use for: API version headers, custom auth schemes, provider-specific metadata.
   */
  extraHeaders?: Record<string, string> | undefined

  /** Human-readable display name for admin UI. Falls back to providerId. */
  displayName?: string | undefined

  /**
   * Whether this provider is currently active.
   * Inactive providers are registered but not eligible for selection.
   * Defaults to false — admin must explicitly enable.
   */
  enabled?: boolean | undefined
}


