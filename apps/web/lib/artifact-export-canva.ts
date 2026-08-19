/**
 * apps/web — lib/artifact-export-canva.ts
 *
 * Canva export logic, split out of the old monolithic
 * app/api/artifact/export/route.ts (see lib/artifact-export-request.ts for
 * why the split happened). Canva export only makes network calls — no
 * Chromium, no puppeteer, no pptxgenjs — so it's safe for this to be
 * imported both by app/api/artifact/export/canva/route.ts and by the
 * legacy app/api/artifact/export/route.ts shim without affecting either
 * function's bundle size.
 */

import { NextResponse } from 'next/server'
import { importArtifactToCanvaFallback } from '@/lib/canva-export'
import { isCanvaFieldRendererAvailable, submitAutofillJob } from '@/lib/canva-field-renderer'
import type { CarouselArtifact } from '@brandos/contracts'
import {
  getCanvaOAuthConfig,
  refreshCanvaToken,
  decryptCanvaAccessToken,
  decryptCanvaRefreshToken,
  encryptCanvaTokens,
  expiresAtFromExpiresIn,
} from '@/lib/canva-oauth'
import { getWorkspaceOAuthConnection, refreshWorkspaceOAuthConnection } from '@brandos/auth'
import type { ParsedExportRequest } from '@/lib/artifact-export-request'

/**
 * Resolve a usable (non-expired) Canva access token for this workspace,
 * refreshing it first if it's expired or about to expire. Returns null
 * with a reason if there's no connection, no Canva config, or refresh
 * fails — callers turn that into the appropriate HTTP response.
 */
async function resolveCanvaAccessToken(
  workspaceId: string
): Promise<{ token: string } | { error: string; status: number }> {
  const config = getCanvaOAuthConfig()
  if (!config) {
    return { error: 'Canva integration is not configured on this server.', status: 503 }
  }

  const { data: connection, error } = await getWorkspaceOAuthConnection(workspaceId, 'canva')
  if (error) return { error, status: 500 }
  if (!connection) {
    return { error: 'Canva is not connected for this workspace. Connect it in Settings → Integrations.', status: 409 }
  }

  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : null
  const isExpiredOrSoon = expiresAt !== null && expiresAt - Date.now() < 60_000 // refresh 60s early

  if (!isExpiredOrSoon) {
    const token = decryptCanvaAccessToken(connection)
    if (!token) return { error: 'Failed to decrypt stored Canva access token.', status: 500 }
    return { token }
  }

  const refreshToken = decryptCanvaRefreshToken(connection)
  if (!refreshToken) {
    return { error: 'Canva access token expired and no refresh token is available. Please reconnect Canva.', status: 409 }
  }

  const refreshed = await refreshCanvaToken(config, refreshToken)
  if (!refreshed.ok || !refreshed.tokens) {
    return { error: refreshed.error ?? 'Failed to refresh Canva access token. Please reconnect Canva.', status: 502 }
  }

  const encrypted = encryptCanvaTokens(refreshed.tokens)
  if ('error' in encrypted) return { error: encrypted.error, status: 500 }

  const { error: updateError } = await refreshWorkspaceOAuthConnection(workspaceId, 'canva', {
    encrypted_access_token: encrypted.encrypted_access_token,
    access_token_iv: encrypted.access_token_iv,
    access_token_auth_tag: encrypted.access_token_auth_tag,
    // Canva may or may not rotate the refresh token on refresh — keep the
    // existing one encrypted-as-is if a new one wasn't issued.
    encrypted_refresh_token: encrypted.encrypted_refresh_token ?? connection.encrypted_refresh_token,
    refresh_token_iv: encrypted.refresh_token_iv ?? connection.refresh_token_iv,
    refresh_token_auth_tag: encrypted.refresh_token_auth_tag ?? connection.refresh_token_auth_tag,
    expires_at: expiresAtFromExpiresIn(refreshed.tokens.expires_in),
  })
  if (updateError) return { error: `Refreshed token but failed to persist it: ${updateError}`, status: 500 }

  return { token: refreshed.tokens.access_token }
}

/**
 * RENDERING V2 PHASE 6: the choice between CanvaFieldRenderer (structured
 * Autofill mapping) and CanvaImportFallback (PDF repackage) is made HERE,
 * visibly, at the call site — not hidden inside either module (see
 * RENDERER_CONTRACT.md §5). isCanvaFieldRendererAvailable() is a real,
 * config-driven check (CANVA_BRAND_TEMPLATE_ID actually set), not a
 * fabricated capability signal. Field-rendering is also scoped to carousel
 * only, matching Phases 3-5's scope decision.
 */
export async function handleCanvaExport(parsed: ParsedExportRequest): Promise<NextResponse> {
  const { workspaceId, artifactType, bp } = parsed

  const tokenResult = await resolveCanvaAccessToken(workspaceId)
  if ('error' in tokenResult) {
    return NextResponse.json({ error: tokenResult.error }, { status: tokenResult.status })
  }

  const useFieldRenderer = artifactType === 'carousel' && isCanvaFieldRendererAvailable()
  const importResult = useFieldRenderer
    ? await submitAutofillJob({ accessToken: tokenResult.token, artifact: bp as unknown as CarouselArtifact })
    : await importArtifactToCanvaFallback({ accessToken: tokenResult.token, artifact: bp, artifactType })

  if (!importResult.ok) {
    return NextResponse.json({ error: importResult.error ?? 'Canva import failed' }, { status: 502 })
  }

  return NextResponse.json({
    designId: importResult.designId,
    editUrl: importResult.editUrl,
    viewUrl: importResult.viewUrl,
  })
}
