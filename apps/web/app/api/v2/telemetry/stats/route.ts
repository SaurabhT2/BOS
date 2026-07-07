/**
 * app/api/v2/telemetry/stats/route.ts
 *
 * Live telemetry aggregation — replaces hardcoded stat cards in Control Plane.
 * Queries from ai-runtime-layer telemetry engine + Supabase telemetry_events.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'

import {
  getLiveRuntimeStats,
  getLiveRuntimeHistory,
} from '@/lib/ai-runtime'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  try {

    const stats = getLiveRuntimeStats()
const history = getLiveRuntimeHistory()

    // Compute today's metrics from history
    const oneDayAgo = Date.now() - 86_400_000
    const todayEvents = history.filter(e => e.timestamp >= oneDayAgo)
    const yesterdayEvents = history.filter(e => e.timestamp >= oneDayAgo * 2 && e.timestamp < oneDayAgo)

    const requestsToday = todayEvents.length
    const requestsYesterday = yesterdayEvents.length
    const delta = requestsYesterday > 0
      ? `${requestsToday > requestsYesterday ? '↑' : '↓'} ${Math.abs(Math.round((requestsToday - requestsYesterday) / requestsYesterday * 100))}% vs yesterday`
      : ''

    const fallbacks = todayEvents.filter(e => e.fallback_count > 0).length
    const localCount = todayEvents.filter(e => e.mode_selected === 'local').length
    const cloudCount = todayEvents.filter(e => e.mode_selected === 'cloud').length

    const byProvider: Record<string, { count: number; avgLatencyMs: number; successRate: number }> = {}
    for (const e of todayEvents) {
      if (!byProvider[e.provider_used]) {
        byProvider[e.provider_used] = { count: 0, avgLatencyMs: 0, successRate: 0 }
      }
      const p = byProvider[e.provider_used]!
      p.count++
      p.avgLatencyMs = Math.round((p.avgLatencyMs * (p.count - 1) + e.latency_ms) / p.count)
      p.successRate = Math.round(
        ((p.successRate * (p.count - 1)) + (e.success ? 100 : 0)) / p.count * 10
      ) / 10
    }

    return NextResponse.json({
      ok: true,
      data: {
        requestsToday,
        requestsDelta: delta,
        successRate:   stats.success_rate * 100,
        avgLatencyMs:  stats.avg_latency_ms,
        fallbackRate:  requestsToday > 0 ? Math.round(fallbacks / requestsToday * 1000) / 10 : 0,
        fallbackCount: fallbacks,
        localVsCloud:  { local: localCount, cloud: cloudCount },
        byProvider,
      },
    })
  } catch (err) {
    // Graceful degradation: runtime may not be initialized in all envs
    console.warn('[TelemetryStats] runtime unavailable:', err)
    return NextResponse.json({
      ok: true,
      data: {
        requestsToday: 0, requestsDelta: '',
        successRate: 0, avgLatencyMs: 0,
        fallbackRate: 0, fallbackCount: 0,
        localVsCloud: { local: 0, cloud: 0 },
        byProvider: {},
      },
    })
  }
}


