'use client'
/**
 * /admin/telemetry — Platform Telemetry & Experiments
 *
 * NEW PAGE — absorbs from former Control Plane:
 *   - Telemetry Summary section (was hardcoded; now live from API)
 *   - Experiments table
 *
 * Adds:
 *   - Live provider health breakdown
 *   - Fallback event log
 *   - Experiment management (create, pause, declare winner)
 *
 * API: GET /api/v2/telemetry/stats, /api/v2/telemetry/experiments
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { AdminShell } from '@brandos/presentation-layer'
import {
  AdminCard, SectionTitle, StatCard, StatusBadge, tokens,
} from '@brandos/ui-admin'
import { Activity, FlaskConical, RefreshCw, Zap } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TelemetryStats {
  requestsToday:   number
  requestsDelta:   string
  successRate:     number
  avgLatencyMs:    number
  fallbackRate:    number
  fallbackCount:   number
  localVsCloud:    { local: number; cloud: number }
  byProvider:      Record<string, { count: number; avgLatencyMs: number; successRate: number }>
}

interface ExperimentConfig {
  id:       string
  name:     string
  variantA: string
  variantB: string
  winner:   'A' | 'B' | null
  status:   'running' | 'paused' | 'complete'
  split:    [number, number]
}

// ─── Fallback default data (shown while loading) ──────────────────────────────

const EMPTY_STATS: TelemetryStats = {
  requestsToday: 0, requestsDelta: '',
  successRate: 0, avgLatencyMs: 0,
  fallbackRate: 0, fallbackCount: 0,
  localVsCloud: { local: 0, cloud: 0 },
  byProvider: {},
}

// ─── Experiments Table ────────────────────────────────────────────────────────

function ExperimentsTable({
  experiments, onDeclareWinner, onToggle,
}: {
  experiments: ExperimentConfig[]
  onDeclareWinner: (id: string, winner: 'A' | 'B') => void
  onToggle: (id: string) => void
}) {
  if (experiments.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0', color: tokens.textDim, fontSize: 13 }}>
        No experiments configured
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${tokens.border}` }}>
            {['Experiment', 'Variant A', 'Variant B', 'Split', 'Winner', 'Status', 'Actions'].map(h => (
              <th key={h} style={{
                padding: '8px 12px', color: tokens.textDim, fontWeight: 600,
                textAlign: 'left', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {experiments.map(exp => (
            <tr key={exp.id} style={{ borderBottom: `1px solid ${tokens.borderSubtle}` }}>
              <td style={{ padding: '10px 12px', color: tokens.text, fontWeight: 500 }}>{exp.name}</td>
              <td style={{ padding: '10px 12px', color: tokens.textMuted }}>{exp.variantA}</td>
              <td style={{ padding: '10px 12px', color: tokens.textMuted }}>{exp.variantB}</td>
              <td style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', width: 80, gap: 1, marginBottom: 4 }}>
                  <div style={{ background: tokens.info, width: `${exp.split[0]}%` }} />
                  <div style={{ background: tokens.purple, width: `${exp.split[1]}%` }} />
                </div>
                <span style={{ fontSize: 10, color: tokens.textDim }}>
                  {exp.split[0]}% / {exp.split[1]}%
                </span>
              </td>
              <td style={{ padding: '10px 12px' }}>
                {exp.winner
                  ? <span style={{ color: tokens.success, fontWeight: 700 }}>Variant {exp.winner}</span>
                  : <span style={{ color: tokens.textDim }}>—</span>
                }
              </td>
              <td style={{ padding: '10px 12px' }}>
                <StatusBadge status={exp.status} />
              </td>
              <td style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {exp.status === 'running' && !exp.winner && (
                    <>
                      <button
                        onClick={() => onDeclareWinner(exp.id, 'A')}
                        style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                          border: `1px solid ${tokens.info}40`, background: 'transparent',
                          color: tokens.info, cursor: 'pointer',
                        }}
                      >
                        A Wins
                      </button>
                      <button
                        onClick={() => onDeclareWinner(exp.id, 'B')}
                        style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                          border: `1px solid ${tokens.purple}40`, background: 'transparent',
                          color: tokens.purple, cursor: 'pointer',
                        }}
                      >
                        B Wins
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => onToggle(exp.id)}
                    style={{
                      padding: '2px 6px', borderRadius: 4, fontSize: 10,
                      border: `1px solid ${tokens.border}`, background: 'transparent',
                      color: tokens.textDim, cursor: 'pointer',
                    }}
                  >
                    {exp.status === 'running' ? 'Pause' : 'Resume'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Provider Breakdown ───────────────────────────────────────────────────────

function ProviderBreakdown({ byProvider }: { byProvider: TelemetryStats['byProvider'] }) {
  const entries = Object.entries(byProvider).sort((a, b) => b[1].count - a[1].count)
  if (entries.length === 0) {
    return <div style={{ color: tokens.textDim, fontSize: 13, padding: '12px 0' }}>No data yet</div>
  }

  const maxCount = Math.max(...entries.map(([, d]) => d.count))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {entries.map(([provider, data]) => (
        <div key={provider}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: tokens.text, fontWeight: 600, textTransform: 'capitalize' }}>
              {provider}
            </span>
            <div style={{ display: 'flex', gap: 12 }}>
              <span style={{ fontSize: 11, color: tokens.textDim }}>{data.count} reqs</span>
              <span style={{ fontSize: 11, color: tokens.textMuted }}>{data.avgLatencyMs}ms avg</span>
              <span style={{
                fontSize: 11,
                color: data.successRate >= 99 ? tokens.success : data.successRate >= 95 ? tokens.warning : tokens.danger,
                fontWeight: 700,
              }}>
                {data.successRate.toFixed(1)}%
              </span>
            </div>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: tokens.border }}>
            <div style={{
              height: '100%', borderRadius: 2,
              width: `${maxCount > 0 ? (data.count / maxCount) * 100 : 0}%`,
              background: tokens.info,
              transition: 'width 0.3s',
            }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TelemetryPage() {
  const [stats, setStats] = useState<TelemetryStats>(EMPTY_STATS)
  const [experiments, setExperiments] = useState<ExperimentConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async () => {
    try {
      const [statsRes, expRes] = await Promise.all([
        fetch('/api/v2/telemetry/stats'),
        fetch('/api/v2/telemetry/experiments'),
      ])
      const statsData = await statsRes.json()
      const expData = await expRes.json()
      if (statsData?.data) setStats(statsData.data)
      if (Array.isArray(expData?.data)) setExperiments(expData.data)
      setLastRefresh(new Date())
    } catch (err) {
      console.error('[TelemetryPage] load error', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const interval = setInterval(load, 30_000) // refresh every 30s
    return () => clearInterval(interval)
  }, [load])

  const declareWinner = async (id: string, winner: 'A' | 'B') => {
    await fetch(`/api/v2/telemetry/experiments/${id}/winner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winner }),
    })
    void load()
  }

  const toggleExperiment = async (id: string) => {
    await fetch(`/api/v2/telemetry/experiments/${id}/toggle`, { method: 'POST' })
    void load()
  }

  const localPct = stats.localVsCloud.local + stats.localVsCloud.cloud > 0
    ? Math.round(stats.localVsCloud.local / (stats.localVsCloud.local + stats.localVsCloud.cloud) * 100)
    : 0

  return (
    <AdminShell
      title="Telemetry"
      subtitle="Live platform observability — requests, latency, fallbacks, experiments"
      titleColor={tokens.info}
      actions={
        <button
          onClick={() => void load()}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 12px', borderRadius: 8,
            border: `1px solid ${tokens.border}`,
            background: 'transparent', color: tokens.textMuted,
            cursor: 'pointer', fontSize: 12,
          }}
        >
          <RefreshCw style={{ width: 12, height: 12 }} />
          {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : 'Refresh'}
        </button>
      }
    >
      <div style={{ display: 'grid', gap: 20 }}>

        {/* ── Live Stats ───────────────────────────────────────────────────── */}
        <AdminCard>
          <SectionTitle icon={Activity} color={tokens.info}>Telemetry Summary</SectionTitle>
          {loading ? (
            <div style={{ color: tokens.textDim, fontSize: 13 }}>Loading live data…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
              <StatCard
                label="Requests Today"
                value={stats.requestsToday.toLocaleString()}
                sub={stats.requestsDelta || 'vs yesterday'}
                color={tokens.info}
              />
              <StatCard
                label="Success Rate"
                value={`${stats.successRate.toFixed(1)}%`}
                sub="last 24 h"
                color={tokens.success}
              />
              <StatCard
                label="Avg Latency"
                value={`${stats.avgLatencyMs}ms`}
                sub="p50 across providers"
                color={tokens.purple}
              />
              <StatCard
                label="Fallback %"
                value={`${stats.fallbackRate.toFixed(1)}%`}
                sub={`${stats.fallbackCount} fallbacks today`}
                color={tokens.warning}
              />
              <StatCard
                label="Local vs Cloud"
                value={`${localPct}/${100 - localPct}`}
                sub="% local / cloud"
                color={tokens.pink}
              />
            </div>
          )}
        </AdminCard>

        {/* ── Provider Breakdown ────────────────────────────────────────────── */}
        <AdminCard>
          <SectionTitle icon={Zap} color={tokens.purple}>Provider Breakdown</SectionTitle>
          <ProviderBreakdown byProvider={stats.byProvider} />
        </AdminCard>

        {/* ── Experiments ──────────────────────────────────────────────────── */}
        <AdminCard>
          <SectionTitle icon={FlaskConical} color={tokens.purple}>Experiments</SectionTitle>
          <ExperimentsTable
            experiments={experiments}
            onDeclareWinner={declareWinner}
            onToggle={toggleExperiment}
          />
        </AdminCard>

      </div>
    </AdminShell>
  )
}


