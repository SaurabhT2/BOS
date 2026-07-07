/**
 * @brandos/control-plane-layer — Supabase-backed Admin Settings Service
 *
 * Sprint 3 hardening: replaces global.__brandos_admin_store with a
 * Supabase-persisted settings table. Falls back to in-memory defaults
 * when DB is unavailable (dev mode).
 *
 * Schema (run once in Supabase):
 *
 *   CREATE TABLE brandos_admin_settings (
 *     id          text PRIMARY KEY DEFAULT 'singleton',
 *     section     text NOT NULL,
 *     data        jsonb NOT NULL,
 *     updated_at  timestamptz DEFAULT now()
 *   );
 *   ALTER TABLE brandos_admin_settings ENABLE ROW LEVEL SECURITY;
 *   -- Only service-role key can read/write
 *   CREATE POLICY "service_only" ON brandos_admin_settings
 *     USING (false) WITH CHECK (false);
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AIRuntimeSettings, ControlPlaneSettings, ArtifactEngineSettings, OutputControlSettings } from './settings-service';
import { AdminSettingsService } from './settings-service';
import { resetRuntime, setRuntimeConfigProvider } from '@brandos/ai-runtime-layer';
import { makeRuntimeConfigProvider } from './runtime-override-assembler';
import { PolicyConfigSchema, DEFAULT_POLICY_CONFIG, type PolicyConfig } from '@brandos/governance-config';

export interface AdminSettingsSnapshot {
  controlPlane: ControlPlaneSettings;
  aiRuntime: AIRuntimeSettings;
  artifactEngine: ArtifactEngineSettings;
  outputControl?: OutputControlSettings;
  /**
   * HIGH-001 FIX: governance section added to snapshot.
   * Previously absent — load() uses `row.section in snapshot` guard, so
   * governance rows written by /api/v2/governance/policy were silently skipped
   * during hydration, meaning all governance config changes were lost on restart.
   * Adding this field ensures the load() loop hydrates governance on startup.
   */
  governance?: PolicyConfig;
}

// ── Bootstrap: wire admin settings into the AI runtime once on first load ─────
// This MUST be called before any request hits the runtime. load() is the
// first async call in the GET handler and is awaited before any response,
// so this runs at startup. setRuntimeConfigProvider is idempotent — safe
// to call on every load(); the runtime only rebuilds when invalidate() is
// triggered, not on every config-provider registration.
let _configProviderWired = false;
function ensureConfigProviderWired(): void {
  if (_configProviderWired) return;
  _configProviderWired = true;
  setRuntimeConfigProvider(makeRuntimeConfigProvider());
  console.info('[ControlPlane] RuntimeConfigProvider wired — admin settings will govern runtime builds');
}

// In-memory fallback
let memoryCache: AdminSettingsSnapshot | null = null;

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export class SupabaseAdminSettingsService {
  private static client: SupabaseClient | null = getSupabaseAdmin();

  /** Load settings from Supabase, falling back to defaults */
  static async load(): Promise<AdminSettingsSnapshot> {
    // Wire the configProvider on first call — ensures admin settings govern
    // all runtime builds from this point forward, including the very first request.
    ensureConfigProviderWired();

    if (!this.client) {
      console.warn('[ControlPlane] Supabase unavailable — using in-memory settings');
      return this.defaults();
    }

    try {
      const { data, error } = await this.client
        .from('brandos_admin_settings')
        .select('section, data');

      if (error || !data || data.length === 0) {
        return this.defaults();
      }

      const snapshot = this.defaults();

      for (const row of data) {
        if (row.section in snapshot) {
          const existing = (
            snapshot as unknown as Record<string, unknown>
          )[row.section];

          ;(snapshot as unknown as Record<string, unknown>)[row.section] = {
            ...(typeof existing === 'object' && existing !== null
              ? (existing as object)
              : {}),
            ...(typeof row.data === 'object' && row.data !== null
              ? (row.data as object)
              : {}),
          };
        }
      }

      memoryCache = snapshot;
      // P0-1: Hydrate the authoritative runtime store so all runtime-facing reads
      // resolve from ONE snapshot. AdminSettingsService is the exclusive read path;
      // SupabaseAdminSettingsService is the exclusive persistence path.
      AdminSettingsService.hydrate(snapshot);
      // HIGH-001 FIX: hydrate governance section into AdminSettingsService so that
      // getGovernancePolicy() returns the persisted policy after restart.
      if (snapshot.governance) {
        AdminSettingsService.hydrateGovernance(snapshot.governance);
      }
      return snapshot;
    } catch (err) {
      console.error('[ControlPlane] LOAD ERROR', err);
      return memoryCache ?? this.defaults();
    }
  }

  /** Persist a settings section to Supabase */
  static async save(section: string, data: unknown): Promise<boolean> {
    // Update in-memory cache immediately
    if (memoryCache && section in memoryCache) {
      (memoryCache as unknown as Record<string, unknown>)[section] = data;
    }

    // P0-1: Propagate change into AdminSettingsService (the authoritative runtime store)
    // and invalidate the runtime so the next request rebuilds with fresh overrides.
    //
    // DEFECT FIX: Previously save() called AdminSettingsService.hydrate({ [section]: data })
    // where `data` was the full merged section object from the POST handler. This is correct
    // for persistence, but the shallow hydrate of aiRuntime replaces the whole providers array
    // with whatever the POST body contained. If the POST was a partial update (e.g. only
    // fallbackEnabled was sent), the POST handler in route.ts already deep-merges providers
    // by ID — so `data` is the correct full merged section. No change needed here; the
    // issue was in route.ts's provider merge logic which is already fixed.
    //
    // What IS needed: after any provider-enable change, the runtime MUST be invalidated
    // AND the capability cache must be cleared so the next request re-probes healthy providers.
    // resetRuntime() calls _runtime.invalidate() which nulls _inner — correct.
    // But the CapabilityEngine's internal cache TTL is 60s by default, meaning even after
    // invalidate() the next build will run a fresh capability check (new CapabilityEngine
    // instance is created in AIRuntimeFactory.create()). This is correct.
    AdminSettingsService.hydrate({ [section]: data } as any);

    // HIGH-001 FIX: if the saved section is 'governance', also call hydrateGovernance()
    // so that assembleRuntimeOverrides() getGovernancePolicy() resolves the new policy
    // immediately — not only after the next restart + load() cycle.
    if (section === 'governance') {
      const parsed = PolicyConfigSchema.safeParse(data);
      AdminSettingsService.hydrateGovernance(parsed.success ? parsed.data : DEFAULT_POLICY_CONFIG);
    }

    resetRuntime(); // signals AIRuntimeAdapter to rebuild on next request

    if (!this.client) {
      console.warn('[ControlPlane] Supabase unavailable — settings saved to memory only');
      return true;
    }

    try {
      const { error } = await this.client
        .from('brandos_admin_settings')
        .upsert({
          id: `settings_${section}`,
          section,
          data,
          updated_at: new Date().toISOString(),
        });

      if (error) {
        console.error('[ControlPlane] SUPABASE UPSERT ERROR', error);
        return false;
      }

      return true;
    } catch (err) {
      console.error('[ControlPlane] SAVE ERROR', err);
      return false;
    }
  }

  /** Synchronous cache read (fast path for request handlers) */
  static getCached(): AdminSettingsSnapshot {
    return memoryCache ?? this.defaults();
  }

  private static defaults(): AdminSettingsSnapshot {
    return {
      ...AdminSettingsService.get(),
      // HIGH-001 FIX: include governance default so load() hydration loop
      // sees 'governance' as a known key and merges Supabase rows into it.
      governance: DEFAULT_POLICY_CONFIG,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// P3 — probeProvider
//
// Sends a minimal "ping" invocation through the runtime to a specific provider.
// Intended for the admin provider-test endpoint.
//
// Route files are forbidden from importing @brandos/ai-runtime-layer directly
// (RULE-ROUTE-BOUNDARY). This function is the CPL-owned boundary that
// exposes the probe capability to route handlers without violating that rule.
// CPL → ARL is the correct, allowed dependency direction.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProviderProbeResult {
  ok:        boolean
  health:    'healthy' | 'degraded' | 'unknown'
  latencyMs: number | null
  error?:    string | undefined
}

/**
 * Probe a provider by sending a minimal invocation through the runtime.
 *
 * @param providerId - Provider name (e.g. 'anthropic', 'openai', 'google').
 * @param mode       - 'local' | 'cloud' — determines which provider tier to use.
 * @returns ProviderProbeResult — always resolved, never throws.
 */
export async function probeProvider(
  providerId: string,
  mode:       'local' | 'cloud',
): Promise<ProviderProbeResult> {
  const { callWithMode, isUnavailable, resetRuntime } = await import('@brandos/ai-runtime-layer')
  resetRuntime()
  const start = Date.now()
  try {
    const result = await callWithMode(
      'Reply with the single word "OK" and nothing else.',
      mode,
      {
        taskType:    'text',
        routingHint: { forceProvider: providerId as import('@brandos/contracts').ProviderName },
      },
    )
    const latencyMs = Date.now() - start
    if (isUnavailable(result)) {
      return { ok: false, health: 'degraded', latencyMs, error: result.message }
    }
    return { ok: true, health: 'healthy', latencyMs }
  } catch (err) {
    return { ok: false, health: 'unknown', latencyMs: Date.now() - start, error: (err as Error).message }
  }
}



