/**
 * GET /api/integrations/figma/handoff/{token}
 *
 * Priority 5 — Figma Export. Called from the BrandOS Figma Plugin's
 * sandboxed iframe UI (figma-plugin/ui.html), which runs on a Figma-hosted
 * origin with NO access to BrandOS's session cookies. Auth is therefore
 * token-possession-based, not session-based — see lib/figma-handoff.ts
 * header comment for the full rationale.
 *
 * CORS: this route must be reachable cross-origin from the plugin iframe,
 * so (unlike every other route in this app) it sets permissive CORS
 * headers. This is safe specifically BECAUSE the token is single-use,
 * short-TTL, and scoped to exactly one artifact snapshot — an attacker
 * who somehow obtained a valid token could fetch that one artifact once,
 * which is the same exposure as someone shoulder-surfing the paste step
 * the legitimate flow already requires.
 */

import { NextRequest, NextResponse } from 'next/server'
import { redeemFigmaHandoffToken } from '@/lib/figma-handoff'

export const runtime = 'nodejs'

function withCors(res: NextResponse): NextResponse {
  res.headers.set('Access-Control-Allow-Origin', '*')
  res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return res
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }))
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const result = await redeemFigmaHandoffToken(token)
  if (!result.ok) {
    return withCors(NextResponse.json({ error: result.error ?? 'Failed to redeem token' }, { status: 404 }))
  }

  return withCors(
    NextResponse.json({
      artifact: result.artifact,
      artifactType: result.artifactType,
    })
  )
}
