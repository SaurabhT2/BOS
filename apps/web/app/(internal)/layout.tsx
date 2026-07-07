/**
 * apps/web/app/(internal)/layout.tsx
 *
 * Phase 7 — Internal Route Isolation.
 *
 * Per brandos_redesign_strategic_completion.md §3 and §8: "/admin/* and
 * Experiments / Prompt Library move to a separate internal ops surface
 * gated by platform-staff auth, never into any customer tier of Settings."
 * (Analytics included too — see notes/cleanup-candidates.md for why; the
 * strategic doc is silent on it but the rollout plan explicitly groups it
 * with Admin/Experiments/Prompt Library for the same treatment.)
 *
 * This layout is the actual isolation boundary: every page under
 * app/(internal)/internal/* is now physically outside the (workspace)
 * route group (no WorkspaceNav, no five-item customer shell), AND gated
 * server-side here so a non-platform-admin hitting any of these URLs
 * directly gets redirected before the page even renders — not just
 * "unlinked from the customer nav" (which would be security-by-obscurity).
 *
 * Uses the same requireUser().isPlatformAdmin check that
 * lib/admin/require-admin.ts already uses for the underlying
 * /api/admin/* routes (requireAdmin() itself is shaped for API route
 * handlers — returns NextResponse — so it isn't directly callable from a
 * page layout; this calls the same underlying requireUser() and redirects
 * instead of returning a Response, which is the correct pattern for
 * server-component layouts).
 *
 * "No capability removed" (rollout plan Phase 5's stated goal) stays
 * true — every admin page below is moved, not deleted; it's just no
 * longer reachable by a customer, by URL or by nav link.
 */

import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/supabase-server'

export default async function InternalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { isPlatformAdmin, unauthorized } = await requireUser()

  if (unauthorized) {
    redirect('/')
  }

  if (!isPlatformAdmin) {
    // Same destination an unauthenticated user would land on, rather than
    // a distinguishable "you're logged in but not allowed" page — avoids
    // confirming to a curious customer that this URL space exists/works
    // for *someone*, just not them.
    redirect('/workspace')
  }

  return <>{children}</>
}
