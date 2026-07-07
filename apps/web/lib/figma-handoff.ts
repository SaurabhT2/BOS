/**
 * apps/web — lib/figma-handoff.ts
 *
 * Priority 5 — Figma Export. Token issuance for the BrandOS Figma Plugin
 * handoff flow.
 *
 * WHY THIS EXISTS (re-stated from the migration header, since it's the
 * crux of this Priority's whole architecture): Figma's REST API has no
 * design-creation/import endpoint — file content can only be created or
 * edited via the Plugin API, which runs inside a user's own Figma editor
 * session. There is no server-to-server equivalent of Canva's Design
 * Import API for Figma. So "export to Figma" cannot be a single button
 * that silently does everything server-side, the way Canva export is.
 *
 * THE FLOW:
 *   1. User clicks "Export to Figma" in BrandOS (create/page.tsx).
 *   2. BrandOS calls POST /api/integrations/figma/handoff, which snapshots
 *      the artifact and issues a short-lived, single-use token (this module).
 *   3. BrandOS opens a tab to figma.com with instructions (Figma has no
 *      "launch this specific plugin run" deep link — confirmed against
 *      Figma's own forum; the closest mechanism, relaunch buttons, only
 *      works from inside a file that already has the plugin's relaunch
 *      data set, which doesn't apply to a fresh cross-app handoff). The
 *      token is shown/copied for the user to paste into the plugin's UI,
 *      OR — if the BrandOS Figma Plugin is already running with its
 *      iframe UI open — postMessage/clipboard can pass it automatically.
 *      This sprint implements the manual-paste path as the minimum viable
 *      version (see figma-plugin/ui.html); the postMessage convenience
 *      path is a follow-up, not required for the flow to work end-to-end.
 *   4. The BrandOS Figma Plugin (figma-plugin/code.ts) calls
 *      GET /api/integrations/figma/handoff/{token} from its sandboxed
 *      iframe UI, receives the artifact JSON, and renders real Figma
 *      nodes (frames, text) via the Plugin API — entirely client-side,
 *      inside Figma's own runtime. BrandOS's server is never able to
 *      create Figma nodes itself; only the plugin, running as the user,
 *      can.
 *
 * AUTH MODEL: the token IS the auth for step 4 — there is no BrandOS
 * session available inside a Figma plugin iframe (it's a different origin,
 * no cookies). This is the same trust model as a short-lived signed
 * download URL: possession of the unguessable token is sufficient,
 * because it's single-use, short-TTL, and scoped to one artifact.
 */

import { createFigmaHandoffToken, consumeFigmaHandoffToken } from '@brandos/auth'
import type { SupportedHtmlArtifactType } from './artifact-export-html'

export const TOKEN_TTL_SECONDS = 600 // 10 minutes — enough time to alt-tab into Figma and paste

function generateOpaqueToken(): string {
  // 24 random bytes, hex-encoded — unguessable, URL-safe, no padding chars.
  const bytes = new Uint8Array(24)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    // Node fallback (should be unreachable in the Next.js Node runtime, but
    // avoids a hard crash if this ever runs somewhere without webcrypto).
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export interface IssueHandoffTokenResult {
  ok: boolean
  error?: string
  token?: string
  expiresAt?: string
}

export async function issueFigmaHandoffToken(params: {
  workspaceId: string
  userId: string | null
  artifact: Record<string, unknown>
  artifactType: SupportedHtmlArtifactType
}): Promise<IssueHandoffTokenResult> {
  const { workspaceId, userId, artifact, artifactType } = params
  const token = generateOpaqueToken()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString()

  const { error } = await createFigmaHandoffToken({
    token,
    workspace_id: workspaceId,
    artifact_type: artifactType,
    artifact,
    created_by: userId,
    consumed_at: null,
    expires_at: expiresAt,
  })

  if (error) return { ok: false, error }
  return { ok: true, token, expiresAt }
}

export interface RedeemHandoffTokenResult {
  ok: boolean
  error?: string
  artifact?: Record<string, unknown>
  artifactType?: string
}

/**
 * Redeem (fetch-and-consume) a handoff token. Called by the plugin's
 * GET /api/integrations/figma/handoff/{token} request.
 */
export async function redeemFigmaHandoffToken(token: string): Promise<RedeemHandoffTokenResult> {
  if (!token || token.length < 16) {
    return { ok: false, error: 'Invalid token format.' }
  }

  const { data, error } = await consumeFigmaHandoffToken(token)
  if (error) return { ok: false, error }
  if (!data) return { ok: false, error: 'Token not found, already used, or expired.' }

  return { ok: true, artifact: data.artifact, artifactType: data.artifact_type }
}
