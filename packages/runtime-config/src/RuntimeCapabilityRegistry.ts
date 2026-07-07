/**
 * @brandos/runtime-config — RuntimeCapabilityRegistry.ts
 *
 * Machine-readable capability map for repo-intelligence, agentic tooling,
 * and multi-agent coordination. Declares which capabilities this package
 * owns and provides queryable access to them at runtime.
 *
 * This file is additive-only — no behavioral changes, no new dependencies.
 * Depends on: nothing (self-describing registry).
 */

// ─── Capability Key Type ───────────────────────────────────────────────────────

export type RuntimeCapabilityKey =
  | 'runtime.mode'
  | 'runtime.provider'
  | 'runtime.routing'
  | 'runtime.retry'
  | 'runtime.circuit_breaker'
  | 'runtime.streaming'
  | 'runtime.fallback'
  | 'runtime.safety'
  | 'runtime.telemetry'
  | 'runtime.bridge'
  | 'runtime.service'
  | 'runtime.merge'

// ─── Capability Descriptor ────────────────────────────────────────────────────

export interface RuntimeCapabilityDescriptor {
  /** Dot-notation capability key (owner claim) */
  key: RuntimeCapabilityKey
  /** Human-readable description of what this capability covers */
  description: string
  /** The primary export(s) that implement this capability */
  exports: string[]
  /** Whether this capability has confirmed active consumers */
  hasActiveConsumers: boolean
  /** Notes for agents (e.g. zero-ref warnings, invariants) */
  notes?: string
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const RUNTIME_CAPABILITIES: readonly RuntimeCapabilityDescriptor[] = [
  {
    key: 'runtime.mode',
    description: 'Active runtime mode (local | cloud). Single source of truth for provider selection.',
    exports: ['RuntimeConfigSchema', 'RuntimeConfig'],
    hasActiveConsumers: true,
  },
  {
    key: 'runtime.provider',
    description: 'Provider settings: identity, priority, health, timeouts, protocol, base URL.',
    exports: ['ProviderSettingsSchema', 'ProviderSettings', 'ProviderProtocol', 'ProviderKind', 'DEFAULT_PROVIDERS'],
    hasActiveConsumers: true,
  },
  {
    key: 'runtime.routing',
    description: 'Provider ordering and fallback rules derived from priority + runtimeMode.',
    exports: ['toAIRuntimeConfig', 'DEFAULT_RUNTIME_CONFIG'],
    hasActiveConsumers: false,
    notes: 'toAIRuntimeConfig() has ZERO cross-package refs at last audit. Bridge may be unwired — investigate before modifying.',
  },
  {
    key: 'runtime.retry',
    description: 'Retry budget: max attempts, per-provider cap, backoff ms.',
    exports: ['RuntimeConfigSchema', 'toAIRuntimeConfig'],
    hasActiveConsumers: true,
    notes: 'RuntimeConfigSchema.retryCount feeds into toAIRuntimeConfig().retry_budget.',
  },
  {
    key: 'runtime.circuit_breaker',
    description: 'Circuit breaker configuration: failure threshold and reset cooldown.',
    exports: ['RuntimeConfigSchema', 'toAIRuntimeConfig'],
    hasActiveConsumers: true,
    notes: 'RuntimeConfigSchema.circuitBreakerCooldown translated to reset_ms in toAIRuntimeConfig().',
  },
  {
    key: 'runtime.streaming',
    description: 'Streaming output enable flag.',
    exports: ['RuntimeConfigSchema'],
    hasActiveConsumers: true,
  },
  {
    key: 'runtime.fallback',
    description: 'Fallback rules: cascade from provider N to N+1 on unavailability.',
    exports: ['RuntimeConfigSchema', 'toAIRuntimeConfig'],
    hasActiveConsumers: true,
  },
  {
    key: 'runtime.safety',
    description: 'Runtime-level safety mode (off | standard | strict). Distinct from governance policy.',
    exports: ['RuntimeConfigSchema'],
    hasActiveConsumers: true,
  },
  {
    key: 'runtime.telemetry',
    description: 'Telemetry enable flag for provider-level tracking.',
    exports: ['RuntimeConfigSchema'],
    hasActiveConsumers: true,
  },
  {
    key: 'runtime.bridge',
    description: 'toAIRuntimeConfig() — the ONLY correct translation from persisted RuntimeConfig to AIRuntimeConfig.',
    exports: ['toAIRuntimeConfig'],
    hasActiveConsumers: false,
    notes: 'ZERO cross-package refs at audit. If this is not wired, admin-configured providers are not used by ai-runtime-layer.',
  },
  {
    key: 'runtime.service',
    description: 'IRuntimeConfigService — interface for Supabase-backed load/save/cache.',
    exports: ['IRuntimeConfigService'],
    hasActiveConsumers: false,
    notes: 'Interface only. SupabaseRuntimeConfigService lives in control-plane-layer.',
  },
  {
    key: 'runtime.merge',
    description: 'mergeProviders() and mergeRuntimeConfig() — deep-merge by provider ID.',
    exports: ['mergeProviders', 'mergeRuntimeConfig'],
    hasActiveConsumers: true,
    notes: 'mergeRuntimeConfig() has ZERO cross-package refs. May be called dynamically — do not delete.',
  },
] as const

// ─── Query API ─────────────────────────────────────────────────────────────────

export class RuntimeCapabilityRegistry {
  private readonly map: ReadonlyMap<RuntimeCapabilityKey, RuntimeCapabilityDescriptor>

  constructor() {
    this.map = new Map(RUNTIME_CAPABILITIES.map(c => [c.key, c]))
  }

  /** Retrieve descriptor for a specific capability key */
  get(key: RuntimeCapabilityKey): RuntimeCapabilityDescriptor | undefined {
    return this.map.get(key)
  }

  /** All registered capability keys */
  keys(): RuntimeCapabilityKey[] {
    return [...this.map.keys()]
  }

  /** All capability descriptors */
  list(): RuntimeCapabilityDescriptor[] {
    return [...this.map.values()]
  }

  /** Capabilities with no confirmed active consumers (zero-ref warnings) */
  flagged(): RuntimeCapabilityDescriptor[] {
    return this.list().filter(c => !c.hasActiveConsumers)
  }

  /** Check whether this package owns a given capability key */
  owns(key: string): key is RuntimeCapabilityKey {
    return this.map.has(key as RuntimeCapabilityKey)
  }
}

/** Singleton instance for import convenience */
export const runtimeCapabilityRegistry = new RuntimeCapabilityRegistry()


