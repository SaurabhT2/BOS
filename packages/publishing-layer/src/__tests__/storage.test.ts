import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { InMemoryRenderedOutputStore, SupabaseRenderedOutputStore } from '../storage'

describe('InMemoryRenderedOutputStore', () => {
  it('put() returns a content-addressed storage key and correct size/hash', async () => {
    const store = new InMemoryRenderedOutputStore()
    const bytes = new TextEncoder().encode('<html>hello</html>')
    const result = await store.put({
      artifactId: 'a1',
      artifactVersionId: 'v1',
      format: 'html',
      bytes,
      mimeType: 'text/html',
    })
    expect(result.storageKey).toContain('a1/v1/html-')
    expect(result.sizeBytes).toBe(bytes.byteLength)
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('getBytes() returns exactly what was put()', async () => {
    const store = new InMemoryRenderedOutputStore()
    const bytes = new TextEncoder().encode('some content')
    const { storageKey } = await store.put({ artifactId: 'a1', artifactVersionId: 'v1', format: 'html', bytes, mimeType: 'text/html' })
    const readBack = await store.getBytes(storageKey)
    expect(new TextDecoder().decode(readBack)).toBe('some content')
  })

  it('getBytes() throws for a missing key', async () => {
    const store = new InMemoryRenderedOutputStore()
    await expect(store.getBytes('nonexistent')).rejects.toThrow()
  })

  it('getSignedUrl() returns a memory:// URL for an existing key and throws for a missing one', async () => {
    const store = new InMemoryRenderedOutputStore()
    const bytes = new TextEncoder().encode('x')
    const { storageKey } = await store.put({ artifactId: 'a1', artifactVersionId: 'v1', format: 'pdf', bytes, mimeType: 'application/pdf' })
    const url = await store.getSignedUrl(storageKey)
    expect(url).toBe(`memory://${storageKey}`)
    await expect(store.getSignedUrl('missing')).rejects.toThrow()
  })

  it('delete() removes the object; subsequent getBytes() throws', async () => {
    const store = new InMemoryRenderedOutputStore()
    const bytes = new TextEncoder().encode('x')
    const { storageKey } = await store.put({ artifactId: 'a1', artifactVersionId: 'v1', format: 'png', bytes, mimeType: 'image/png' })
    await store.delete(storageKey)
    await expect(store.getBytes(storageKey)).rejects.toThrow()
  })

  it('identical bytes for the same artifact/version/format produce the same storage key (content-addressed, idempotent)', async () => {
    const store = new InMemoryRenderedOutputStore()
    const bytes = new TextEncoder().encode('identical')
    const a = await store.put({ artifactId: 'a1', artifactVersionId: 'v1', format: 'html', bytes, mimeType: 'text/html' })
    const b = await store.put({ artifactId: 'a1', artifactVersionId: 'v1', format: 'html', bytes, mimeType: 'text/html' })
    expect(a.storageKey).toBe(b.storageKey)
  })
})

// ─── SupabaseRenderedOutputStore — missing credentials guard ───────────────
// No live Supabase project is reachable from this sandbox (see
// PUBLISHING_LAYER_NOTES.md). What IS genuinely testable without one is the
// guard every method goes through first — real production code, not a
// workaround.
describe('SupabaseRenderedOutputStore — missing credentials guard', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  afterAll(() => {
    if (originalUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
    if (originalKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
  })

  const store = new SupabaseRenderedOutputStore()

  it('put() throws a clear configuration error rather than an opaque network failure', async () => {
    await expect(
      store.put({ artifactId: 'a1', artifactVersionId: 'v1', format: 'html', bytes: new Uint8Array(), mimeType: 'text/html' }),
    ).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('getBytes() throws the same clear error', async () => {
    await expect(store.getBytes('some-key')).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('getSignedUrl() throws the same clear error', async () => {
    await expect(store.getSignedUrl('some-key')).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('delete() throws the same clear error', async () => {
    await expect(store.delete('some-key')).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('error message directs the caller to the in-memory alternative for tests/local dev', async () => {
    await expect(store.getBytes('some-key')).rejects.toThrow(/InMemoryRenderedOutputStore/)
  })
})
