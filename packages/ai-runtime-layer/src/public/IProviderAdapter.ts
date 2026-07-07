// ============================================================
// packages/ai-runtime-layer/src/public/IProviderAdapter.ts
//
// PUBLIC INTERFACE CONTRACT — Provider Adapter Boundary
//
// This file defines everything a provider adapter must implement,
// plus the internal normalisation contracts that ensure no provider-
// specific types leak into the orchestration layer.
//
// STRUCTURE:
//   IProviderAdapter         ← the contract every adapter implements
//   ProviderAdapterConfig    ← base config shape all adapters accept
//   InternalProviderContracts← error + result normalisation (internal use)
//   ProviderProfile          ← pure-function normalisation interface
//
// RULES:
//   - Adapters may import any provider SDK (openai, anthropic, etc.)
//     but ONLY inside their own `provider-adapters/<name>/index.ts` file.
//   - Adapters must never import from other adapters, from the router-engine,
//     runtime-engine, or from apps/web.
//   - All errors from the provider SDK must be normalised to RuntimeError
//     before being returned. Raw SDK errors must never reach ExecutionEngine.
//   - healthCheck() must never throw. Return available:false with a reason
//     string instead.
//   - invoke() should not catch errors — let them propagate to ExecutionEngine
//     which handles retry, circuit-breaker, and error normalisation uniformly.
//
// ADDING A NEW PROVIDER:
//   1. Create provider-adapters/<name>/index.ts
//   2. Implement IProviderAdapter (import from @brandos/contracts)
//   3. Add ProviderName to @brandos/contracts if it's a new id
//   4. Register in config/factory.ts
//   See AGENT_CONTEXT.md §8 for the complete checklist.
// ============================================================

import type {
  ProviderName,
  ExecutionMode,
  ProviderCapabilityStatus,
  ProviderInvokeRequest,
  ProviderInvokeResult,
} from '@brandos/contracts'

// ─────────────────────────────────────────────────────────────
// IProviderAdapter
//
// The contract every provider adapter must satisfy.
// Imported from @brandos/contracts — re-exported here for
// discoverability from within this package's public surface.
//
// Adapters are instantiated by AIRuntimeFactory and held in a
// Map<ProviderName, IProviderAdapter>. The Map insertion order
// is the admin-defined priority order.
// ─────────────────────────────────────────────────────────────
export type { IProviderAdapter } from '@brandos/contracts'
export type {
  ProviderCapabilityStatus,
  ProviderInvokeRequest,
  ProviderInvokeResult,
} from '@brandos/contracts'

// ─────────────────────────────────────────────────────────────
// ProviderAdapterConfig
//
// Minimum required configuration all adapters share.
// Individual adapters extend this with provider-specific fields
// (e.g. AnthropicAdapterConfig extends ProviderAdapterConfig).
//
// Passed by AIRuntimeFactory from the merged AIRuntimeConfig.
// Never read from environment directly inside an adapter.
// ─────────────────────────────────────────────────────────────
export interface ProviderAdapterConfig {
  /** Provider's API key. undefined for local adapters (Ollama, LMStudio). */
  api_key?: string | undefined
  /** Override base URL. Use for proxies, self-hosted endpoints, or dev. */
  base_url?: string | undefined
  /** Default model ID to use when the InvocationRequest doesn't specify one. */
  default_model?: string | undefined
}

// ─────────────────────────────────────────────────────────────
// LocalProviderAdapterConfig
//
// Adapter config for local providers (Ollama, LMStudio).
// No api_key required; base_url is the local server endpoint.
// ─────────────────────────────────────────────────────────────
export interface LocalProviderAdapterConfig {
  /** Local server URL. Defaults vary per adapter (e.g. http://localhost:11434). */
  base_url?: string | undefined
  /** Default model to load. Must be available in the local server's model list. */
  default_model?: string | undefined
}

// ─────────────────────────────────────────────────────────────
// OpenAICompatibleAdapterConfig
//
// Config for adapters using the OpenAI REST API wire protocol.
// Used by OpenAICompatibleAdapter and all registry-driven providers
// (Groq, Together, OpenRouter, DeepSeek, etc.).
// ─────────────────────────────────────────────────────────────
export interface OpenAICompatibleAdapterConfig extends ProviderAdapterConfig {
  /** Unique provider name used as the Map key and in telemetry. */
  provider_name: ProviderName
  /** Base URL for the OpenAI-compatible API (required). */
  base_url: string
  /** Extra HTTP headers to inject (e.g. api-version, x-provider-metadata). */
  extra_headers?: Record<string, string> | undefined
  /** Cost in USD per 1k tokens. Used by CostTracker. */
  cost_per_1k_tokens?: number | undefined
  /** Human-readable display name for admin UI. */
  display_name?: string | undefined
  /**
   * Semantic profile key for error/response normalisation.
   * Must be a key in PROVIDER_PROFILES. Defaults to 'generic'.
   */
  semantic_profile?: string | undefined
}

// ─────────────────────────────────────────────────────────────
// INTERNAL PROVIDER CONTRACTS
//
// These types are used WITHIN ai-runtime-layer only.
// They exist to ensure raw provider API responses and errors never
// reach the orchestration layer in their original SDK shapes.
//
// Workflow:
//   provider SDK response → ProviderProfile.normalizeResponse() → ProviderResult
//   provider SDK error    → ProviderProfile.normalizeError()    → RuntimeError
//   RuntimeError          → ExecutionEngine                     → AIRuntimeError (contracts)
//
// The translation at each step ensures orchestration logic depends
// only on stable internal shapes, not volatile SDK changes.
// ─────────────────────────────────────────────────────────────

/**
 * Canonical runtime error shape — produced by ProviderProfile.normalizeError().
 *
 * NEVER let raw SDK errors (openai.APIError, anthropic.APIError, etc.)
 * escape the adapter or profile. Always normalise to RuntimeError first.
 *
 * - `provider`: the provider id that originated the error (e.g. 'groq').
 * - `code`: stable machine-readable code. Valid values listed below.
 * - `message`: human-readable summary. Never undefined.
 * - `retryable`: true when the ExecutionEngine should retry (transient errors).
 * - `statusCode`: HTTP status if available (for rate-limit window calculation).
 * - `raw`: original throwable for debug logging only. Never read by orchestration.
 *
 * Stable code values:
 *   'auth_error' | 'rate_limited' | 'context_length' | 'model_not_found' |
 *   'server_error' | 'network_error' | 'unknown'
 */
export interface RuntimeError {
  provider: string
  code: string
  message: string
  retryable?: boolean | undefined
  statusCode?: number | undefined
  raw?: unknown | undefined
}

/**
 * Normalised success response — produced by ProviderProfile.normalizeResponse().
 *
 * `content` is always a non-empty string. If the raw response had empty choices
 * or null content, the profile must return ProviderFailure instead.
 */
export interface ProviderSuccess {
  success: true
  content: string
  /** Optional provider-specific metadata for logging or profile inspection. */
  metadata?: Record<string, unknown> | undefined
}

/**
 * Normalised failure response — produced by ProviderProfile.normalizeResponse()
 * when the raw response indicates a model-level failure (null choice, refusal, etc.).
 */
export interface ProviderFailure {
  success: false
  error: RuntimeError
}

/** Discriminated union of the two normalised response states. */
export type ProviderResult = ProviderSuccess | ProviderFailure

// ─────────────────────────────────────────────────────────────
// ProviderCapabilities
//
// Capability metadata for a specific provider family.
// Used by CapabilityEngine to skip incompatible providers for
// task types they cannot handle (e.g. a text-only model for VLM).
//
// Set via ProviderProfile.capabilities. Merge priority:
//   adapter.capabilities > profile.capabilities > defaults
// ─────────────────────────────────────────────────────────────
export interface ProviderCapabilities {
  /** Whether this provider supports streaming responses. */
  supportsStreaming?: boolean | undefined
  /** Whether this provider supports function/tool calling. */
  supportsTools?: boolean | undefined
  /** Whether this provider supports image/vision inputs. */
  supportsVision?: boolean | undefined
  /** Whether this provider supports native JSON mode (response_format). */
  supportsJsonMode?: boolean | undefined
  /** Maximum output tokens supported. */
  maxTokens?: number | undefined
  /** Maximum context window in tokens. */
  maxContext?: number | undefined
}

// ─────────────────────────────────────────────────────────────
// ProviderProfile
//
// Pure-function normalisation contract. No I/O, no SDK calls.
// One profile per semantic vendor family (OpenAI, Groq, DeepSeek, generic).
//
// Profiles ensure that orchestration logic never sees raw SDK shapes.
// All profiles live in src/profiles/. Register new profiles in profiles/index.ts.
//
// INVARIANT: Both normalizeError and normalizeResponse must NEVER throw.
// ─────────────────────────────────────────────────────────────
export interface ProviderProfile {
  /**
   * Convert any throwable into a RuntimeError.
   *
   * - Input may be any type (Error, string, SDK error object, undefined).
   * - Must never throw.
   * - Must always return a RuntimeError with non-empty code and message.
   *
   * @param error    - The raw throwable.
   * @param provider - Optional provider name for attribution in the error.
   */
  normalizeError(error: unknown, provider?: string): RuntimeError

  /**
   * Convert a raw provider API response into ProviderResult.
   *
   * - Handles null/undefined choices, empty content arrays, refusal reasons.
   * - Returns ProviderFailure for empty content — never ProviderSuccess with empty string.
   * - Must never throw.
   *
   * @param response - The raw API response object (unknown type, SDK-specific).
   * @param provider - Optional provider name for attribution in errors.
   */
  normalizeResponse(response: unknown, provider?: string): ProviderResult

  /**
   * Optional capability overrides for this provider family.
   * Merged with defaults in CapabilityEngine.
   */
  capabilities?: ProviderCapabilities | undefined
}

// ─────────────────────────────────────────────────────────────
// DynamicProviderConfig
//
// Config shape for runtime-registered providers (admin-created,
// not statically compiled into factory.ts).
//
// Protocol families determine which adapter class is used:
//   'openai-compatible' → OpenAICompatibleAdapter
//   'anthropic'         → AnthropicAdapter
//   'gemini'            → GoogleAdapter
//   'local'             → OllamaAdapter or LMStudioAdapter
//
// Used by: admin onboarding UI, control-plane-layer dynamic registration.
// NOT used by: the static factory.ts provider block (that's compile-time).
// ─────────────────────────────────────────────────────────────
export type ProtocolFamily =
  | 'openai-compatible'
  | 'anthropic'
  | 'gemini'
  | 'local'

export interface DynamicProviderConfig {
  /** Unique instance ID (e.g. 'groq-prod', 'my-vllm'). Must be valid ProviderName or a custom string. */
  providerId: string
  /** Wire protocol to use for this provider. Determines which adapter class is instantiated. */
  protocol: ProtocolFamily
  /**
   * Semantic profile key for error/response normalisation.
   * Must be a key in PROVIDER_PROFILES in profiles/index.ts.
   * Defaults to 'generic' if unknown — never hard-fails on missing profile.
   */
  semanticProfile: string
  /** Base URL for the API endpoint (e.g. 'https://api.groq.com/openai/v1'). */
  baseUrl: string
  /** API key. Required for cloud protocols; omit for local. */
  apiKey?: string | undefined
  /** Default model ID. Falls back to the profile's default when absent. */
  defaultModel?: string | undefined
  /** Additional HTTP headers injected on every request to this provider. */
  extraHeaders?: Record<string, string> | undefined
  /** Human-readable name for admin UI display. */
  displayName?: string | undefined
  /** Whether this provider is currently active. Defaults to false. */
  enabled?: boolean | undefined
}


