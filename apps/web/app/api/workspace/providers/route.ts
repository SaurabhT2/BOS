/**
 * apps/web — /api/workspace/providers
 *
 * P3 — BYOK: Workspace provider key management.
 *
 * GET    — List all active provider key rows for this workspace.
 *          Returns safe display fields only (hint, validated_at, etc.).
 *          NEVER returns encrypted_key, iv, auth_tag.
 *
 * POST   — Add or rotate a provider key.
 *          Body: { provider: string; key: string; action?: 'add' | 'rotate' | 'revalidate' }
 *          - 'add'        → format-check, live-validate, encrypt, upsert
 *          - 'rotate'     → live-validate, encrypt, rotateWorkspaceApiKey()
 *          - 'revalidate' → decrypt existing, live-validate, update validated_at
 *
 * DELETE — Revoke (soft-delete) a provider key.
 *          Body: { provider: string }
 *
 * AUTHENTICATION: requireUser() — workspaceId always from session.
 * TIER GATE: Explorer workspaces receive 403 — BYOK requires Professional+.
 *
 * SECURITY:
 *   - Response bodies NEVER include encrypted_key, iv, or auth_tag.
 *   - The plaintext key from the request body is used only within this
 *     handler; it is never stored in plaintext, never logged, never
 *     included in any response field.
 *   - All encryption is via AES-256-GCM (shared-utils/crypto.ts).
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import {
  listWorkspaceApiKeys,
  getWorkspaceApiKey,
  upsertWorkspaceApiKey,
  rotateWorkspaceApiKey,
  revokeWorkspaceApiKey,
  markWorkspaceApiKeyValidated,
} from '@brandos/auth'
import {
  validateProviderKey,
  validateKeyFormat,
  getProviderKey,
} from '@brandos/runtime-config'
import { encryptKey } from '@brandos/shared-utils'
import { isCloudProvider } from '@brandos/contracts'
import { resolveWorkspaceSettings } from '@brandos/control-plane-layer'

// ─── Encryption secret helper ─────────────────────────────────────────────────

function getEncryptionSecret(): Buffer | null {
  const raw = process.env.BRANDOS_KEY_ENCRYPTION_SECRET
  if (!raw) return null
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) return null
  return buf
}

// ─── Safe row projection ──────────────────────────────────────────────────────

/**
 * Strip all sensitive fields from a workspace_api_keys row before sending
 * to the client. encrypted_key, iv, and auth_tag are NEVER included.
 */
function safeKeyRow(row: {
  id: string
  provider: string
  key_hint: string
  is_active: boolean
  validated_at: string | null
  created_at: string
  rotated_at: string | null
}) {
  return {
    id:           row.id,
    provider:     row.provider,
    key_hint:     row.key_hint,
    is_active:    row.is_active,
    validated_at: row.validated_at,
    created_at:   row.created_at,
    rotated_at:   row.rotated_at,
  }
}

// ─── GET /api/workspace/providers ────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rows, error } = await listWorkspaceApiKeys(workspaceId)
  if (error) return NextResponse.json({ error }, { status: 500 })

  return NextResponse.json({
    providers: (rows ?? []).map(safeKeyRow),
  })
}

// ─── POST /api/workspace/providers ───────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { workspaceId, user, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Tier gate: BYOK requires Professional+
  const settings = await resolveWorkspaceSettings(workspaceId)
  if (settings.plan === 'explorer') {
    return NextResponse.json(
      { error: 'BYOK requires a Professional or Executive plan.' },
      { status: 403 }
    )
  }

  let body: { provider?: string; key?: string; action?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { provider, key, action = 'add' } = body

  if (!provider || typeof provider !== 'string') {
    return NextResponse.json({ error: '`provider` is required' }, { status: 400 })
  }
  if (!isCloudProvider(provider)) {
    return NextResponse.json(
      { error: `Unknown or unsupported provider: ${provider}` },
      { status: 400 }
    )
  }

  // ── revalidate: decrypt existing key, live-check, update validated_at ──────
  if (action === 'revalidate') {
    // For revalidation, decrypt the existing key and live-check it
    const plaintext = await getProviderKey(workspaceId, provider)
    if (!plaintext) {
      return NextResponse.json(
        { error: `No active key found for provider: ${provider}` },
        { status: 404 }
      )
    }

    const { valid, error: validationError } = await validateProviderKey(provider, plaintext)
    const validatedAt = new Date().toISOString()

    if (valid) {
      await markWorkspaceApiKeyValidated(workspaceId, provider, validatedAt)
    }

    return NextResponse.json({ valid, error: validationError ?? null, validated_at: valid ? validatedAt : null })
  }

  // ── add / rotate: require key in body ────────────────────────────────────
  if (!key || typeof key !== 'string') {
    return NextResponse.json({ error: '`key` is required for add/rotate' }, { status: 400 })
  }

  // Format pre-check (cheap, avoids a network round-trip on junk input)
  const formatError = validateKeyFormat(provider, key)
  if (formatError) {
    return NextResponse.json({ error: formatError }, { status: 422 })
  }

  // Live validation
  const { valid, error: validationError } = await validateProviderKey(provider, key)
  if (!valid) {
    return NextResponse.json(
      { error: validationError ?? 'API key validation failed' },
      { status: 422 }
    )
  }

  // Encryption
  const secret = getEncryptionSecret()
  if (!secret) {
    return NextResponse.json(
      { error: 'BYOK encryption is not configured on this server (BRANDOS_KEY_ENCRYPTION_SECRET missing).' },
      { status: 503 }
    )
  }

  let encryptedParts: { encryptedKey: string; iv: string; authTag: string }
  try {
    encryptedParts = encryptKey(key, secret)
  } catch (err) {
    console.error('[POST /api/workspace/providers] encryption error:', (err as Error).message)
    return NextResponse.json({ error: 'Key encryption failed' }, { status: 500 })
  }

  const keyHint = key.slice(-4)
  const validatedAt = new Date().toISOString()

  // ── rotate: update in place ───────────────────────────────────────────────
  if (action === 'rotate') {
    const { data: rotated, error: rotateError } = await rotateWorkspaceApiKey(
      workspaceId,
      provider,
      {
        encrypted_key: encryptedParts.encryptedKey,
        iv:            encryptedParts.iv,
        auth_tag:      encryptedParts.authTag,
        key_hint:      keyHint,
      }
    )
    if (rotateError) return NextResponse.json({ error: rotateError }, { status: 500 })
    if (!rotated) return NextResponse.json({ error: 'No active key to rotate' }, { status: 404 })

    await markWorkspaceApiKeyValidated(workspaceId, provider, validatedAt)
    return NextResponse.json({ provider: safeKeyRow(rotated) }, { status: 200 })
  }

  // ── add: upsert (also handles re-add after revoke) ───────────────────────
  const { data: inserted, error: insertError } = await upsertWorkspaceApiKey({
    workspace_id:  workspaceId,
    provider,
    key_hint:      keyHint,
    encrypted_key: encryptedParts.encryptedKey,
    iv:            encryptedParts.iv,
    auth_tag:      encryptedParts.authTag,
    is_active:     true,
    validated_at:  validatedAt,
    created_by:    user.id ?? null,
    rotated_at:    null,
    revoked_at:    null,
  })

  if (insertError) return NextResponse.json({ error: insertError }, { status: 500 })
  if (!inserted)   return NextResponse.json({ error: 'Insert failed' }, { status: 500 })

  return NextResponse.json({ provider: safeKeyRow(inserted) }, { status: 201 })
}

// ─── DELETE /api/workspace/providers ─────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { provider?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { provider } = body
  if (!provider || typeof provider !== 'string') {
    return NextResponse.json({ error: '`provider` is required' }, { status: 400 })
  }

  const { data: revoked, error } = await revokeWorkspaceApiKey(workspaceId, provider)
  if (error === 'No active key found for this provider') {
    return NextResponse.json({ error }, { status: 404 })
  }
  if (error) return NextResponse.json({ error }, { status: 500 })

  return NextResponse.json({ success: true, provider: revoked ? safeKeyRow(revoked) : null })
}
