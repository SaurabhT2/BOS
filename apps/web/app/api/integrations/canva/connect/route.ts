/**
 * GET /api/integrations/canva/connect
 *
 * Priority 4 — Canva Export. Step 1 of the OAuth flow: redirects the
 * user to Canva's authorize page, with PKCE challenge + CSRF state
 * stashed in a short-lived, httpOnly cookie for the callback route to
 * verify.
 *
 * AUTHENTICATION: requireUser() — same pattern as every other
 * workspace-scoped route in this app. The resulting Canva connection is
 * stored against this session's workspaceId.
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { requireUser } from '@/lib/supabase-server'
import { getCanvaOAuthConfig, buildCanvaAuthorizeUrl, generatePkcePair } from '@/lib/canva-oauth'

export const runtime = 'nodejs'

const STATE_COOKIE = 'canva_oauth_state'
const VERIFIER_COOKIE = 'canva_oauth_verifier'
const COOKIE_MAX_AGE_SECONDS = 600 // 10 minutes — generous for a human to complete the Canva login/consent screen

export async function GET(_req: NextRequest) {
  const { unauthorized } = await requireUser()
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const config = getCanvaOAuthConfig()
  if (!config) {
    return NextResponse.json(
      {
        error:
          'Canva integration is not configured on this server. ' +
          'CANVA_CLIENT_ID, CANVA_CLIENT_SECRET, and NEXT_PUBLIC_APP_URL must all be set.',
      },
      { status: 503 }
    )
  }

  const { randomBytes } = await import('crypto')
  const state = randomBytes(16).toString('hex')
  const { verifier, challenge } = await generatePkcePair()

  const cookieStore = await cookies()
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: '/api/integrations/canva',
  }
  cookieStore.set(STATE_COOKIE, state, cookieOpts)
  cookieStore.set(VERIFIER_COOKIE, verifier, cookieOpts)

  const authorizeUrl = buildCanvaAuthorizeUrl({ config, state, codeChallenge: challenge })
  return NextResponse.redirect(authorizeUrl)
}
