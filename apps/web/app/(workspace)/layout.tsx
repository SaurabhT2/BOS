'use client'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@brandos/auth'
import { Loader2 } from 'lucide-react'
import { WorkspaceNav } from '@/components/WorkspaceNav'

// The one page in this route group that UserState is allowed to redirect
// TO. Kept as a single constant so there is exactly one place that knows
// this path, rather than it being duplicated between the redirect check
// and the "don't redirect away from where we're already going" check.
const ONBOARDING_PATH = '/workspace/onboarding'

/**
 * WorkspaceLayout — the single earliest point in this route group where
 * the UserState routing decision is made.
 *
 * WHY THIS FILE, NOT THE INDIVIDUAL PAGES:
 *
 * The routing decision used to live inside workspace/page.tsx as a
 * useEffect. That guaranteed a flash: /workspace is a Client Component
 * page, so the sequence was always mount → render → commit → THEN run
 * effects → THEN redirect. React runs effects after paint, not before —
 * an effect inside the destination page can only ever discover "this was
 * the wrong page" after that page was already visible for a frame.
 * Computing UserState faster would not have fixed this: the problem was
 * never purely about compute latency, it was about which component owns
 * the decision. A decision made inside the page you might need to leave
 * cannot, by React's own execution order, run before that page renders.
 *
 * This layout wraps every page in the (workspace) route group, including
 * both /workspace and /workspace/onboarding — so it is the earliest
 * Client Component boundary above the destination pages where a
 * UserState-based decision can be made once and apply to all of them.
 * It does not compute UserState itself (that stays exactly where it was:
 * a single computation in @brandos/auth's computeUserLifecycleState,
 * exposed via AuthProvider) — it only reads the already-computed
 * userLifecycleState.stage and, until it is confident of the right
 * destination, withholds rendering `children` so neither page paints
 * first.
 *
 * NOT middleware: this is a client-side gate on an already-authenticated
 * route (proxy.ts's session check already ran before any of this
 * mounts). Middleware can't read UserState — computeUserLifecycleState
 * calls Supabase table reads through @brandos/auth's browser client, and
 * moving that into the edge middleware runtime would mean either
 * duplicating the computation there (violates "one authoritative
 * source") or making auth's session-only edge gate now also fetch
 * workspace/persona rows on every request. A layout-level client gate,
 * one level above the pages, is the smallest change that fixes the
 * flash without touching that boundary.
 *
 * WHY `stage !== null` ALONE WASN'T ENOUGH (found after shipping the
 * first version of this fix):
 *
 * `state.user` starts `null` on every mount, before the real session has
 * resolved — that's normal, `isLoading` is `true` during that window.
 * But AuthProvider's lifecycle effect is keyed on `state.user?.id`, so on
 * that very first render it fires with `userId = null`, and
 * `computeUserLifecycleState(null)` resolves to `{ stage: 'anonymous' }`
 * almost immediately — well before the real session/profile round trip
 * finishes. From this layout's point of view, `'anonymous'` is a
 * perfectly non-null, "resolved-looking" stage, so the old
 * `stage !== null` check let `showChildren` flip true during that
 * window — mounting /workspace (and its own data-fetching effects)
 * while the REAL user was still being authenticated. Once the real user
 * resolved, `setUser()` reset `userLifecycleState` back to `null` and
 * this layout correctly unmounted `children` again, but the dashboard
 * had already rendered — and fired its `load()` effect — for that
 * window. That's the frame the user was still seeing.
 *
 * Fix: a route inside (workspace) can only be reached with a real
 * session (proxy.ts already guarantees that), so `'anonymous'` here
 * never means "this user is genuinely logged out" — it only ever means
 * "the real session hasn't resolved yet." Treat it exactly like
 * `stage === null`: still resolving, withhold children. Also gate on
 * `isLoading` directly, rather than relying on `stage` alone to imply
 * it — `isLoading` is the more direct signal for "auth itself hasn't
 * finished," and checking it explicitly means this gate doesn't depend
 * on a coincidental relationship between two different pieces of state.
 */
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { isLoading, userLifecycleState } = useAuth()
  const pathname = usePathname()
  const router = useRouter()

  const stage = userLifecycleState?.stage ?? null

  // Neither the real user's identity nor their lifecycle stage is known
  // for certain yet. `'anonymous'` is included deliberately — see the
  // header comment above; within this route group it can only mean
  // "not resolved yet," never "actually logged out."
  const identityUnresolved = isLoading || stage === null || stage === 'anonymous'

  const onOnboardingPath = pathname === ONBOARDING_PATH
  const needsOnboarding = stage === 'needs_onboarding'
  const mustRedirectToOnboarding = needsOnboarding && !onOnboardingPath

  React.useEffect(() => {
    if (mustRedirectToOnboarding) {
      router.replace(ONBOARDING_PATH)
    }
  }, [mustRedirectToOnboarding, router])

  // Withhold `children` — i.e. withhold both /workspace and
  // /workspace/onboarding's own content — until:
  //   1. identity + lifecycle are both genuinely resolved (not loading,
  //      not null, not the transient 'anonymous' pre-session value), AND
  //   2. we're not mid-redirect to onboarding.
  //
  // Every other resolved stage (profile_pending, workspace_initializing,
  // *_failed, onboarded, operational, etc.) renders `children` normally
  // once identity has resolved — this layout only ever makes the one
  // needs_onboarding routing decision; it does not attempt to gate on,
  // or re-derive, any other stage.
  const showChildren = !identityUnresolved && !mustRedirectToOnboarding

  // Phase 1 — Navigation Shell: WorkspaceNav renders the persistent five-item
  // nav (Home · Create · Brand · Library · Settings) above every page in this
  // route group. Same shell for every tier — see WorkspaceNav.tsx for the
  // no-fork-by-plan rationale. Individual pages should no longer render their
  // own top header/back-button (Phase 1 step 5 strips those).
  return (
    <>
      <WorkspaceNav />
      {showChildren ? children : <WorkspaceResolvingPlaceholder />}
    </>
  )
}

// Minimal, unobtrusive placeholder shown only while identity/lifecycle is
// still resolving (typically well under a second; bounded by
// INIT_TIMEOUT_MS in AuthProvider on the slow end). Deliberately not a
// full skeleton/redesign of either destination page — just enough that
// the withheld-content window doesn't read as a blank/broken page.
function WorkspaceResolvingPlaceholder() {
  return (
    <div className="flex items-center justify-center py-24 text-white/40">
      <Loader2 className="w-5 h-5 animate-spin" />
    </div>
  )
}

