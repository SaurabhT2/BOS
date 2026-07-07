'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ScoreAggregation, ScoreHistoryEntry } from '@brandos/control-plane-layer'

const COLORS = {
  blue: '#3b82f6',
  purple: '#7c3aed',
  green: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  gray: '#64748b',
}

function MiniChart({ data, color }: { data: number[]; color: string }) {
  if (data.length === 0) return <div style={{ height: 40 }} />
  const max = Math.max(...data) || 1
  const min = Math.min(...data)
  const h = 40
  const w = data.length > 1 ? 100 / (data.length - 1) : 0

  const points = data.map((v, i) => {
    const x = i * w
    const y = h - ((v - min) / (max - min || 1)) * h
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <svg viewBox={`0 0 100 ${h}`} style={{ width: '100%', height: h }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

function BarChart({ buckets }: { buckets: { label: string; value: number }[] }) {
  const max = Math.max(...buckets.map(b => b.value), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 100 }}>
      {buckets.map(b => (
        <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ width: '100%', background: '#7c3aed', borderRadius: '2px 2px 0 0', height: `${(b.value / max) * 80}px`, transition: 'height 0.3s' }} />
          <div style={{ color: '#64748b', fontSize: 10, writingMode: 'vertical-lr', transform: 'rotate(180deg)', maxHeight: 50, overflow: 'hidden' }}>{b.label}</div>
        </div>
      ))}
    </div>
  )
}

function StatCard({ label, value, unit, trend, color }: { label: string; value: string; unit?: string; trend?: number; color?: string }) {
  return (
    <div style={{ background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 12, padding: 20 }}>
      <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: color ?? '#f1f5f9' }}>{value}</span>
        {unit && <span style={{ color: '#64748b', fontSize: 13 }}>{unit}</span>}
      </div>
      {trend !== undefined && (
        <div style={{ fontSize: 12, color: trend >= 0 ? '#10b981' : '#ef4444', marginTop: 4 }}>
          {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)} vs prev
        </div>
      )}
    </div>
  )
}

export default function AnalyticsPage() {
  const [aggregations, setAggregations] = useState<ScoreAggregation[]>([])
  const [recent, setRecent] = useState<ScoreHistoryEntry[]>([])
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day')
  const [taskFilter, setTaskFilter] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const [loading, setLoading] = useState(true)

  // P0: workspaceId resolved server-side from session (requireUser) — not needed client-side

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({
      // workspace_id scoped server-side — not sent
      granularity,
      aggregate: 'true',
      ...(taskFilter && { task_type: taskFilter }),
      ...(modelFilter && { model_id: modelFilter }),
    })
    const [aggRes, recentRes] = await Promise.all([
      fetch(`/api/control-plane/score-history?${params}`),
      fetch('/api/control-plane/score-history?limit=20'),
    ])
    const aggData = await aggRes.json() as ScoreAggregation[]
    const recentData = await recentRes.json() as ScoreHistoryEntry[]
    setAggregations(aggData)
    setRecent(recentData)
    setLoading(false)
  }, [granularity, taskFilter, modelFilter])

  useEffect(() => { void load() }, [load])

  const latest = aggregations[aggregations.length - 1]
  const prev = aggregations[aggregations.length - 2]
  const avgScores = aggregations.map(a => a.avg_score)
  const requestCounts = aggregations.map(a => a.total_requests)

  // Get unique task types and models from recent data
  const taskTypes = [...new Set(recent.map(r => r.task_type))]
  const models = [...new Set(recent.map(r => r.model_id))]

  const taskBuckets = taskTypes.map(t => ({
    label: t,
    value: recent.filter(r => r.task_type === t).reduce((s, r) => s + r.score, 0) / (recent.filter(r => r.task_type === t).length || 1),
  }))

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f1a', color: '#e2e8f0', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(135deg,#2563eb,#10b981)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📊</div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Score Analytics</h1>
          </div>
          <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>Quality trends, retry rates, latency, and model performance over time.</p>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          {(['day', 'week', 'month'] as const).map(g => (
            <button key={g} onClick={() => setGranularity(g)}
              style={{ padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: granularity === g ? '#7c3aed' : '#1e1e3a', color: granularity === g ? '#fff' : '#94a3b8' }}>
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
          <select value={taskFilter} onChange={e => setTaskFilter(e.target.value)}
            style={{ background: '#1e1e3a', border: '1px solid #2a2a4a', borderRadius: 20, padding: '6px 16px', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>
            <option value="">All Tasks</option>
            {taskTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={modelFilter} onChange={e => setModelFilter(e.target.value)}
            style={{ background: '#1e1e3a', border: '1px solid #2a2a4a', borderRadius: 20, padding: '6px 16px', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>
            <option value="">All Models</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={load} style={{ background: '#1e1e3a', border: '1px solid #374151', borderRadius: 20, padding: '6px 16px', color: '#94a3b8', cursor: 'pointer', fontSize: 13 }}>
            ↻ Refresh
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: '#7c3aed', padding: 80 }}>Loading analytics...</div>
        ) : (
          <>
            {/* KPI row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
              <StatCard
  label="Avg Score"
  value={latest ? latest.avg_score.toFixed(1) : '--'}
  unit="/100"
  color={
    latest && latest.avg_score >= 85
      ? COLORS.green
      : latest && latest.avg_score >= 70
        ? COLORS.blue
        : COLORS.red
  }
  {...(
    latest && prev
      ? { trend: latest.avg_score - prev.avg_score }
      : {}
  )}
/>
             <StatCard
  label="Total Requests"
  value={aggregations.reduce((s, a) => s + a.total_requests, 0).toString()}
  {...(
    latest && prev
      ? { trend: latest.total_requests - prev.total_requests }
      : {}
  )}
/>
              <StatCard label="Avg Retries" value={latest ? latest.avg_retries.toFixed(2) : '--'}
                color={latest && latest.avg_retries < 1 ? COLORS.green : COLORS.amber} />
              <StatCard label="Avg Latency" value={latest ? (latest.avg_latency_ms / 1000).toFixed(1) : '--'} unit="s"
                color={latest && latest.avg_latency_ms < 3000 ? COLORS.green : COLORS.amber} />
            </div>

            {/* Score trend chart */}
            <div style={{ background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 12, padding: 24, marginBottom: 20 }}>
              <h3 style={{ color: '#a78bfa', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>Quality Score Trend</h3>
              {aggregations.length > 0 ? (
                <div style={{ height: 120 }}>
                  <svg viewBox={`0 0 100 60`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="none">
                    {/* Threshold line */}
                    <line x1="0" y1="30" x2="100" y2="30" stroke="#2a2a4a" strokeWidth="0.5" strokeDasharray="2,2" />
                    {/* Score area */}
                    {avgScores.length > 1 && (
                      <>
                        <polyline
                          points={avgScores.map((v, i) => `${(i / (avgScores.length - 1)) * 100},${60 - (v / 100) * 60}`).join(' ')}
                          fill="none" stroke="#7c3aed" strokeWidth="1.5"
                        />
                        <polygon
                          points={[
                            ...avgScores.map((v, i) => `${(i / (avgScores.length - 1)) * 100},${60 - (v / 100) * 60}`),
                            `100,60`, `0,60`,
                          ].join(' ')}
                          fill="url(#gradient)" opacity={0.2}
                        />
                        <defs>
                          <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#7c3aed" />
                            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                      </>
                    )}
                  </svg>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    {aggregations.slice(-5).map(a => (
                      <span key={a.period} style={{ color: '#475569', fontSize: 10 }}>{a.period.slice(-5)}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ color: '#475569', textAlign: 'center', padding: 40 }}>No data yet. Generate some content to see trends.</div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
              {/* By task type */}
              <div style={{ background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 12, padding: 24 }}>
                <h3 style={{ color: '#a78bfa', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>Avg Score by Task Type</h3>
                {taskBuckets.length > 0 ? <BarChart buckets={taskBuckets} /> : <div style={{ color: '#475569', textAlign: 'center', padding: 20 }}>No data</div>}
              </div>

              {/* Request volume */}
              <div style={{ background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 12, padding: 24 }}>
                <h3 style={{ color: '#a78bfa', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>Request Volume Trend</h3>
                <MiniChart data={requestCounts} color={COLORS.blue} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                  {aggregations.slice(-5).map(a => (
                    <span key={a.period} style={{ color: '#475569', fontSize: 10 }}>{a.total_requests}req</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Recent generations table */}
            <div style={{ background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 12, padding: 24 }}>
              <h3 style={{ color: '#a78bfa', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>Recent Generations</h3>
              {recent.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
                      {['Time', 'Task', 'Model', 'Score', 'Retries', 'Latency', 'Cost'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #1e293b' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map(r => (
                      <tr key={r.id} style={{ borderBottom: '1px solid #1a2744' }}>
                        <td style={{ padding: '8px 12px', color: '#64748b' }}>{new Date(r.timestamp).toLocaleTimeString()}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{r.task_type}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.model_id}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ color: r.score >= 85 ? COLORS.green : r.score >= 70 ? COLORS.blue : COLORS.red, fontWeight: 700 }}>{r.score}</span>
                        </td>
                        <td style={{ padding: '8px 12px', color: r.retries > 0 ? COLORS.amber : '#64748b' }}>{r.retries}</td>
                        <td style={{ padding: '8px 12px', color: '#64748b' }}>{(r.latency_ms / 1000).toFixed(1)}s</td>
                        <td style={{ padding: '8px 12px', color: '#64748b' }}>${(r.cost_usd ?? 0).toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ color: '#475569', textAlign: 'center', padding: 40 }}>No recent generations. Run the workspace to populate data.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}


