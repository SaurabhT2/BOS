// ============================================================
// packages/publishing-layer/src/hash.ts
//
// §6: "A content hash of the source ArtifactV2 plus theme/composition
// version is what makes 'can we prove this exact content was what got
// approved and published' answerable without re-rendering ... now does
// double duty as an audit primitive." Used for both rendered-output bytes
// (storage.ts) and the governed source payload (publishing-service.ts).
//
// Uses Node's built-in webcrypto (available globally since Node 19,
// required floor here is Node 22 per the workspace's engines field) —
// zero new dependency, unlike pulling in a userland hashing library.
// ============================================================

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return toHex(digest)
}

export async function sha256HexOfJson(value: unknown): Promise<string> {
  const json = JSON.stringify(value ?? null)
  return sha256Hex(new TextEncoder().encode(json))
}
