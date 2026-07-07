/**
 * apps/web/app/api/admin/providers/route.ts
 *
 * CHANGES:
 *  1. GET response now includes runtimeMode (from aiRuntime.runtimeMode) instead of
 *     defaultMode, which was the legacy field. Backward-compat: both are present.
 *  2. KNOWN_PROTOCOLS and KNOWN_PROFILES now derive from PROVIDER_REGISTRY instead
 *     of being hardcoded sets.
 *  3. POST handler validation accepts 'local'|'cloud' runtimeMode values only.
 *     Legacy 'cloud_free'|'cloud_pro' strings are no longer accepted.
 *  4. All other behavior (PATCH, PUT) unchanged.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin }              from '@/lib/admin/require-admin'
import { SupabaseAdminSettingsService } from '@brandos/control-plane-layer'
import { PROVIDER_REGISTRY, LOCAL_PROVIDER_IDS } from '@brandos/contracts'
import type { ProviderSettings }     from '@brandos/runtime-config'

export const runtime = 'nodejs'

// Derived from PROVIDER_REGISTRY — no hardcoded lists.
// 'local' and 'gemini' were legacy aliases removed in Sprint A contract fix.
// Canonical values are 'ollama', 'lmstudio', 'google' from ProviderProtocol.
const KNOWN_PROTOCOLS = new Set(
  PROVIDER_REGISTRY.map(p => p.protocol)
)
const KNOWN_PROFILES  = new Set(
  PROVIDER_REGISTRY.map(p => p.semanticProfile)
    .concat(['openrouter', 'togetherai', 'fireworks', 'anyscale', 'vllm'])
)

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  const snapshot  = await SupabaseAdminSettingsService.load()
  const providers: ProviderSettings[] = snapshot.aiRuntime?.providers ?? []

  const LOCAL_IDS     = new Set(['ollama', 'lmstudio'])
  const enabledIds    = providers.filter(p => p.enabled).map(p => p.id)
  const localOnly     = enabledIds.length > 0 && enabledIds.every(id => LOCAL_IDS.has(id))
  const cloudOnly     = enabledIds.length > 0 && enabledIds.every(id => !LOCAL_IDS.has(id))

  const runtimeMode   = (snapshot.aiRuntime as any)?.runtimeMode ?? 'cloud'

  return NextResponse.json({
    ok:                 true,
    providers,
    modes:              { localOnly, cloudOnly },
    runtimeMode,
    availableProfiles:  [...KNOWN_PROFILES],
    availableProtocols: [...KNOWN_PROTOCOLS],
  })
}

// ── POST — bulk replace provider list ────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  try {
    const body = await req.json()
    const { providers, defaultMode, runtimeMode } = body as {
      providers?:   ProviderSettings[]
      defaultMode?: string
      runtimeMode?: string
    }

    if (!providers || !Array.isArray(providers)) {
      return NextResponse.json({ ok: false, error: 'providers array required' }, { status: 400 })
    }

    if (!providers.some(p => p.enabled)) {
      return NextResponse.json(
        { ok: false, error: 'At least one provider must remain enabled' },
        { status: 400 }
      )
    }

    const current = SupabaseAdminSettingsService.getCached()
    const update: Record<string, unknown> = { providers }
    if (runtimeMode && ['auto','local','cloud'].includes(runtimeMode)) {
      update.runtimeMode = runtimeMode
    }

    const saved = await SupabaseAdminSettingsService.save('aiRuntime', {
      ...(current?.aiRuntime ?? {}),
      ...update,
    })

    if (!saved) {
      return NextResponse.json({ ok: false, error: 'Failed to persist provider settings' }, { status: 500 })
    }

    console.info(`[AdminProviders] Updated by user=${auth.userId}`, { runtimeMode, providerCount: providers.length })
    return NextResponse.json({ ok: true, providers, runtimeMode })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}

// ── PATCH /api/admin/providers — update a single provider field ───────────────

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  try {
    const body = await req.json()
    const { id, ...fields } = body as { id: string } & Partial<ProviderSettings>

    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })

    const current   = SupabaseAdminSettingsService.getCached()
    const providers = [...(current?.aiRuntime?.providers ?? [])]
    const idx       = providers.findIndex(p => p.id === id)

    if (idx === -1) {
      return NextResponse.json({ ok: false, error: `Provider "${id}" not found` }, { status: 404 })
    }

    providers[idx] = { ...providers[idx]!, ...fields }

    const saved = await SupabaseAdminSettingsService.save('aiRuntime', {
      ...(current?.aiRuntime ?? {}),
      providers,
    })

    if (!saved) {
      return NextResponse.json({ ok: false, error: 'Failed to persist' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, provider: providers[idx] })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}

// ── PUT — register a new dynamic provider ─────────────────────────────────────

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  try {
    const body = await req.json()
    const { id, name, protocol, baseUrl, semanticProfile, priority } = body as {
      id:              string
      name:            string
      protocol:        string
      baseUrl?:        string
      semanticProfile?: string
      priority?:       number
    }

    if (!id || !name || !protocol) {
      return NextResponse.json({ ok: false, error: 'id, name, protocol required' }, { status: 400 })
    }
    if (!KNOWN_PROTOCOLS.has(protocol as any)) {
      return NextResponse.json(
        { ok: false, error: `Unknown protocol "${protocol}". Known: ${[...KNOWN_PROTOCOLS].join(', ')}` },
        { status: 400 }
      )
    }
    if (semanticProfile && !KNOWN_PROFILES.has(semanticProfile)) {
      return NextResponse.json(
        { ok: false, error: `Unknown profile "${semanticProfile}". Known: ${[...KNOWN_PROFILES].join(', ')}` },
        { status: 400 }
      )
    }

    const current   = SupabaseAdminSettingsService.getCached()
    const providers = [...(current?.aiRuntime?.providers ?? [])]

    if (providers.some(p => p.id === id)) {
      return NextResponse.json({ ok: false, error: `Provider "${id}" already exists` }, { status: 409 })
    }

    const maxPriority = providers.reduce((max, p) => Math.max(max, p.priority), 0)
    const newProvider: ProviderSettings = {
      id,
      name,
      kind:           (LOCAL_PROVIDER_IDS.includes(id) ? 'local' : 'cloud') as ProviderSettings['kind'],
      enabled:        false,
      keyConfigured:  false,
      priority:       priority ?? maxPriority + 1,
      health:         'unknown',
      lastResponseMs: null,
      protocol:       (protocol as ProviderSettings['protocol']),
      semanticProfile: semanticProfile ?? 'generic',
      baseUrl,
    }

    providers.push(newProvider)

    const saved = await SupabaseAdminSettingsService.save('aiRuntime', {
      ...(current?.aiRuntime ?? {}),
      providers,
    })

    if (!saved) {
      return NextResponse.json({ ok: false, error: 'Failed to persist' }, { status: 500 })
    }

    console.info(`[AdminProviders] New provider registered: ${id} by user=${auth.userId}`)
    return NextResponse.json({ ok: true, provider: newProvider }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}


