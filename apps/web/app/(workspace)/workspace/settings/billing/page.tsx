'use client'

/**
 * /workspace/settings/billing — Usage & Plan
 *
 * P2: Displays current usage against tier limits via quota meters.
 * Shows which artifact types are unlocked, capability flags, and
 * an upgrade CTA (email-based, no billing integration).
 *
 * NO Stripe. NO payment processing. NO subscription management.
 */

import * as React from 'react'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Loader2, Zap, CheckCircle, XCircle,
  BarChart2, HardDrive, Upload, Cpu, RefreshCw,
} from 'lucide-react'
import { QuotaMeter, UpgradeGate } from '../upgrade-gate'

// ─── Types ────────────────────────────────────────────────────────────────────

interface UsageData {
  plan: string
  generations: { used: number; limit: number | null; percentUsed: number | null }
  storage:     { usedMb: number; limitMb: number | null; percentUsed: number | null }
  uploads:     { used: number;   limit: number | null; percentUsed: number | null }
  capabilities: {
    canWriteSettings:      boolean
    canOverrideGovernance: boolean
    allowedArtifactTypes:  string[]
    repairAttempts:        number
    richnessRetryEnabled:  boolean
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_ARTIFACT_TYPES = ['carousel', 'post', 'deck', 'report'] as const

const ARTIFACT_LABELS: Record<string, string> = {
  carousel: 'Carousel',
  post:     'Post / Article',
  deck:     'Deck (Slides)',
  report:   'Report',
}

const PLAN_LABELS: Record<string, string> = {
  explorer:     'Explorer',
  professional: 'Professional',
  executive:    'Executive',
}

const PLAN_COLORS: Record<string, string> = {
  explorer:     'text-gray-300 border-gray-600 bg-gray-800/50',
  professional: 'text-purple-300 border-purple-500/40 bg-purple-500/10',
  executive:    'text-amber-300 border-amber-500/40 bg-amber-500/10',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UsageBillingPage() {
  const router = useRouter()
  const [data,    setData]    = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => { fetchUsage() }, [])

  async function fetchUsage() {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/workspace/usage')
      if (!res.ok) throw new Error('Failed to load usage data')
      setData(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-red-400">{error ?? 'Failed to load usage.'}</p>
      </div>
    )
  }

  const { plan: planRaw, generations, storage, uploads, capabilities } = data
  const plan: string = planRaw          // keep as string — avoids TS narrowing issues in upgrade cards
  const isExplorer = plan === 'explorer'
  const needsUpgrade = isExplorer || plan === 'professional'

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <button
            onClick={() => router.push('/workspace/settings')}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <BarChart2 className="w-5 h-5 text-purple-400" />
          <div className="flex-1">
            <h1 className="text-lg font-semibold">Usage &amp; Plan</h1>
            <p className="text-xs text-gray-400">Monthly quotas and capabilities</p>
          </div>
          <button
            onClick={fetchUsage}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">

        {/* Current Plan */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Current Plan</h2>
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold ${PLAN_COLORS[plan] ?? PLAN_COLORS.explorer}`}>
            <Zap className="w-4 h-4" />
            {PLAN_LABELS[plan] ?? plan}
          </div>
          {needsUpgrade && (
            <p className="text-xs text-gray-500">
              Want more? {' '}
              <a
                href="mailto:hello@brandos.ai?subject=Upgrade+Inquiry"
                className="text-purple-400 hover:text-purple-300 underline"
              >
                Talk to us about upgrading
              </a>
              .
            </p>
          )}
        </section>

        {/* Usage Meters */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">This Month's Usage</h2>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-5">

            <div className="flex items-center gap-2 mb-1">
              <Cpu className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-medium">Generations</span>
            </div>
            <QuotaMeter
              label="Monthly generations"
              used={generations.used}
              limit={generations.limit}
              percentUsed={generations.percentUsed}
            />

            <div className="border-t border-gray-800" />

            <div className="flex items-center gap-2 mb-1">
              <HardDrive className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-medium">Asset Storage</span>
            </div>
            <QuotaMeter
              label="Storage used"
              used={parseFloat(storage.usedMb.toFixed(1))}
              limit={storage.limitMb}
              unit=" MB"
              percentUsed={storage.percentUsed}
            />

            <div className="border-t border-gray-800" />

            <div className="flex items-center gap-2 mb-1">
              <Upload className="w-4 h-4 text-green-400" />
              <span className="text-sm font-medium">Asset Uploads</span>
            </div>
            <QuotaMeter
              label="Uploads this month"
              used={uploads.used}
              limit={uploads.limit}
              percentUsed={uploads.percentUsed}
            />
          </div>
        </section>

        {/* Capabilities */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Capabilities</h2>
          <div className="rounded-xl border border-gray-800 bg-gray-900 divide-y divide-gray-800">

            {/* Artifact types */}
            <div className="p-4 space-y-3">
              <p className="text-sm font-medium text-gray-300">Artifact Types</p>
              <div className="grid grid-cols-2 gap-2">
                {ALL_ARTIFACT_TYPES.map(type => {
                  const allowed = capabilities.allowedArtifactTypes.includes(type)
                  return (
                    <div
                      key={type}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                        allowed
                          ? 'bg-green-500/5 border border-green-500/20 text-green-300'
                          : 'bg-gray-800/50 border border-gray-700/40 text-gray-500'
                      }`}
                    >
                      {allowed
                        ? <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
                        : <XCircle    className="w-3.5 h-3.5 text-gray-600 shrink-0" />}
                      {ARTIFACT_LABELS[type]}
                    </div>
                  )
                })}
              </div>

              {/* Deck/Report gate for Explorer */}
              {isExplorer && (
                <UpgradeGate
                  feature="Deck & Report generation"
                  tierRequired="professional"
                  currentPlan="explorer"
                  variant="banner"
                  className="mt-2"
                />
              )}
            </div>

            {/* Other capabilities */}
            {[
              {
                label:   'Workspace Settings Overrides',
                enabled: capabilities.canWriteSettings,
                detail:  'Customise governance threshold, provider, and runtime mode.',
              },
              {
                label:   'Governance Override',
                enabled: capabilities.canOverrideGovernance,
                detail:  'Set custom governance score thresholds per workspace.',
              },
              {
                label:   `Governance Repair Attempts`,
                enabled: true,
                detail:  `${capabilities.repairAttempts} attempt${capabilities.repairAttempts !== 1 ? 's' : ''} per artifact.`,
              },
              {
                label:   'Richness Retry',
                enabled: capabilities.richnessRetryEnabled,
                detail:  'Re-generate automatically if richness score is below threshold.',
              },
            ].map(({ label, enabled, detail }) => (
              <div key={label} className="flex items-start justify-between gap-4 px-4 py-3">
                <div>
                  <p className="text-sm text-gray-300">{label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{detail}</p>
                </div>
                {enabled
                  ? <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                  : <XCircle    className="w-4 h-4 text-gray-600 mt-0.5 shrink-0" />}
              </div>
            ))}
          </div>
        </section>

        {/* P2.19 — Plan comparison. Shown for all plans — upgraders see CTAs,
            current-plan users see their card highlighted. The `plan` variable
            is typed as `string` so all equality checks are valid. */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            {needsUpgrade ? 'Upgrade your plan' : 'Your plan'}
          </h2>

          {/* Plan comparison cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Professional */}
            <div className={`rounded-xl border p-5 space-y-4 ${plan === 'professional' ? 'border-purple-500/50 bg-purple-500/10 ring-1 ring-purple-500/30' : 'border-gray-800 bg-gray-900'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-purple-300">Professional</p>
                  <p className="text-xs text-gray-500 mt-0.5">For growing brands</p>
                </div>
                {plan === 'professional' && <span className="text-xs text-purple-400 bg-purple-500/20 px-2 py-0.5 rounded-full border border-purple-500/30">Current plan</span>}
              </div>
              <ul className="space-y-2">
                {[
                  '200 generations / month',
                  'All formats: Carousel, Post, Deck, Report',
                  '2 GB asset storage',
                  '100 asset uploads',
                  'Workspace settings overrides',
                  'Quality threshold control',
                ].map(f => (
                  <li key={f} className="flex items-start gap-2 text-xs text-gray-300">
                    <CheckCircle className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              {isExplorer && (
                <a
                  href="mailto:hello@brandos.ai?subject=Upgrade+to+Professional"
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg text-sm font-semibold bg-purple-600 hover:bg-purple-500 text-white transition-colors"
                >
                  <Zap className="w-4 h-4" />
                  Upgrade to Professional
                </a>
              )}
            </div>

            {/* Executive */}
            <div className={`rounded-xl border p-5 space-y-4 ${plan === 'executive' ? 'border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/30' : 'border-gray-800 bg-gray-900'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-amber-300">Executive</p>
                  <p className="text-xs text-gray-500 mt-0.5">For established brands</p>
                </div>
                {plan === 'executive' && <span className="text-xs text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded-full border border-amber-500/30">Current plan</span>}
              </div>
              <ul className="space-y-2">
                {[
                  'Everything in Professional',
                  'Configurable generation limits',
                  'Unlimited asset uploads',
                  'Unlimited storage',
                  'Governance audit trail',
                  'Dedicated support',
                ].map(f => (
                  <li key={f} className="flex items-start gap-2 text-xs text-gray-300">
                    <CheckCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              {plan !== 'executive' && (
                <a
                  href="mailto:hello@brandos.ai?subject=Upgrade+to+Executive"
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg text-sm font-semibold bg-amber-600 hover:bg-amber-500 text-white transition-colors"
                >
                  <Zap className="w-4 h-4" />
                  Upgrade to Executive
                </a>
              )}
            </div>
          </div>

          <p className="text-xs text-gray-600 text-center">
            No payment portal yet — upgrades are handled manually.{' '}
            <a href="mailto:hello@brandos.ai" className="text-gray-500 hover:text-gray-400 underline">Email us</a>
            {' '}and we'll get you sorted within one business day.
          </p>
        </section>

      </div>
    </div>
  )
}
