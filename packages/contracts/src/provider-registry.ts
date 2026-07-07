// ============================================================
// packages/contracts/src/provider-registry.ts
//
// SINGLE SOURCE OF TRUTH — AI Provider Registry
//
// ARCHITECTURAL ROLE:
//   Every AI provider known to the BrandOS platform MUST have
//   an entry here. All other files that previously defined their
//   own provider lists MUST import from here:
//     - settings-service.ts       → DEFAULTS.aiRuntime.providers
//     - runtime-override-assembler.ts → ALL_KNOWN_PROVIDERS
//     - definitions.ts            → OPENAI_COMPATIBLE_PROVIDER_DEFS
//     - ai-runtime/page.tsx       → PRESET_PROVIDERS
//     - admin/providers/route.ts  → KNOWN_PROTOCOLS
//
// INVARIANTS:
//   1. No runtime imports. No implementation. Pure data only.
//   2. Every `id` must match a member of ProviderName in airuntime-types.ts.
//   3. `priority_default` values must be unique and contiguous starting at 1.
//   4. `cost_per_1k_tokens: 0` for free providers; actual USD otherwise.
//   5. `requires_api_key: false` only for local providers (Ollama, LM Studio).
//
// HOW TO ADD A PROVIDER:
//   1. Add one entry to PROVIDER_REGISTRY below.
//   2. Add its name to the ProviderName union in airuntime-types.ts.
//   3. Add its env var to ConfigLoader.fromEnv().
//   4. Add its adapter to ai-runtime factory.ts if not openai-compatible.
//   Nothing else changes — the registry drives everything.
// ============================================================

/** Whether a provider runs locally or calls a remote cloud API */
export type ProviderKind = 'local' | 'cloud'

/**
 * Wire protocol used to communicate with this provider.
 * 'openai-compatible' covers most cloud providers (Groq, DeepSeek, Together,
 * OpenRouter). 'anthropic' and 'google' use their own SDK shapes.
 * 'ollama' and 'lmstudio' are local-server protocols.
 */
export type ProviderProtocol =
  | 'openai-compatible'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'lmstudio'

/** Full metadata record for one AI provider */
export interface ProviderDefinition {
  /**
   * Stable identifier. MUST match a member of ProviderName in
   * airuntime-types.ts. Never rename — this value is persisted
   * in DB settings and telemetry records.
   */
  id: string

  /** Human-readable display name (UI, logs) */
  name: string

  /**
   * 'local': runs on the user's machine (Ollama, LM Studio).
   *   – Costs $0. No API key. Explicit terminal failure if unavailable.
   *   – RuntimeMode 'local' restricts to these providers only.
   * 'cloud': remote API call (OpenAI, Anthropic, Groq, etc).
   *   – May have cost. API key required for most.
   *   – RuntimeMode 'cloud' restricts to these providers only.
   */
  kind: ProviderKind

  /** Wire protocol — determines which adapter class handles invocations */
  protocol: ProviderProtocol

  /**
   * Semantic profile tag used to select prompt templates.
   * 'generic' → standard template; provider-specific values
   * (e.g. 'groq', 'deepseek') select tailored templates.
   */
  semanticProfile: string

  /**
   * Default base URL. null means the SDK resolves it automatically
   * (e.g. OpenAI, Anthropic official SDKs). For local providers,
   * this is the localhost address of the server.
   */
  defaultBaseUrl: string | null

  /**
   * Default model identifier. Operators may override this in
   * AdminSettings. The runtime always prefers the persisted setting
   * over this default.
   */
  defaultModel: string

  /**
   * Whether this provider is active by default on a fresh workspace.
   * Local providers (Ollama) and Groq are enabled by default.
   * Paid cloud providers are disabled until the operator adds an API key.
   */
  enabled_by_default: boolean

  /**
   * Lower number = higher priority in routing decisions.
   * The router sorts providers by this value when building fallback chains.
   * Priority 1 is always attempted first; higher numbers are fallbacks.
   */
  priority_default: number

  /**
   * Estimated cost in USD per 1,000 tokens (combined prompt + completion).
   * 0 for free providers (local, Groq free tier, OpenRouter free tier).
   * Used by the cost tracker and budget enforcement in IRateLimiter.
   */
  cost_per_1k_tokens: number

  /**
   * Whether an API key must be configured before this provider can be used.
   * Always false for local providers. Always true for paid cloud providers.
   */
  requires_api_key: boolean

  /**
   * Additional HTTP headers to inject on every request.
   * Required by OpenRouter (attribution) and some managed cloud proxies.
   * Never include Authorization here — that comes from ProviderConfig.api_key.
   */
  extra_headers?: Record<string, string>
}

// ─────────────────────────────────────────────────────────────────────────────
// THE REGISTRY
// Order here does not affect routing priority — use `priority_default` for that.
// ─────────────────────────────────────────────────────────────────────────────

export const PROVIDER_REGISTRY: ProviderDefinition[] = [
  // ── Local providers ─────────────────────────────────────────────────────
  {
    id:                 'ollama',
    name:               'Ollama',
    kind:               'local',
    protocol:           'ollama',
    semanticProfile:    'generic',
    defaultBaseUrl:     'http://localhost:11434',
    defaultModel:       'llama3',
    enabled_by_default: true,
    priority_default:   1,
    cost_per_1k_tokens: 0,
    requires_api_key:   false,
  },
  {
    id:                 'lmstudio',
    name:               'LM Studio',
    kind:               'local',
    protocol:           'lmstudio',
    semanticProfile:    'generic',
    defaultBaseUrl:     'http://localhost:1234',
    defaultModel:       'local-model',
    enabled_by_default: false,
    priority_default:   2,
    cost_per_1k_tokens: 0,
    requires_api_key:   false,
  },

  // ── Cloud providers — enabled by default ─────────────────────────────────
  {
    id:                 'groq',
    name:               'Groq',
    kind:               'cloud',
    protocol:           'openai-compatible',
    semanticProfile:    'groq',
    defaultBaseUrl:     'https://api.groq.com/openai/v1',
    // llama-3.3-70b-versatile: Groq's free-tier flagship at time of writing.
    // High throughput, low latency — the default routing choice for cloud generation.
    defaultModel:       'llama-3.3-70b-versatile',
    enabled_by_default: true,
    priority_default:   3,
    cost_per_1k_tokens: 0,
    requires_api_key:   true,
  },

  // ── Cloud providers — disabled by default (paid or explicit opt-in) ──────
  {
    id:                 'openai',
    name:               'OpenAI',
    kind:               'cloud',
    protocol:           'openai-compatible',
    semanticProfile:    'openai',
    // null → SDK uses its built-in endpoint; supports Azure endpoint override
    defaultBaseUrl:     null,
    // gpt-4o-mini: best cost/quality balance for structured generation tasks
    defaultModel:       'gpt-4o-mini',
    enabled_by_default: false,
    priority_default:   4,
    cost_per_1k_tokens: 0.00015,
    requires_api_key:   true,
  },
  {
    id:                 'anthropic',
    name:               'Anthropic',
    kind:               'cloud',
    protocol:           'anthropic',
    semanticProfile:    'generic',
    defaultBaseUrl:     null,
    // claude-haiku: fastest + cheapest Anthropic model; suitable for structured output
    defaultModel:       'claude-haiku-4-5-20251001',
    enabled_by_default: false,
    priority_default:   5,
    cost_per_1k_tokens: 0.00025,
    requires_api_key:   true,
  },
  {
    id:                 'google',
    name:               'Google Gemini',
    kind:               'cloud',
    protocol:           'google',
    semanticProfile:    'generic',
    defaultBaseUrl:     null,
    // gemini-2.5-flash: multimodal, generous free tier, image_analysis capable
    defaultModel:       'gemini-2.5-flash',
    enabled_by_default: false,
    priority_default:   6,
    cost_per_1k_tokens: 0.0001,
    requires_api_key:   true,
  },
  {
    id:                 'deepseek',
    name:               'DeepSeek',
    kind:               'cloud',
    protocol:           'openai-compatible',
    semanticProfile:    'deepseek',
    defaultBaseUrl:     'https://api.deepseek.com/v1',
    defaultModel:       'deepseek-chat',
    enabled_by_default: false,
    priority_default:   7,
    cost_per_1k_tokens: 0.00014,
    requires_api_key:   true,
  },
  {
    id:                 'openrouter',
    name:               'OpenRouter',
    kind:               'cloud',
    protocol:           'openai-compatible',
    semanticProfile:    'generic',
    defaultBaseUrl:     'https://openrouter.ai/api/v1',
    // Free Qwen model — appropriate default for operators without a paid key.
    // Operators can override this to any OpenRouter model slug.
    defaultModel:       'qwen/qwen-2.5-72b-instruct:free',
    enabled_by_default: false,
    priority_default:   8,
    cost_per_1k_tokens: 0,
    requires_api_key:   true,
    // OpenRouter requires attribution headers per their ToS.
    extra_headers: {
      'HTTP-Referer': 'https://brandos.app',
      'X-Title':      'BrandOS',
    },
  },
  {
    id:                 'togetherai',
    name:               'Together AI',
    kind:               'cloud',
    protocol:           'openai-compatible',
    semanticProfile:    'generic',
    defaultBaseUrl:     'https://api.together.xyz/v1',
    defaultModel:       'meta-llama/Llama-3-70b-chat-hf',
    enabled_by_default: false,
    priority_default:   9,
    cost_per_1k_tokens: 0.0009,
    requires_api_key:   true,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// DERIVED LOOKUP TABLES
//
// Computed once at module load. All sorted by priority_default ascending
// (lower number = higher routing priority). Consumers should import these
// instead of filtering PROVIDER_REGISTRY themselves.
// ─────────────────────────────────────────────────────────────────────────────

// Sort once; all derived arrays share this order
const _sorted = [...PROVIDER_REGISTRY].sort((a, b) => a.priority_default - b.priority_default)

/**
 * All provider IDs in routing-priority order.
 * Used by the router when building fallback chains and by the settings
 * service to initialise the provider map.
 */
export const ALL_PROVIDER_IDS: string[] =
  _sorted.map(p => p.id)

/**
 * Local provider IDs only (kind === 'local'), priority order.
 * RuntimeMode 'local' restricts the runtime to these providers.
 */
export const LOCAL_PROVIDER_IDS: string[] =
  _sorted.filter(p => p.kind === 'local').map(p => p.id)

/**
 * Cloud provider IDs only (kind === 'cloud'), priority order.
 * RuntimeMode 'cloud' restricts the runtime to these providers.
 */
export const CLOUD_PROVIDER_IDS: string[] =
  _sorted.filter(p => p.kind === 'cloud').map(p => p.id)

/**
 * Provider IDs that are active on a fresh workspace (enabled_by_default === true).
 * Used by the settings service to seed initial provider config.
 */
export const DEFAULT_ENABLED_PROVIDER_IDS: string[] =
  _sorted.filter(p => p.enabled_by_default).map(p => p.id)

/**
 * Full ProviderDefinition records for openai-compatible providers.
 * Consumed by adapter factory to build OpenAI-SDK-backed adapters in one loop.
 * Does NOT include 'anthropic', 'google', 'ollama', 'lmstudio' — those use
 * dedicated adapter classes.
 */
export const OPENAI_COMPATIBLE_DEFS: ProviderDefinition[] =
  _sorted.filter(p => p.protocol === 'openai-compatible')

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the ProviderDefinition for a given ID, or undefined if not found.
 * Prefer this over array.find() at call sites — keeps the lookup in one place.
 *
 * EDGE CASE: returns undefined for provider IDs that exist in ProviderName
 * (airuntime-types.ts) but have been removed from the registry. Callers must
 * handle this gracefully; the runtime will treat unknown providers as unavailable.
 */
export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return PROVIDER_REGISTRY.find(p => p.id === id)
}

/**
 * True if the provider runs locally (no network call, no cost, no API key).
 * Used by the circuit breaker and cost tracker to skip tracking for local calls.
 */
export function isLocalProvider(id: string): boolean {
  return LOCAL_PROVIDER_IDS.includes(id)
}

/**
 * True if the provider calls a remote cloud API.
 * Used by policy engine to enforce `local_only` policy restrictions.
 */
export function isCloudProvider(id: string): boolean {
  return CLOUD_PROVIDER_IDS.includes(id)
}


