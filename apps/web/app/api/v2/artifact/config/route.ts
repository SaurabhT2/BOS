/**
 * app/api/v2/artifact/config/route.ts
 *
 * SINGLE API for all artifact engine configuration.
 * Replaces /api/admin/settings?section=artifactEngine
 * Now uses typed ArtifactEngineConfig schema (no `any`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import {
  ArtifactEngineConfigSchema,
  DEFAULT_ARTIFACT_CONFIG,
} from '@brandos/control-plane-layer'
import { SupabaseAdminSettingsService } from '@brandos/control-plane-layer'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  const snapshot = await SupabaseAdminSettingsService.load()
  const raw = (snapshot as any)?.artifactEngine ?? DEFAULT_ARTIFACT_CONFIG

  const result = ArtifactEngineConfigSchema.safeParse(raw)
  const config = result.success ? result.data : DEFAULT_ARTIFACT_CONFIG

  return NextResponse.json({ ok: true, data: config })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  try {
    const body = await req.json()
    const patchResult = ArtifactEngineConfigSchema.partial().safeParse(body.data ?? body)
    if (!patchResult.success) {
      return NextResponse.json({
        ok: false,
        error: 'Validation failed',
        details: patchResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`),
      }, { status: 400 })
    }

    const snapshot = await SupabaseAdminSettingsService.load()
    const current = ArtifactEngineConfigSchema.safeParse((snapshot as any)?.artifactEngine)
    const existing = current.success ? current.data : DEFAULT_ARTIFACT_CONFIG

    const merged = ArtifactEngineConfigSchema.parse({
      ...existing,
      ...patchResult.data,
      exports: { ...existing.exports, ...(patchResult.data.exports ?? {}) },
      renderSettings: { ...existing.renderSettings, ...(patchResult.data.renderSettings ?? {}) },
    })

    const saved = await SupabaseAdminSettingsService.save('artifactEngine', merged)
    if (!saved) {
      return NextResponse.json({ ok: false, error: 'Failed to persist settings' }, { status: 500 })
    }

    console.info(`[ArtifactConfig] saved by user=${auth.userId}`)
    return NextResponse.json({ ok: true, data: merged })
  } catch (err) {
    console.error('[ArtifactConfig] save error', err)
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}


