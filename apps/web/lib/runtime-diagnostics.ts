/**
 * apps/web/lib/runtime-diagnostics.ts
 *
 * All business logic for GET /api/admin/runtime-debug.
 * Route handler delegates entirely here. No business logic in the route.
 *
 * Pattern: Route → Service → runtime internals.
 */

import { SupabaseAdminSettingsService } from '@brandos/control-plane-layer'
import { AdminSettingsService }          from '@brandos/control-plane-layer'
import { assembleRuntimeOverrides }      from '@brandos/control-plane-layer'
import { callWithMode, isUnavailable }   from '@brandos/ai-runtime-layer'
import type { ProviderConfig }           from '@brandos/contracts'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiagnosticsSnapshot {
  ok:        boolean
  healthy:   boolean
  warnings:  string[]
  checkedAt: string

  settings_in_db: {
    runtimeMode:      string
    fallbackEnabled:  boolean
    retryCount:       number
    circuitBreaker_s: number
    providers: Array<{
      id:            string
      name:          string
      enabled:       boolean
      priority:      number
      health:        string
      defaultModel?: string | undefined
    }>
  }

  resolved_config: {
    active_providers:   Array<{ id: string; priority: number | null; configuredModel?: string | undefined }>
    disabled_providers: string[]
    fallback_rules:     string[]
    retry_budget:       unknown
    circuit_breaker:    unknown
  }

  mismatched_providers: Array<{
    id:                 string
    enabled_in_db:      boolean
    enabled_in_runtime: boolean
  }>

  test_invoke: {
    ok:         boolean
    provider?:        string
    model?:           string
    configuredModel?: string
    resolvedModel?:   string
    latency_ms?:      number
    error?:           string
  } | null
}

export interface DiagnosticsOptions {
  runLiveTest:    boolean
  forceProvider?: string | undefined
  requestId:      string
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class RuntimeDiagnosticsService {
  static async getSnapshot(opts: DiagnosticsOptions): Promise<DiagnosticsSnapshot> {
    const checkedAt = new Date().toISOString()

    // 1. Settings as persisted in Supabase
    const stored  = await SupabaseAdminSettingsService.load()
    const rtStored = stored.aiRuntime
    const rtMode  = (rtStored as any)?.runtimeMode ?? 'cloud'

    // 2. Resolved config (what factory.ts will actually build on next request)
    const overrides         = assembleRuntimeOverrides()
    const overrideProviders = overrides.providers ?? {}
    const adminProviders    = rtStored?.providers ?? []

    const active:   Array<{ id: string; priority: number | null; configuredModel?: string | undefined }> = []
    const disabled: string[] = []

    for (const [id, cfg] of Object.entries(overrideProviders)) {
      const adminEntry = adminProviders.find(p => p.id === id)
      if ((cfg as ProviderConfig).enabled === true) {
        active.push({ id, priority: adminEntry?.priority ?? null, configuredModel: adminEntry?.defaultModel })
      } else {
        disabled.push(id)
      }
    }
    active.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))

    // 3. Mismatches
    const mismatched: DiagnosticsSnapshot['mismatched_providers'] = []
    for (const p of adminProviders) {
      const runtimeEnabled = (overrideProviders[p.id] as ProviderConfig)?.enabled === true
      if (p.enabled !== runtimeEnabled) {
        mismatched.push({ id: p.id, enabled_in_db: p.enabled, enabled_in_runtime: runtimeEnabled })
      }
    }

    // 4. Fallback chain display
    const fallbackRules = (overrides.fallback_rules ?? []).map(
      (r: any) => `${r.from_mode ?? '?'} → ${r.to_provider}`
    )

    // 5. Live test
    let testInvoke: DiagnosticsSnapshot['test_invoke'] = null

    if (opts.runLiveTest) {
      // Resolve the current runtime mode to use for the test
      const mode = AdminSettingsService.resolveRuntimeMode()
      const routingHint = opts.forceProvider
        ? ({ forceProvider: opts.forceProvider } as any)
        : undefined

      const start = Date.now()
      try {
        const result = await callWithMode(
          'Reply with the single word "OK" and nothing else.',
          mode,
          {
            userId:      `runtime-debug-${opts.requestId}`,
            taskType:    'text',
            routingHint,
          }
        )

        if (isUnavailable(result)) {
          testInvoke = { ok: false, latency_ms: Date.now() - start, error: result.message }
        } else {
          testInvoke = {
            ok:              true,
            provider:        result.provider,
            model:           result.model,
            configuredModel: result.configuredModel,
            resolvedModel:   result.resolvedModel,
            latency_ms:      result.latency_ms,
          }
        }
      } catch (err) {
        testInvoke = { ok: false, latency_ms: Date.now() - start, error: (err as Error).message }
      }
    }

    // 6. Warnings
    const warnings: string[] = []
    if (mismatched.length > 0) {
      warnings.push(`Provider state mismatch: ${mismatched.map(m => m.id).join(', ')} — DB and runtime disagree`)
    }
    if (active.length === 0) {
      warnings.push('No providers are active — all generation requests will fail immediately')
    }
    if (fallbackRules.length === 0 && active.length < 2) {
      warnings.push('Only one provider active and no fallback — single point of failure')
    }
    if (testInvoke?.ok === false) {
      warnings.push(`Live test failed: ${testInvoke.error}`)
    }

    const healthy = testInvoke === null ? active.length > 0 : testInvoke.ok

    return {
      ok: true,
      healthy,
      warnings,
      checkedAt,

      settings_in_db: {
        runtimeMode:      rtMode,
        fallbackEnabled:  rtStored?.fallbackEnabled ?? true,
        retryCount:       rtStored?.retryCount ?? 2,
        circuitBreaker_s: rtStored?.circuitBreakerCooldown ?? 60,
        providers: adminProviders.map(p => ({
          id:            p.id,
          name:          p.name,
          enabled:       p.enabled,
          priority:      p.priority,
          health:        p.health,
          defaultModel:  p.defaultModel,
        })),
      },

      resolved_config: {
        active_providers:   active,
        disabled_providers: disabled,
        fallback_rules:     fallbackRules,
        retry_budget:       overrides.retry_budget,
        circuit_breaker:    overrides.circuit_breaker,
      },

      mismatched_providers: mismatched,
      test_invoke:          testInvoke,
    }
  }
}


