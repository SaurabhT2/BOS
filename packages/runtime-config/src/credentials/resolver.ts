// ============================================================
// @brandos/runtime-config — src/credentials/resolver.ts
//
// WORKSPACE CREDENTIAL RESOLUTION SERVICE
//
// RESPONSIBILITY:
//   - Resolve the plaintext API key BrandOS should use for a given
//     (workspace, provider) pair at request time.
//   - Build the full provider → key map for a workspace in one DB round-trip
//     (F4 requirement: ONE query, not one per provider).
//   - Record provider success/failure outcomes for health tracking.
//
// OWNERSHIP NOTE (P3):
//   This module introduces the only cross-package dependency added in P3:
//   @brandos/runtime-config now depends on @brandos/auth. The dependency
//   is clean (no circular: auth → contracts, runtime-config → auth → contracts)
//   and is owned here because this is *provider-configuration resolution*,
//   not authentication — the auth dependency is purely for encrypted-row
//   storage access.
//
//   The runtime-config/index.ts header comment "Explicitly NOT responsible
//   for: ... Auth → @brandos/auth" is updated in index.ts to reflect this
//   exception explicitly.
//
// SECURITY INVARIANTS:
//   1. NEVER THROWS (externally) — on any failure (missing env, no key,
//      decryption error), logs a warning and returns null so the caller
//      falls through to the platform key. Mirrors callWithMode()'s own
//      "never throws" contract.
//   2. NEVER LOGS the plaintext key — only logs provider name and error
//      message on failure.
//   3. Explorer tier skips resolution entirely — no DB round-trip for
//      Explorer workspaces (BYOK is not available on Explorer).
//
// CONSUMERS:
//   - packages/control-plane-layer/src/run-control-plane.ts (W4)
//   - apps/web/app/api/assets/[id]/analyze/route.ts          (W6)
//   - apps/web/app/api/workspace/providers/route.ts          (W7, for hint-only display)
// ============================================================

import {
  listWorkspaceApiKeys,
  upsertWorkspaceProviderHealth,
} from '@brandos/auth'
import { decryptKey, AuthDecryptionError } from '@brandos/shared-utils'
import { isCloudProvider } from '@brandos/contracts'

// ─── Encryption secret ────────────────────────────────────────────────────────

/**
 * Thrown during startup if BRANDOS_KEY_ENCRYPTION_SECRET is missing or wrong size.
 * This error is intentionally descriptive — it surfaces at boot time, not at
 * request time, so leaking the error message is safe.
 */
export class MissingEncryptionSecretError extends Error {
  constructor(detail = 'BRANDOS_KEY_ENCRYPTION_SECRET not set') {
    super(`BYOK encryption secret invalid: ${detail}`)
    this.name = 'MissingEncryptionSecretError'
  }
}

/**
 * Read and validate BRANDOS_KEY_ENCRYPTION_SECRET from env.
 * Returns null if the var is absent (BYOK silently disabled — not a startup error).
 * Throws MissingEncryptionSecretError if set but wrong size (misconfiguration).
 */
function getEncryptionSecret(): Buffer | null {
  const raw = process.env.BRANDOS_KEY_ENCRYPTION_SECRET
  if (!raw) return null  // BYOK not configured — callers fall through to platform key

  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    throw new MissingEncryptionSecretError(
      `must decode to exactly 32 bytes (got ${buf.length}). ` +
      `Generate with: openssl rand -base64 32`
    )
  }
  return buf
}

// ─── Single-provider resolution ───────────────────────────────────────────────

/**
 * Resolve the plaintext API key BrandOS should use for one (workspace, provider) pair.
 *
 * NEVER THROWS — on any failure, logs a warning and returns null so the
 * caller falls through to the platform environment key.
 *
 * Returns null when:
 *   - provider is not a cloud provider (local providers are never BYOK-eligible)
 *   - BRANDOS_KEY_ENCRYPTION_SECRET is not configured (BYOK feature disabled)
 *   - No active key row exists for this (workspace, provider)
 *   - Decryption fails for any reason
 *
 * @param workspaceId - The workspace to resolve a key for.
 * @param provider    - Provider ID (e.g. 'anthropic', 'openai').
 * @returns           - Plaintext key string, or null to fall through to platform key.
 */
export async function getProviderKey(
  workspaceId: string,
  provider:    string,
): Promise<string | null> {
  if (!isCloudProvider(provider)) return null

  try {
    const secret = getEncryptionSecret()
    if (!secret) return null  // BYOK not configured

    const { data: row, error } = await listWorkspaceApiKeys(workspaceId)
    if (error || !row) return null

    // Find the row for this specific provider from the bulk result
    const providerRow = row.find(r => r.provider === provider && r.is_active && !r.revoked_at)
    if (!providerRow) return null

    return decryptKey(
      {
        encryptedKey: providerRow.encrypted_key,
        iv:           providerRow.iv,
        authTag:      providerRow.auth_tag,
      },
      secret,
    )
  } catch (err) {
    if (err instanceof AuthDecryptionError) {
      console.warn(`[CredentialsService] decryption failed for provider=${provider}:`, (err as Error).message)
    } else {
      console.warn(`[CredentialsService] getProviderKey(${provider}) error:`, (err as Error).message)
    }
    return null
  }
}

// ─── Bulk-provider resolution (F4) ───────────────────────────────────────────

/**
 * Resolve plaintext keys for ALL providers this workspace has an active BYOK row for.
 *
 * F4 REQUIREMENT: Uses ONE listWorkspaceApiKeys() query for the full workspace,
 * then decrypts each row in memory. This is the function called from CPL's W4
 * integration to populate apiKeyOverrides before a generation call.
 *
 * Returns only providers that have active, decryptable keys. Providers with
 * no key, revoked keys, or decryption failures are silently omitted — callers
 * fall through to platform keys for those providers.
 *
 * @param workspaceId - The workspace to resolve keys for.
 * @param providers   - The provider IDs to resolve (typically CLOUD_PROVIDER_IDS).
 * @returns           - Map of provider → plaintext key (only successfully resolved entries).
 */
export async function getProviderKeyMap(
  workspaceId: string,
  providers:   string[],
): Promise<Record<string, string>> {
  try {
    const secret = getEncryptionSecret()
    if (!secret) return {}  // BYOK not configured

    // ONE DB query for the full workspace (F4)
    const { data: rows, error } = await listWorkspaceApiKeys(workspaceId)
    if (error || !rows || rows.length === 0) return {}

    // Build a provider → row map for O(1) lookup during decryption
    const rowsByProvider = new Map(
      rows
        .filter(r => r.is_active && !r.revoked_at)
        .map(r => [r.provider, r])
    )

    const result: Record<string, string> = {}

    for (const provider of providers) {
      if (!isCloudProvider(provider)) continue

      const row = rowsByProvider.get(provider)
      if (!row) continue

      try {
        const plaintext = decryptKey(
          {
            encryptedKey: row.encrypted_key,
            iv:           row.iv,
            authTag:      row.auth_tag,
          },
          secret,
        )
        result[provider] = plaintext
      } catch (decryptErr) {
        // Individual provider decryption failure — skip this provider, continue with others
        console.warn(
          `[CredentialsService] decryption failed for provider=${provider}:`,
          (decryptErr as Error).message,
        )
      }
    }

    return result
  } catch (err) {
    console.warn('[CredentialsService] getProviderKeyMap error:', (err as Error).message)
    return {}
  }
}

// ─── Health recording ─────────────────────────────────────────────────────────

/**
 * Fire-and-forget health outcome recording.
 * Never throws, never awaited on the hot path.
 * Logs a warning on failure (consistent with PersistentTelemetryService pattern).
 *
 * @param workspaceId - The workspace whose provider health to update.
 * @param provider    - Provider ID.
 * @param outcome     - 'success' or 'failure'.
 */
export async function recordProviderOutcome(
  workspaceId: string,
  provider:    string,
  outcome:     'success' | 'failure',
): Promise<void> {
  try {
    await upsertWorkspaceProviderHealth(workspaceId, provider, outcome)
  } catch (err) {
    console.warn(
      `[CredentialsService] health write failed for provider=${provider} (non-critical):`,
      (err as Error).message,
    )
  }
}
