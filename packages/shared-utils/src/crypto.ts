// ============================================================
// @brandos/shared-utils — src/crypto.ts
//
// AES-256-GCM symmetric encryption/decryption for BYOK key storage.
//
// DESIGN:
//   - Uses Node.js built-in `crypto` module — no extra dependencies.
//   - Three-column output (ciphertext / IV / authTag) matches the schema
//     of workspace_api_keys (encrypted_key, iv, auth_tag).
//   - 12-byte random nonce per encryption (GCM standard).
//   - 16-byte GCM authentication tag (default, verifies integrity on decrypt).
//   - All values are base64-encoded strings for DB storage.
//   - encryptKey() is always called with a freshly-generated IV — never reuse.
//   - decryptKey() verifies the auth tag automatically (GCM authenticated mode).
//
// SECURITY INVARIANTS:
//   1. Never log the plaintext key or the encryption secret.
//   2. The encryption secret must be exactly 32 bytes (256-bit AES key).
//      Callers must validate this before calling these functions.
//   3. A unique IV is generated per encryptKey() call — do not recycle IVs
//      for the same key material; GCM security depends on IV uniqueness.
//
// CONSUMERS:
//   - @brandos/runtime-config/src/credentials/resolver.ts  (decryptKey)
//   - apps/web/app/api/workspace/providers/route.ts        (encryptKey via resolver)
//
// NEVER import this module in browser bundles — it uses Node.js crypto.
// ============================================================

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES   = 12    // 96-bit IV — GCM recommendation
const TAG_BYTES  = 16    // 128-bit authentication tag — GCM default

// ─── Output types ─────────────────────────────────────────────────────────────

/**
 * Result of encrypting a plaintext key.
 * All three fields are base64-encoded and map directly to the three
 * ciphertext columns in workspace_api_keys.
 */
export interface EncryptedKeyParts {
  /** base64-encoded AES-256-GCM ciphertext */
  encryptedKey: string
  /** base64-encoded 12-byte GCM nonce */
  iv:           string
  /** base64-encoded 16-byte GCM authentication tag */
  authTag:      string
}

// ─── Error types ──────────────────────────────────────────────────────────────

/**
 * Thrown by decryptKey() when the encrypted data cannot be authenticated
 * or decrypted (wrong key, tampered ciphertext, or corrupted fields).
 *
 * NEVER expose the internal error message to end users — it may contain
 * provider-specific details. The credentials service catches this and
 * logs only at console.warn level with a sanitised message.
 */
export class AuthDecryptionError extends Error {
  constructor(detail?: string) {
    super(`Key decryption failed${detail ? `: ${detail}` : ''}`)
    this.name = 'AuthDecryptionError'
  }
}

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext API key using AES-256-GCM.
 *
 * Generates a cryptographically random 12-byte IV on every call.
 * Returns the three base64-encoded output fields for DB storage.
 *
 * @param plaintextKey  - The provider API key string to encrypt.
 * @param secret        - 32-byte encryption secret (from BRANDOS_KEY_ENCRYPTION_SECRET).
 * @returns             - { encryptedKey, iv, authTag } all base64-encoded.
 */
export function encryptKey(plaintextKey: string, secret: Buffer): EncryptedKeyParts {
  if (secret.length !== 32) {
    throw new Error('Encryption secret must be exactly 32 bytes')
  }

  const iv     = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, secret, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintextKey, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return {
    encryptedKey: encrypted.toString('base64'),
    iv:           iv.toString('base64'),
    authTag:      tag.toString('base64'),
  }
}

/**
 * Decrypt an AES-256-GCM ciphertext back to a plaintext API key.
 *
 * Automatically verifies the GCM authentication tag — any tampered
 * ciphertext or wrong key throws AuthDecryptionError.
 *
 * NEVER THROWS for other reasons — internal errors are wrapped into
 * AuthDecryptionError so callers always get a typed signal.
 *
 * @param parts  - The three encrypted columns from workspace_api_keys.
 * @param secret - 32-byte encryption secret (from BRANDOS_KEY_ENCRYPTION_SECRET).
 * @returns      - The original plaintext API key string.
 * @throws       - AuthDecryptionError on any failure.
 */
export function decryptKey(
  parts:  { encryptedKey: string; iv: string; authTag: string },
  secret: Buffer,
): string {
  try {
    if (secret.length !== 32) {
      throw new AuthDecryptionError('secret must be 32 bytes')
    }

    const iv      = Buffer.from(parts.iv,           'base64')
    const tag     = Buffer.from(parts.authTag,      'base64')
    const cipher  = Buffer.from(parts.encryptedKey, 'base64')

    if (iv.length !== IV_BYTES) {
      throw new AuthDecryptionError(`IV must be ${IV_BYTES} bytes, got ${iv.length}`)
    }
    if (tag.length !== TAG_BYTES) {
      throw new AuthDecryptionError(`Auth tag must be ${TAG_BYTES} bytes, got ${tag.length}`)
    }

    const decipher = createDecipheriv(ALGORITHM, secret, iv)
    decipher.setAuthTag(tag)

    const decrypted = Buffer.concat([
      decipher.update(cipher),
      decipher.final(),
    ])

    return decrypted.toString('utf8')
  } catch (err) {
    if (err instanceof AuthDecryptionError) throw err
    // GCM tag verification failure surfaces as a generic Error from Node crypto.
    throw new AuthDecryptionError((err as Error).message)
  }
}
