/**
 * BrandOS Proxy (was: middleware.ts)
 *
 * Renamed from `middleware.ts` to `proxy.ts` — Next.js 16 deprecated the
 * `middleware` file convention in favour of `proxy`. The runtime behaviour,
 * matcher config, and all auth/redirect logic are identical. Only the
 * filename changes.
 *
 * Protects:
 *  - /workspace/*  — redirects unauthenticated users to /
 *  - /internal/*   — redirects unauthenticated users to / (session-level
 *    check only; the actual platform-admin authorization check lives in
 *    app/(internal)/layout.tsx, since that requires a profile lookup this
 *    middleware doesn't otherwise do — this is defense-in-depth, not a
 *    duplicate of that check)
 *  - /api/admin/*  — returns 401 for unauthenticated requests
 *    (individual routes also call requireAdmin() as a defence-in-depth layer)
 *
 * FIX: /api/admin/* was completely unprotected at the middleware level.
 * Added early 401 rejection so unauthenticated requests never reach route handlers.
 *
 * Phase 1 (redesign) — Legacy route redirects:
 * /workspace/studio, /workspace/assets, /workspace/memory were renamed to
 * /workspace/create, /workspace/library, /workspace/brand respectively.
 * Old bookmarked/shared URLs (and sub-paths) 301-redirect to the new ones
 * rather than 404ing. This runs before the auth check so the redirect
 * applies regardless of session state; the auth check then re-runs
 * naturally against the new path on the follow-up request.
 *
 * Phase 7 (redesign) — Internal route isolation:
 * /workspace/admin, /workspace/analytics, /workspace/experiments,
 * /workspace/prompt-library moved to /internal/admin, /internal/analytics,
 * /internal/experiments, /internal/prompt-library (now outside the
 * customer (workspace) route group entirely — no WorkspaceNav, no
 * five-item shell). Old paths redirect to / rather than to their new
 * /internal/* location, since a non-platform-admin customer hitting the
 * old bookmarked URL shouldn't be handed a working link into the admin
 * surface — they should land somewhere normal, same as any other 404-ish
 * case. (A genuine platform admin who has the old bookmark will just need
 * to re-navigate to /internal/admin once — an acceptable one-time cost
 * for not leaking the new path's existence to non-admins via a redirect.)
 */

import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const LEGACY_WORKSPACE_REDIRECTS: Record<string, string> = {
  '/workspace/studio': '/workspace/create',
  '/workspace/assets': '/workspace/library',
  '/workspace/memory': '/workspace/brand',
}

const LEGACY_INTERNAL_PATHS = [
  '/workspace/admin',
  '/workspace/analytics',
  '/workspace/experiments',
  '/workspace/prompt-library',
]

function legacyRedirectTarget(pathname: string): string | null {
  for (const [oldPrefix, newPrefix] of Object.entries(LEGACY_WORKSPACE_REDIRECTS)) {
    if (pathname === oldPrefix) return newPrefix
    if (pathname.startsWith(oldPrefix + '/')) {
      return newPrefix + pathname.slice(oldPrefix.length)
    }
  }
  return null
}

function isLegacyInternalPath(pathname: string): boolean {
  return LEGACY_INTERNAL_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Legacy internal-route paths: redirect to home, not to /internal/* ──
  if (isLegacyInternalPath(pathname)) {
    return NextResponse.redirect(new URL('/workspace', request.url), 301)
  }

  // ── Legacy route redirects (renamed in the redesign) ────────────
  const legacyTarget = legacyRedirectTarget(pathname)
  if (legacyTarget) {
    const redirectUrl = new URL(legacyTarget, request.url)
    redirectUrl.search = request.nextUrl.search
    return NextResponse.redirect(redirectUrl, 301)
  }

  // ── Fast-path: non-protected paths ───────────────────────────
  const isWorkspace = pathname.startsWith('/workspace')
  const isInternal  = pathname.startsWith('/internal')
  const isAdminApi  = pathname.startsWith('/api/admin')

  if (!isWorkspace && !isInternal && !isAdminApi) {
    return NextResponse.next({ request: { headers: request.headers } })
  }

  const response = NextResponse.next({
    request: { headers: request.headers },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // ── Workspace / Internal: redirect to login if no session ──────
  if ((isWorkspace || isInternal) && !user) {
    const loginUrl = new URL('/', request.url)
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // ── Admin API: return 401 JSON ────────────────────────────────
  if (isAdminApi && !user) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized — authentication required' },
      { status: 401 }
    )
  }

  return response
}

export const config = {
  matcher: [
    '/workspace',
    '/workspace/:path*',
    '/internal',
    '/internal/:path*',
    '/api/admin/:path*',
  ],
}


