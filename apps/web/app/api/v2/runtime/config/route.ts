/**
 * app/api/v2/runtime/config/route.ts
 *
 * SINGLE API for all runtime configuration.
 * Replaces /api/admin/settings?section=aiRuntime
 * Replaces /api/admin/settings?section=controlPlane (runtime-relevant fields)
 *
 * Enforces:
 *   - Zod schema validation on write
 *   - Deep provider merge by ID (no wholesale array replacement)
 *   - Settings → runtime bridge on save
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import {
  RuntimeConfigSchema,
  DEFAULT_RUNTIME_CONFIG,
  mergeRuntimeConfig,
} from '@brandos/control-plane-layer'
import { SupabaseAdminSettingsService } from '@brandos/control-plane-layer'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  const snapshot = await SupabaseAdminSettingsService.load()
  const raw = (snapshot as any)?.aiRuntime ?? DEFAULT_RUNTIME_CONFIG

  const result = RuntimeConfigSchema.safeParse(raw)
  const config = result.success ? result.data : DEFAULT_RUNTIME_CONFIG

  return NextResponse.json({ ok: true, data: config })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  try {
    const body = await req.json()

    // Validate incoming patch
    const patchResult = RuntimeConfigSchema.partial().safeParse(body.data ?? body)
    if (!patchResult.success) {
      return NextResponse.json({
        ok: false,
        error: 'Validation failed',
        details: patchResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`),
      }, { status: 400 })
    }

    // Load current, deep-merge
    const snapshot = await SupabaseAdminSettingsService.load()
    const current = RuntimeConfigSchema.safeParse((snapshot as any)?.aiRuntime)
    const existing = current.success ? current.data : DEFAULT_RUNTIME_CONFIG
    const merged = mergeRuntimeConfig(existing, patchResult.data)

    // Persist
    const saved = await SupabaseAdminSettingsService.save('aiRuntime', merged)
    if (!saved) {
      return NextResponse.json({ ok: false, error: 'Failed to persist settings' }, { status: 500 })
    }

    console.info(`[RuntimeConfig] saved by user=${auth.userId}`)
    return NextResponse.json({ ok: true, data: merged })
  } catch (err) {
    console.error('[RuntimeConfig] save error', err)
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}


