/**
 * app/api/v2/telemetry/experiments/route.ts
 *
 * Experiment management — moved from control-plane experiments service.
 * Owner: telemetry domain (experiments are an observability concern, not a runtime concern)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import { SupabaseAdminSettingsService } from '@brandos/control-plane-layer'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  const snapshot = await SupabaseAdminSettingsService.load()
  const experiments = (snapshot as any)?.experiments ?? []
  return NextResponse.json({ ok: true, data: experiments })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  try {
    const body = await req.json()
    const snapshot = await SupabaseAdminSettingsService.load()
    const current: any[] = (snapshot as any)?.experiments ?? []

    const newExp = {
      id: `exp_${Date.now()}`,
      ...body,
      status: 'running',
      winner: null,
      createdAt: new Date().toISOString(),
      createdBy: auth.userId,
    }

    await SupabaseAdminSettingsService.save('experiments', [...current, newExp])
    return NextResponse.json({ ok: true, data: newExp })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}


