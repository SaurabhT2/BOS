'use client'

/**
 * Brand — the workspace where users see (and influence) what BrandOS knows.
 *
 * Per brandos_redesign_strategic_completion.md §3 and §8, Final IA:
 *   Profile / Learned signals (actionable) / Visual identity / Voice (multi-persona switcher)
 *
 * §3: "Learned signals is an action queue (approve/reject)... fundamentally
 * different from the other two tabs and should feel like an inbox, not a
 * read-only panel." Implemented below using the real PATCH contract on
 * /api/control-plane/brand-memory: { entry_id, approved, reviewed_by }.
 *
 * §1: "Voice should stay a switchable, multi-valued sub-entity of Brand,
 * not one field" — don't flatten Persona into Brand. Implemented as its
 * own tab over the real /api/persona contract (GET list; POST with an
 * action discriminator — create/switch/delete/update_profile). No
 * generic PATCH/DELETE verb exists on this route; see route file.
 *
 * WorkspaceNav (Phase 1) renders the persistent header — this page no
 * longer owns its own logo/logout chrome (replacing the old standalone
 * header from the original Memory page).
 */

import * as React from 'react'
import { useAuth } from '@brandos/auth'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  Brain, Save, RefreshCw, Sparkles, Check, X, Plus,
  Palette, Mic2, User, ChevronRight, Clock, TrendingUp,
  BookOpen, AlertCircle, ArrowRight, BarChart2, Target,
} from 'lucide-react'

type Tab = 'profile' | 'signals' | 'visual' | 'voice' | 'timeline' | 'learning'

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; description: string }[] = [
  { id: 'profile',  label: 'Identity',  icon: User,      description: 'Your brand fundamentals — tone, audience, positioning' },
  { id: 'signals',  label: 'Signals',   icon: Sparkles,  description: 'What BrandOS has learned from your content' },
  { id: 'visual',   label: 'Visual',    icon: Palette,   description: 'Colors and typography learned from your assets' },
  { id: 'voice',    label: 'Voices',    icon: Mic2,      description: 'Named personas BrandOS can write as' },
  { id: 'timeline', label: 'Timeline',  icon: Clock,     description: 'How your brand has evolved over time' },
  { id: 'learning', label: 'To learn',  icon: Target,    description: 'Gaps in your brand profile and how to close them' },
]

// Signal classification explanation — shown inline on signal cards
const CLASSIFICATION_LABELS: Record<string, { label: string; description: string; color: string }> = {
  A: { label: 'Strong signal',   description: 'High-confidence pattern seen repeatedly across your content', color: 'text-emerald-400 bg-emerald-950 border-emerald-800' },
  B: { label: 'Emerging signal', description: 'Consistent pattern still building confidence over time',       color: 'text-blue-400 bg-blue-950 border-blue-800' },
  C: { label: 'Weak signal',     description: 'Early observation — needs more content to confirm',           color: 'text-gray-400 bg-gray-800 border-gray-700' },
}

// Confidence interpretation — helps users understand what the % means
function confidenceLabel(confidence: number): { label: string; color: string } {
  if (confidence >= 80) return { label: 'Very confident', color: 'text-emerald-400' }
  if (confidence >= 60) return { label: 'Confident',      color: 'text-blue-400' }
  if (confidence >= 40) return { label: 'Building',       color: 'text-amber-400' }
  return                       { label: 'Early learning', color: 'text-gray-400' }
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface BrandProfile {
  tone: string
  audience: string
  industry: string
  positioning: string
  keywords: string
}

interface MemoryData {
  total_generations?: number
  total_copies?: number
  preferred_format?: string | null
  [key: string]: any
}

// getBrandMemory()'s exact shape isn't independently confirmable from
// apps/web (it's a CPL proxy into @brandos/brand-intelligence) — coded
// defensively against the field names the strategic doc §1 and the route's
// own PATCH contract imply (classification, confidence, entry id, status).
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

interface AssetWithVlm {
  id: string
  name?: string
  mime_type?: string
  vlm_analysis?: {
    colors?: { primary?: string[] }
    typography?: { personality?: string }
    confidence?: number
  } | null
  created_at?: string
}

interface Persona {
  id: string
  name: string
  tone: string
  domain?: string | null
  audience?: string | null
  key_themes?: string[]
  is_default?: boolean
  created_at?: string
}

export default function BrandPage() {
  return (
    <React.Suspense fallback={<BrandPageLoadingFallback />}>
      <BrandPageInner />
    </React.Suspense>
  )
}

function BrandPageLoadingFallback() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <RefreshCw className="w-5 h-5 animate-spin text-gray-600" />
    </div>
  )
}

function BrandPageInner() {
  // BUGFIX (Vercel "Loading profile…" hang): previously only `user` was read
  // here, discarding `isLoading`. ProfileTab's data-fetch effect is gated on
  // `userId` (`if (!userId) return`), so while AuthProvider is still resolving
  // the session — which on Vercel cold starts can take several seconds — userId
  // is undefined, the effect never fires, and ProfileTab's `loadingMemory` state
  // (initialized to `true`) never gets set to `false`. The spinner runs forever.
  // Passing `isLoading` down lets ProfileTab distinguish "still waiting on auth"
  // from "fetching memory" from "definitely logged out", instead of presenting
  // an indistinguishable infinite spinner for all three.
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  const initialTab = (searchParams.get('tab') as Tab) ?? 'profile'
  const [tab, setTab] = React.useState<Tab>(TABS.some(t => t.id === initialTab) ? initialTab : 'profile')

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="mb-6 flex items-center gap-3">
          <Brain className="w-6 h-6 text-blue-400 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold">Brand Intelligence</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              What BrandOS knows about your brand — and how you can shape it.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-gray-800 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === id
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {tab === 'profile' && <ProfileTab userId={user?.id} authLoading={authLoading} />}
        {tab === 'signals' && <SignalsTab userId={user?.id} />}
        {tab === 'visual'  && <VisualIdentityTab />}
        {tab === 'voice'   && <VoiceTab onUpgrade={() => router.push('/workspace/settings/billing')} />}
        {tab === 'timeline' && <SignalTimelineTab />}
        {tab === 'learning' && <LearningQueueTab />}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Tab 1: Profile — carried over from the original Memory page, unchanged
// contract (/api/memory GET/POST), now a tab instead of a standalone page.
// ════════════════════════════════════════════════════════════════════════════

function ProfileTab({ userId, authLoading }: { userId?: string; authLoading: boolean }) {
  // BUGFIX: loadingMemory used to initialize to `true` unconditionally and the
  // fetch effect below only ran `if (userId)`. If auth never resolved a user
  // (slow Vercel cold start, or a genuinely logged-out edge case slipping past
  // middleware), loadingMemory stayed `true` forever — "Loading profile…" spun
  // indefinitely. It now starts `false` and is only flipped to `true` right
  // before an actual fetch begins, so there is no state where the UI claims to
  // be loading without a request in flight.
  const [memoryData, setMemoryData] = React.useState<MemoryData | null>(null)
  const [loadingMemory, setLoadingMemory] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [savedOk, setSavedOk] = React.useState(false)

  const [profile, setProfile] = React.useState<BrandProfile>({
    tone: 'executive',
    audience: '',
    industry: '',
    positioning: '',
    keywords: '',
  })

  React.useEffect(() => {
    // Auth hasn't settled yet — wait. Once authLoading flips to false this
    // effect re-runs (it's in the dependency array) and re-evaluates userId.
    if (authLoading) return
    if (!userId) return
    fetchMemory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, authLoading])

  const fetchMemory = async () => {
    if (!userId) return
    setLoadingMemory(true)
    try {
      const res = await fetch('/api/memory')
      const data = await res.json()
      if (data.memory) {
        setMemoryData(data.memory)
        setProfile(prev => ({
          tone: data.memory.preferred_tone || prev.tone,
          audience: data.memory.audience || prev.audience,
          industry: data.memory.industry || prev.industry,
          positioning: data.memory.positioning || prev.positioning,
          keywords: data.memory.keywords || prev.keywords,
        }))
      }
    } catch {
      // silently fail — memory may not exist yet
    } finally {
      setLoadingMemory(false)
    }
  }

  const saveProfile = async () => {
    if (!userId) return
    setSaving(true)
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: { type: 'profile_update', payload: profile },
        }),
      })
      if (res.ok) {
        setSavedOk(true)
        setTimeout(() => setSavedOk(false), 2500)
      }
    } catch {
      // handle silently
    } finally {
      setSaving(false)
    }
  }

  const fields: { key: keyof BrandProfile; label: string; placeholder: string }[] = [
    { key: 'tone', label: 'Brand Tone', placeholder: 'executive, bold, educational, founder' },
    { key: 'audience', label: 'Target Audience', placeholder: 'e.g. B2B SaaS founders, Series A+' },
    { key: 'industry', label: 'Industry / Domain', placeholder: 'e.g. Technology, Finance' },
    { key: 'positioning', label: 'Brand Positioning', placeholder: 'e.g. Challenger brand focused on AI-native workflows' },
    { key: 'keywords', label: 'Keywords / Themes', placeholder: 'e.g. growth, AI, automation, scale' },
  ]

  return (
    <div>
      {memoryData && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Generations', value: memoryData.total_generations ?? 0 },
            { label: 'Pieces Created', value: memoryData.total_copies ?? 0 },
            { label: 'Top Format', value: memoryData.preferred_format ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</div>
              <div className="text-xl font-bold text-white">{value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-5">
          Brand Profile
        </h2>

        {authLoading ? (
          // Waiting on AuthProvider to resolve the session (e.g. Vercel cold
          // start) — distinct copy from the memory-fetch spinner below so a
          // slow network doesn't read as a stuck/broken page.
          <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Connecting…
          </div>
        ) : !userId ? (
          // Auth has settled and there is genuinely no signed-in user.
          // Middleware should have redirected before this point in normal
          // operation, but this avoids ever showing an infinite spinner if
          // that assumption doesn't hold for some edge case.
          <div className="flex items-center gap-2 text-gray-500 py-8 justify-center text-sm">
            Couldn&rsquo;t verify your session. Try refreshing the page.
          </div>
        ) : loadingMemory ? (
          <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Loading profile…
          </div>
        ) : (
          <div className="space-y-4">
            {fields.map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">{label}</label>
                <input
                  type="text"
                  value={profile[key]}
                  onChange={e => setProfile(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full bg-black border border-gray-700 focus:border-blue-500 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 outline-none transition-colors"
                />
              </div>
            ))}

            <button
              onClick={saveProfile}
              disabled={saving}
              className="mt-2 flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-semibold transition-all"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {savedOk ? 'Saved ✓' : saving ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Tab 2: Learned signals — actionable inbox, NEW (didn't exist anywhere
// before; the prior Memory page never called the brand-memory route at all).
// ════════════════════════════════════════════════════════════════════════════

function SignalsTab({ userId }: { userId?: string }) {
  const [entries, setEntries] = React.useState<BrandMemoryEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [actioningId, setActioningId] = React.useState<string | null>(null)
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [showHistory, setShowHistory] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/control-plane/brand-memory')
      if (!res.ok) throw new Error('Failed to load signals')
      const data = await res.json()
      const list: BrandMemoryEntry[] = Array.isArray(data) ? data : (data?.entries ?? [])
      setEntries(list)
    } catch {
      setError('Couldn\u2019t load learned signals. Try refreshing.')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const review = async (entry: BrandMemoryEntry, approved: boolean) => {
    const id = entry.entry_id ?? entry.id
    if (!id || actioningId) return
    setActioningId(id)
    try {
      const res = await fetch('/api/control-plane/brand-memory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_id: id,
          approved,
          reviewed_by: userId ?? 'unknown',
        }),
      })
      if (!res.ok) throw new Error('Review failed')
      setEntries(prev => prev.filter(e => (e.entry_id ?? e.id) !== id))
    } catch {
      setError('That action didn\u2019t go through. Try again.')
    } finally {
      setActioningId(null)
    }
  }

  const pending = entries.filter(e => !e.status || e.status === 'pending_review')
  const approved = entries.filter(e => e.status === 'approved')

  return (
    <div>
      {/* Explainability callout — what signals are and why they matter */}
      <div className="mb-5 p-4 rounded-xl bg-blue-950/30 border border-blue-900/50">
        <div className="flex items-start gap-3">
          <Sparkles className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-200 mb-1">How signals work</p>
            <p className="text-xs text-blue-300/80 leading-relaxed">
              Every piece of content you generate teaches BrandOS something about your brand voice.
              These signals are patterns it noticed — approve the ones that feel right, reject anything
              that doesn&rsquo;t fit. Approved signals become part of every future generation.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              {Object.entries(CLASSIFICATION_LABELS).map(([cls, { label, description, color }]) => (
                <span key={cls} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs ${color}`}>
                  <span className="font-mono font-bold">{cls}</span>
                  <span className="text-xs opacity-80">= {label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">
          {pending.length > 0
            ? `${pending.length} signal${pending.length === 1 ? '' : 's'} waiting for your review`
            : 'Signal inbox'}
        </p>
        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-lg transition-colors shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-950/40 border border-red-900 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-12 justify-center">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : pending.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 p-10 text-center">
          <Sparkles className="w-6 h-6 text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Nothing waiting on you right now.</p>
          <p className="text-xs text-gray-600 mt-1">New signals show up here as BrandOS learns from your content.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pending.map((entry, i) => {
            const id = entry.entry_id ?? entry.id ?? String(i)
            const busy = actioningId === id
            const isExpanded = expandedId === id
            const cls = entry.classification
            const clsInfo = cls ? CLASSIFICATION_LABELS[cls] : null
            const conf = typeof entry.confidence === 'number' ? entry.confidence : null
            const confInfo = conf != null ? confidenceLabel(Math.round(conf)) : null

            return (
              <div
                key={id}
                className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden"
              >
                <div className="flex items-center gap-3 p-4">
                  <div className="w-9 h-9 rounded-lg bg-cyan-950 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      {entry.summary ?? entry.signal ?? entry.description ?? entry.topic ?? 'New brand signal'}
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {clsInfo && (
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${clsInfo.color}`}>
                          {clsInfo.label}
                        </span>
                      )}
                      {confInfo && conf != null && (
                        <span className={`text-xs ${confInfo.color}`}>
                          {confInfo.label} ({Math.round(conf)}%)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : id)}
                      title="What does this mean?"
                      className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors text-xs"
                    >
                      Why?
                    </button>
                    <button
                      onClick={() => void review(entry, true)}
                      disabled={busy}
                      title="Approve — add to brand profile"
                      className="p-2 rounded-lg bg-gray-800 hover:bg-emerald-900/50 hover:text-emerald-400 disabled:opacity-40 transition-colors"
                    >
                      {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => void review(entry, false)}
                      disabled={busy}
                      title="Reject — don't include in brand profile"
                      className="p-2 rounded-lg bg-gray-800 hover:bg-red-900/50 hover:text-red-400 disabled:opacity-40 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Expandable explainability panel */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-0 border-t border-gray-800 bg-gray-900/50">
                    <div className="pt-3 space-y-2">
                      {clsInfo && (
                        <div className="flex items-start gap-2">
                          <span className="text-xs font-semibold text-gray-500 min-w-[4.5rem]">Signal type</span>
                          <span className="text-xs text-gray-300">{clsInfo.description}</span>
                        </div>
                      )}
                      {confInfo && conf != null && (
                        <div className="flex items-start gap-2">
                          <span className="text-xs font-semibold text-gray-500 min-w-[4.5rem]">Confidence</span>
                          <span className="text-xs text-gray-300">
                            {confInfo.label} at {Math.round(conf)}%.
                            {conf >= 70
                              ? ' This pattern has appeared consistently in your content.'
                              : conf >= 40
                              ? ' Seen in several pieces — confidence grows with more examples.'
                              : ' Early observation — BrandOS saw this recently and is watching for it.'
                            }
                          </span>
                        </div>
                      )}
                      <div className="flex items-start gap-2">
                        <span className="text-xs font-semibold text-gray-500 min-w-[4.5rem]">If you approve</span>
                        <span className="text-xs text-gray-300">
                          This signal gets added to your brand profile and influences every future generation.
                        </span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-xs font-semibold text-gray-500 min-w-[4.5rem]">If you reject</span>
                        <span className="text-xs text-gray-300">
                          BrandOS dismisses this observation and won&rsquo;t apply it to future content.
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Identity evolution: approved signals history ─────────────────── */}
      {!loading && approved.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowHistory(h => !h)}
            className="flex items-center gap-2 text-sm font-semibold text-gray-400 hover:text-white transition-colors mb-3 w-full text-left"
          >
            <ChevronRight className={`w-4 h-4 transition-transform ${showHistory ? 'rotate-90' : ''}`} />
            Your brand profile — {approved.length} approved signal{approved.length === 1 ? '' : 's'}
          </button>

          {showHistory && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 mb-3">
                These signals are active in your brand profile and influence every generation.
                They were built up from your content over time.
              </p>
              {approved.map((entry, i) => {
                const id = entry.entry_id ?? entry.id ?? String(i)
                const cls = entry.classification
                const clsInfo = cls ? CLASSIFICATION_LABELS[cls] : null
                const conf = typeof entry.confidence === 'number' ? entry.confidence : null
                return (
                  <div
                    key={id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-gray-900/50 border border-gray-800/60"
                  >
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-300 truncate">
                        {entry.summary ?? entry.signal ?? entry.description ?? entry.topic ?? 'Approved signal'}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {clsInfo && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${clsInfo.color}`}>
                            {clsInfo.label}
                          </span>
                        )}
                        {conf != null && (
                          <span className={`text-xs ${confidenceLabel(Math.round(conf)).color}`}>
                            {Math.round(conf)}%
                          </span>
                        )}
                        {entry.created_at && (
                          <span className="text-xs text-gray-600">
                            {new Date(entry.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Tab 3: Visual identity — read-only, derived from asset VLM analysis. NEW.
// ════════════════════════════════════════════════════════════════════════════

function VisualIdentityTab() {
  const [assets, setAssets] = React.useState<AssetWithVlm[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    fetch('/api/assets?mimeCategory=image&limit=20&sortBy=created_at&sortDir=desc')
      .then(r => r.json())
      .then(d => setAssets(d?.assets ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const analyzed = assets.filter(a => a.vlm_analysis)
  const palette = React.useMemo(() => {
    const colors = new Set<string>()
    analyzed.forEach(a => a.vlm_analysis?.colors?.primary?.forEach(c => colors.add(c)))
    return [...colors].slice(0, 10)
  }, [analyzed])

  const personalities = React.useMemo(() => {
    const counts: Record<string, number> = {}
    analyzed.forEach(a => {
      const p = a.vlm_analysis?.typography?.personality
      if (p) counts[p] = (counts[p] ?? 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [analyzed])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-500 py-12 justify-center">
        <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
      </div>
    )
  }

  if (analyzed.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-800 p-10 text-center">
        <Palette className="w-6 h-6 text-gray-600 mx-auto mb-2" />
        <p className="text-sm text-gray-400">No visual patterns detected yet.</p>
        <p className="text-xs text-gray-600 mt-1">
          Upload brand images to Library — they&rsquo;re analyzed automatically.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Detected palette
        </h2>
        {palette.length === 0 ? (
          <p className="text-sm text-gray-500">No color data yet — analyzed images didn&rsquo;t return a palette.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {palette.map(color => (
              <div key={color} className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-lg border border-gray-700"
                  style={{ backgroundColor: /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : undefined }}
                />
                <span className="text-xs text-gray-400 font-mono">{color}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Typography personality
        </h2>
        {personalities.length === 0 ? (
          <p className="text-sm text-gray-500">No typography data yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {personalities.map(([p, count]) => (
              <span key={p} className="text-xs px-2.5 py-1 rounded-full bg-blue-950 text-blue-300">
                {p} <span className="text-blue-500">×{count}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-600">
        Based on {analyzed.length} analyzed image{analyzed.length === 1 ? '' : 's'} in your Library.
      </p>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Tab 4: Voice — multi-persona switcher. NEW.
// Strategic doc §1: "the schema already supports multiple named personas
// per workspace... don't flatten this." Built against the real /api/persona
// contract: GET lists all, POST with action create/switch/delete/update_profile.
// ════════════════════════════════════════════════════════════════════════════

function VoiceTab({ onUpgrade }: { onUpgrade: () => void }) {
  const [personas, setPersonas] = React.useState<Persona[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const [newRole, setNewRole] = React.useState('')

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/persona')
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load')
      setPersonas(data.personas ?? [])
    } catch {
      setError('Couldn\u2019t load voices. Try refreshing.')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const switchTo = async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch('/api/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'switch', personaId: id }),
      })
      if (!res.ok) throw new Error()
      await load()
    } catch {
      setError('Couldn\u2019t switch voice. Try again.')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch('/api/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', personaId: id }),
      })
      if (!res.ok) throw new Error()
      setPersonas(prev => prev.filter(p => p.id !== id))
    } catch {
      setError('Couldn\u2019t delete that voice. Try again.')
    } finally {
      setBusyId(null)
    }
  }

  const create = async () => {
    if (!newName.trim() || !newRole.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: newName.trim(), role: newRole.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Failed to create')
      setNewName('')
      setNewRole('')
      await load()
    } catch {
      setError('Couldn\u2019t create that voice. Try again.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400 max-w-xl">
          BrandOS supports multiple named voices — switch which one Create writes as.
        </p>
        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-lg transition-colors shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-950/40 border border-red-900 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-12 justify-center">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-2 mb-6">
          {personas.map(p => (
            <div
              key={p.id}
              className={`flex items-center gap-3 p-4 rounded-xl border transition-colors ${
                p.is_default ? 'bg-blue-950/30 border-blue-800' : 'bg-gray-900 border-gray-800'
              }`}
            >
              <div className="w-9 h-9 rounded-lg bg-gray-800 flex items-center justify-center shrink-0">
                <Mic2 className="w-4 h-4 text-gray-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{p.name}</span>
                  {p.is_default && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-900 text-blue-300">
                      Writing as
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {p.tone}{p.domain ? ` · ${p.domain}` : ''}{p.audience ? ` · ${p.audience}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {!p.is_default && (
                  <button
                    onClick={() => void switchTo(p.id)}
                    disabled={busyId === p.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-800 hover:bg-blue-900/50 hover:text-blue-300 disabled:opacity-40 rounded-lg text-xs transition-colors"
                  >
                    {busyId === p.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    Switch
                  </button>
                )}
                {!p.is_default && (
                  <button
                    onClick={() => void remove(p.id)}
                    disabled={busyId === p.id}
                    title="Delete voice"
                    className="p-2 rounded-lg bg-gray-800 hover:bg-red-900/50 hover:text-red-400 disabled:opacity-40 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add a voice
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Name (e.g. Founder voice)"
            className="bg-black border border-gray-700 focus:border-blue-500 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 outline-none"
          />
          <input
            type="text"
            value={newRole}
            onChange={e => setNewRole(e.target.value)}
            placeholder="Role (e.g. Founder, Marketing)"
            className="bg-black border border-gray-700 focus:border-blue-500 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 outline-none"
          />
        </div>
        <button
          onClick={() => void create()}
          disabled={!newName.trim() || !newRole.trim() || creating}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg text-sm font-semibold transition-all"
        >
          {creating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Create voice
        </button>
      </div>
    </div>
  )
}

// ─── P3.21 — Signal Timeline tab ─────────────────────────────────────────────
// Shows approved signals in chronological order as a visual timeline — how
// the brand profile was built up over time from content observations.
// Data source: GET /api/memory (brand_memory_entries with created_at).

function SignalTimelineTab() {
  const [entries, setEntries] = React.useState<BrandMemoryEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError]     = React.useState<string | null>(null)

  React.useEffect(() => {
    fetch('/api/memory?limit=200')
      .then(r => r.json())
      .then(d => {
        const all: BrandMemoryEntry[] = d.entries ?? d.data ?? []
        const approved = all
          .filter(e => e.status === 'approved')
          .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
        setEntries(approved)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center py-16 gap-3 text-gray-600">
      <RefreshCw className="w-4 h-4 animate-spin" />
      <span className="text-sm">Loading timeline…</span>
    </div>
  )

  if (error) return (
    <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-sm text-red-400">{error}</div>
  )

  if (entries.length === 0) return (
    <div className="text-center py-16 text-gray-600">
      <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="text-sm">No approved signals yet — approve some in the Signals tab to build your timeline.</p>
    </div>
  )

  // Group by month
  const byMonth = new Map<string, BrandMemoryEntry[]>()
  for (const e of entries) {
    const month = new Date(e.created_at ?? 0).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    if (!byMonth.has(month)) byMonth.set(month, [])
    byMonth.get(month)!.push(e)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-6">
        <TrendingUp className="w-4 h-4 text-cyan-400" />
        <p className="text-sm text-gray-400">
          {entries.length} signal{entries.length !== 1 ? 's' : ''} shaping your brand — in the order they were confirmed
        </p>
      </div>

      <div className="relative">
        {/* Vertical timeline spine */}
        <div className="absolute left-[11px] top-0 bottom-0 w-px bg-gray-800" />

        <div className="space-y-8 ml-8">
          {[...byMonth.entries()].map(([month, monthEntries]) => (
            <div key={month}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 -ml-8 pl-6 relative">
                <span className="absolute left-0 top-0.5 w-5 h-5 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
                </span>
                {month}
              </p>
              <div className="space-y-2">
                {monthEntries.map(e => {
                  const cls = CLASSIFICATION_LABELS[e.classification ?? '']
                  // confidence is 0-1 in the actual type; multiply to get %
                  const confPct = (e.confidence ?? 0) * 100
                  const conf = confidenceLabel(confPct)
                  // signal text: prefer signal, fall back through summary → description → topic
                  const text = e.signal ?? e.summary ?? e.description ?? e.topic ?? '—'
                  return (
                    <div key={e.id ?? e.entry_id} className="relative flex items-start gap-3">
                      <span className="absolute -left-[29px] top-2 w-3 h-3 rounded-full bg-emerald-600/40 border border-emerald-500/60 shrink-0" />
                      <div className="flex-1 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-sm text-gray-200 leading-snug">{text}</p>
                          {cls && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full border shrink-0 ${cls.color}`}>
                              {cls.label}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-600">
                          <span className={conf.color}>{conf.label}</span>
                          <span>·</span>
                          <span>{new Date(e.created_at ?? 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          <span>·</span>
                          <span>{Math.round(confPct)}% confidence</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── P3.23 — Learning Queue tab ───────────────────────────────────────────────
// Shows what's missing from the brand profile and how to fix each gap.
// Derived entirely from what exists (persona count, signal count, asset count,
// profile fields) — no new API. Pure client-side gap detection.

interface LearningItem {
  id: string
  priority: 'high' | 'medium' | 'low'
  title: string
  description: string
  action: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

function LearningQueueTab() {
  const [signals,  setSignals]  = React.useState<BrandMemoryEntry[]>([])
  const [personas, setPersonas] = React.useState<Persona[]>([])
  const [assets,   setAssets]   = React.useState<number>(0)
  const [profile,  setProfile]  = React.useState<BrandMemoryEntry[]>([])
  const [loading,  setLoading]  = React.useState(true)

  React.useEffect(() => {
    Promise.allSettled([
      fetch('/api/memory?limit=200').then(r => r.json()),
      fetch('/api/persona').then(r => r.json()),
      fetch('/api/assets?limit=1').then(r => r.json()),
    ]).then(([memRes, perRes, astRes]) => {
      if (memRes.status === 'fulfilled') {
        const all: BrandMemoryEntry[] = memRes.value.entries ?? memRes.value.data ?? []
        setSignals(all.filter(e => e.status === 'approved'))
        // Use entries that have a topic as a proxy for profile/identity content
        setProfile(all.filter(e => e.topic != null))
      }
      if (perRes.status === 'fulfilled') setPersonas(perRes.value.personas ?? perRes.value.data ?? [])
      if (astRes.status === 'fulfilled') setAssets(astRes.value.total ?? 0)
    }).finally(() => setLoading(false))
  }, [])

  const items = React.useMemo<LearningItem[]>(() => {
    const queue: LearningItem[] = []

    if (personas.length === 0) queue.push({
      id: 'voice',
      priority: 'high',
      title: 'Create at least one brand voice',
      description: 'Without a named voice, every generation uses a generic tone. Voices let BrandOS write with a specific style, role, and personality.',
      action: 'Create a voice →',
      href: '/workspace/brand?tab=voice',
      icon: Mic2,
    })

    if (signals.length < 3) queue.push({
      id: 'signals',
      priority: 'high',
      title: 'Approve more brand signals',
      description: `You have ${signals.length} approved signal${signals.length !== 1 ? 's' : ''}. BrandOS needs at least 3 to detect consistent brand patterns. Generate content and approve the signals it surfaces.`,
      action: 'Review signals →',
      href: '/workspace/brand?tab=signals',
      icon: Sparkles,
    })

    if (assets === 0) queue.push({
      id: 'assets',
      priority: 'high',
      title: 'Upload a brand asset',
      description: 'Brand assets (logo, brand guide, example posts) teach BrandOS your visual identity and writing style. Even one document improves every generation.',
      action: 'Upload an asset →',
      href: '/workspace/library',
      icon: BookOpen,
    })

    if (profile.length < 3) queue.push({
      id: 'profile',
      priority: 'medium',
      title: 'Complete your brand identity',
      description: 'Your brand identity profile is sparse. Fill in your tone, target audience, and positioning so BrandOS generates consistently on-brand content.',
      action: 'Edit identity →',
      href: '/workspace/brand?tab=profile',
      icon: Target,
    })

    if (signals.length >= 3 && signals.length < 10) queue.push({
      id: 'signals-depth',
      priority: 'medium',
      title: 'Build signal depth',
      description: `${signals.length} signals is a good start. 10+ signals means BrandOS has enough data to detect nuanced brand patterns and generate with high confidence.`,
      action: 'Keep generating →',
      href: '/workspace/create',
      icon: BarChart2,
    })

    if (personas.length === 1) queue.push({
      id: 'second-voice',
      priority: 'low',
      title: 'Add a second voice',
      description: 'Multiple voices let you generate content for different audiences or contexts — a thought-leadership voice and a product voice, for example.',
      action: 'Add another voice →',
      href: '/workspace/brand?tab=voice',
      icon: Mic2,
    })

    return queue
  }, [signals, personas, assets, profile])

  if (loading) return (
    <div className="flex items-center justify-center py-16 gap-3 text-gray-600">
      <RefreshCw className="w-4 h-4 animate-spin" />
      <span className="text-sm">Analysing your brand profile…</span>
    </div>
  )

  if (items.length === 0) return (
    <div className="text-center py-16">
      <Check className="w-12 h-12 mx-auto mb-3 text-emerald-500" />
      <p className="text-sm font-semibold text-gray-200 mb-1">Your brand profile is solid</p>
      <p className="text-sm text-gray-500">Keep generating to continue building signal confidence over time.</p>
    </div>
  )

  const priorityOrder = { high: 0, medium: 1, low: 2 } as const
  const sorted = [...items].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  const PRIORITY_STYLES = {
    high:   { badge: 'text-red-400 bg-red-950 border-red-800',    label: 'High priority'   },
    medium: { badge: 'text-amber-400 bg-amber-950 border-amber-800', label: 'Medium priority' },
    low:    { badge: 'text-gray-400 bg-gray-800 border-gray-700', label: 'Nice to have'    },
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <AlertCircle className="w-4 h-4 text-amber-400" />
        <p className="text-sm text-gray-400">
          {sorted.filter(i => i.priority === 'high').length} high-priority gap{sorted.filter(i => i.priority === 'high').length !== 1 ? 's' : ''} detected — resolve these to improve generation quality
        </p>
      </div>
      {sorted.map(item => {
        const Icon = item.icon
        const style = PRIORITY_STYLES[item.priority]
        return (
          <div key={item.id} className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-start gap-4">
              <div className="w-9 h-9 rounded-lg bg-gray-800 flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="w-4 h-4 text-gray-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <p className="text-sm font-semibold text-gray-200">{item.title}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${style.badge}`}>{style.label}</span>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed mb-3">{item.description}</p>
                <a
                  href={item.href}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  {item.action}
                  <ArrowRight className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
