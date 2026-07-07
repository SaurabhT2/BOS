// ============================================================
// packages/ai-runtime-layer/src/interfaces/IAIRuntimeRequirement.ts
//
// MACHINE-READABLE PACKAGE DEPENDENCY CONTRACT
//
// This file is the authoritative declaration of what this package
// requires to function. It is consumed by:
//   - Agents performing dependency analysis
//   - CI validation scripts (validatePackage.ts)
//   - Architecture linting tools
//   - Documentation generators
//
// RULES:
//   - Keep this in sync with actual package behavior.
//   - Update when adding dependencies, env vars, or changing contracts.
//   - Agents may read this to understand safe modification boundaries.
// ============================================================

/**
 * Declares all runtime requirements for @brandos/ai-runtime-layer.
 *
 * Instantiate and pass to validatePackage() in CI or startup checks.
 */
export interface IAIRuntimeRequirement {
  // ─────────────────────────────────────────────────────────
  // Required contracts (upstream type dependencies)
  // These packages must be present and their interfaces must be satisfied.
  // ─────────────────────────────────────────────────────────
  required_contracts: string[]

  // ─────────────────────────────────────────────────────────
  // Required packages (workspace dependencies)
  // ─────────────────────────────────────────────────────────
  required_packages: string[]

  // ─────────────────────────────────────────────────────────
  // Required environment variables
  // At least one provider group must be configured for the runtime to
  // produce successful invocations. No single env var is strictly required
  // at import time — the package loads without them and fails gracefully
  // at first invocation.
  // ─────────────────────────────────────────────────────────
  required_env_vars: AIRuntimeEnvVarGroup[]

  // ─────────────────────────────────────────────────────────
  // Optional capabilities
  // Features that are available when additional env vars or config
  // are present, but do not prevent the package from loading.
  // ─────────────────────────────────────────────────────────
  optional_capabilities: AIRuntimeOptionalCapability[]

  // ─────────────────────────────────────────────────────────
  // Forbidden dependencies
  // Packages that must NEVER appear in this package's import graph.
  // Import of any forbidden package is an architectural violation.
  // ─────────────────────────────────────────────────────────
  forbidden_dependencies: string[]

  // ─────────────────────────────────────────────────────────
  // Runtime assumptions
  // Facts that must be true at runtime for the package to behave correctly.
  // Violations produce silent degradation or incorrect behavior.
  // ─────────────────────────────────────────────────────────
  runtime_assumptions: string[]

  // ─────────────────────────────────────────────────────────
  // Upstream requirements
  // What this package expects callers to do before using it.
  // ─────────────────────────────────────────────────────────
  upstream_requirements: string[]
}

export interface AIRuntimeEnvVarGroup {
  /** Human-readable group name */
  group: string
  /** At least one of these env vars enables the group */
  vars: string[]
  /** Whether this group is required (vs. optional enhancement) */
  required: boolean
  /** Provider name this group configures */
  provider: string
}

export interface AIRuntimeOptionalCapability {
  /** Capability name */
  name: string
  /** What enables it */
  enabled_by: string
  /** Phase or tracking ID for incomplete capabilities */
  phase?: string
}

// ─────────────────────────────────────────────────────────────
// AUTHORITATIVE INSTANCE
//
// This is the ground-truth requirement declaration for the package.
// Agents and CI scripts should import and use this directly.
// ─────────────────────────────────────────────────────────────

export const AI_RUNTIME_REQUIREMENT: IAIRuntimeRequirement = {
  required_contracts: [
    // Core invocation types
    'InvocationRequest',
    'AIRuntimeOutput',
    'AIRuntimeConfig',
    'IAIRuntime',
    'IProviderAdapter',

    // Capability system
    'CapabilityResult',
    'CapabilityCheckOptions',
    'ICapabilityEngine',

    // Routing
    'ExecutionPlan',
    'IRouterEngine',
    'FallbackRule',
    'RoutingHint',

    // Telemetry
    'TelemetryStats',
    'TelemetrySnapshot',
    'ITelemetryEngine',
    'TelemetrySink',

    // Resilience
    'ICircuitBreaker',
    'IRateLimiter',
    'ICostTracker',

    // Policy
    'IPolicyEngine',

    // Misc
    'ProviderName',
    'RuntimeMode',
    'ExecutionMode',
    'ErrorCode',
    'QualityFlag',
    'OPENAI_COMPATIBLE_DEFS',
    'PROVIDER_REGISTRY',
  ],

  required_packages: [
    '@brandos/contracts',        // All interface and type definitions
    '@brandos/shared-utils',     // Logger, withRetry, CircuitBreaker, RateLimiter, CostTracker
    // Fix C1: @brandos/output-control-layer removed. ARTIFACT_TASK_PROMPTS are now
    // pushed via registerArtifactPrompt() at bootstrap time (Phase 1.1 bridge complete).
  ],

  required_env_vars: [
    {
      group: 'openai',
      vars: ['OPENAI_API_KEY'],
      required: false,
      provider: 'openai',
    },
    {
      group: 'anthropic',
      vars: ['ANTHROPIC_API_KEY'],
      required: false,
      provider: 'anthropic',
    },
    {
      group: 'google',
      vars: ['GOOGLE_AI_API_KEY'],
      required: false,
      provider: 'google',
    },
    {
      group: 'deepseek',
      vars: ['DEEPSEEK_API_KEY'],
      required: false,
      provider: 'deepseek',
    },
    {
      group: 'ollama',
      vars: ['OLLAMA_BASE_URL'],
      required: false,
      provider: 'ollama',
      // If absent, defaults to http://localhost:11434
    },
    {
      group: 'lmstudio',
      vars: ['LMSTUDIO_BASE_URL'],
      required: false,
      provider: 'lmstudio',
      // If absent, defaults to http://localhost:1234
    },
    // NOTE: Additional OpenAI-compatible provider keys are defined in PROVIDER_REGISTRY.
    // Each entry with protocol: 'openai-compatible' in that registry defines its own env var.
    // They are not enumerated here to avoid duplication. See config/loader.ts.
  ],

  optional_capabilities: [
    {
      name: 'admin_config_overrides',
      enabled_by: 'setRuntimeConfigProvider() called at startup with assembleRuntimeOverrides()',
    },
    {
      name: 'vlm_image_analysis',
      enabled_by: 'Provider with vision support configured (anthropic, openai with GPT-4V)',
    },
    {
      name: 'capability_registry_routing',
      enabled_by: 'CapabilityRegistry wired into AIRuntimeFactory.create() — Phase 2',
      phase: 'M-3',
    },
    {
      name: 'streaming_responses',
      enabled_by: 'parseSSEStream / StreamBuffer used by caller; no special config needed',
    },
    {
      name: 'http_telemetry_sink',
      enabled_by: 'config.telemetry_sink set to HttpTelemetrySink instance',
    },
    {
      name: 'openai_compatible_providers',
      enabled_by: 'PROVIDER_REGISTRY entries with protocol: openai-compatible and their API keys',
    },
  ],

  forbidden_dependencies: [
    '@brandos/control-plane-layer',
    '@brandos/governance-layer',
    '@brandos/governance-config',
    '@brandos/auth',
    '@brandos/cognition-client',
    '@brandos/iskill-runtime',
    '@brandos/artifact-engine-layer',
    '@brandos/presentation-layer',
    '@brandos/ui-admin',
    '@supabase/supabase-js',
    // Any direct import from apps/web is also forbidden (enforced by boundary scripts)
  ],

  runtime_assumptions: [
    'setRuntimeConfigProvider() is called before the first callWithMode() invocation.',
    '_sharedCircuitBreaker, _sharedRateLimiter, _sharedCostTracker are module-level singletons — not recreated on resetRuntime().',
    'Node.js single-threaded model: no locking is required for module-level state.',
    'The RuntimeConfigProvider function is synchronous, stable, and does not throw.',
    'Provider Map insertion order in buildProviders() reflects admin priority order.',
    'OPENAI_COMPATIBLE_DEFS and HANDLED_NATIVE_PROVIDERS are kept in sync to avoid double-registration.',
    'In serverless environments, each cold start begins with fresh singleton state.',
  ],

  upstream_requirements: [
    'Caller must call setRuntimeConfigProvider(assembleRuntimeOverrides) in instrumentation.ts or layout.tsx before any AI invocations.',
    'Caller must NOT create additional AIRuntimeFactory.create() instances in production code outside of tests.',
    'Caller must NOT call AIRuntimeAdapter directly in app routes — use callWithMode() from llmRouter instead.',
    'Control-plane-layer must call resetRuntime() after persisting admin provider changes.',
    'Provider API keys must be present in environment or in admin settings before calling callWithMode().',
  ],
}


