'use client'

/**
 * /workspace/analytics — P2.18 + P2.15
 *
 * User-facing analytics surface built entirely from existing data:
 *   - /api/control-plane/score-history  (brandos_score_history table — workspace-scoped)
 *   - /api/campaigns                    (request counts by format)
 *   - /api/workspace/usage              (quota meters)
 *
 * P2.15 — Quality trajectory per format: shows average score trend for
 *   carousel / post / deck / report over time, with plain-language verdict
 *   ("Your carousels are improving").
 *
 * P2.18 — Analytics surface: request count, score distribution,
 *   format breakdown, low-quality count.
 *
 * No new backend routes — reuses existing workspace-scoped score history API.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  BarChart2, ArrowLeft, Loader2, TrendingUp, TrendingDown,
  Minus, RefreshCw, LayoutGrid, FileText, Presentation,
  BookOpen, Mail, Sparkles,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScoreEntry {
  id: string
  task_type: string
  artifact_type?: string
  score: number | string
  timestamp: string
  retries?: number
  approved?: boolean
}

interface AggEntry {
  period: string
  avg_score: number
  count: number
}

interface CampaignRow {
  id: string
  format: string
  qa_score_after: number | null
  created_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<string, string> = {
  carousel:      'Carousel',
  deck:          'Deck',
  report:        'Report',
  newsletter:    'Newsletter',
  linkedin_post: 'Post',
  article:       'Article',
  post:          'Post',
}

const FORMAT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  carousel:      LayoutGrid,
  deck:          Presentation,
  report:        BookOpen,
  newsletter:    Mail,
  linkedin_post: FileText,
  article:       FileText,
  post:          FileText,
}

function scoreColor(s: number) {
  if (s >= 75) return 'text-emerald-400'
  if (s >= 60) return 'text-amber-400'
  return 'text-red-400'
}

function scoreBg(s: number) {
  if (s >= 75) return 'bg-emerald-500'
  if (s >= 60) return 'bg-amber-500'
  return 'bg-red-500'
}

/**
 * Micro sparkline — pure SVG, no chart library.
 * Renders up to N points as a polyline scaled to the viewbox.
 */
function Sparkline({ data, color = '#22d3ee' }: { data: number[]; color?: string }) {
  if (data.length < 2) return null
  const h = 32; const w = 80
  const min = Math.max(0, Math.min(...data) - 5)
  const max = Math.min(100, Math.max(...data) + 5)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-20 h-8 overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={(data.length - 1) / (data.length - 1) * w} cy={h - ((data[data.length - 1]! - min) / range) * h} r="2.5" fill={color} />
    </svg>
  )
}

// ─── Quality Trajectory Card (P2.15) ─────────────────────────────────────────

interface FormatStats {
  format: string
  scores: number[]
  avg: number
  trend: 'up' | 'down' | 'flat'
  trendDelta: number
  count: number
}

function QualityTrajectorySection({ formatStats }: { formatStats: FormatStats[] }) {
  if (formatStats.length === 0) return null
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-cyan-400" />
        <h2 className="text-sm font-semibold text-gray-200">Quality trajectory by format</h2>
        <span className="text-xs text-gray-500">— how your scores are moving over time</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {formatStats.map(fs => {
          const Icon = FORMAT_ICONS[fs.format] ?? FileText
          const trendColor = fs.trend === 'up' ? 'text-emerald-400' : fs.trend === 'down' ? 'text-red-400' : 'text-gray-500'
          const sparkColor = fs.trend === 'up' ? '#34d399' : fs.trend === 'down' ? '#f87171' : '#6b7280'
          const verdict = fs.trend === 'up'
            ? `Your ${FORMAT_LABELS[fs.format] ?? fs.format}s are improving`
            : fs.trend === 'down'
              ? `Your ${FORMAT_LABELS[fs.format] ?? fs.format}s have been declining`
              : `Your ${FORMAT_LABELS[fs.format] ?? fs.format}s are holding steady`
          return (
            <div key={fs.format} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-200">{FORMAT_LABELS[fs.format] ?? fs.format}</span>
                </div>
                <span className="text-xs text-gray-600">{fs.count} generated</span>
              </div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className={`text-2xl font-bold tabular-nums ${scoreColor(fs.avg)}`}>{fs.avg}</div>
                  <div className={`text-xs mt-0.5 flex items-center gap-0.5 ${trendColor}`}>
                    {fs.trend === 'up' && <TrendingUp className="w-3 h-3" />}
                    {fs.trend === 'down' && <TrendingDown className="w-3 h-3" />}
                    {fs.trend === 'flat' && <Minus className="w-3 h-3" />}
                    {fs.trend !== 'flat' && `${fs.trendDelta > 0 ? '+' : ''}${fs.trendDelta} pts`}
                    {fs.trend === 'flat' && 'stable'}
                  </div>
                </div>
                <Sparkline data={fs.scores} color={sparkColor} />
              </div>
              <p className="text-xs text-gray-500 mt-2">{verdict}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─── Score Distribution Bar ───────────────────────────────────────────────────

function ScoreDistributionBar({ entries }: { entries: ScoreEntry[] }) {
  if (entries.length === 0) return null
  const scores = entries.map(e => Number(e.score)).filter(s => !isNaN(s))
  const low  = scores.filter(s => s <  60).length
  const mid  = scores.filter(s => s >= 60 && s < 75).length
  const high = scores.filter(s => s >= 75).length
  const total = scores.length
  if (total === 0) return null
  return (
    <div className="space-y-2">
      <div className="h-2 rounded-full overflow-hidden flex">
        <div className="bg-red-500 transition-all" style={{ width: `${(low/total)*100}%` }} title={`Low quality: ${low}`} />
        <div className="bg-amber-500 transition-all" style={{ width: `${(mid/total)*100}%` }} title={`Acceptable: ${mid}`} />
        <div className="bg-emerald-500 transition-all" style={{ width: `${(high/total)*100}%` }} title={`High quality: ${high}`} />
      </div>
      <div className="flex text-xs text-gray-500 gap-4">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Below threshold ({low})</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />Acceptable ({mid})</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />High quality ({high})</span>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const router = useRouter()
  const [entries, setEntries]     = React.useState<ScoreEntry[]>([])
  const [campaigns, setCampaigns] = React.useState<CampaignRow[]>([])
  const [loading, setLoading]     = React.useState(true)
  const [error, setError]         = React.useState<string | null>(null)
  const [range, setRange]         = React.useState<'30d' | '90d' | 'all'>('30d')

  const load = React.useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const from = range !== 'all'
        ? new Date(Date.now() - (range === '30d' ? 30 : 90) * 86_400_000).toISOString()
        : undefined
      const params = new URLSearchParams({ limit: '500' })
      if (from) params.set('from', from)

      const [scoreRes, campRes] = await Promise.allSettled([
        fetch(`/api/control-plane/score-history?${params}`),
        fetch('/api/campaigns?limit=200'),
      ])

      if (scoreRes.status === 'fulfilled' && scoreRes.value.ok) {
        const d = await scoreRes.value.json()
        setEntries(Array.isArray(d.data) ? d.data : [])
      }
      if (campRes.status === 'fulfilled' && campRes.value.ok) {
        const d = await campRes.value.json()
        setCampaigns(d.campaigns ?? [])
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [range])

  React.useEffect(() => { void load() }, [load])

  // ── Derived stats ──────────────────────────────────────────────────────────

  const validScores = entries.map(e => Number(e.score)).filter(s => !isNaN(s))
  const avgScore = validScores.length > 0
    ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length)
    : null
  const totalRequests = entries.length

  // Format breakdown from campaigns table (has format column)
  const formatCounts = campaigns.reduce<Record<string, number>>((acc, c) => {
    const fmt = c.format ?? 'unknown'
    acc[fmt] = (acc[fmt] ?? 0) + 1
    return acc
  }, {})
  const topFormat = Object.entries(formatCounts).sort((a, b) => b[1] - a[1])[0]

  // P2.15 — Quality trajectory: group score entries by artifact_type / task_type,
  // compute rolling avg, detect trend from first-half vs second-half avg
  const formatStats: FormatStats[] = React.useMemo(() => {
    const byFormat = new Map<string, number[]>()
    for (const e of [...entries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())) {
      const fmt = e.artifact_type ?? e.task_type ?? 'unknown'
      if (!byFormat.has(fmt)) byFormat.set(fmt, [])
      const s = Number(e.score)
      if (!isNaN(s)) byFormat.get(fmt)!.push(s)
    }
    return [...byFormat.entries()]
      .filter(([, scores]) => scores.length >= 2)
      .map(([format, scores]) => {
        const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        // Compare last third vs first third for trend
        const chunk = Math.max(1, Math.floor(scores.length / 3))
        const firstAvg = scores.slice(0, chunk).reduce((a, b) => a + b, 0) / chunk
        const lastAvg  = scores.slice(-chunk).reduce((a, b) => a + b, 0) / chunk
        const delta = Math.round(lastAvg - firstAvg)
        const trend: 'up' | 'down' | 'flat' = delta > 3 ? 'up' : delta < -3 ? 'down' : 'flat'
        return { format, scores, avg, trend, trendDelta: delta, count: scores.length }
      })
      .sort((a, b) => b.count - a.count)
  }, [entries])

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <button onClick={() => router.back()} className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors">
            <ArrowLeft className="w-4 h-4 text-gray-400" />
          </button>
          <BarChart2 className="w-5 h-5 text-cyan-400" />
          <div className="flex-1">
            <h1 className="text-lg font-semibold">Analytics</h1>
            <p className="text-xs text-gray-400">Your generation history and quality trends</p>
          </div>
          <div className="flex gap-1">
            {(['30d', '90d', 'all'] as const).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${range === r ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-600/30' : 'text-gray-500 hover:text-gray-300 border border-transparent'}`}
              >
                {r === 'all' ? 'All time' : `Last ${r}`}
              </button>
            ))}
          </div>
          <button onClick={load} className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors" title="Refresh">
            <RefreshCw className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-10">
        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-sm text-red-400">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 gap-3 text-gray-600">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span>Loading analytics…</span>
          </div>
        ) : (
          <>
            {/* ── Summary stats ─────────────────────────────────────────── */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Generations', value: totalRequests, color: 'text-cyan-400' },
                { label: 'Avg quality score', value: avgScore !== null ? avgScore : '—', color: avgScore !== null ? scoreColor(avgScore) : 'text-gray-500' },
                { label: 'Top format', value: topFormat ? (FORMAT_LABELS[topFormat[0]] ?? topFormat[0]) : '—', color: 'text-blue-400' },
                { label: 'Formats used', value: Object.keys(formatCounts).length, color: 'text-purple-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                  <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                </div>
              ))}
            </section>

            {/* ── P2.15 Quality trajectory ──────────────────────────────── */}
            <QualityTrajectorySection formatStats={formatStats} />

            {/* ── Score distribution ────────────────────────────────────── */}
            {entries.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <h2 className="text-sm font-semibold text-gray-200">Score distribution</h2>
                  <span className="text-xs text-gray-500">— {entries.length} generations scored</span>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                  <ScoreDistributionBar entries={entries} />
                </div>
              </section>
            )}

            {/* ── Format breakdown ──────────────────────────────────────── */}
            {Object.keys(formatCounts).length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-gray-200">Format breakdown</h2>
                <div className="rounded-xl border border-gray-800 bg-gray-900 divide-y divide-gray-800">
                  {Object.entries(formatCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([fmt, count]) => {
                      const Icon = FORMAT_ICONS[fmt] ?? FileText
                      const pct = Math.round((count / campaigns.length) * 100)
                      return (
                        <div key={fmt} className="flex items-center gap-4 px-5 py-3">
                          <Icon className="w-4 h-4 text-gray-500 shrink-0" />
                          <span className="text-sm text-gray-300 w-28 shrink-0">{FORMAT_LABELS[fmt] ?? fmt}</span>
                          <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full bg-cyan-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 w-16 text-right tabular-nums">{count} · {pct}%</span>
                        </div>
                      )
                    })}
                </div>
              </section>
            )}

            {/* Empty state */}
            {entries.length === 0 && campaigns.length === 0 && (
              <div className="text-center py-20 text-gray-600">
                <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No generation data yet — start creating to see trends here.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
