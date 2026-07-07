/**
 * @brandos/runtime-config — IPackage.ts
 *
 * Machine-readable package metadata for repo-intelligence and agentic tooling.
 * Updated to L4.
 */

export const PACKAGE_METADATA = {
  name:    '@brandos/runtime-config' as const,
  version: '1.0.0',
  layer:   2,     // Config layer
  level:   'L4',  // Upgraded from L3 by Wave C

  /**
   * Capability ownership registry.
   * Keys are dot-notation capability paths owned by this package.
   */
  capabilities: {
    'runtime.mode':           'RuntimeConfigSchema.runtimeMode — single source of truth for local|cloud',
    'runtime.provider':       'ProviderSettingsSchema, ProviderSettings, DEFAULT_PROVIDERS',
    'runtime.routing':        'toAIRuntimeConfig() — derives fallback rules from priority ordering',
    'runtime.retry':          'RuntimeConfigSchema.retryCount → toAIRuntimeConfig().retry_budget',
    'runtime.circuit_breaker':'RuntimeConfigSchema.circuitBreakerCooldown → toAIRuntimeConfig().circuit_breaker',
    'runtime.streaming':      'RuntimeConfigSchema.streamingEnabled',
    'runtime.fallback':       'RuntimeConfigSchema.fallbackEnabled + fallback_rules in toAIRuntimeConfig()',
    'runtime.safety':         'RuntimeConfigSchema.safetyMode (off|standard|strict)',
    'runtime.telemetry':      'RuntimeConfigSchema.telemetryEnabled',
    'runtime.bridge':         'toAIRuntimeConfig() — ONLY correct translation to AIRuntimeConfig',
    'runtime.service':        'IRuntimeConfigService — load/save/cache interface',
    'runtime.merge':          'mergeProviders(), mergeRuntimeConfig()',
  },

  /**
   * Dependencies.
   * INVARIANT: Never add governance-layer, ai-runtime-layer, or control-plane-layer.
   */
  dependencies: [
    '@brandos/contracts',  // type imports — AIRuntimeConfig, ProviderName
    'zod',
  ],

  /**
   * Confirmed consumers.
   */
  consumers: [
    '@brandos/control-plane-layer',  // RuntimeConfig, ProviderSettings, mergeProviders
    'apps/web',                       // RuntimeConfig type
  ],

  /**
   * Exports with zero cross-package direct references at last audit.
   * Do NOT delete — reasons documented per item.
   */
  flaggedExports: [
    { name: 'mergeRuntimeConfig',    status: 'ZERO_REFS', action: 'Keep — may be called via dynamic import or CPL re-export' },
    { name: 'toAIRuntimeConfig',     status: 'ZERO_REFS', action: 'Keep — bridge MUST be wired; zero refs = bridge broken, not dead code' },
    { name: 'DEFAULT_RUNTIME_CONFIG',status: 'ZERO_REFS', action: 'Keep — fallback default' },
    { name: 'IRuntimeConfigService', status: 'ZERO_REFS', action: 'Keep — interface for planned SupabaseRuntimeConfigService' },
  ],

  /**
   * Invariants that must never be violated.
   */
  invariants: [
    'I-1: No imports from @brandos/ai-runtime-layer, @brandos/governance-config, or @brandos/control-plane-layer',
    'I-2: toAIRuntimeConfig() is the single translation point from RuntimeConfig to AIRuntimeConfig',
    'I-3: All schemas are zod-validated; never bypass .parse() with type assertions on user-supplied config',
    'I-4: mergeProviders() merges by provider id; never replace the full list wholesale',
    'I-5: DEFAULT_RUNTIME_CONFIG is produced by RuntimeConfigSchema.parse({}); defaults flow through zod schema',
  ],

  /**
   * L4 additions in this wave.
   */
  l4Additions: [
    'RuntimeCapabilityRegistry.ts — queryable capability map',
    'validatePackage.ts — self-check returns PackageHealthReport',
    'IPackage.ts — machine-readable metadata (this file)',
    'AGENT_CONTEXT.md — updated to L4',
    'src/__tests__/validatePackage.test.ts — L4 test coverage',
  ],

  requiredReads: [
    'AGENT_CONTEXT.md',
    'src/IPackage.ts',         // this file
    'src/index.ts',            // implementation
    'src/RuntimeCapabilityRegistry.ts',
  ],
} as const

export type PackageCapabilityKey = keyof typeof PACKAGE_METADATA.capabilities


