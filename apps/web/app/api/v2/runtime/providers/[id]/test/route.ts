/**
 * POST /api/v2/runtime/providers/[id]/test
 *
 * Sprint A — Obj 7: Implements the missing provider connectivity test endpoint.
 * Previously: all "Test" button clicks in /admin/ai-runtime returned 404.
 *
 * Sends a minimal probe through probeProvider() (CPL boundary function),
 * then writes the resulting health + latency back into Supabase so the admin
 * UI reflects it without a page reload.
 *
 * Returns:
 *   { ok: true,  health: 'healthy',  latencyMs: number }
 *   { ok: false, health: 'degraded'|'unknown', error: string, latencyMs: number|null }
 *
 * P3 FIX (D4): Route boundary violation resolved. The previous implementation
 * imported { resetRuntime, callWithMode, isUnavailable } directly from
 * @brandos/ai-runtime-layer, which violates RULE-ROUTE-BOUNDARY. Those calls
 * are now proxied through probeProvider() in @brandos/control-plane-layer,
 * which is the correct package for route files to import from.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin }              from '@/lib/admin/require-admin'
import {
  SupabaseAdminSettingsService,
  probeProvider,
}                                    from '@brandos/control-plane-layer'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  const { id } = params

  if (!id) {
    return NextResponse.json({ ok: false, error: 'provider id required' }, { status: 400 })
  }

  try {
    // Load settings to confirm the provider exists and is enabled
    const snapshot  = await SupabaseAdminSettingsService.load()
    const providers = snapshot?.aiRuntime?.providers ?? []
    const provider  = providers.find((p: any) => p.id === id)

    if (!provider) {
      return NextResponse.json(
        { ok: false, error: `Provider "${id}" not found in settings` },
        { status: 404 },
      )
    }

    if (!provider.enabled) {
      return NextResponse.json({
        ok:        false,
        error:     `Provider "${id}" is disabled. Enable it before testing.`,
        health:    'unknown',
        latencyMs: null,
      }, { status: 400 })
    }

    // ── Connectivity probe via CPL boundary ───────────────────────────────────
    // probeProvider() wraps callWithMode + resetRuntime inside CPL, preserving
    // RULE-ROUTE-BOUNDARY (routes must not import @brandos/ai-runtime-layer).
    const mode = (provider.kind === 'local' ? 'local' : 'cloud') as 'local' | 'cloud'
    const probe = await probeProvider(id, mode)

    // ── Write result back to Supabase ─────────────────────────────────────────
    const updatedProviders = providers.map((p: any) =>
      p.id === id ? { ...p, health: probe.health, lastResponseMs: probe.latencyMs } : p,
    )
    await SupabaseAdminSettingsService.save('aiRuntime', {
      ...(snapshot?.aiRuntime ?? {}),
      providers: updatedProviders,
    })

    if (!probe.ok) {
      return NextResponse.json({
        ok:        false,
        error:     probe.error,
        health:    probe.health,
        latencyMs: probe.latencyMs,
      })
    }

    console.info(`[ProviderTest] provider=${id} health=healthy latencyMs=${probe.latencyMs} user=${auth.userId}`)

    return NextResponse.json({
      ok:       true,
      provider: id,
      health:   'healthy',
      latencyMs: probe.latencyMs,
    })
  } catch (err) {
    console.error(`[ProviderTest] provider=${id} error`, err)
    return NextResponse.json({
      ok:        false,
      error:     (err as Error).message,
      health:    'unknown',
      latencyMs: null,
    }, { status: 500 })
  }
}
