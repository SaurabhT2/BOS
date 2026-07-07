// ============================================================
// packages/presentation-layer/src/components/RecoveryBanner.tsx
//
// P3-RECOVERY: RecoveryBanner
//
// Displays a non-blocking warning when a generated artifact was returned
// in a degraded state — i.e., governance validation failed after all repair
// attempts but a partial artifact was recovered and rendered.
//
// DESIGN PRINCIPLES:
//   • Must never crash the renderer that wraps it.
//   • Pure presentational — no network calls, no state side effects.
//   • Dismissable by the user (session-local, not persisted).
//   • Accessible: role="alert", aria-live="polite".
//   • Co-located with renderers — renders inside the artifact workspace,
//     not as a modal that blocks the content.
//
// USAGE:
//   Present whenever the API response carries recoverable_issues: true.
//   Pass recoverable_reason for the detail message (optional).
//
//   ```tsx
//   {result.recoverable_issues && (
//     <RecoveryBanner reason={result.recoverable_reason} />
//   )}
//   <CarouselRenderer artifact={result.artifact} />
//   ```
//
// NEVER show this banner on clean (non-degraded) artifacts.
// NEVER suppress this banner — the user must always know when
//   they are viewing unvalidated output.
// ============================================================

'use client'

import { useState } from 'react'

export interface RecoveryBannerProps {
  /**
   * Human-readable reason the governance check failed.
   * Rendered as detail text inside the banner.
   * If omitted, a generic message is shown.
   */
  reason?: string | undefined

  /**
   * Optional CSS class override for the banner container.
   * Defaults to the built-in amber warning style.
   */
  className?: string | undefined
}

/**
 * RecoveryBanner — non-blocking warning for degraded artifacts.
 *
 * Renders an amber banner above the artifact indicating that governance
 * validation partially failed but the artifact was recovered. Dismissable.
 *
 * @see P3-RECOVERY in artifact-pipeline.ts and generate route
 */
export function RecoveryBanner({ reason, className }: RecoveryBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  return (
    <div
      role="alert"
      aria-live="polite"
      className={
        className ??
        'flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm'
      }
    >
      {/* Warning icon */}
      <span className="mt-0.5 flex-shrink-0 text-amber-500" aria-hidden="true">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-5 w-5"
        >
          <path
            fillRule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
      </span>

      {/* Message */}
      <div className="flex-1">
        <p className="font-medium leading-snug">
          Generated with recoverable issues
        </p>
        {reason ? (
          <p className="mt-1 text-xs text-amber-700 leading-relaxed">
            {reason}
          </p>
        ) : (
          <p className="mt-1 text-xs text-amber-700 leading-relaxed">
            This content was generated but did not fully pass quality validation.
            It may contain minor formatting or completeness issues.
          </p>
        )}
      </div>

      {/* Dismiss button */}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss warning"
        className="flex-shrink-0 rounded p-0.5 text-amber-500 hover:bg-amber-100 hover:text-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4"
        >
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
      </button>
    </div>
  )
}

export default RecoveryBanner
