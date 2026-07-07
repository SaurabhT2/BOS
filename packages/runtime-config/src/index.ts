/**
 * @brandos/runtime-config
 *
 * SINGLE SOURCE OF TRUTH for AI runtime configuration.
 *
 * Responsibilities:
 *   - Provider settings schema (identity, priority, enabled, timeouts)
 *   - Runtime mode (local | cloud)
 *   - Resilience config (retryCount, circuitBreaker, fallback)
 *   - Local model selection
 *   - Streaming / telemetry flags
 *   - toAIRuntimeConfig() bridge → converts persisted settings → ai-runtime-layer format
 *   - Workspace credential resolution (P3 — BYOK): getProviderKey / getProviderKeyMap
 *     This is an exception to the "Auth → @brandos/auth" boundary: credential
 *     resolution depends on auth for encrypted-row storage but is *provider-configuration
 *     resolution*, not authentication. The dependency is explicit and non-circular.
 *
 * Explicitly NOT responsible for:
 *   - Governance / policy rules → @brandos/governance-config
 *   - Artifact type settings → @brandos/artifact-config
 *   - Telemetry aggregation → @brandos/telemetry-store
 *   - Auth session management → @brandos/auth (only credential storage is used here)
 */

import { z } from 'zod'
import type { AIRuntimeConfig, ProviderName } from '@brandos/contracts'

// ─── Provider Settings Schema ─────────────────────────────────────────────────
//
// OWNERSHIP: ProviderSettings is canonical here. @brandos/control-plane-layer
// imports this type — it does NOT maintain its own parallel definition.
//
// Protocol enum aligns with @brandos/contracts ProviderProtocol.
// 'gemini' was a drift bug — contracts uses 'google'. Fixed here.

export const ProviderProtocol = z.enum([
  'openai-compatible',
  'anthropic',
  'google',       // was 'gemini' — aligns with @brandos/contracts ProviderProtocol
  'ollama',
  'lmstudio',
])

export const ProviderKind = z.enum(['local', 'cloud'])

export const ProviderSettingsSchema = z.object({
  id:              z.string().min(1),
  name:            z.string().min(1),
  kind:            ProviderKind.default('cloud'),
  enabled:         z.boolean().default(false),
  keyConfigured:   z.boolean().default(false),
  priority:        z.number().int().min(1).max(100),
  health:          z.enum(['healthy', 'degraded', 'unknown']).default('unknown'),
  lastResponseMs:  z.number().nullable().default(null),
  protocol:        ProviderProtocol.optional(),
  baseUrl:         z.string().url().optional(),
  displayName:     z.string().optional(),
  timeout:         z.number().int().min(1000).max(120_000).optional(),
  defaultModel:    z.string().optional(),
  // semanticProfile: drives OpenAI-compatible adapter error/response normalisation.
  // Sourced from PROVIDER_REGISTRY.semanticProfile when creating a provider from a
  // registry preset; optional for custom/dynamic providers.
  semanticProfile: z.string().optional(),
})

export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>

// ─── Runtime Config Schema ────────────────────────────────────────────────────

export const RuntimeConfigSchema = z.object({
  // Core mode — single source of truth, replaces all duplicate runtimeMode fields
  runtimeMode: z.enum(['local', 'cloud']).default('cloud'),

  // Providers — ordered list; priority field determines fallback order
  providers: z.array(ProviderSettingsSchema).default([]),

  // Local models
  selectedLocalModel: z.string().optional(),
  localTimeout:       z.number().int().min(1000).max(120_000).default(30_000),

  // Cloud / resilience
  cloudTimeout:           z.number().int().min(1000).max(60_000).default(15_000),
  retryCount:             z.number().int().min(0).max(10).default(2),
  circuitBreakerCooldown: z.number().int().min(10).max(600).default(60),
  maxParallelJobs:        z.number().int().min(1).max(32).default(4),

  // Behavior flags
  streamingEnabled: z.boolean().default(true),
  fallbackEnabled:  z.boolean().default(true),

  // Safety (runtime-level; threshold is governance concern)
  safetyMode: z.enum(['off', 'standard', 'strict']).default('standard'),

  // Telemetry
  telemetryEnabled: z.boolean().default(true),
})

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_PROVIDERS: ProviderSettings[] = [
  {
    id: 'ollama', name: 'Ollama', kind: 'local', enabled: true,
    keyConfigured: false, priority: 1, health: 'unknown', lastResponseMs: null,
    protocol: 'ollama', baseUrl: 'http://localhost:11434',
  },
  {
    id: 'groq', name: 'Groq', kind: 'cloud', enabled: true,
    keyConfigured: false, priority: 2, health: 'unknown', lastResponseMs: null,
    protocol: 'openai-compatible',
  },
  {
    id: 'lmstudio', name: 'LM Studio', kind: 'local', enabled: false,
    keyConfigured: false, priority: 3, health: 'unknown', lastResponseMs: null,
    protocol: 'lmstudio', baseUrl: 'http://localhost:1234',
  },
  {
    id: 'openai', name: 'OpenAI', kind: 'cloud', enabled: false,
    keyConfigured: false, priority: 4, health: 'unknown', lastResponseMs: null,
    protocol: 'openai-compatible',
  },
  {
    id: 'anthropic', name: 'Anthropic', kind: 'cloud', enabled: false,
    keyConfigured: false, priority: 5, health: 'unknown', lastResponseMs: null,
    protocol: 'anthropic',
  },
  {
    id: 'google', name: 'Google Gemini', kind: 'cloud', enabled: false,
    keyConfigured: false, priority: 6, health: 'unknown', lastResponseMs: null,
    protocol: 'google',
  },
  {
    id: 'deepseek', name: 'DeepSeek', kind: 'cloud', enabled: false,
    keyConfigured: false, priority: 7, health: 'unknown', lastResponseMs: null,
    protocol: 'openai-compatible',
  },
  {
    id: 'openrouter', name: 'OpenRouter', kind: 'cloud', enabled: false,
    keyConfigured: false, priority: 8, health: 'unknown', lastResponseMs: null,
    protocol: 'openai-compatible',
  },
  {
    id: 'togetherai', name: 'Together AI', kind: 'cloud', enabled: false,
    keyConfigured: false, priority: 9, health: 'unknown', lastResponseMs: null,
    protocol: 'openai-compatible',
  },
]

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = RuntimeConfigSchema.parse({
  providers: DEFAULT_PROVIDERS,
})

// ─── Merge helpers ────────────────────────────────────────────────────────────

/**
 * Deep-merge incoming provider list with existing providers by ID.
 * Existing providers not present in incoming are preserved.
 * Incoming providers not present in existing are appended.
 */
export function mergeProviders(
  existing: ProviderSettings[],
  incoming: ProviderSettings[],
): ProviderSettings[] {
  const incomingMap = new Map(incoming.map(p => [p.id, p]))
  const merged = existing.map(p => {
    const override = incomingMap.get(p.id)
    return override ? { ...p, ...override } : p
  })
  const existingIds = new Set(existing.map(p => p.id))
  for (const p of incoming) {
    if (!existingIds.has(p.id)) merged.push(p)
  }
  return merged
}

/**
 * Merge a partial RuntimeConfig patch into an existing config.
 * Providers are deep-merged by ID, not replaced wholesale.
 */
export function mergeRuntimeConfig(
  existing: RuntimeConfig,
  patch: Partial<RuntimeConfig>,
): RuntimeConfig {
  const { providers: patchProviders, ...scalarPatch } = patch
  return RuntimeConfigSchema.parse({
    ...existing,
    ...scalarPatch,
    providers: patchProviders
      ? mergeProviders(existing.providers, patchProviders)
      : existing.providers,
  })
}

// ─── RuntimeConfigBridge ──────────────────────────────────────────────────────

/**
 * Converts persisted RuntimeConfig → AIRuntimeConfig (ai-runtime-layer format).
 *
 * THIS IS THE ONLY PLACE that translates admin settings into runtime behaviour.
 * No other code should construct AIRuntimeConfig from env vars or defaults
 * when Supabase settings exist.
 */
export function toAIRuntimeConfig(
  config: RuntimeConfig,
  apiKeys: Partial<Record<string, string>>,
): AIRuntimeConfig {
  const enabledProviders = config.providers
    .filter(p => p.enabled)
    .sort((a, b) => a.priority - b.priority)

  const providerMap: Partial<Record<ProviderName, { api_key?: string; base_url?: string; default_model?: string; enabled: boolean }>> = {}

  for (const p of config.providers) {
    providerMap[p.id as ProviderName] = {
      api_key:       apiKeys[p.id],
      base_url:      p.baseUrl,
      default_model: p.defaultModel,
      enabled:       p.enabled,
    }
  }

  // Derive policy from runtimeMode
  const policy = config.runtimeMode === 'local'
    ? { local_only: true }
    : { no_external_providers: false }

  // Build fallback rules from enabled provider order
  const fallbackRules = config.fallbackEnabled && enabledProviders.length > 1
    ? enabledProviders.slice(0, -1).map((p, i) => ({
        trigger: 'provider_unavailable' as const,
        from_provider: p.id as ProviderName,
        to_provider:   enabledProviders[i + 1]!.id as ProviderName,
        to_mode:       (enabledProviders[i + 1]!.kind === 'local' ? 'local' : 'cloud') as 'local' | 'cloud',
        max_attempts:  config.retryCount,
      }))
    : []

  return {
    providers: providerMap,
    policy,
    fallback_rules:   fallbackRules,
    retry_budget: {
      max_total_attempts: config.retryCount,
      max_per_provider:   1,
      backoff_ms:         500,
    },
    default_timeout_ms: config.cloudTimeout,
    circuit_breaker: {
      threshold: 3,
      reset_ms:  config.circuitBreakerCooldown * 1000,
    },
    log_level: 'info',
  }
}

// ─── Supabase Service Interface ───────────────────────────────────────────────

export interface IRuntimeConfigService {
  load(workspaceId?: string): Promise<RuntimeConfig>
  save(config: Partial<RuntimeConfig>, workspaceId?: string): Promise<RuntimeConfig>
  getCached(): RuntimeConfig
}

// ─── L4 Additions (Wave C) ─────────────────────────────────────────────────

export {
  RuntimeCapabilityRegistry,
  runtimeCapabilityRegistry,
  RUNTIME_CAPABILITIES,
} from './RuntimeCapabilityRegistry'

export type {
  RuntimeCapabilityKey,
  RuntimeCapabilityDescriptor,
} from './RuntimeCapabilityRegistry'

export {
  validatePackage,
} from './validatePackage'

export type {
  PackageHealthReport,
  PackageHealthCheck,
} from './validatePackage'

export {
  PACKAGE_METADATA,
} from './IPackage'

export type {
  PackageCapabilityKey,
} from './IPackage'

// ─── P3 — BYOK Credentials Service ───────────────────────────────────────────
//
// Workspace-scoped API key resolution and health recording.
// Server-side only — uses @brandos/auth (encrypted row storage) and
// @brandos/shared-utils (AES-256-GCM decryption).
//
// getProviderKeyMap() is the hot-path function (called from CPL W4).
// It issues ONE DB query for the workspace (F4) and decrypts in memory.
// getProviderKey() is used for single-provider lookups (VLM route, W6).
// recordProviderOutcome() is fire-and-forget health telemetry (W4).

export {
  getProviderKey,
  getProviderKeyMap,
  recordProviderOutcome,
  MissingEncryptionSecretError,
} from './credentials/resolver'

// validateProviderKey and validateKeyFormat are used by the W7 API route.
// They are exported here so routes import from '@brandos/runtime-config' —
// consistent with every other credential-service concern.
export {
  validateProviderKey,
  validateKeyFormat,
} from './credentials/validator'

export type { ValidationResult } from './credentials/validator'


