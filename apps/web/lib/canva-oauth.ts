/**
 * apps/web — lib/canva-oauth.ts
 *
 * Priority 4 — Canva Export. OAuth connection lifecycle for the Canva
 * Connect API (https://www.canva.dev/docs/connect/).
 *
 * ARCHITECTURE:
 *   - Reuses the SAME encryption primitive as P3/BYOK
 *     (encryptKey/decryptKey from @brandos/shared-utils, AES-256-GCM,
 *     BRANDOS_KEY_ENCRYPTION_SECRET) — see workspace_oauth_connections
 *     migration header for why this is a new table rather than an
 *     extension of workspace_api_keys.
 *   - Reuses the SAME workspace-scoping pattern as
 *     /api/workspace/providers (requireUser() in the calling route,
 *     workspaceId always from session, never from the client).
 *   - One token per (workspace, provider) — matches Canva's own model
 *     (a Connect API access token acts on behalf of one authorized user;
 *     for BrandOS that's "whoever connected Canva for this workspace").
 *
 * CREDENTIALS REQUIRED (NOT present in this environment):
 *   CANVA_CLIENT_ID / CANVA_CLIENT_SECRET — issued when registering a
 *   Connect API integration at https://www.canva.com/developers. This
 *   module is written against Canva's documented OAuth 2.0 + PKCE flow
 *   and the documented /v1/oauth/token contract, but the actual
 *   credential exchange has not been (and cannot be, from this sandbox)
 *   tested against Canva's live OAuth servers — there is no registered
 *   BrandOS Canva app to test against. Flagged in the completion report's
 *   Remaining Risks. The code degrades safely either way: every function
 *   here checks for the env vars first and returns a clear, typed error
 *   rather than throwing or silently proceeding with undefined values.
 *
 * SCOPES: design:content:read design:content:write design:meta:read
 *   asset:write — design:content:write is required for the eventual
 *   "open in Canva, edit, sync back" loop; asset:write is required to
 *   import the rendered PDF/PPTX as a new design (see canva-export.ts).
 */

import { encryptKey, decryptKey } from '@brandos/shared-utils'

export const CANVA_API_BASE = 'https://api.canva.com/rest/v1'
export const CANVA_OAUTH_BASE = 'https://www.canva.com/api/oauth'

export const CANVA_SCOPES = [
  'design:content:read',
  'design:content:write',
  'design:meta:read',
  'asset:write',
] as const

export interface CanvaOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function getCanvaOAuthConfig(): CanvaOAuthConfig | null {
  const clientId = process.env.CANVA_CLIENT_ID
  const clientSecret = process.env.CANVA_CLIENT_SECRET
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!clientId || !clientSecret || !appUrl) return null
  return {
    clientId,
    clientSecret,
    redirectUri: `${appUrl.replace(/\/$/, '')}/api/integrations/canva/callback`,
  }
}

function getEncryptionSecret(): Buffer | null {
  const raw = process.env.BRANDOS_KEY_ENCRYPTION_SECRET
  if (!raw) return null
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) return null
  return buf
}

// ─── PKCE helpers ───────────────────────────────────────────────────────────
// Canva's Connect API OAuth flow requires PKCE (RFC 7636) — required for all
// integrations, not optional, per Canva's own docs.

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function generatePkcePair(): Promise<{ verifier: string; challenge: string }> {
  const { randomBytes, createHash } = await import('crypto')
  const verifier = base64UrlEncode(randomBytes(32))
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

// ─── Authorize URL ──────────────────────────────────────────────────────────

export function buildCanvaAuthorizeUrl(params: {
  config: CanvaOAuthConfig
  state: string
  codeChallenge: string
}): string {
  const { config, state, codeChallenge } = params
  const url = new URL(`${CANVA_OAUTH_BASE}/authorize`)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', CANVA_SCOPES.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

// ─── Token exchange ─────────────────────────────────────────────────────────

export interface CanvaTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number // seconds
  scope: string
  token_type: string
}

export interface CanvaOAuthResult {
  ok: boolean
  error?: string
  tokens?: CanvaTokenResponse
}

/**
 * Exchange an authorization code for an access/refresh token pair.
 * POST /v1/oauth/token per Canva Connect API docs.
 */
export async function exchangeCanvaCode(
  config: CanvaOAuthConfig,
  code: string,
  codeVerifier: string
): Promise<CanvaOAuthResult> {
  try {
    const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
    const res = await fetch(`${CANVA_OAUTH_BASE}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: config.redirectUri,
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `Canva token exchange failed (${res.status}): ${text}` }
    }

    const tokens = (await res.json()) as CanvaTokenResponse
    return { ok: true, tokens }
  } catch (err: any) {
    return { ok: false, error: `Canva token exchange error: ${err?.message ?? String(err)}` }
  }
}

/**
 * Refresh an expired (or soon-to-expire) access token.
 * POST /v1/oauth/token with grant_type=refresh_token.
 */
export async function refreshCanvaToken(
  config: CanvaOAuthConfig,
  refreshToken: string
): Promise<CanvaOAuthResult> {
  try {
    const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
    const res = await fetch(`${CANVA_OAUTH_BASE}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `Canva token refresh failed (${res.status}): ${text}` }
    }

    const tokens = (await res.json()) as CanvaTokenResponse
    return { ok: true, tokens }
  } catch (err: any) {
    return { ok: false, error: `Canva token refresh error: ${err?.message ?? String(err)}` }
  }
}

// ─── Encrypted storage helpers ──────────────────────────────────────────────
// Thin wrappers so callers (the OAuth routes, the export-time token
// resolver) never touch encryptKey/decryptKey or the secret loading logic
// directly — same separation of concerns as the BYOK route's use of
// getEncryptionSecret() + encryptKey().

export interface EncryptedTokenPair {
  encrypted_access_token: string
  access_token_iv: string
  access_token_auth_tag: string
  encrypted_refresh_token: string | null
  refresh_token_iv: string | null
  refresh_token_auth_tag: string | null
}

export function encryptCanvaTokens(tokens: CanvaTokenResponse): EncryptedTokenPair | { error: string } {
  const secret = getEncryptionSecret()
  if (!secret) return { error: 'BRANDOS_KEY_ENCRYPTION_SECRET missing or not 32 bytes — cannot encrypt tokens' }

  const access = encryptKey(tokens.access_token, secret)
  const refresh = tokens.refresh_token ? encryptKey(tokens.refresh_token, secret) : null

  return {
    encrypted_access_token: access.encryptedKey,
    access_token_iv: access.iv,
    access_token_auth_tag: access.authTag,
    encrypted_refresh_token: refresh?.encryptedKey ?? null,
    refresh_token_iv: refresh?.iv ?? null,
    refresh_token_auth_tag: refresh?.authTag ?? null,
  }
}

export function decryptCanvaAccessToken(row: {
  encrypted_access_token: string
  access_token_iv: string
  access_token_auth_tag: string
}): string | null {
  const secret = getEncryptionSecret()
  if (!secret) return null
  try {
    return decryptKey(
      { encryptedKey: row.encrypted_access_token, iv: row.access_token_iv, authTag: row.access_token_auth_tag },
      secret
    )
  } catch {
    return null
  }
}

export function decryptCanvaRefreshToken(row: {
  encrypted_refresh_token: string | null
  refresh_token_iv: string | null
  refresh_token_auth_tag: string | null
}): string | null {
  if (!row.encrypted_refresh_token || !row.refresh_token_iv || !row.refresh_token_auth_tag) return null
  const secret = getEncryptionSecret()
  if (!secret) return null
  try {
    return decryptKey(
      { encryptedKey: row.encrypted_refresh_token, iv: row.refresh_token_iv, authTag: row.refresh_token_auth_tag },
      secret
    )
  } catch {
    return null
  }
}

export function expiresAtFromExpiresIn(expiresInSeconds: number): string {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString()
}
