// ============================================================
// packages/publishing-layer/src/storage.ts
//
// §6 Persistence Strategy — storage abstraction for rendered-output bytes:
//   "Storage abstraction: yes, and for the same reason @brandos/design-tokens
//   has zero dependencies — to avoid coupling the Publishing domain model
//   to one storage vendor."
//   "rendered bytes are a cache (regenerable, evictable under a
//   RetentionPolicy, not the system of record)."
//
// SCOPE BOUNDARY — read before extending this file:
//   §13 explicitly lists as NOT to be built yet: "Whether render-output
//   caching ... is solving a real, current performance problem or is
//   speculative — do not build the storage-abstraction/caching layer
//   ahead of evidence." This module implements the BASE requirement the
//   domain model cannot function without — "store the bytes a Publication
//   needs to reference, with a durable pointer" — which §6 places in the
//   sanctioned, stable section of the document. It deliberately does NOT
//   implement: automatic eviction policies, "regenerate from source if
//   evicted" reconstruction, or any cache-invalidation strategy. Those are
//   the speculative "caching layer" §13 says to wait on real evidence for.
//   If that evidence arrives, it is additive on top of this interface
//   (an eviction policy would call delete() below; regeneration would call
//   put() again with a new render) — no redesign required.
// ============================================================

import { sha256Hex } from './hash'

export interface StoredOutput {
  readonly storageKey: string
  readonly contentHash: string
  readonly sizeBytes: number
}

/**
 * RenderedOutputStore — the seam between Publishing's domain model and
 * wherever bytes actually live (Supabase Storage, S3, or anything else —
 * §6: "an infrastructure decision Publishing's domain model should not
 * need to know about").
 */
export interface RenderedOutputStore {
  put(params: {
    artifactId: string
    artifactVersionId: string
    format: string
    bytes: Uint8Array
    mimeType: string
  }): Promise<StoredOutput>

  getBytes(storageKey: string): Promise<Uint8Array>

  /** A time-limited URL suitable for handing to a Publisher (e.g. ShareLinkPublisher) or an end user. */
  getSignedUrl(storageKey: string, expiresInSeconds?: number): Promise<string>

  delete(storageKey: string): Promise<void>
}

// ─── Supabase Storage implementation ────────────────────────────────────────
//
// Lazy client construction from env, matching the exact pattern already
// established in control-plane-layer (ArtifactVersioningService,
// ApprovalService, AuditTrailService) — NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY, dynamic import, session persistence disabled
// (server-side, request-scoped usage).

const DEFAULT_BUCKET = 'publishing-artifacts'
const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60 // 1 hour

export class SupabaseRenderedOutputStore implements RenderedOutputStore {
  constructor(private readonly bucket: string = DEFAULT_BUCKET) {}

  private async getClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      throw new Error(
        'SupabaseRenderedOutputStore requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. ' +
          'Use InMemoryRenderedOutputStore for tests/local dev without Supabase configured.',
      )
    }
    const { createClient } = await import('@supabase/supabase-js')
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  }

  async put(params: {
    artifactId: string
    artifactVersionId: string
    format: string
    bytes: Uint8Array
    mimeType: string
  }): Promise<StoredOutput> {
    const contentHash = await sha256Hex(params.bytes)
    const storageKey = `${params.artifactId}/${params.artifactVersionId}/${params.format}-${contentHash.slice(0, 16)}`

    const supabase = await this.getClient()
    const { error } = await supabase.storage.from(this.bucket).upload(storageKey, params.bytes, {
      contentType: params.mimeType,
      upsert: true, // content-addressed key — re-uploading identical bytes is a safe no-op
    })
    if (error) {
      throw new Error(`SupabaseRenderedOutputStore.put failed for '${storageKey}': ${error.message}`)
    }

    return { storageKey, contentHash, sizeBytes: params.bytes.byteLength }
  }

  async getBytes(storageKey: string): Promise<Uint8Array> {
    const supabase = await this.getClient()
    const { data, error } = await supabase.storage.from(this.bucket).download(storageKey)
    if (error || !data) {
      throw new Error(`SupabaseRenderedOutputStore.getBytes failed for '${storageKey}': ${error?.message ?? 'no data returned'}`)
    }
    return new Uint8Array(await data.arrayBuffer())
  }

  async getSignedUrl(storageKey: string, expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS): Promise<string> {
    const supabase = await this.getClient()
    const { data, error } = await supabase.storage.from(this.bucket).createSignedUrl(storageKey, expiresInSeconds)
    if (error || !data) {
      throw new Error(`SupabaseRenderedOutputStore.getSignedUrl failed for '${storageKey}': ${error?.message ?? 'no data returned'}`)
    }
    return data.signedUrl
  }

  async delete(storageKey: string): Promise<void> {
    const supabase = await this.getClient()
    const { error } = await supabase.storage.from(this.bucket).remove([storageKey])
    if (error) {
      throw new Error(`SupabaseRenderedOutputStore.delete failed for '${storageKey}': ${error.message}`)
    }
  }
}

// ─── In-memory implementation ───────────────────────────────────────────────
// For unit tests and local dev without Supabase configured. NOT a
// production persistence path — bytes vanish on process restart, same
// caveat as every in-memory fallback already in this codebase
// (AuditTrailService's buffer, PolicyAdminService's Map).

export class InMemoryRenderedOutputStore implements RenderedOutputStore {
  private readonly objects = new Map<string, { bytes: Uint8Array; mimeType: string }>()

  async put(params: {
    artifactId: string
    artifactVersionId: string
    format: string
    bytes: Uint8Array
    mimeType: string
  }): Promise<StoredOutput> {
    const contentHash = await sha256Hex(params.bytes)
    const storageKey = `${params.artifactId}/${params.artifactVersionId}/${params.format}-${contentHash.slice(0, 16)}`
    this.objects.set(storageKey, { bytes: params.bytes, mimeType: params.mimeType })
    return { storageKey, contentHash, sizeBytes: params.bytes.byteLength }
  }

  async getBytes(storageKey: string): Promise<Uint8Array> {
    const obj = this.objects.get(storageKey)
    if (!obj) throw new Error(`InMemoryRenderedOutputStore: no object at '${storageKey}'`)
    return obj.bytes
  }

  async getSignedUrl(storageKey: string): Promise<string> {
    if (!this.objects.has(storageKey)) {
      throw new Error(`InMemoryRenderedOutputStore: no object at '${storageKey}'`)
    }
    return `memory://${storageKey}`
  }

  async delete(storageKey: string): Promise<void> {
    this.objects.delete(storageKey)
  }
}
