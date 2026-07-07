'use client'

/**
 * Home — pulse-first dashboard.
 *
 * Per brandos_redesign_strategic_completion.md §6:
 *  - Brand pulse is the hero, not a footnote — shown with trend, not just
 *    a snapshot, so the compounding-memory story is visible.
 *  - A one-line "what BrandOS learned this week" digest makes the learning
 *    loop emotionally visible.
 *  - The review queue unifies two things that would otherwise read as two
 *    separate "stuff waiting on me" surfaces (§3): pending brand-memory
 *    signals (from /api/control-plane/brand-memory) and freshly-generated
 *    content not yet exported (closest real analog to "needs your
 *    attention" — see notes/cleanup-candidates.md for why this isn't a
 *    literal `pending_review` campaign status, which doesn't exist in the
 *    schema despite the rollout plan's phrasing).
 *  - Quick-create and Recent are utility, below the fold.
 *  - "Active campaigns" row (between quick-create and pulse, per §6) is
 *    intentionally omitted: it depends on Campaign Lite's shared
 *    campaign_brief_id column, which does not exist in the schema yet
 *    (see /api/campaigns route notes). Showing it now would mean either a
 *    fake empty state or silently-wrong grouping — add this row when that
 *    column ships.
 *
 * WorkspaceNav (Phase 1) now renders the persistent header — this page no
 * longer owns its own logo/logout chrome.
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@brandos/auth'
import {
  Upload, Wand2, FileText, LayoutGrid, Rocket, TrendingUp, TrendingDown,
  Sparkles, ArrowRight, Clock, Calendar, X, Loader2, Info, CheckCircle2,
} from 'lucide-react'

// ─── Types (defensive — see route file notes for shape uncertainty) ───────

interface PulseAggregation {
  period?: string
  avg_score?: number
  count?: number
}

interface BrandMemoryEntry {
  id?: string
  entry_id?: string
  classification?: 'A' | 'B' | 'C'
  confidence?: number
  status?: string
  summary?: string
  signal?: string
  description?: string
  topic?: string
  created_at?: string
}

interface CampaignRow {
  id: string
  title: string
  topic: string
  format: string
  status: 'draft' | 'generated' | 'exported' | 'paid'
  qa_score_before: number | null
  qa_score_after: number | null
  created_at: string
}

// GTM Critical Item 3 (2026-06-21) — Plan My Week.
// Mirrors ContentIdea / PlannerResult from apps/web/lib/agents/plannerAgent.ts
// (not imported directly — that module isn't marked for client use and pulls
// in server-only deps; these are the response shape, kept in sync manually
// since GET /api/planner is the only consumer-facing contract that matters
// here).
interface ContentIdea {
  id: string
  day: string
  format: 'linkedin_post' | 'carousel' | 'newsletter' | 'x_thread' | 'article'
  title: string
  hook: string
  angle: string
  why_now: string
  format_label: string
  color: string
}

interface PlannerResult {
  week_theme: string
  ideas: ContentIdea[]
  generated_at: string
  context_signals: string[]
}

// Only formats Create's format-pick step actually supports today (verified
// against apps/web/app/(workspace)/workspace/create/page.tsx's
// QUERY_FORMAT_MAP and its format-option cards) — 'newsletter' and
// 'x_thread' have no corresponding Create UI option, so ideas in those
// formats get a disabled "Use this idea" action with an honest reason
// rather than a silently-wrong pre-fill.
const PLANNER_FORMAT_TO_CREATE_QUERY_KEY: Partial<Record<ContentIdea['format'], string>> = {
  linkedin_post: 'post',
  carousel: 'carousel',
  article: 'article',
}

// ─── Quick actions ──────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'New Post', icon: FileText, href: '/workspace/create?format=post', color: 'bg-blue-600 hover:bg-blue-700' },
  { label: 'New Carousel', icon: LayoutGrid, href: '/workspace/create?format=carousel', color: 'bg-cyan-600 hover:bg-cyan-700' },
  { label: 'New Campaign', icon: Rocket, href: '/workspace/create?mode=campaign', color: 'bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700' },
  { label: 'Upload to Library', icon: Upload, href: '/workspace/library', color: 'bg-gray-700 hover:bg-gray-600' },
]

// ── Pulse sparkline ──────────────────────────────────────────────────────────
// Pure SVG, no chart library needed. Renders the last N score-history data
// points as a line chart to show the trend at a glance.

function PulseSparkline({ data }: { data: PulseAggregation[] }) {
  const W = 120
  const H = 44
  const PAD = 4

  const scores = data.map(d => d.avg_score ?? 0)
  if (scores.length < 2) return null

  const min = Math.min(...scores)
  const max = Math.max(...scores)
  const range = max - min || 1

  const pts = scores.map((s, i) => {
    const x = PAD + (i / (scores.length - 1)) * (W - PAD * 2)
    const y = PAD + (1 - (s - min) / range) * (H - PAD * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  const latest = scores[scores.length - 1]
  const prior = scores[scores.length - 2]
  const isUp = latest >= prior

  return (
    <div className="flex flex-col items-end gap-1">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        {/* Area fill */}
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isUp ? '#34d399' : '#fbbf24'} stopOpacity="0.25" />
            <stop offset="100%" stopColor={isUp ? '#34d399' : '#fbbf24'} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline
          points={pts.join(' ')}
          fill="none"
          stroke={isUp ? '#34d399' : '#fbbf24'}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Last point dot */}
        {pts.length > 0 && (() => {
          const last = pts[pts.length - 1].split(',')
          return (
            <circle
              cx={last[0]} cy={last[1]} r="2.5"
              fill={isUp ? '#34d399' : '#fbbf24'}
            />
          )
        })()}
      </svg>
      <span className="text-[10px] text-gray-500">last {scores.length} periods</span>
    </div>
  )
}

export default function HomePage() {
  const { user, userLifecycleState } = useAuth()
  const router = useRouter()

  const [loading, setLoading] = React.useState(true)
  const [pulseAgg, setPulseAgg] = React.useState<PulseAggregation[]>([])
  const [pendingSignals, setPendingSignals] = React.useState<BrandMemoryEntry[]>([])
  const [recentCampaigns, setRecentCampaigns] = React.useState<CampaignRow[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [planMyWeekOpen, setPlanMyWeekOpen] = React.useState(false)
  const [pulseTipOpen, setPulseTipOpen] = React.useState(false)
  // Workspace intelligence summary stats
  const [wsStats, setWsStats] = React.useState<{
    signalCount: number | null
    personaCount: number | null
    assetCount: number | null
  }>({ signalCount: null, personaCount: null, assetCount: null })

  // P2.16 — Onboarding progress: tracks how much of the brand is configured.
  // Derived from persona count, signal count, and asset count — no new API.
  const [onboardingDone, setOnboardingDone] = React.useState<boolean>(false)

  // Onboarding redirect: this used to live here as a useEffect, but an
  // effect inside the destination page can only run AFTER that page has
  // already rendered once — guaranteeing a one-frame flash of the wrong
  // page no matter how fast UserState resolves. The decision has been
  // moved up to app/(workspace)/layout.tsx, which sits above both this
  // page and /workspace/onboarding and can withhold rendering either one
  // until UserState says which is correct. See that file for the full
  // rationale. userLifecycleState is still read here (via useAuth()) for
  // the dashboard's own informational use, but this page no longer makes
  // any routing decision of its own.

  React.useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [pulseRes, memoryRes, campaignsRes] = await Promise.allSettled([
          fetch('/api/control-plane/score-history?aggregate=true&granularity=week&limit=200'),
          fetch('/api/control-plane/brand-memory'),
          fetch('/api/campaigns?limit=8'),
        ])

        // Fetch workspace intelligence stats independently (non-blocking)
        Promise.allSettled([
          fetch('/api/persona'),
          fetch('/api/assets?limit=1'),
        ]).then(([personaRes, assetRes]) => {
          const personaCount = personaRes.status === 'fulfilled' && personaRes.value.ok
            ? personaRes.value.json().then((d: any) => (d?.personas ?? []).length)
            : Promise.resolve(null)
          const assetCount = assetRes.status === 'fulfilled' && assetRes.value.ok
            ? assetRes.value.json().then((d: any) => d?.total ?? null)
            : Promise.resolve(null)
          Promise.all([personaCount, assetCount]).then(([pc, ac]) => {
            if (!cancelled) {
              setWsStats(s => ({ ...s, personaCount: pc, assetCount: ac }))
              // Onboarding is "complete" once user has a voice + signal + asset
              const signals = // will be updated by the memory check below
                (pc ?? 0) > 0 // voice check — defer signal/asset until both resolve
              void signals // used below when signals are counted
            }
          }).catch(() => {})
        }).catch(() => {})

        if (cancelled) return

        if (pulseRes.status === 'fulfilled' && pulseRes.value.ok) {
          const data = await pulseRes.value.json()
          setPulseAgg(Array.isArray(data) ? data : [])
        }

        if (memoryRes.status === 'fulfilled' && memoryRes.value.ok) {
          const data = await memoryRes.value.json()
          // getBrandMemory's exact shape isn't confirmable from apps/web alone
          // (see route file) — handle both a bare array and a {entries:[]} wrap.
          const entries: BrandMemoryEntry[] = Array.isArray(data) ? data : (data?.entries ?? [])
          setPendingSignals(entries.filter(e => e.status === 'pending_review'))
          // Track approved signal count for workspace intelligence summary
          const approvedCount = entries.filter(e => e.status === 'approved').length
          if (!cancelled) {
            setWsStats(s => ({ ...s, signalCount: approvedCount }))
            // Onboarding complete: has at least 1 approved signal
            if (approvedCount > 0) setOnboardingDone(true)
          }
        }

        if (campaignsRes.status === 'fulfilled' && campaignsRes.value.ok) {
          const data = await campaignsRes.value.json()
          setRecentCampaigns(data?.campaigns ?? [])
        }
      } catch {
        if (!cancelled) setError('Some dashboard data couldn\u2019t load. Try refreshing.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [])

  // ── Derived pulse trend ──────────────────────────────────────────────
  const latest = pulseAgg[pulseAgg.length - 1]
  const prior = pulseAgg[pulseAgg.length - 2]
  const currentScore = latest?.avg_score != null ? Math.round(latest.avg_score) : null
  const trendDelta =
    currentScore != null && prior?.avg_score != null
      ? Math.round(latest!.avg_score! - prior.avg_score)
      : null

  // ── Generated-but-not-exported, closest real analog to "review queue" ──
  const awaitingExport = recentCampaigns.filter(c => c.status === 'generated')

  const firstName = user?.email ? user.email.split('@')[0] : null

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {/* Welcome */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold mb-1">
            Welcome back{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-gray-400 text-sm sm:text-base">
            Your brand operating system is paying attention.
          </p>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-red-950/40 border border-red-900 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* ── Brand Pulse — the hero ─────────────────────────────────────── */}
        <section className="mb-8 p-6 sm:p-8 rounded-2xl bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800">
          <div className="flex items-start justify-between flex-wrap gap-4 mb-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Brand Pulse
                <button
                  onClick={() => setPulseTipOpen(o => !o)}
                  className="text-gray-600 hover:text-gray-400 transition-colors"
                  aria-label="What is Brand Pulse?"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              </div>
              {loading ? (
                <div className="h-10 w-40 bg-gray-800 rounded animate-pulse" />
              ) : currentScore != null ? (
                <div className="flex items-baseline gap-3">
                  <span className="text-4xl sm:text-5xl font-bold tabular-nums">
                    {currentScore}%
                  </span>
                  {trendDelta != null && trendDelta !== 0 && (
                    <span
                      className={`flex items-center gap-1 text-sm font-semibold ${
                        trendDelta > 0 ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {trendDelta > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                      {trendDelta > 0 ? '+' : ''}{trendDelta}% this period
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-2xl font-semibold text-gray-500">
                  Generate your first piece to see consistency trends
                </div>
              )}
              <p className="text-sm text-gray-400 mt-2 max-w-xl">
                How closely recent content matches your brand profile, tracked over time.
              </p>
            </div>

            {/* Sparkline trend chart */}
            {!loading && pulseAgg.length > 1 && (
              <div className="shrink-0">
                <PulseSparkline data={pulseAgg} />
              </div>
            )}

            {!loading && pulseAgg.length <= 1 && (
              <Link
                href="/workspace/brand"
                className="flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300 font-medium shrink-0"
              >
                View Intelligence
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>

          {/* Brand Pulse explanation panel */}
          {pulseTipOpen && (
            <div className="mt-4 p-4 rounded-xl bg-gray-800/60 border border-gray-700 text-sm space-y-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-white">What is Brand Pulse?</p>
                <button onClick={() => setPulseTipOpen(false)} className="text-gray-500 hover:text-white shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-gray-300 text-xs leading-relaxed">
                Brand Pulse measures how consistently your AI-generated content matches your brand profile
                over time. It&rsquo;s calculated from governance scores on recent generations — the higher
                the score, the more your content sounds like your brand.
              </p>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">What moves it up:</p>
                <ul className="text-xs text-gray-300 space-y-1">
                  <li className="flex items-start gap-2"><span className="text-emerald-400 shrink-0">↑</span>Approving more brand signals in Intelligence → Signals</li>
                  <li className="flex items-start gap-2"><span className="text-emerald-400 shrink-0">↑</span>Uploading brand assets (logo, guidelines) to Library for analysis</li>
                  <li className="flex items-start gap-2"><span className="text-emerald-400 shrink-0">↑</span>Generating more content with Brand Memory enabled</li>
                </ul>
              </div>
              <p className="text-xs text-gray-500">
                A score above 70% means your AI is well-calibrated to your brand.
              </p>
            </div>
          )}

          {/* "What BrandOS learned this week" digest */}
          {!loading && pendingSignals.length > 0 && (
            <div className="mt-5 pt-5 border-t border-gray-800 flex items-center gap-2 text-sm text-gray-300">
              <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>
                BrandOS picked up <strong className="text-white">{pendingSignals.length}</strong> new
                signal{pendingSignals.length === 1 ? '' : 's'} from your recent content —
                <button
                  onClick={() => router.push('/workspace/brand?tab=signals')}
                  className="ml-1 text-cyan-400 hover:text-cyan-300 font-medium"
                >
                  review them in Intelligence
                </button>
                {' '}to improve future generations.
              </span>
            </div>
          )}
        </section>

        {/* ── Workspace Intelligence Summary ──────────────────────────────── */}
        {!loading && (wsStats.signalCount !== null || wsStats.personaCount !== null || wsStats.assetCount !== null) && (
          <section className="mb-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                label: 'Approved signals',
                value: wsStats.signalCount ?? '—',
                sub: 'shaping every generation',
                href: '/workspace/brand?tab=signals',
                color: 'text-cyan-400',
              },
              {
                label: 'Active voices',
                value: wsStats.personaCount ?? '—',
                sub: 'personas in your brand',
                href: '/workspace/brand?tab=voice',
                color: 'text-blue-400',
              },
              {
                label: 'Brand assets',
                value: wsStats.assetCount ?? '—',
                sub: 'analyzed for intelligence',
                href: '/workspace/library',
                color: 'text-purple-400',
              },
            ].map(({ label, value, sub, href, color }) => (
              <Link
                key={label}
                href={href}
                className="p-4 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 transition-colors group"
              >
                <div className={`text-2xl font-bold tabular-nums mb-0.5 ${color}`}>{value}</div>
                <div className="text-xs font-semibold text-gray-300">{label}</div>
                <div className="text-xs text-gray-600 mt-0.5 group-hover:text-gray-500 transition-colors">{sub}</div>
              </Link>
            ))}
          </section>
        )}

        {/* ── P2.16 Onboarding Progress ──────────────────────────────────── */}
        {!loading && !onboardingDone && (() => {
          const steps = [
            { label: 'Create a voice', done: (wsStats.personaCount ?? 0) > 0, href: '/workspace/brand?tab=voice' },
            { label: 'Upload a brand asset', done: (wsStats.assetCount ?? 0) > 0, href: '/workspace/library' },
            { label: 'Generate your first piece', done: recentCampaigns.length > 0, href: '/workspace/create' },
            { label: 'Review a brand signal', done: (wsStats.signalCount ?? 0) > 0, href: '/workspace/brand?tab=signals' },
          ]
          const completedCount = steps.filter(s => s.done).length
          const pct = Math.round((completedCount / steps.length) * 100)
          if (completedCount === steps.length) return null // all done, hide
          return (
            <section className="mb-8">
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-200">Setting up your brand</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Your brand is {pct}% configured — complete these steps to unlock the full intelligence layer.
                    </p>
                  </div>
                  <span className="text-xs font-bold text-cyan-400 tabular-nums">{completedCount}/{steps.length}</span>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden mb-4">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-700"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="space-y-2">
                  {steps.map(({ label, done, href }) => (
                    <Link
                      key={label}
                      href={href}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${done ? 'opacity-50 cursor-default pointer-events-none' : 'hover:bg-gray-800'}`}
                    >
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border ${done ? 'bg-emerald-600/30 border-emerald-600/50' : 'border-gray-700'}`}>
                        {done ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <span className="w-2 h-2 rounded-full bg-gray-600" />}
                      </span>
                      <span className={done ? 'line-through text-gray-600' : 'text-gray-300'}>{label}</span>
                      {!done && <ArrowRight className="w-3.5 h-3.5 text-gray-600 ml-auto" />}
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          )
        })()}

        {/* ── Unified review queue ───────────────────────────────────────── */}
        {!loading && (pendingSignals.length > 0 || awaitingExport.length > 0) && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Needs your attention
            </h2>
            <div className="rounded-xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
              {pendingSignals.slice(0, 4).map((entry, i) => (
                <button
                  key={entry.id ?? entry.entry_id ?? i}
                  onClick={() => router.push('/workspace/brand?tab=signals')}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-900/60 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-cyan-950 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {entry.summary ?? entry.signal ?? entry.description ?? entry.topic ?? 'New brand signal'}
                    </div>
                    <div className="text-xs text-gray-500">
                      Brand signal {entry.classification ? `\u00b7 ${entry.classification === 'A' ? 'strong' : entry.classification === 'B' ? 'emerging' : 'weak'} pattern` : ''} \u00b7 tap to review in Intelligence
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-600 shrink-0" />
                </button>
              ))}
              {awaitingExport.slice(0, 4).map(c => (
                <button
                  key={c.id}
                  onClick={() => router.push('/workspace/library')}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-900/60 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-purple-950 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{c.title}</div>
                    <div className="text-xs text-gray-500">
                      {c.format} \u00b7 generated, not yet exported
                      {c.qa_score_after != null ? ` \u00b7 score ${c.qa_score_after}` : ''}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-600 shrink-0" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── Quick create ────────────────────────────────────────────────── */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Quick Create
            </h2>
            {/* GTM Critical Item 3 (2026-06-21): Plan My Week — opens the
                planner modal rather than navigating, since /api/planner's
                ContentIdea[] result is best shown immediately for the user
                to pick from, matching how the runtime already works
                (uses existing planner runtime / persona / brand context;
                does not duplicate planner logic). */}
            <button
              onClick={() => setPlanMyWeekOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors"
            >
              <Calendar className="w-3.5 h-3.5" />
              Plan My Week
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            {QUICK_ACTIONS.map(({ label, icon: Icon, href, color }) => (
              <button
                key={label}
                onClick={() => router.push(href)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm transition-all ${color}`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* ── Recent ──────────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Recent</h2>
            <Link href="/workspace/library" className="text-xs text-cyan-400 hover:text-cyan-300 font-medium">
              View all in Library
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-24 rounded-xl bg-gray-900 border border-gray-800 animate-pulse" />
              ))}
            </div>
          ) : recentCampaigns.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-800 p-8 text-center">
              <Wand2 className="w-6 h-6 text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-400 mb-3">You haven&rsquo;t created anything yet — let&rsquo;s start.</p>
              <button
                onClick={() => router.push('/workspace/create')}
                className="text-sm font-semibold text-cyan-400 hover:text-cyan-300"
              >
                Create your first piece →
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {recentCampaigns.slice(0, 8).map(c => (
                <button
                  key={c.id}
                  onClick={() => router.push('/workspace/library')}
                  className="text-left p-4 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      {c.format}
                    </span>
                    <StatusPill status={c.status} />
                  </div>
                  <div className="text-sm font-medium truncate">{c.title}</div>
                  <div className="flex items-center gap-1 text-xs text-gray-500 mt-1.5">
                    <Clock className="w-3 h-3" />
                    {new Date(c.created_at).toLocaleDateString()}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {planMyWeekOpen && (
        <PlanMyWeekModal onClose={() => setPlanMyWeekOpen(false)} router={router} />
      )}
    </div>
  )
}

// ─── Plan My Week modal (GTM Critical Item 3, 2026-06-21) ─────────────────────
// GET /api/planner already existed with a complete runtime + Control Plane +
// brand-context resolution; this was purely a missing UI entry point.

function PlanMyWeekModal({ onClose, router }: { onClose: () => void; router: ReturnType<typeof useRouter> }) {
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [plan, setPlan] = React.useState<PlannerResult | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // POST, not GET — see app/api/planner/route.ts (the route only
      // exports POST; takes an optional { tone } body, default 'executive').
      const res = await fetch('/api/planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) {
        // Surfaces the route's own message verbatim, including the named
        // "No brand persona found. Run style analysis first." precondition
        // — same pattern as /api/transform's persona requirement.
        setError(data?.error ?? 'Could not generate a plan right now')
        return
      }
      setPlan(data.result ?? null)
    } catch (err: any) {
      setError(err?.message ?? 'Could not generate a plan right now')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  function useIdea(idea: ContentIdea) {
    const queryFormat = PLANNER_FORMAT_TO_CREATE_QUERY_KEY[idea.format]
    const params = new URLSearchParams({ topic: `${idea.title} — ${idea.hook}` })
    if (queryFormat) params.set('format', queryFormat)
    router.push(`/workspace/create?${params.toString()}`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-gray-950 border border-gray-800 rounded-2xl p-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Calendar className="w-5 h-5 text-amber-400" />
              Plan My Week
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {plan?.week_theme ? plan.week_theme : 'A content plan based on your brand and recent activity'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
            <span className="text-sm">Building this week&rsquo;s plan…</span>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
            <button onClick={() => void load()} className="block mt-2 text-xs font-semibold text-red-200 hover:text-white">
              Try again
            </button>
          </div>
        )}

        {!loading && !error && plan && (
          <>
            {plan.context_signals?.length > 0 && (
              <div className="mb-4 flex items-start gap-2 text-xs text-gray-500">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                <span>Informed by: {plan.context_signals.join(', ')}</span>
              </div>
            )}

            <div className="space-y-2.5">
              {plan.ideas.map(idea => {
                const supported = Boolean(PLANNER_FORMAT_TO_CREATE_QUERY_KEY[idea.format])
                return (
                  <div key={idea.id} className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{idea.day}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                        {idea.format_label}
                      </span>
                    </div>
                    <h3 className="text-sm font-medium text-white">{idea.title}</h3>
                    <p className="text-xs text-gray-500 mt-1">{idea.hook}</p>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-[11px] text-gray-600">{idea.why_now}</span>
                      {supported ? (
                        <button
                          onClick={() => useIdea(idea)}
                          className="flex items-center gap-1 text-xs font-semibold text-amber-400 hover:text-amber-300 shrink-0"
                        >
                          Use this idea <ArrowRight className="w-3 h-3" />
                        </button>
                      ) : (
                        <span
                          className="text-[11px] text-gray-600 shrink-0"
                          title={`Create doesn't have a ${idea.format_label} option yet — copy the idea into a supported format instead`}
                        >
                          Not yet available in Create
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: CampaignRow['status'] }) {
  const config: Record<CampaignRow['status'], { label: string; cls: string }> = {
    draft:     { label: 'Draft',     cls: 'bg-gray-800 text-gray-400' },
    generated: { label: 'Generated', cls: 'bg-blue-950 text-blue-300' },
    exported:  { label: 'Exported',  cls: 'bg-emerald-950 text-emerald-300' },
    paid:      { label: 'Published', cls: 'bg-purple-950 text-purple-300' },
  }
  const { label, cls } = config[status] ?? { label: status, cls: 'bg-gray-800 text-gray-400' }
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}>{label}</span>
}
