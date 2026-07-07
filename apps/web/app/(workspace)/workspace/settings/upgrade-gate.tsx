'use client'

/**
 * UpgradeGate — locked-state overlay component for P2 tier gating.
 *
 * Usage patterns:
 *   1. Wrap a feature section: shows a blurred/locked overlay with CTA.
 *   2. Render standalone inside an empty state when a quota is hit.
 *
 * Never implements billing. Never navigates to payment flows.
 * Shows upgrade messaging only.
 */

import * as React from 'react'
import { Lock, Zap, ArrowRight, TrendingUp } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkspacePlan = 'explorer' | 'professional' | 'executive'

export interface TierGateProps {
  /** The feature or artifact type that is locked */
  feature: string
  /** Human-readable explanation of why it is locked */
  reason?: string
  /** The plan required to unlock this feature */
  tierRequired?: WorkspacePlan
  /** The workspace's current plan */
  currentPlan?: WorkspacePlan
  /** Upgrade CTA text */
  upgradeCta?: string
  /** Whether to render as a full overlay (wraps children) or standalone block */
  variant?: 'overlay' | 'banner' | 'card'
  /** Children to blur/dim when variant='overlay' */
  children?: React.ReactNode
  className?: string
}

// ─── Plan Labels ──────────────────────────────────────────────────────────────

const PLAN_LABELS: Record<WorkspacePlan, string> = {
  explorer:     'Explorer',
  professional: 'Professional',
  executive:    'Executive',
}

const PLAN_COLORS: Record<WorkspacePlan, string> = {
  explorer:     'text-gray-400',
  professional: 'text-purple-400',
  executive:    'text-amber-400',
}

// ─── Upgrade Gate ─────────────────────────────────────────────────────────────

export function UpgradeGate({
  feature,
  reason,
  tierRequired = 'professional',
  currentPlan  = 'explorer',
  upgradeCta,
  variant      = 'card',
  children,
  className    = '',
}: TierGateProps) {
  const cta = upgradeCta ?? `Upgrade to ${PLAN_LABELS[tierRequired]} to unlock ${feature}.`

  if (variant === 'overlay') {
    return (
      <div className={`relative ${className}`}>
        {/* Blurred content */}
        <div className="pointer-events-none select-none blur-[2px] opacity-40">
          {children}
        </div>
        {/* Lock overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950/60 rounded-lg">
          <GateCard
            feature={feature}
            reason={reason}
            tierRequired={tierRequired}
            currentPlan={currentPlan}
            cta={cta}
            compact
          />
        </div>
      </div>
    )
  }

  if (variant === 'banner') {
    return (
      <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/5 ${className}`}>
        <Lock className="w-4 h-4 text-amber-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm text-gray-300">{reason ?? `${feature} is available on ${PLAN_LABELS[tierRequired]}.`}</span>
        </div>
        <span className={`text-xs font-medium shrink-0 ${PLAN_COLORS[tierRequired]}`}>
          {PLAN_LABELS[tierRequired]}+
        </span>
      </div>
    )
  }

  // default: card
  return (
    <GateCard
      feature={feature}
      reason={reason}
      tierRequired={tierRequired}
      currentPlan={currentPlan}
      cta={cta}
      className={className}
    />
  )
}

// ─── Gate Card (internal) ─────────────────────────────────────────────────────

function GateCard({
  feature,
  reason,
  tierRequired,
  currentPlan,
  cta,
  compact   = false,
  className = '',
}: {
  feature:      string
  reason?:      string
  tierRequired: WorkspacePlan
  currentPlan:  WorkspacePlan
  cta:          string
  compact?:     boolean
  className?:   string
}) {
  return (
    <div className={`
      flex flex-col items-center text-center gap-3 rounded-xl border border-gray-700/60
      bg-gray-900/80 backdrop-blur-sm
      ${compact ? 'p-4 max-w-xs' : 'p-8 max-w-md mx-auto'}
      ${className}
    `}>
      {/* Icon */}
      <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
        <Lock className="w-5 h-5 text-amber-400" />
      </div>

      {/* Feature name */}
      <div>
        <p className="text-sm font-semibold text-white">{feature}</p>
        {reason && !compact && (
          <p className="mt-1 text-xs text-gray-400 leading-relaxed">{reason}</p>
        )}
      </div>

      {/* Plan badge */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500">Requires</span>
        <span className={`text-xs font-semibold ${PLAN_COLORS[tierRequired]}`}>
          {PLAN_LABELS[tierRequired]}
        </span>
        <TrendingUp className={`w-3 h-3 ${PLAN_COLORS[tierRequired]}`} />
      </div>

      {/* CTA */}
      {!compact && (
        <p className="text-xs text-gray-400">{cta}</p>
      )}

      {/* Contact prompt — no billing integration in P2 */}
      {!compact && (
        <a
          href="mailto:hello@brandos.ai?subject=Upgrade+Inquiry"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600/20 border border-purple-500/30 text-purple-300 hover:bg-purple-600/30 transition-colors"
        >
          <Zap className="w-3 h-3" />
          Talk to us about upgrading
          <ArrowRight className="w-3 h-3" />
        </a>
      )}
    </div>
  )
}

// ─── Quota Meter ──────────────────────────────────────────────────────────────

export interface QuotaMeterProps {
  label:      string
  used:       number
  limit:      number | null
  unit?:      string
  /** 0-100, computed by server */
  percentUsed?: number | null
  warnAt?:    number  // % threshold for warning colour (default 80)
  className?: string
}

export function QuotaMeter({
  label,
  used,
  limit,
  unit        = '',
  percentUsed,
  warnAt      = 80,
  className   = '',
}: QuotaMeterProps) {
  const pct = percentUsed ?? (limit ? Math.min(Math.round((used / limit) * 100), 100) : null)

  const barColor =
    pct === null     ? 'bg-gray-600' :
    pct >= 100       ? 'bg-red-500' :
    pct >= warnAt    ? 'bg-amber-500' :
                       'bg-purple-500'

  const textColor =
    pct === null     ? 'text-gray-400' :
    pct >= 100       ? 'text-red-400' :
    pct >= warnAt    ? 'text-amber-400' :
                       'text-gray-400'

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-300">{label}</span>
        <span className={`text-xs font-mono ${textColor}`}>
          {limit === null
            ? `${used}${unit} / ∞`
            : `${used}${unit} / ${limit}${unit}`}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-800">
        {pct !== null && (
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        )}
      </div>
      {pct !== null && pct >= 100 && (
        <p className="text-xs text-red-400">Limit reached. Resets on the 1st of next month.</p>
      )}
    </div>
  )
}
