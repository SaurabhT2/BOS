/**
 * packages/control-plane-layer/src/admin/settings-service.ts
 *
 * GOVERNANCE MIGRATION:
 *   scoreThreshold default is now sourced from @brandos/governance-config
 *   (QualityConfigSchema default = 70) so there is a single source of truth.
 *   The field is kept in ControlPlaneSettings for runtime admin override,
 *   but the DEFAULT value MUST come from governance-config.
 *
 * NOTE: hallucinationGuard and autoRegenerate are surfaced as admin settings
 * and stored here. hallucinationGuard enforcement is on the governance roadmap
 * (see governance-config TODO). Do NOT remove the field — the UI depends on it.
 */

import type { RuntimeMode } from '@brandos/contracts'
import { fromLegacyToRuntimeMode } from '@brandos/contracts'
import { PROVIDER_REGISTRY, LOCAL_PROVIDER_IDS, isLocalProvider, isCloudProvider } from '@brandos/contracts'
import { QualityConfigSchema } from '@brandos/governance-config'
// HIGH-001 FIX: import PolicyConfig type and default so getGovernancePolicy() can
// be typed correctly and hydrateGovernance() can accept the canonical type.
import { type PolicyConfig, DEFAULT_POLICY_CONFIG } from '@brandos/governance-config'
// Sprint A contract fix: ProviderSettings is canonical in @brandos/runtime-config.
// This package imports the type — it does NOT maintain a parallel definition.
import type { ProviderSettings } from '@brandos/runtime-config'

// ─── Derive canonical default score threshold from governance-config ───────────
const _qualityDefaults = QualityConfigSchema.parse({})
const GOVERNANCE_DEFAULT_SCORE_THRESHOLD = _qualityDefaults.scoreThreshold  // 70

// ── Schema ────────────────────────────────────────────────────────────────────

export interface ControlPlaneSettings {
  runtimeMode:        RuntimeMode
  providerOrder:      string[]
  fallbackEnabled:    boolean
  retryCount:         number
  maxAttempts:        number
  /**
   * hallucinationGuard — stored and surfaced in admin UI.
   * Enforcement implementation is on the governance roadmap.
   * TODO: wire to governanceEngine.ts when hallucination detection is implemented.
   */
  hallucinationGuard: boolean
  brandSafetyMode:    'off' | 'standard' | 'strict'
  /**
   * scoreThreshold — admin-configurable override for the governance pass threshold.
   * Default sourced from governance-config.QualityConfigSchema (currently 70).
   * The orchestrator takes Math.max(task-threshold, adminThreshold) so this can
   * only raise the bar, never lower it below the task-specific governance-config value.
   */
  scoreThreshold:     number
  autoRegenerate:     boolean
  approvalRequired:   string[]
  experiments:        ExperimentConfig[]
}

export interface ExperimentConfig {
  id:       string
  name:     string
  variantA: string
  variantB: string
  winner:   string | null
  status:   'running' | 'paused' | 'complete'
  split:    [number, number]
}

export interface AIRuntimeSettings {
  runtimeMode:            RuntimeMode
  localTimeout:           number
  cloudTimeout:           number
  retryCount:             number
  circuitBreakerCooldown: number
  maxParallelJobs:        number
  streamingEnabled:       boolean
  fallbackEnabled:        boolean
  fallbackChain:          FallbackLink[]
  providers:              ProviderSettings[]
  selectedLocalModel?:    string | undefined
  safetyMode?:            'off' | 'standard' | 'strict' | undefined
  telemetryEnabled?:      boolean | undefined
  scoreThreshold?:        number | undefined
}

export interface FallbackLink { from: string; to: string }

// ProviderSettings is imported from @brandos/runtime-config above.
// The local interface that previously lived here has been removed (Sprint A).

export interface ArtifactEngineSettings {
  enabledTypes:   string[]
  exports:        Record<string, boolean>
  renderSettings: RenderSettings
  templates:      TemplateConfig[]
  renderQueue:    RenderJob[]
}

export interface RenderSettings {
  maxSlidesPerDeck:     number
  defaultCarouselPages: number
  themeStyle:           string
  autoImageGeneration:  boolean
  brandPackRequired:    boolean
}

export interface TemplateConfig {
  id:        string
  name:      string
  type:      string
  usage:     number
  updatedAt: string
  active:    boolean
}

export interface RenderJob {
  id:         string
  artifact:   string
  status:     'pending' | 'running' | 'completed' | 'failed'
  startedAt:  string
  durationMs: number | null
}

export interface OutputControlSettings {
  llmRepairEnabled: boolean
}

export interface AdminSettings {
  controlPlane:   ControlPlaneSettings
  aiRuntime:      AIRuntimeSettings
  artifactEngine: ArtifactEngineSettings
  outputControl:  OutputControlSettings
}

// ── Derive default providers from PROVIDER_REGISTRY ──────────────────────────

const DEFAULT_PROVIDERS: ProviderSettings[] = [...PROVIDER_REGISTRY]
  .sort((a, b) => a.priority_default - b.priority_default)
  .map(def => ({
    id:             def.id,
    name:           def.name,
    kind:           def.kind,
    enabled:        def.enabled_by_default,
    keyConfigured:  false,
    priority:       def.priority_default,
    health:         'unknown' as const,
    lastResponseMs: null,
    // Use the protocol directly from the registry definition — no collapsing.
    // 'ollama' and 'lmstudio' are valid values in ProviderSettingsSchema.
    // 'google' was previously incorrectly stored as 'gemini' in the local interface.
    protocol: (
      def.protocol === 'google' ? 'google' : def.protocol
    ) as ProviderSettings['protocol'],
    semanticProfile: def.semanticProfile,
  }))

// ── Defaults — scoreThreshold sourced from governance-config ──────────────────

const DEFAULTS: AdminSettings = {
  controlPlane: {
    runtimeMode:       'cloud',
    providerOrder:     [...PROVIDER_REGISTRY].sort((a,b) => a.priority_default - b.priority_default).map(p => p.name),
    fallbackEnabled:   true,
    retryCount:        2,
    maxAttempts:       3,
    hallucinationGuard: true,
    brandSafetyMode:   'standard',
    scoreThreshold:    GOVERNANCE_DEFAULT_SCORE_THRESHOLD,  // sourced from governance-config
    autoRegenerate:    true,
    approvalRequired:  ['high_risk', 'external_publish'],
    experiments:       [],
  },
  aiRuntime: {
    runtimeMode:            'cloud',
    localTimeout:           30000,
    cloudTimeout:           15000,
    retryCount:             2,
    circuitBreakerCooldown: 60,
    maxParallelJobs:        4,
    streamingEnabled:       true,
    fallbackEnabled:        true,
    fallbackChain:          [],
    providers: DEFAULT_PROVIDERS,
  },
  artifactEngine: {
    enabledTypes: ['carousel', 'deck', 'report', 'newsletter', 'post', 'thread'],
    exports:      { canva: true, figma: false, pptx: true, pdf: true, html: true },
    renderSettings: {
      maxSlidesPerDeck:     20,
      defaultCarouselPages: 6,
      themeStyle:           'dark',
      autoImageGeneration:  false,
      brandPackRequired:    false,
    },
    templates:   [],
    renderQueue: [],
  },
  outputControl: {
    llmRepairEnabled: false,
  },
}

// ── IAdminSettingsService ─────────────────────────────────────────────────────

export interface IAdminSettingsService {
  get(): AdminSettings
  getControlPlane():   ControlPlaneSettings
  getAIRuntime():      AIRuntimeSettings
  getArtifactEngine(): ArtifactEngineSettings
  getOutputControl():  OutputControlSettings
  getScoreThreshold(): number
  shouldAutoRegenerate(): boolean
  getMaxAttempts(): number
  getLLMRepairEnabled(): boolean
  resolveRuntimeMode(rawMode?: string | null): RuntimeMode
  getEnabledProvidersInPriorityOrder(): string[]
}

// ── In-process store ──────────────────────────────────────────────────────────

let _bootstrapped = false

// HIGH-001 FIX: separate in-process governance policy store.
// Governance is persisted under section='governance' in brandos_admin_settings,
// but it does NOT extend AdminSettings (which owns controlPlane/aiRuntime/artifactEngine).
// A separate store avoids touching the AdminSettings type and its cache version system.
let _governancePolicyStore: PolicyConfig | null = null

function getRawStore(): Record<string, unknown> {
  if (!(globalThis as any).__brandos_admin_store) {
    ;(globalThis as any).__brandos_admin_store = {
      controlPlane:   { ...DEFAULTS.controlPlane },
      aiRuntime:      { ...DEFAULTS.aiRuntime },
      artifactEngine: { ...DEFAULTS.artifactEngine },
      outputControl:  { ...DEFAULTS.outputControl },
    }
  }
  return (globalThis as any).__brandos_admin_store
}

// ── AdminSettingsService ──────────────────────────────────────────────────────

export class AdminSettingsService {
  private static _cache: AdminSettings | undefined = undefined
  private static _cacheVersion                     = -1

  static init(snapshot?: Partial<AdminSettings>): void {
    if (_bootstrapped) return
    _bootstrapped = true
    if (snapshot) this.hydrate(snapshot)
    console.info('[AdminSettingsService] Initialized' + (snapshot ? ' from snapshot' : ' from defaults'))
  }

  static get(): AdminSettings {
    const v = (globalThis as any).__brandos_settings_version ?? 0
    if (this._cache && this._cacheVersion === v) return this._cache

    const raw   = getRawStore()
    const rawAI = (raw.aiRuntime ?? {}) as Partial<AIRuntimeSettings> & { defaultMode?: string }

    let runtimeMode: RuntimeMode = 'cloud'
    if (rawAI.runtimeMode && (rawAI.runtimeMode === 'local' || rawAI.runtimeMode === 'cloud')) {
      runtimeMode = rawAI.runtimeMode
    } else if (rawAI.defaultMode) {
      runtimeMode = fromLegacyToRuntimeMode(rawAI.defaultMode)
    }

    const rawCP = (raw.controlPlane ?? {}) as Partial<ControlPlaneSettings> & { runtimeMode?: string }
    let cpRuntimeMode: RuntimeMode = 'cloud'
    if (rawCP.runtimeMode && (rawCP.runtimeMode === 'local' || rawCP.runtimeMode === 'cloud')) {
      cpRuntimeMode = rawCP.runtimeMode
    }

    this._cache = {
      controlPlane: {
        ...DEFAULTS.controlPlane,
        ...(rawCP as Partial<ControlPlaneSettings>),
        runtimeMode: cpRuntimeMode,
      },
      aiRuntime: {
        ...DEFAULTS.aiRuntime,
        ...rawAI,
        runtimeMode,
      },
      artifactEngine: {
        ...DEFAULTS.artifactEngine,
        ...(raw.artifactEngine as Partial<ArtifactEngineSettings> ?? {}),
      },
      outputControl: {
        ...DEFAULTS.outputControl,
        ...(raw.outputControl as Partial<OutputControlSettings> ?? {}),
      },
    }
    this._cacheVersion = v
    return this._cache!
  }

  static getControlPlane():   ControlPlaneSettings  { return this.get().controlPlane }
  static getAIRuntime():      AIRuntimeSettings      { return this.get().aiRuntime }
  static getArtifactEngine(): ArtifactEngineSettings { return this.get().artifactEngine }
  static getOutputControl():  OutputControlSettings  { return this.get().outputControl }

  static hydrate(snapshot: Partial<AdminSettings>): void {
    const store = getRawStore()
    if (snapshot.controlPlane)   store.controlPlane   = snapshot.controlPlane
    if (snapshot.aiRuntime)      store.aiRuntime      = snapshot.aiRuntime
    if (snapshot.artifactEngine) store.artifactEngine = snapshot.artifactEngine
    if (snapshot.outputControl)  store.outputControl  = snapshot.outputControl
    this._cache = undefined
    this.invalidate()
  }

  static invalidate(): void {
    ;(globalThis as any).__brandos_settings_version =
      ((globalThis as any).__brandos_settings_version ?? 0) + 1
    this._cache = undefined
  }

  static getTaskTimeouts(): Partial<Record<string, number>> {
    const { localTimeout, cloudTimeout } = this.getAIRuntime()
    return {
      chat:              cloudTimeout,
      post:              cloudTimeout,
      carousel:          Math.max(localTimeout, cloudTimeout) + 15000,
      generate_carousel: Math.max(localTimeout, cloudTimeout) + 15000,
      deck:              Math.max(localTimeout, cloudTimeout) + 15000,
      generate_deck:     Math.max(localTimeout, cloudTimeout) + 15000,
      report:            Math.max(localTimeout, cloudTimeout) + 10000,
      generate_report:   Math.max(localTimeout, cloudTimeout) + 10000,
      local:             localTimeout,
      image_analysis:    cloudTimeout + 20000,
    }
  }

  static getCircuitBreakerConfig(): { threshold: number; reset_ms: number } {
    return { threshold: 3, reset_ms: this.getAIRuntime().circuitBreakerCooldown * 1000 }
  }

  static getRetryBudget(): { max_total_attempts: number; max_per_provider: number; backoff_ms: number } {
    return { max_total_attempts: this.getAIRuntime().retryCount + 1, max_per_provider: 2, backoff_ms: 500 }
  }

  static getFallbackRules(): Array<{ trigger: string; to_provider: string; to_mode: string; max_attempts: number }> {
    const rt = this.getAIRuntime()
    if (!rt.fallbackEnabled) return []
    return []
  }

  static resolveRuntimeMode(rawMode?: string | null): RuntimeMode {
    if (rawMode) return fromLegacyToRuntimeMode(rawMode)
    return this.getAIRuntime().runtimeMode ?? 'cloud'
  }

  static getEnabledProvidersInPriorityOrder(): string[] {
    return this.getAIRuntime().providers
      .filter(p => p.enabled)
      .sort((a, b) => a.priority - b.priority)
      .map(p => p.id)
  }

  static isArtifactEnabled(type: string):  boolean { return this.getArtifactEngine().enabledTypes.includes(type) }
  static isExportEnabled(channel: string): boolean { return this.getArtifactEngine().exports[channel] ?? false }
  static getScoreThreshold(): number     { return this.getControlPlane().scoreThreshold }
  static shouldAutoRegenerate(): boolean { return this.getControlPlane().autoRegenerate }
  static getMaxAttempts(): number        { return this.getControlPlane().maxAttempts }
  static getSelectedLocalModel(): string { return this.getAIRuntime().selectedLocalModel ?? 'llama3' }
  static getLLMRepairEnabled(): boolean  { return this.getOutputControl().llmRepairEnabled }

  /**
   * HIGH-001 FIX: getGovernancePolicy — returns the active PolicyConfig.
   *
   * Previously this method did not exist. assembleRuntimeOverrides() used a safe-navigation
   * call `(AdminSettingsService as any).getGovernancePolicy?.()` which always resolved to
   * undefined, causing the runtime to fall back to DEFAULT_POLICY_CONFIG on every build
   * regardless of what was saved in Supabase.
   *
   * This method is now the authoritative read path for governance policy. It reads from
   * the in-process _governancePolicyStore which is populated by hydrateGovernance() at
   * two points: (1) SupabaseAdminSettingsService.load() on startup, (2) save() on write.
   */
  static getGovernancePolicy(): PolicyConfig {
    return _governancePolicyStore ?? DEFAULT_POLICY_CONFIG
  }

  /**
   * HIGH-001 FIX: hydrateGovernance — load governance policy into the in-process store.
   *
   * Called by SupabaseAdminSettingsService.load() after hydrating the main snapshot,
   * and by save() when section === 'governance'. This ensures the governance policy
   * stored in Supabase is reflected in runtime behavior after both restart and live update.
   */
  static hydrateGovernance(policy: PolicyConfig): void {
    _governancePolicyStore = policy
    console.info('[AdminSettingsService] Governance policy hydrated', {
      complianceMode: policy.complianceMode,
      governanceMode: policy.governanceMode,
      scoreThresholds: policy.scoreThresholds,
    })
  }

  static runtimeConfigSummary(requestMode: string): string {
    const rt = this.getAIRuntime()
    const cp = this.getControlPlane()
    const enabled = this.getEnabledProvidersInPriorityOrder()
    return [
      '[AdminConfig]',
      `runtimeMode=${rt.runtimeMode}`,
      `requestMode=${requestMode}`,
      `enabledProviders=[${enabled.join(',')}]`,
      `localTimeout=${rt.localTimeout}ms`,
      `cloudTimeout=${rt.cloudTimeout}ms`,
      `fallback=${rt.fallbackEnabled}`,
      `model=${this.getSelectedLocalModel()}`,
      `retry=${rt.retryCount}`,
      `circuitBreaker=${rt.circuitBreakerCooldown}s`,
      `scoreThreshold=${cp.scoreThreshold}`,
      `autoRegen=${cp.autoRegenerate}`,
      `safety=${cp.brandSafetyMode}`,
      `llmRepair=${this.getLLMRepairEnabled()}`,
    ].join(' ')
  }
}
   

