'use client'

/**
 * Landing page — P3.26 rewrite.
 *
 * Messaging updated to reflect the actual product:
 *   - Not "AI Growth OS" — BrandOS builds a brand intelligence layer that
 *     makes every generation more on-brand over time.
 *   - The core value prop is learning, not speed: "Your AI learns your brand."
 *   - Secondary prop: quality governance (every generation is scored + repaired).
 *   - Tertiary: multi-format from one brief.
 *
 * No layout changes to auth flow, redirect logic, or auth provider.
 */

import { useEffect } from 'react'
import { useAuth } from '@brandos/auth'
import { useRouter } from 'next/navigation'
import {
  Brain, Sparkles, ArrowRight, Check,
  LayoutGrid, FileText, Presentation, BookOpen,
  TrendingUp, ShieldCheck, Zap,
} from 'lucide-react'

export default function LandingPage() {
  const { user, isLoading, loginWithGoogle } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && user) router.push('/workspace')
  }, [user, isLoading, router])

  if (isLoading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (user) return null

  const handleSignIn = () => loginWithGoogle()

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Nav */}
      <nav className="border-b border-gray-900 bg-black/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-lg flex items-center justify-center">
              <Brain className="w-4.5 h-4.5 text-white" style={{ width: '18px', height: '18px' }} />
            </div>
            <span className="text-lg font-bold tracking-tight">BrandOS</span>
          </div>
          <button
            onClick={handleSignIn}
            className="px-5 py-2 text-sm font-semibold bg-white text-black hover:bg-gray-100 rounded-lg transition-colors"
          >
            Sign in
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/20 rounded-full mb-8">
          <Brain className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs font-medium text-cyan-400 tracking-wide">Brand Intelligence Platform</span>
        </div>

        <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold mb-6 leading-[1.05] tracking-tight">
          Your AI learns<br />
          <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            your brand.
          </span>
        </h1>

        <p className="text-lg sm:text-xl text-gray-400 mb-4 max-w-xl mx-auto leading-relaxed">
          BrandOS builds a living intelligence layer from your content — and uses it to generate on-brand work that gets better with every piece you create.
        </p>

        <p className="text-sm text-gray-600 mb-10 max-w-md mx-auto">
          Unlike generic AI tools, BrandOS actually learns your tone, your audience, and your visual identity. The more you use it, the more distinctly yours every output becomes.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
          <button
            onClick={handleSignIn}
            className="px-7 py-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 rounded-lg font-semibold text-base transition-all hover:scale-[1.02] flex items-center gap-2 shadow-lg shadow-cyan-500/20"
          >
            Start free
            <ArrowRight className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-600">No credit card · Explorer plan is always free</span>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-gray-900 max-w-6xl mx-auto px-6 py-20">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-widest text-center mb-12">How it works</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              step: '01',
              title: 'BrandOS learns your brand',
              body: 'Upload brand assets, generate content, approve what resonates. BrandOS extracts signals — tone, style, audience — and builds a living profile that improves with every interaction.',
              icon: Brain,
              color: 'text-cyan-400',
            },
            {
              step: '02',
              title: 'Every generation uses that intelligence',
              body: 'Your Brand Pulse score — a live measure of how well-defined your brand is — drives every generation. The higher it is, the more distinctly on-brand each output becomes.',
              icon: TrendingUp,
              color: 'text-blue-400',
            },
            {
              step: '03',
              title: 'Quality governance catches everything',
              body: "Every generation is scored against your brand standards. Anything that doesn't pass is automatically repaired before you see it. You only get your best work.",
              icon: ShieldCheck,
              color: 'text-purple-400',
            },
          ].map(({ step, title, body, icon: Icon, color }) => (
            <div key={step} className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-gray-700 tabular-nums">{step}</span>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <h3 className="text-base font-semibold text-gray-100">{title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* What you get */}
      <section className="border-t border-gray-900 max-w-6xl mx-auto px-6 py-20">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-widest text-center mb-3">What you get</p>
        <h2 className="text-3xl font-bold text-center mb-12">One brief. Four formats.</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl mx-auto mb-12">
          {[
            { label: 'LinkedIn Carousel',  icon: LayoutGrid,   color: 'text-cyan-400 bg-cyan-950'   },
            { label: 'Post / Article',     icon: FileText,     color: 'text-blue-400 bg-blue-950'   },
            { label: 'Slide Deck',         icon: Presentation, color: 'text-purple-400 bg-purple-950' },
            { label: 'Report',             icon: BookOpen,     color: 'text-amber-400 bg-amber-950' },
          ].map(({ label, icon: Icon, color }) => (
            <div key={label} className={`rounded-xl border border-gray-800 p-4 flex flex-col items-center gap-2 text-center`}>
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color.split(' ')[1]}`}>
                <Icon className={`w-4 h-4 ${color.split(' ')[0]}`} />
              </div>
              <p className="text-xs font-medium text-gray-300">{label}</p>
            </div>
          ))}
        </div>

        {/* Feature list */}
        <div className="max-w-lg mx-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            'Brand signal extraction from every generation',
            'Living Brand Pulse score',
            'Automatic quality repair loop',
            'Named brand voices / personas',
            'Visual identity learning from assets',
            'Campaign grouping across formats',
            'Export to PDF, PPTX, Canva, Figma',
            'Signal timeline and learning queue',
          ].map(f => (
            <div key={f} className="flex items-center gap-2 text-xs text-gray-400">
              <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              {f}
            </div>
          ))}
        </div>
      </section>

      {/* Plans */}
      <section className="border-t border-gray-900 max-w-6xl mx-auto px-6 py-20">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-widest text-center mb-12">Plans</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
          {[
            {
              name: 'Explorer',
              price: 'Free',
              color: 'border-gray-800',
              badge: null,
              features: ['50 generations / month', 'Carousel + Post formats', '500 MB storage', '20 uploads', 'Brand signal learning'],
              cta: 'Start free',
              ctaStyle: 'bg-gray-800 hover:bg-gray-700 text-white',
            },
            {
              name: 'Professional',
              price: 'Contact us',
              color: 'border-purple-500/40 ring-1 ring-purple-500/20',
              badge: 'Most popular',
              features: ['200 generations / month', 'All 4 formats', '2 GB storage', '100 uploads', 'Workspace settings control'],
              cta: 'Get Professional',
              ctaStyle: 'bg-purple-600 hover:bg-purple-500 text-white',
              href: 'mailto:hello@brandos.ai?subject=Professional+Plan',
            },
            {
              name: 'Executive',
              price: 'Contact us',
              color: 'border-amber-500/20',
              badge: null,
              features: ['Configurable limits', 'Unlimited storage', 'Governance audit trail', 'Dedicated support', 'Custom onboarding'],
              cta: 'Get Executive',
              ctaStyle: 'bg-amber-700 hover:bg-amber-600 text-white',
              href: 'mailto:hello@brandos.ai?subject=Executive+Plan',
            },
          ].map(plan => (
            <div key={plan.name} className={`rounded-xl border ${plan.color} bg-gray-950 p-6 space-y-4`}>
              <div>
                {plan.badge && (
                  <span className="text-xs font-semibold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full mb-2 inline-block">
                    {plan.badge}
                  </span>
                )}
                <p className="text-base font-bold text-gray-100">{plan.name}</p>
                <p className="text-sm text-gray-500 mt-0.5">{plan.price}</p>
              </div>
              <ul className="space-y-1.5">
                {plan.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-xs text-gray-400">
                    <Check className="w-3 h-3 text-gray-600 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              {plan.href ? (
                <a href={plan.href} className={`flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${plan.ctaStyle}`}>
                  <Zap className="w-3.5 h-3.5" />
                  {plan.cta}
                </a>
              ) : (
                <button onClick={handleSignIn} className={`flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${plan.ctaStyle}`}>
                  <Sparkles className="w-3.5 h-3.5" />
                  {plan.cta}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-gray-900 max-w-6xl mx-auto px-6 py-20 text-center">
        <h2 className="text-3xl font-bold mb-4">The more you use it, the smarter it gets.</h2>
        <p className="text-gray-500 mb-8 max-w-md mx-auto text-sm leading-relaxed">
          BrandOS isn't a prompt wrapper. It's a brand intelligence layer that accumulates knowledge about your brand and puts it to work in every generation.
        </p>
        <button
          onClick={handleSignIn}
          className="px-7 py-3.5 bg-white text-black hover:bg-gray-100 rounded-lg font-semibold text-sm transition-colors inline-flex items-center gap-2"
        >
          Start building your brand intelligence
          <ArrowRight className="w-4 h-4" />
        </button>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-900 py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between text-xs text-gray-700">
          <span>© 2026 BrandOS</span>
          <a href="mailto:hello@brandos.ai" className="hover:text-gray-500 transition-colors">hello@brandos.ai</a>
        </div>
      </footer>
    </div>
  )
}
