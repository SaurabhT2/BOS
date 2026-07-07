/**
 * apps/web/app/api/admin/runtime-debug/route.ts
 *
 * GET /api/admin/runtime-debug
 *
 * Settings propagation observability endpoint.
 * Admin-only. No business logic here — delegates to RuntimeDiagnosticsService.
 *
 * Query params:
 *   ?test=true    (default) — runs a live probe invocation
 *   ?test=false   — read-only snapshot, no provider calls
 *   ?force=<id>   — force a specific provider for the test (non-production only)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin }              from '@/lib/admin/require-admin'
import { RuntimeDiagnosticsService } from '@/lib/runtime-diagnostics'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  const runTest       = req.nextUrl.searchParams.get('test') !== 'false'
  const forceProvider = req.nextUrl.searchParams.get('force') ?? undefined

  try {
    const snapshot = await RuntimeDiagnosticsService.getSnapshot({
      runLiveTest:    runTest,
      forceProvider,
      requestId:      `debug-${Date.now()}`,
    })
    return NextResponse.json(snapshot)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    )
  }
}


