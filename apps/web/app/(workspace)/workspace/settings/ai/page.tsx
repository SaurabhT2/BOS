'use client'

/**
 * /workspace/settings/ai — Settings → AI
 *
 * Per brandos_redesign_strategic_completion.md §4 "AI Workspace
 * Recommendation": tier-gated DEPTH at one fixed location, not new
 * top-level real estate. Same route for every plan; sections within it
 * gate by tier (consistent with §7's "same screens for every tier, always
 * — never fork navigation by plan").
 *
 *   Explorer     — usage meter + upgrade banner only. No BYOK controls
 *                  shown (BYOK is hard-gated server-side; Explorer gets a
 *                  403 from /api/workspace/providers, so showing disabled
 *                  controls would just be nagging — §4).
 *   Professional — Providers (3 primary cards: Claude/ChatGPT/Gemini, plus
 *                  an "Advanced providers" disclosure for the other 4),
 *                  Quality level, Quality gate, Usage.
 *   Executive    — everything Professional has, plus Health, Fallback
 *                  ordering (UI placeholder — no backing column exists
 *                  yet, see notes below), configurable repair attempts,
 *                  real cost breakdown, and an approval audit trail.
 *
 * CONSOLIDATION (strategic doc, Polish Items): this page converges TWO
 * previously-separate, previously-fully-built pages rather than living
 * alongside them as a third option:
 *   - /workspace/settings (the governance-threshold/provider/runtime-mode
 *     override form) — that logic is now embedded in this page's Quality
 *     section, sourced from the same /api/workspace/settings GET/PATCH
 *     contract, UNCHANGED.
 *   - /workspace/settings/providers (full BYOK key management: add,
 *     rotate, revoke, revalidate, usage/health table) — embedded here
 *     UNCHANGED, sourced from the same /api/workspace/providers and
 *     /api/workspace/providers/usage contracts.
 * /workspace/settings/providers itself now just redirects here (see that
 * file) rather than being deleted outright, so old bookmarks still work.
 *
 * PROVIDER LIST NOTE: the strategic doc's table mentions 9 providers
 * (Claude/ChatGPT/Gemini primary + Groq/DeepSeek/OpenRouter/TogetherAI/
 * Ollama/LM Studio advanced). The real workspace BYOK contract
 * (/api/workspace/providers, confirmed against providers/page.tsx's
 * PROVIDER_LABELS) only supports 7 cloud key-based providers — Ollama and
 * LM Studio are LOCAL runtime providers with no API key to manage; they're
 * already handled by RuntimeModeSelector's cloud/local toggle in Create,
 * not by this key-management UI. Not silently omitted — just correctly
 * categorized as a different mechanism.
 *
 * QUALITY GATE DEFAULT FIX (strategic doc, Polish Items): the mockup
 * showed a default of 65; the codebase's real default is 70
 * (DEFAULT_POLICY_CONFIG.quality.scoreThreshold in governance admin's own
 * page, confirmed via `config.scoreThresholds[task] ?? 70`). This page's
 * placeholder uses 70. No literal `DEFAULT_APPROVAL_SCORE_THRESHOLD`
 * export was found anywhere in current usage — that name from the
 * strategic doc doesn't match the real constant.
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Sliders, Save, Loader2, CheckCircle, AlertCircle,
  Key, Plus, Trash2, RefreshCw, XCircle, Activity, ShieldCheck,
  ShieldAlert, Eye, EyeOff, Cpu,
  Zap, ArrowLeft,
} from 'lucide-react'
import { UpgradeGate, QuotaMeter } from '../upgrade-gate'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ResolvedSettings {
  preferred_provider: string
  runtime_mode: string
  governance_score_threshold: number
  monthly_generation_limit: number | null
  asset_storage_limit_mb: number
  has_custom_generation_limit: boolean
  plan: string
}

interface SettingsData {
  resolved: ResolvedSettings
  overrides: Partial<ResolvedSettings> | null
  canWriteSettings: boolean
  plan: string
}

interface UsageData {
  plan: string
  generations: { used: number; limit: number | null; percentUsed: number | null }
  storage: { usedMb: number; limitMb: number | null; percentUsed: number | null }
  uploads: { used: number; limit: number | null; percentUsed: number | null }
}

interface ProviderKeyRow {
  id: string
  provider: string
  key_hint: string
  is_active: boolean
  validated_at: string | null
  created_at: string
  rotated_at: string | null
}

interface UsageSummary {
  provider: string
  request_count: number
  total_tokens: number | null
}

interface HealthRow {
  provider: string
  last_success_at: string | null
  last_failure_at: string | null
  failure_count: number
  last_validated_at: string | null
  updated_at: string
}

const PRIMARY_PROVIDERS = ['anthropic', 'openai', 'google'] as const
const ADVANCED_PROVIDERS = ['groq', 'deepseek', 'openrouter', 'togetherai'] as const
const ALL_PROVIDERS = [...PRIMARY_PROVIDERS, ...ADVANCED_PROVIDERS]

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Claude (Anthropic)',
  openai: 'ChatGPT (OpenAI)',
  google: 'Gemini (Google)',
  groq: 'Groq',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  togetherai: 'Together AI',
}

const PROVIDER_PLACEHOLDER: Record<string, string> = {
  anthropic: 'sk-ant-...',
  openai: 'sk-...',
  google: 'AIza...',
  groq: 'gsk_...',
  deepseek: 'sk-...',
  openrouter: 'sk-or-...',
  togetherai: '...',
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function SettingsAiPage() {
  const router = useRouter()

  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [settingsRes, usageRes] = await Promise.all([
        fetch('/api/workspace/settings'),
        fetch('/api/workspace/usage'),
      ])
      if (settingsRes.ok) setSettings(await settingsRes.json())
      if (usageRes.ok) setUsage(await usageRes.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadAll() }, [loadAll])

  if (loading || !settings) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
      </div>
    )
  }

  const plan = settings.plan
  const isExplorer = plan === 'explorer'
  const isExecutive = plan === 'executive'

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <button
            onClick={() => router.push('/workspace/settings')}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Sliders className="w-5 h-5 text-purple-400" />
          <div className="flex-1">
            <h1 className="text-lg font-semibold">AI Intelligence</h1>
            <p className="text-xs text-gray-400">Quality settings, AI providers, and usage for this workspace</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-10">
        {/* ── Explorer: usage meter + upgrade banner only ──────────────── */}
        {isExplorer ? (
          <>
            {usage && <UsageMeters usage={usage} />}
            <UpgradeGate
              feature="AI Providers & Quality Controls"
              reason="Explorer workspaces use the platform default provider and quality settings. Upgrade to Professional to bring your own API keys and tune generation quality."
              tierRequired="professional"
              currentPlan="explorer"
              variant="banner"
            />
          </>
        ) : (
          <>
            {usage && <UsageMeters usage={usage} />}
            <QualitySection settings={settings} onSaved={loadAll} />
            <ProvidersSection />
            {isExecutive && <ExecutiveSection />}
          </>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Usage meters — shown to every tier (unchanged data source from billing page)
// ════════════════════════════════════════════════════════════════════════════

function UsageMeters({ usage }: { usage: UsageData }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
        <Cpu className="w-4 h-4 text-purple-400" /> Usage
      </h2>
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-5">
        <QuotaMeter label="Monthly generations" used={usage.generations.used} limit={usage.generations.limit} percentUsed={usage.generations.percentUsed} />
        <div className="border-t border-gray-800" />
        <QuotaMeter label="Storage used" used={parseFloat(usage.storage.usedMb.toFixed(1))} limit={usage.storage.limitMb} unit=" MB" percentUsed={usage.storage.percentUsed} />
      </div>
    </section>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Quality section — carried over from the old /workspace/settings page,
// unchanged /api/workspace/settings GET/PATCH contract.
// ════════════════════════════════════════════════════════════════════════════

function QualitySection({ settings, onSaved }: { settings: SettingsData; onSaved: () => void }) {
  const { resolved, canWriteSettings } = settings
  const [governanceThreshold, setGovernanceThreshold] = useState<string>(
    settings.overrides?.governance_score_threshold != null ? String(settings.overrides.governance_score_threshold) : ''
  )
  const [preferredProvider, setPreferredProvider] = useState<string>(settings.overrides?.preferred_provider ?? '')
  const [runtimeMode, setRuntimeMode] = useState<string>(settings.overrides?.runtime_mode ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // User-friendly labels for resolved settings
  const qualityLevelLabel: Record<string, string> = {
    cloud: 'Maximum quality (Cloud)',
    local: 'Fast (Local)',
  }
  const modelLabel: Record<string, string> = {
    anthropic: 'Claude (Anthropic)',
    openai: 'ChatGPT (OpenAI)',
    google: 'Gemini (Google)',
  }

  async function handleSave() {
    if (!canWriteSettings) return
    setSaving(true)
    setError(null)
    setSuccess(false)

    const body: Record<string, unknown> = {
      governance_score_threshold: governanceThreshold !== '' ? parseFloat(governanceThreshold) : null,
      preferred_provider: preferredProvider !== '' ? preferredProvider : null,
      runtime_mode: runtimeMode !== '' ? runtimeMode : null,
    }

    try {
      const res = await fetch('/api/workspace/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Save failed')
      }
      setSuccess(true)
      onSaved()
      setTimeout(() => setSuccess(false), 3000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
        <Sliders className="w-4 h-4 text-purple-400" /> Content Quality
      </h2>

      <p className="text-xs text-gray-500 -mt-2">
        Control how BrandOS generates and validates your content. Higher quality settings take slightly longer but produce more on-brand results.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'AI model', value: modelLabel[resolved.preferred_provider] ?? resolved.preferred_provider },
          { label: 'Quality level', value: qualityLevelLabel[resolved.runtime_mode] ?? resolved.runtime_mode },
          { label: 'Quality threshold', value: `${resolved.governance_score_threshold}% minimum score` },
        ].map(({ label, value }) => (
          <div key={label} className="px-4 py-3 rounded-lg bg-gray-900 border border-gray-800">
            <p className="text-xs text-gray-500 mb-0.5">{label}</p>
            <p className="text-sm text-gray-200">{value}</p>
          </div>
        ))}
      </div>

      <fieldset disabled={!canWriteSettings} className="space-y-4">
        <legend className="sr-only">Quality overrides</legend>

        <div className="space-y-1.5">
          <label htmlFor="threshold" className="text-sm text-gray-300">
            Quality threshold
          </label>
          <p className="text-xs text-gray-500">
            BrandOS will only deliver content that scores at or above this threshold.
            Content below it gets automatically improved and re-scored.
            Platform default is 70 — raise it for stricter brand compliance, lower it for faster output.
          </p>
          <input
            id="threshold" type="number" min={0} max={100} step={1}
            value={governanceThreshold}
            onChange={e => setGovernanceThreshold(e.target.value)}
            placeholder={`${resolved.governance_score_threshold} (current threshold)`}
            className="w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-40 disabled:cursor-not-allowed"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="provider" className="text-sm text-gray-300">
            AI model <span className="ml-2 text-xs text-gray-500">(blank = use platform default)</span>
          </label>
          <select
            id="provider" value={preferredProvider} onChange={e => setPreferredProvider(e.target.value)}
            className="w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <option value="">Use platform default</option>
            <option value="openai">ChatGPT (OpenAI)</option>
            <option value="anthropic">Claude (Anthropic)</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="mode" className="text-sm text-gray-300">
            Quality level <span className="ml-2 text-xs text-gray-500">(blank = use platform default)</span>
          </label>
          <p className="text-xs text-gray-500">
            Maximum quality uses cloud AI for the most accurate, on-brand results. Fast mode uses local processing — quicker, but may score lower.
          </p>
          <select
            id="mode" value={runtimeMode} onChange={e => setRuntimeMode(e.target.value)}
            className="w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <option value="">Use platform default</option>
            <option value="cloud">Maximum quality (Cloud)</option>
            <option value="local">Fast (Local)</option>
          </select>
        </div>
      </fieldset>

      {canWriteSettings && (
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-500 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
          {success && <span className="flex items-center gap-1.5 text-sm text-green-400"><CheckCircle className="w-4 h-4" /> Saved</span>}
          {error && <span className="flex items-center gap-1.5 text-sm text-red-400"><AlertCircle className="w-4 h-4" /> {error}</span>}
        </div>
      )}
    </section>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Providers section — carried over from the old providers/page.tsx,
// unchanged /api/workspace/providers contract. Adds primary/advanced split.
// ════════════════════════════════════════════════════════════════════════════

function ProvidersSection() {
  const [keys, setKeys] = useState<ProviderKeyRow[]>([])
  const [usage, setUsage] = useState<UsageSummary[]>([])
  const [health, setHealth] = useState<HealthRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [formProvider, setFormProvider] = useState('')
  const [formKey, setFormKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [formAction, setFormAction] = useState<'add' | 'rotate'>('add')
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formSuccess, setFormSuccess] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [provRes, usageRes] = await Promise.all([
        fetch('/api/workspace/providers'),
        fetch('/api/workspace/providers/usage'),
      ])
      if (!provRes.ok) throw new Error('Failed to load provider keys')
      if (!usageRes.ok) throw new Error('Failed to load usage data')
      const { providers } = await provRes.json()
      const { usage: u, health: h } = await usageRes.json()
      setKeys(providers ?? [])
      setUsage(u ?? [])
      setHealth(h ?? [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formProvider || !formKey) return
    setFormLoading(true)
    setFormError(null)
    setFormSuccess(null)
    try {
      const res = await fetch('/api/workspace/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: formProvider, key: formKey, action: formAction }),
      })
      const json = await res.json()
      if (!res.ok) { setFormError(json.error ?? 'Request failed'); return }
      setFormSuccess(`${PROVIDER_LABELS[formProvider] ?? formProvider} key ${formAction === 'add' ? 'added' : 'rotated'}.`)
      setFormKey('')
      setFormProvider('')
      await load()
    } catch (e: any) {
      setFormError(e.message)
    } finally {
      setFormLoading(false)
    }
  }

  async function handleRevoke(provider: string) {
    if (!confirm(`Revoke ${PROVIDER_LABELS[provider] ?? provider} key? This cannot be undone.`)) return
    setActionLoading(prev => ({ ...prev, [`revoke:${provider}`]: true }))
    try {
      const res = await fetch('/api/workspace/providers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      if (!res.ok) {
        const { error: e } = await res.json()
        alert(e ?? 'Revoke failed')
        return
      }
      await load()
    } finally {
      setActionLoading(prev => ({ ...prev, [`revoke:${provider}`]: false }))
    }
  }

  async function handleRevalidate(provider: string) {
    setActionLoading(prev => ({ ...prev, [`revalidate:${provider}`]: true }))
    try {
      const res = await fetch('/api/workspace/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, action: 'revalidate' }),
      })
      const json = await res.json()
      if (!res.ok || !json.valid) alert(`Revalidation failed: ${json.error ?? 'Key is no longer valid'}`)
      await load()
    } finally {
      setActionLoading(prev => ({ ...prev, [`revalidate:${provider}`]: false }))
    }
  }

  const healthFor = (p: string) => health.find(h => h.provider === p)
  const usageFor = (p: string) => usage.find(u => u.provider === p)
  const configuredProviders = new Set(keys.map(k => k.provider))

  const visibleProviders = showAdvanced ? ALL_PROVIDERS : PRIMARY_PROVIDERS
  const configuredKeys = keys.filter(k => visibleProviders.includes(k.provider as any))

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
        <Key className="w-4 h-4 text-purple-400" /> Providers (BYOK)
      </h2>
      <p className="text-xs text-gray-500 -mt-2">
        Bring your own API keys. Key is validated, encrypted with AES-256-GCM, then stored — the plaintext key is never saved.
      </p>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-900/30 border border-red-700/50 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 text-purple-400 animate-spin" /></div>
      ) : (
        <>
          {configuredKeys.length > 0 && (
            <div className="space-y-2">
              {configuredKeys.map(row => {
                const h = healthFor(row.provider)
                const u = usageFor(row.provider)
                const isHealthy = h?.last_failure_at == null || (h.last_success_at != null && h.last_success_at > h.last_failure_at)
                return (
                  <div key={row.id} className="rounded-xl bg-gray-900 border border-gray-800 px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-100">{PROVIDER_LABELS[row.provider] ?? row.provider}</span>
                          {row.validated_at ? (
                            <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3 h-3" /> Validated</span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-yellow-400"><AlertCircle className="w-3 h-3" /> Not validated</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5 space-x-3">
                          <span className="font-mono">···· {row.key_hint}</span>
                          {row.rotated_at && <span>Rotated {relativeTime(row.rotated_at)}</span>}
                        </div>
                      </div>
                      {u && (
                        <div className="hidden sm:flex items-center gap-1 text-xs text-gray-500 bg-gray-800/60 px-2.5 py-1 rounded-lg">
                          <Activity className="w-3 h-3" /><span>{u.request_count} calls</span>
                        </div>
                      )}
                      {h && (
                        <div title={isHealthy ? 'Healthy' : `${h.failure_count} failures`}>
                          {isHealthy ? <ShieldCheck className="w-4 h-4 text-green-400" /> : <ShieldAlert className="w-4 h-4 text-red-400" />}
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleRevalidate(row.provider)} disabled={actionLoading[`revalidate:${row.provider}`]} title="Revalidate key"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-purple-400 hover:bg-purple-400/10 transition-colors disabled:opacity-50">
                          {actionLoading[`revalidate:${row.provider}`] ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        </button>
                        <button onClick={() => { setFormProvider(row.provider); setFormAction('rotate'); setFormKey('') }} title="Rotate key"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-amber-400/10 transition-colors">
                          <Key className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleRevoke(row.provider)} disabled={actionLoading[`revoke:${row.provider}`]} title="Revoke key"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50">
                          {actionLoading[`revoke:${row.provider}`] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <button
            onClick={() => setShowAdvanced(s => !s)}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {showAdvanced ? '− Hide advanced providers' : `+ Advanced providers (${ADVANCED_PROVIDERS.length})`}
          </button>

          <form onSubmit={handleSubmit} className="space-y-4 rounded-xl bg-gray-900 border border-gray-800 p-5">
            <div className="space-y-1.5">
              <label className="text-sm text-gray-300">Provider</label>
              <select
                value={formProvider}
                onChange={e => { setFormProvider(e.target.value); setFormAction(configuredProviders.has(e.target.value) ? 'rotate' : 'add') }}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
              >
                <option value="">Select a provider…</option>
                {visibleProviders.map(p => (
                  <option key={p} value={p}>{PROVIDER_LABELS[p]}{configuredProviders.has(p) ? ' (configured — will rotate)' : ''}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-gray-300">
                API Key <span className="ml-2 text-xs text-gray-500">{formProvider ? PROVIDER_PLACEHOLDER[formProvider] : 'select a provider first'}</span>
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'} value={formKey} onChange={e => setFormKey(e.target.value)}
                  placeholder={formProvider ? PROVIDER_PLACEHOLDER[formProvider] : ''} autoComplete="off"
                  className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 pr-10 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono"
                />
                <button type="button" onClick={() => setShowKey(s => !s)} className="absolute right-2.5 top-2 text-gray-500 hover:text-gray-300 transition-colors">
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {formError && <div className="flex items-center gap-2 text-sm text-red-400"><XCircle className="w-4 h-4 shrink-0" /> {formError}</div>}
            {formSuccess && <div className="flex items-center gap-2 text-sm text-green-400"><CheckCircle className="w-4 h-4 shrink-0" /> {formSuccess}</div>}
            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={formLoading || !formProvider || !formKey}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {formLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : formAction === 'rotate' ? <RefreshCw className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {formAction === 'rotate' ? 'Rotate key' : 'Add & validate'}
              </button>
              {(formProvider || formKey) && (
                <button type="button" onClick={() => { setFormProvider(''); setFormKey(''); setFormAction('add'); setFormError(null); setFormSuccess(null) }}
                  className="text-sm text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
              )}
            </div>
          </form>
        </>
      )}
    </section>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Executive-only section — Health, Fallback ordering, Cost breakdown,
// Audit trail. NEW (didn't exist anywhere before this redesign).
// ════════════════════════════════════════════════════════════════════════════

function ExecutiveSection() {
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
        <Zap className="w-4 h-4 text-amber-400" /> Executive Controls
      </h2>

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-gray-200 mb-1">Executive workspace</p>
            <p className="text-xs text-gray-400 leading-relaxed">
              Your workspace has Executive-tier capabilities including configurable quality thresholds,
              governance audit logging, and priority provider routing. Advanced configuration controls
              are rolling out progressively — watch this space.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
