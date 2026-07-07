/**
 * GET /api/integrations/canva/callback
 *
 * Priority 4 — Canva Export. Step 2 of the OAuth flow: Canva redirects
 * here with `code` and `state` after the user approves the connection.
 * Verifies state against the cookie set by /connect, exchanges the code
 * for tokens, encrypts and stores them, then redirects back to the
 * workspace settings page.
 *
 * AUTHENTICATION: requireUser() — the workspaceId from THIS session must
 * match the session that started the flow. Since both legs of an OAuth
 * redirect happen in the same browser, this is satisfied by relying on
 * the same session cookie Supabase already sets — no separate identity
 * check needed beyond requireUser() succeeding.
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { requireUser } from '@/lib/supabase-server'
import {
  getCanvaOAuthConfig,
  exchangeCanvaCode,
  encryptCanvaTokens,
  expiresAtFromExpiresIn,
} from '@/lib/canva-oauth'
import { upsertWorkspaceOAuthConnection } from '@brandos/auth'

export const runtime = 'nodejs'

const STATE_COOKIE = 'canva_oauth_state'
const VERIFIER_COOKIE = 'canva_oauth_verifier'

// Where to send the user back to after the flow completes, success or fail.
// Settings → Integrations (a new section added alongside this Priority).
const RETURN_PATH = '/workspace/settings/integrations'

function redirectWithStatus(req: NextRequest, status: 'connected' | 'error', message?: string) {
  const url = new URL(RETURN_PATH, req.url)
  url.searchParams.set('canva', status)
  if (message) url.searchParams.set('canva_error', message)
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest) {
  const { workspaceId, user, unauthorized } = await requireUser()
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const config = getCanvaOAuthConfig()
  if (!config) {
    return redirectWithStatus(req, 'error', 'Canva integration is not configured on this server.')
  }

  const searchParams = req.nextUrl.searchParams
  const code = searchParams.get('code')
  const returnedState = searchParams.get('state')
  const canvaError = searchParams.get('error')

  if (canvaError) {
    return redirectWithStatus(req, 'error', `Canva denied the connection: ${canvaError}`)
  }
  if (!code || !returnedState) {
    return redirectWithStatus(req, 'error', 'Missing code or state from Canva redirect.')
  }

  const cookieStore = await cookies()
  const expectedState = cookieStore.get('canva_oauth_state')?.value
  const verifier = cookieStore.get('canva_oauth_verifier')?.value

  // Clear the short-lived cookies regardless of outcome — they're single-use.
  cookieStore.delete(STATE_COOKIE)
  cookieStore.delete(VERIFIER_COOKIE)

  if (!expectedState || !verifier || returnedState !== expectedState) {
    return redirectWithStatus(req, 'error', 'OAuth state mismatch — please try connecting again.')
  }

  const exchange = await exchangeCanvaCode(config, code, verifier)
  if (!exchange.ok || !exchange.tokens) {
    return redirectWithStatus(req, 'error', exchange.error ?? 'Token exchange failed.')
  }

  const encrypted = encryptCanvaTokens(exchange.tokens)
  if ('error' in encrypted) {
    return redirectWithStatus(req, 'error', encrypted.error)
  }

  const { error: dbError } = await upsertWorkspaceOAuthConnection({
    workspace_id: workspaceId,
    provider: 'canva',
    ...encrypted,
    scopes: exchange.tokens.scope.split(' ').filter(Boolean),
    expires_at: expiresAtFromExpiresIn(exchange.tokens.expires_in),
    external_account_label: null, // Canva's token response doesn't include a display name; left null
    is_active: true,
    connected_by: user.id ?? null,
    connected_at: new Date().toISOString(),
    refreshed_at: null,
    revoked_at: null,
  })

  if (dbError) {
    return redirectWithStatus(req, 'error', `Failed to save Canva connection: ${dbError}`)
  }

  return redirectWithStatus(req, 'connected')
}
