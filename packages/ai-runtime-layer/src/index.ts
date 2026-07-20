// ============================================================
// packages/ai-runtime-layer/src/index.ts
//
// PUBLIC API — @brandos/ai-runtime-layer
//
// WHAT TO IMPORT FROM WHERE:
//
//   For invoking the AI runtime from the app (apps/web routes, agents):
//     import { callWithMode, callLLM, isUnavailable } from '@brandos/ai-runtime-layer'
//
//   For wiring the config provider at startup (control-plane-layer):
//     import { setRuntimeConfigProvider, ensureRuntimeInitialized } from '@brandos/ai-runtime-layer'
//
//   For the IAIRuntime interface (type-only dependency on the interface):
//     import type { IAIRuntime } from '@brandos/ai-runtime-layer/public'
//
//   For implementing a new provider adapter:
//     import type { IProviderAdapter } from '@brandos/contracts'
//
//   For implementing a new telemetry sink:
//     import type { TelemetrySink } from '@brandos/contracts'
//
//   For running the runtime as a standalone HTTP server:
//     import { AIRuntimeGateway } from '@brandos/ai-runtime-layer'
//
// PHASE 6 REMOVALS (previously documented):
//   - EngineMode, ModelTier, modeToTier, tierToMode, modeToEngineMode
//   - GENERATION_MODE_CONFIG, GENERATION_MODE_ORDER (now in @brandos/contracts)
//   - runtimeMode export (use RuntimeMode from @brandos/contracts)
//   - providerKind replaces engine field on LLMResponse
// ============================================================

// ─────────────────────────────────────────────────────────────
// Core adapter — the IAIRuntime implementation.
// Used by control-plane-layer tests and standalone server mode.
// Most app code should use llmRouter exports instead.
// ─────────────────────────────────────────────────────────────
export { AIRuntimeAdapter } from './AIRuntimeAdapter'
export type { AIRuntimeAdapterOptions, RuntimeConfigProvider } from './AIRuntimeAdapter'

// ─────────────────────────────────────────────────────────────
// LLM Router — primary entry point for AI generation.
// These are the functions apps/web routes and agents should use.
// ─────────────────────────────────────────────────────────────
export {
  // Primary call surface
  callWithMode,          // Call with mode string; returns RouterResult (never throws)
  callLLM,               // Call with mode string; throws on failure
  isUnavailable,         // Type guard: narrows RouterResult → UnavailableResponse

  // Singleton lifecycle
  resetRuntime,          // Invalidate runtime instance; rebuilds on next call
  setRuntimeConfigProvider, // Wire admin config overrides (call once at startup)
  ensureRuntimeInitialized, // Wire config provider only if not already set
  primeRuntime,          // Bootstrap: force adapter construction so globalThis bridge is set before AEL bootstrap

  // Utilities
  getAvailableModels,    // List all models from MODEL_REGISTRY with providerKind
  engineLabel,           // Attribution label string for UI display

  // telemetry accessors
  getActiveTelemetryStats,
  getActiveTelemetryHistory,
} from './llmRouter'

export type {
  LLMResponse,           // Successful response from callWithMode
  UnavailableResponse,   // Failure response from callWithMode
  RouterResult,          // Union of LLMResponse | UnavailableResponse
  TaskType,  
              // 'text' | 'carousel' | 'vlm' | 'extraction'
} from './llmRouter'

// LLMTaskType alias kept for backward compatibility with callers that import
// it under this name. New code should use TaskType from './llmRouter'.
export type { TaskType as LLMTaskType } from './llmRouter'

// ─────────────────────────────────────────────────────────────
// Model Registry
// Static model metadata for UI display and provider selection.
// ─────────────────────────────────────────────────────────────
export { MODEL_REGISTRY, getModelById, getModelsByProviderKind } from './registry'
export type { ModelDefinition } from './registry'

// ─────────────────────────────────────────────────────────────
// Output Badge
// Attribution string for rendering in UI footers and export metadata.
// ─────────────────────────────────────────────────────────────
export { buildOutputBadge } from './generationModes'

// ─────────────────────────────────────────────────────────────
// VLM Service
// Vision language model helpers for brand asset analysis.
// ─────────────────────────────────────────────────────────────
export { analyzeImageWithVLM, analyzeMultipleImages, checkBrandCompliance, extractTextFromImageWithVLM } from './vlmService'
export type { VLMAnalysisResult, VLMAnalysisRequest } from './vlmService'

// ─────────────────────────────────────────────────────────────
// Provider Adapters (concrete implementations)
// Import these only if you need to instantiate an adapter directly
// (e.g. in tests, or in AIRuntimeFactory custom wiring).
// Normal app code should not import adapters directly.
// ─────────────────────────────────────────────────────────────
export { AnthropicAdapter } from './provider-adapters/anthropic/index'
export type { AnthropicAdapterConfig } from './provider-adapters/anthropic/index'
export { OpenAIAdapter }    from './provider-adapters/openai/index'
export { GoogleAdapter }    from './provider-adapters/google/index'
export { OllamaAdapter }    from './provider-adapters/ollama/index'
export { LMStudioAdapter }  from './provider-adapters/lmstudio/index'
export { OpenAICompatibleAdapter }    from './provider-adapters/openai-compatible/index'
export { OPENAI_COMPATIBLE_PROVIDER_DEFS }    from './provider-adapters/openai-compatible/definitions'
export type { OpenAICompatibleProviderDef }   from './provider-adapters/openai-compatible/definitions'

// ─────────────────────────────────────────────────────────────
// Internal Provider Contracts
// These types are INTERNAL to ai-runtime-layer.
// They define the normalisation boundary between raw provider API
// shapes and the orchestration layer.
// External code should depend on @brandos/contracts types instead.
// ─────────────────────────────────────────────────────────────
export type {
  RuntimeError,          // Canonical normalised provider error
  ProviderSuccess,       // Normalised success result
  ProviderFailure,       // Normalised failure result
  ProviderResult,        // Union of ProviderSuccess | ProviderFailure
  ProviderCapabilities,  // Capability flags for a provider family
  ProviderProfile,       // Pure-function normalisation interface
  DynamicProviderConfig, // Config for runtime-registered (admin-created) providers
  ProtocolFamily,        // Wire protocol identifier
} from './contracts/provider'

// ─────────────────────────────────────────────────────────────
// Semantic Profiles
// Error and response normalisation strategies per vendor family.
// Register new profiles in profiles/index.ts.
// ─────────────────────────────────────────────────────────────
export {
  PROVIDER_PROFILES,    // All registered profiles by key
  resolveProfile,       // Look up a profile by key (falls back to 'generic')
  genericOpenAIProfile, // Default OpenAI-compatible normalisation
  openaiProfile,        // OpenAI-specific normalisation
  groqProfile,          // Groq-specific normalisation
  deepseekProfile,      // DeepSeek-specific normalisation
} from './profiles/index'

// ─────────────────────────────────────────────────────────────
// Error Normalisation Utility
// Universal error normaliser used by all adapters and ExecutionEngine.
// ─────────────────────────────────────────────────────────────
export { normalizeError } from './utils/normalizeError'

// ─────────────────────────────────────────────────────────────
// Config — Factory and Loader
// Used by AIRuntimeAdapter internally and by control-plane-layer
// for config assembly and merging.
// ─────────────────────────────────────────────────────────────
export { AIRuntimeFactory, buildDefaultFallbackRules } from './config/factory'
export { ConfigLoader }                                from './config/loader'

// ─────────────────────────────────────────────────────────────
// Telemetry Engine
// Fan-out telemetry to multiple sinks. Built-in sinks for common cases.
// Add custom sinks via TelemetryEngine.addSink().
// ─────────────────────────────────────────────────────────────
export {
  TelemetryEngine,         // Main engine with fan-out and stats
  ConsoleTelemetrySink,    // Logs JSON snapshots to console
  NoopTelemetrySink,       // Captures snapshots in memory (for tests)
  HttpTelemetrySink,       // POSTs snapshots to an HTTP endpoint
} from './telemetry-engine/index'

// ─────────────────────────────────────────────────────────────
// Runtime Engine
// The full IAIRuntime implementation and its execution engine.
// Import these for testing, standalone mode, or custom wiring.
// Normal app code should use llmRouter exports.
// ─────────────────────────────────────────────────────────────
export { RuntimeEngine, ExecutionEngine } from './runtime-engine/index'
export type {
  RuntimeEngineOptions,  // Constructor options for RuntimeEngine
  IExecutionEngine,      // Interface for the execution engine (for mocking)
  ExecutionEngineOptions, // Constructor options for ExecutionEngine
} from './runtime-engine/index'

export { PromptBuilder }                          from './runtime-engine/prompt-builder'
export { StreamBuffer, parseSSEStream, streamOpenAICompatible } from './runtime-engine/streaming'

// ─────────────────────────────────────────────────────────────
// Capability Registry (Phase 2)
// Extended capability scoring and hint-based resolution.
// Not yet wired into AIRuntimeFactory — available for future
// agentic routing layers to use independently.
// See AGENT_CONTEXT.md §14 (M-3) for current status.
// ─────────────────────────────────────────────────────────────
export { CapabilityRegistry } from './capability-registry'

// ─────────────────────────────────────────────────────────────
// Public Interface Re-exports
// Type-only exports for consumers that depend on the interface
// rather than the implementation (control-plane-layer, tests, mocks).
// ─────────────────────────────────────────────────────────────
export type {
  IAIRuntime as IAIRuntimePublic,
  IRuntimeBridge,
  RuntimeBridgeCallOptions,
  RuntimeBridgeResult,
  RuntimeBridgeSuccess,
  RuntimeBridgeUnavailable,
} from './public/IAIRuntime'

export type {
  ProviderAdapterConfig,
  LocalProviderAdapterConfig,
  OpenAICompatibleAdapterConfig,
} from './public/IProviderAdapter'


