'use client'

/**
 * SkillShell — universal wrapper for any skill invocation output.
 *
 * Handles four states:
 *   idle       — nothing generated yet
 *   loading    — generation in progress
 *   error      — generation failed (with retry)
 *   result     — output rendered via children
 *
 * All future skills (carousel, post, email, SEO, image) render inside this shell.
 * No skill should own its own loading/error/fallback JSX.
 */

import { Loader, AlertTriangle, RefreshCw, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'

export type SkillStatus = 'idle' | 'loading' | 'error' | 'result'

/** Inline definition — UnavailableAction was removed from @brandos/contracts in L5. */
interface UnavailableAction { action: string; label: string }

interface SkillShellProps {
  /** Current state of this skill slot */
  status: SkillStatus
  /** Skill human name shown in header */
  skillName: string
  /** Icon element for the skill (e.g., <LayoutGrid className="w-4 h-4" />) */
  skillIcon?: ReactNode
  /** Engine attribution badge shown when result is ready */
  engineBadge?: string
  /** Quality score 0–100 shown when result is ready */
  qualityScore?: number
  /** Error message shown in error state */
  errorMessage?: string
  /** Structured unavailable block (no engine available) */
  unavailable?: { message: string; actions: UnavailableAction[] }
  /** Called when user clicks retry */
  onRetry?: () => void
  /** Called when user clicks an unavailable action button */
  onUnavailableAction?: (action: string) => void
  /** Result content — rendered only in 'result' state */
  children?: ReactNode
  /** Whether to show the result panel at all (can hide while keeping status running) */
  hidePanel?: boolean
}

export default function SkillShell({
  status,
  skillName,
  skillIcon,
  engineBadge,
  qualityScore,
  errorMessage,
  unavailable,
  onRetry,
  onUnavailableAction,
  children,
  hidePanel = false,
}: SkillShellProps) {
  if (status === 'idle') return null
  if (hidePanel) return null

  // ── Loading ───────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-8 flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-600/20 flex items-center justify-center">
          <Loader className="w-6 h-6 text-cyan-400 animate-spin" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-white">{skillName}</p>
          <p className="text-xs text-gray-500 mt-1">Generating…</p>
        </div>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (status === 'error') {
    // Structured unavailable (no engine) — different from runtime error
    if (unavailable) {
      return (
        <div className="rounded-2xl border border-amber-800/50 bg-amber-950/20 p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-300">No generation engine available</p>
              <p className="text-xs text-amber-400/70 mt-1 whitespace-pre-line leading-relaxed">
                {unavailable.message}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {unavailable.actions.map((a) => (
              <button
                key={a.action}
                onClick={() => onUnavailableAction?.(a.action)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-700/50 transition-colors"
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )
    }

    return (
      <div className="rounded-2xl border border-red-900/40 bg-red-950/20 p-6 flex items-start gap-4">
        <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-red-300">Generation failed</p>
          {errorMessage && (
            <p className="text-xs text-red-400/70 mt-1">{errorMessage}</p>
          )}
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-800/50 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        )}
      </div>
    )
  }

  // ── Result ────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden">
      {/* Result header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          {skillIcon && <span className="text-cyan-400">{skillIcon}</span>}
          <span className="text-sm font-semibold text-white">{skillName}</span>
          {qualityScore !== undefined && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                qualityScore >= 80
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : qualityScore >= 60
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-red-500/20 text-red-400'
              }`}
            >
              QA {qualityScore}
            </span>
          )}
        </div>
        {engineBadge && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Sparkles className="w-3 h-3" />
            {engineBadge}
          </div>
        )}
      </div>

      {/* Skill-specific output */}
      <div className="p-5">{children}</div>
    </div>
  )
}


