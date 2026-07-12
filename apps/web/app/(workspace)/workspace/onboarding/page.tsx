'use client'

/**
 * /workspace/onboarding — First-time user onboarding flow.
 *
 * Per Phase 1 UX Audit §6 "Onboarding Audit":
 *   Step 1 — Welcome + Product Philosophy (60 seconds)
 *   Step 2 — Package selection (Explorer / Professional / Executive)
 *   Step 3 — Brand Identity setup (3 fields → existing Profile fields)
 *   Step 4 — Create your first voice (persona creation)
 *   Step 5 — Upload brand assets (optional but recommended)
 *   Step 6 — Generate your first piece
 *
 * Implementation notes:
 *   - Steps 3 and 4 use existing /api/memory and /api/persona contracts —
 *     no new backend. Step 2 is display-only (plan is already set via
 *     workspace creation; this is an educational moment, not a billing gate).
 *   - Step 5 links to Library — asset upload already exists there.
 *   - Step 6 redirects to Create with a pre-filled topic.
 *   - There is no separate "review what was learned" step: BrandOS no
 *     longer exposes raw learning signals for review anywhere in its UI
 *     (Option B — cognition-consumer split). Learning happens automatically
 *     via CognitionProvider.observe(); IntelligenceOS owns any review of it.
 *   - finishOnboarding()/skipToWorkspace() both call the imported
 *     completeOnboarding(userId) (@brandos/auth), which sets the durable
 *     public.users.onboarding_completed_at timestamp — the single
 *     authoritative onboarding signal (see @brandos/contracts's
 *     UserLifecycleState). This replaced the old client-side localStorage
 *     flag entirely; the Home page reads useAuth().userLifecycleState.stage
 *     instead of any localStorage key.
 *   - Skipping does not require a persona to exist. See
 *     computeUserLifecycleState's 'onboarded' (field set) vs
 *     'operational' (field set AND ≥1 persona) distinction.
 *   - The onboarding page is accessible at any time (re-run it from
 *     Settings in a future iteration) so we don't hard-gate it.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, completeOnboarding } from '@brandos/auth'
import {
  Sparkles, Brain, Mic2, Upload, Wand2, ArrowRight,
  Check, Zap, Star, Crown, ChevronRight, Loader2, X,
} from 'lucide-react'

type Step = 'welcome' | 'package' | 'identity' | 'voice' | 'assets' | 'generate'

const STEPS: { id: Step; label: string }[] = [
  { id: 'welcome',  label: 'Welcome' },
  { id: 'package',  label: 'Your plan' },
  { id: 'identity', label: 'Your brand' },
  { id: 'voice',    label: 'Your voice' },
  { id: 'assets',   label: 'Assets' },
  { id: 'generate', label: 'First generation' },
]

// Package display — maps plan names to user-friendly descriptions
const PACKAGE_INFO = {
  explorer: {
    icon: Zap,
    color: 'border-blue-600 bg-blue-600/10',
    headerColor: 'text-blue-400',
    title: 'Explorer',
    tagline: 'Social posts and carousels',
    features: [
      'LinkedIn posts and carousels',
      '25 generations per month',
      'Brand signal learning',
      'Platform-default AI quality',
    ],
  },
  professional: {
    icon: Star,
    color: 'border-purple-600 bg-purple-600/10',
    headerColor: 'text-purple-400',
    title: 'Professional',
    tagline: 'Full content suite',
    features: [
      'Everything in Explorer',
      'Slide decks and research reports',
      '200 generations per month',
      'Custom quality settings and BYOK',
    ],
  },
  executive: {
    icon: Crown,
    color: 'border-amber-500 bg-amber-500/10',
    headerColor: 'text-amber-400',
    title: 'Executive',
    tagline: 'Full brand governance',
    features: [
      'Everything in Professional',
      'Team brand governance controls',
      'Configurable generation limits',
      'Governance audit trail',
    ],
  },
} as const

// ─── Component ─────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const { user, refreshUserLifecycleState } = useAuth()
  const router = useRouter()

  const [step, setStep] = React.useState<Step>('welcome')
  const [workspacePlan, setWorkspacePlan] = React.useState<string>('explorer')
  const [loadingPlan, setLoadingPlan] = React.useState(true)

  // Identity form
  const [brandName, setBrandName] = React.useState('')
  const [audience, setAudience] = React.useState('')
  const [industry, setIndustry] = React.useState('')
  const [savingIdentity, setSavingIdentity] = React.useState(false)
  const [identityError, setIdentityError] = React.useState<string | null>(null)

  // Voice form
  const [voiceName, setVoiceName] = React.useState('')
  const [voiceRole, setVoiceRole] = React.useState('')
  const [savingVoice, setSavingVoice] = React.useState(false)
  const [voiceError, setVoiceError] = React.useState<string | null>(null)
  const [voiceCreated, setVoiceCreated] = React.useState(false)

  // Load the workspace plan for the Package step
  React.useEffect(() => {
    fetch('/api/workspace')
      .then(r => r.json())
      .then(d => {
        const plan = d?.workspace?.plan ?? 'explorer'
        setWorkspacePlan(plan)
        // Pre-fill brand name from workspace name
        if (d?.workspace?.name) setBrandName(d.workspace.name)
      })
      .catch(() => {})
      .finally(() => setLoadingPlan(false))
  }, [])

  const currentStepIndex = STEPS.findIndex(s => s.id === step)

  function advance(to?: Step) {
    if (to) { setStep(to); return }
    const next = STEPS[currentStepIndex + 1]
    if (next) setStep(next.id)
  }

  async function saveIdentity() {
    setSavingIdentity(true)
    setIdentityError(null)
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: {
            type: 'profile_update',
            payload: {
              audience,
              industry,
              // Use brand name as part of positioning if they haven't set it
              positioning: brandName ? `${brandName} — a brand focused on ${industry || 'its industry'}` : '',
            },
          },
        }),
      })
      if (!res.ok) throw new Error('Failed to save')
      advance('voice')
    } catch {
      setIdentityError('Couldn\u2019t save your brand profile. Try again.')
    } finally {
      setSavingIdentity(false)
    }
  }

  async function saveVoice() {
    if (!voiceName.trim() || !voiceRole.trim()) return
    setSavingVoice(true)
    setVoiceError(null)
    try {
      const res = await fetch('/api/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          name: voiceName.trim(),
          role: voiceRole.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Failed to create voice')
      setVoiceCreated(true)
      setTimeout(() => advance('assets'), 800)
    } catch {
      setVoiceError('Couldn\u2019t create that voice. Try again.')
    } finally {
      setSavingVoice(false)
    }
  }

  async function finishOnboarding() {
    // Durable, server-side completion signal — the single authoritative
    // onboarding fact.
    if (user) {
      await completeOnboarding(user.id)
      // ONBOARDING-BOUNCE FIX: completeOnboarding() writes directly to
      // Supabase and does not go through AuthProvider, so the
      // userLifecycleState already cached in context still says
      // 'needs_onboarding' at this point. Without this explicit refresh,
      // /workspace/create's (workspace) layout gate would read that
      // stale stage and redirect straight back here. Must be awaited
      // BEFORE navigating — see AuthProvider.tsx's
      // refreshUserLifecycleState for the full rationale.
      await refreshUserLifecycleState()
    }
    router.push('/workspace/create?onboarding=1')
  }

  async function skipToWorkspace() {
    // Skip also completes onboarding — no persona is required on this
    // path. computeUserLifecycleState resolves this to 'onboarded' rather
    // than 'operational' until a persona is created, but the redirect
    // check only cares about 'needs_onboarding' vs. everything else.
    if (user) {
      await completeOnboarding(user.id)
      // Same fix as finishOnboarding() above — refresh before navigating
      // so /workspace's layout gate sees the completed stage immediately.
      await refreshUserLifecycleState()
    }
    router.push('/workspace')
  }

  const planInfo = PACKAGE_INFO[workspacePlan as keyof typeof PACKAGE_INFO] ?? PACKAGE_INFO.explorer

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Progress header */}
      <div className="border-b border-gray-800 bg-black/95 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-md flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-sm bg-gradient-to-r from-cyan-400 to-blue-600 bg-clip-text text-transparent">
              BrandOS
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {STEPS.map((s, i) => (
              <div
                key={s.id}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i < currentStepIndex
                    ? 'bg-cyan-400'
                    : i === currentStepIndex
                    ? 'bg-white'
                    : 'bg-gray-700'
                }`}
              />
            ))}
          </div>
          <button
            onClick={skipToWorkspace}
            className="text-xs text-gray-500 hover:text-gray-400 transition-colors"
          >
            Skip setup
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-12">
        {/* ── Step 1: Welcome ─────────────────────────────────────────────── */}
        {step === 'welcome' && (
          <div className="text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-8">
              <Brain className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold mb-4">
              Welcome to BrandOS
            </h1>
            <p className="text-lg text-gray-300 mb-8 leading-relaxed max-w-lg mx-auto">
              BrandOS learns your brand. Every piece of content you create teaches it your voice,
              your style, and your identity. Over time, it gets smarter — so every generation
              is more accurate, more on-brand, and more distinctively yours.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10 text-left">
              {[
                { icon: Brain, title: 'Learns your voice', body: 'Every generation teaches BrandOS your tone, vocabulary, and style.' },
                { icon: Sparkles, title: 'Gets smarter over time', body: 'The more you create, the more accurately BrandOS captures your brand\u2019s DNA.' },
                { icon: Wand2, title: 'Produces on-brand content', body: 'Your accumulated brand intelligence shapes every generation — consistently, at scale.' },
              ].map(({ icon: Icon, title, body }) => (
                <div key={title} className="p-4 rounded-xl bg-gray-900 border border-gray-800">
                  <Icon className="w-5 h-5 text-cyan-400 mb-2" />
                  <p className="text-sm font-semibold text-white mb-1">{title}</p>
                  <p className="text-xs text-gray-400 leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => advance('package')}
              className="px-8 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 rounded-xl font-semibold text-base transition-all flex items-center gap-2 mx-auto"
            >
              Start building your brand
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* ── Step 2: Package selection ────────────────────────────────────── */}
        {step === 'package' && (
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-2">Your BrandOS plan</h1>
            <p className="text-gray-400 mb-8">
              You&rsquo;re on the <strong className={`${planInfo.headerColor}`}>{planInfo.title}</strong> plan.
              Here&rsquo;s what that means for you.
            </p>

            {loadingPlan ? (
              <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : (
              <div className="space-y-3 mb-8">
                {(Object.keys(PACKAGE_INFO) as Array<keyof typeof PACKAGE_INFO>).map(planKey => {
                  const info = PACKAGE_INFO[planKey]
                  const Icon = info.icon
                  const isCurrentPlan = planKey === workspacePlan
                  return (
                    <div
                      key={planKey}
                      className={`p-5 rounded-xl border transition-colors ${
                        isCurrentPlan
                          ? info.color
                          : 'border-gray-800 bg-gray-900/40 opacity-50'
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          isCurrentPlan ? 'bg-black/30' : 'bg-gray-800'
                        }`}>
                          <Icon className={`w-5 h-5 ${isCurrentPlan ? info.headerColor : 'text-gray-600'}`} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`font-semibold ${isCurrentPlan ? 'text-white' : 'text-gray-500'}`}>
                              {info.title}
                            </span>
                            {isCurrentPlan && (
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${info.headerColor} bg-black/20`}>
                                YOUR PLAN
                              </span>
                            )}
                          </div>
                          <p className={`text-xs mb-2 ${isCurrentPlan ? 'text-gray-300' : 'text-gray-600'}`}>
                            {info.tagline}
                          </p>
                          <ul className="space-y-1">
                            {info.features.map(f => (
                              <li key={f} className={`flex items-center gap-2 text-xs ${isCurrentPlan ? 'text-gray-300' : 'text-gray-600'}`}>
                                <Check className="w-3 h-3 shrink-0" />
                                {f}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {workspacePlan === 'explorer' && (
              <p className="text-xs text-gray-500 mb-6 text-center">
                Want to upgrade? Email <a href="mailto:hello@brandos.ai" className="text-cyan-400 hover:underline">hello@brandos.ai</a> — self-serve billing coming soon.
              </p>
            )}

            <button
              onClick={() => advance('identity')}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
            >
              Got it — let&rsquo;s build my brand
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Step 3: Brand Identity ───────────────────────────────────────── */}
        {step === 'identity' && (
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-2">Tell BrandOS about your brand</h1>
            <p className="text-gray-400 mb-8">
              Three questions — that&rsquo;s all. BrandOS will learn everything else from your content.
            </p>

            <div className="space-y-5 mb-8">
              <div>
                <label className="block text-sm font-medium text-gray-200 mb-1.5">
                  What&rsquo;s your brand called?
                </label>
                <input
                  type="text"
                  value={brandName}
                  onChange={e => setBrandName(e.target.value)}
                  placeholder="e.g. Acme Corp, The Founders Journal"
                  className="w-full bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-200 mb-1.5">
                  What do you do? <span className="text-gray-500 font-normal text-xs">(your industry or domain)</span>
                </label>
                <input
                  type="text"
                  value={industry}
                  onChange={e => setIndustry(e.target.value)}
                  placeholder="e.g. B2B SaaS, Professional services, E-commerce"
                  className="w-full bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-200 mb-1.5">
                  Who do you write for? <span className="text-gray-500 font-normal text-xs">(your audience)</span>
                </label>
                <input
                  type="text"
                  value={audience}
                  onChange={e => setAudience(e.target.value)}
                  placeholder="e.g. Series A+ founders, Marketing managers at mid-market SaaS"
                  className="w-full bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 outline-none transition-colors"
                />
              </div>
            </div>

            {identityError && (
              <div className="mb-4 px-4 py-3 rounded-lg bg-red-950/40 border border-red-900 text-sm text-red-300">
                {identityError}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={saveIdentity}
                disabled={savingIdentity || !audience.trim() || !industry.trim()}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                {savingIdentity ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                {savingIdentity ? 'Saving…' : 'Continue'}
              </button>
              <button
                onClick={() => advance('voice')}
                className="px-4 py-3 text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Create your first voice ─────────────────────────────── */}
        {step === 'voice' && (
          <div>
            <div className="w-12 h-12 bg-blue-950 rounded-xl flex items-center justify-center mb-6">
              <Mic2 className="w-6 h-6 text-blue-400" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-2">Who writes for this brand?</h1>
            <p className="text-gray-400 mb-3">
              BrandOS supports multiple named voices — different personas that write in distinct styles.
              Create your first one now. You can always add more later.
            </p>
            <p className="text-xs text-gray-500 mb-8 p-3 rounded-lg bg-gray-900 border border-gray-800">
              <strong className="text-gray-400">Why does this matter?</strong>{' '}
              Every generation is written as a specific voice. When you generate content, BrandOS
              applies that voice&rsquo;s style and tone. If you write as a founder and a marketer,
              you can have both — each with their own signal profile.
            </p>

            {voiceCreated ? (
              <div className="flex items-center gap-2 py-8 justify-center text-emerald-400">
                <Check className="w-5 h-5" />
                <span className="font-medium">Voice created!</span>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-200 mb-1.5">
                      Voice name
                    </label>
                    <input
                      type="text"
                      value={voiceName}
                      onChange={e => setVoiceName(e.target.value)}
                      placeholder="e.g. Founder voice, Marketing voice"
                      className="w-full bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-200 mb-1.5">
                      Role
                    </label>
                    <input
                      type="text"
                      value={voiceRole}
                      onChange={e => setVoiceRole(e.target.value)}
                      placeholder="e.g. Founder, Head of Marketing"
                      className="w-full bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 outline-none transition-colors"
                    />
                  </div>
                </div>

                {voiceError && (
                  <div className="mb-4 px-4 py-3 rounded-lg bg-red-950/40 border border-red-900 text-sm text-red-300">
                    {voiceError}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <button
                    onClick={saveVoice}
                    disabled={savingVoice || !voiceName.trim() || !voiceRole.trim()}
                    className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    {savingVoice ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic2 className="w-4 h-4" />}
                    {savingVoice ? 'Creating…' : 'Create this voice'}
                  </button>
                  <button
                    onClick={() => advance('assets')}
                    className="px-4 py-3 text-sm text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    Skip for now
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Step 5: Upload assets ────────────────────────────────────────── */}
        {step === 'assets' && (
          <div>
            <div className="w-12 h-12 bg-purple-950 rounded-xl flex items-center justify-center mb-6">
              <Upload className="w-6 h-6 text-purple-400" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-2">Upload your brand assets</h1>
            <p className="text-gray-400 mb-3">
              This step is optional — but recommended. BrandOS analyzes your visual assets to learn
              your color palette and design personality.
            </p>
            <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 mb-8 space-y-2">
              {[
                'Your logo or brand mark — extracts your color palette',
                'A brand guideline PDF — contributes voice and positioning signals',
                'Sample content (social images, decks) — reinforces your visual style',
              ].map(item => (
                <div key={item} className="flex items-start gap-2 text-sm text-gray-300">
                  <ChevronRight className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  {item}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  // Open Library in a new tab so they don't lose their place
                  window.open('/workspace/library', '_blank')
                  advance('generate')
                }}
                className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" />
                Open Library to upload
              </button>
              <button
                onClick={() => advance('generate')}
                className="px-4 py-3 text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* ── Step 6: Generate your first piece ───────────────────────────── */}
        {step === 'generate' && (
          <div className="text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-8">
              <Wand2 className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-3">
              Your brand is ready to learn
            </h1>
            <p className="text-gray-300 mb-4 max-w-md mx-auto leading-relaxed">
              Let&rsquo;s generate your first piece of content. BrandOS will use everything you just
              set up — and pick up new signals from this generation.
            </p>
            <p className="text-sm text-gray-500 mb-10 max-w-sm mx-auto">
              After you generate, BrandOS keeps learning from what you create — shaping future
              generations automatically as your brand profile grows.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={finishOnboarding}
                className="px-8 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 rounded-xl font-semibold text-base transition-all flex items-center gap-2 justify-center"
              >
                <Wand2 className="w-5 h-5" />
                Generate my first piece
              </button>
              <button
                onClick={skipToWorkspace}
                className="px-8 py-3 border border-gray-700 hover:border-gray-600 rounded-xl font-semibold text-base transition-colors text-gray-300 hover:text-white"
              >
                Go to dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
