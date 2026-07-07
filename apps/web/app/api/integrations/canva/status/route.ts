/**
 * GET    /api/integrations/canva/status   — is this workspace connected to Canva?
 * DELETE /api/integrations/canva/status   — disconnect (soft-revoke)
 *
 * Priority 4 — Canva Export. Read/disconnect endpoint for the settings UI.
 * NEVER returns encrypted_access_token / encrypted_refresh_token or their
 * IV/auth-tag fields — same convention as /api/workspace/providers'
 * safeKeyRow().
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { getWorkspaceOAuthConnection, revokeWorkspaceOAuthConnection } from '@brandos/auth'
import { getCanvaOAuthConfig } from '@/lib/canva-oauth'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const configured = getCanvaOAuthConfig() !== null

  const { data: connection, error } = await getWorkspaceOAuthConnection(workspaceId, 'canva')
  if (error) return NextResponse.json({ error }, { status: 500 })

  return NextResponse.json({
    configured,
    connected: connection !== null,
    connected_at: connection?.connected_at ?? null,
    expires_at: connection?.expires_at ?? null,
    scopes: connection?.scopes ?? [],
  })
}

export async function DELETE(_req: NextRequest) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: revoked, error } = await revokeWorkspaceOAuthConnection(workspaceId, 'canva')
  if (error === 'No active connection found for this provider') {
    return NextResponse.json({ error }, { status: 404 })
  }
  if (error) return NextResponse.json({ error }, { status: 500 })

  return NextResponse.json({ success: true, disconnected: revoked !== null })
}
