/**
 * POST /api/integrations/figma/handoff
 *
 * Priority 5 — Figma Export. Issues a short-lived, single-use handoff
 * token for the BrandOS Figma Plugin to redeem. See lib/figma-handoff.ts
 * for the full architecture rationale (no Figma server-side import API).
 *
 * Body: { artifact: ArtifactV2 } — artifact_type is read from the
 * artifact itself, same convention as /api/artifact/export.
 *
 * Response: { token, expiresAt, instructions } — the UI shows `token` for
 * the user to paste into the plugin (or copies it to clipboard).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { issueFigmaHandoffToken } from '@/lib/figma-handoff'
import type { SupportedHtmlArtifactType } from '@/lib/artifact-export-html'

export const runtime = 'nodejs'

const SUPPORTED_ARTIFACT_TYPES: readonly SupportedHtmlArtifactType[] = ['carousel', 'deck', 'report']

export async function POST(req: NextRequest) {
  const { workspaceId, user, unauthorized } = await requireUser()
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { artifact?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const artifact = body.artifact
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return NextResponse.json({ error: 'Missing or invalid artifact.' }, { status: 400 })
  }

  const bp = artifact as Record<string, unknown>
  const artifactType = bp.artifact_type

  if (!SUPPORTED_ARTIFACT_TYPES.includes(artifactType as SupportedHtmlArtifactType)) {
    return NextResponse.json(
      { error: `Unsupported artifact_type: ${JSON.stringify(artifactType)}.` },
      { status: 400 }
    )
  }

  const result = await issueFigmaHandoffToken({
    workspaceId,
    userId: user.id ?? null,
    artifact: bp,
    artifactType: artifactType as SupportedHtmlArtifactType,
  })

  if (!result.ok || !result.token) {
    return NextResponse.json({ error: result.error ?? 'Failed to issue handoff token' }, { status: 500 })
  }

  return NextResponse.json({
    token: result.token,
    expiresAt: result.expiresAt,
    instructions:
      'Open Figma, run the BrandOS plugin (Plugins → BrandOS Export), and paste this code when prompted.',
  })
}
