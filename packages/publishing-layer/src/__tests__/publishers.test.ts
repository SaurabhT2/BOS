import { describe, it, expect } from 'vitest'
import { ShareLinkPublisher } from '../publishers/share-link-publisher'
import { DownloadPublisher } from '../publishers/download-publisher'
import type { Actor, RenderedOutputRef } from '../types'

const actor: Actor = { userId: 'u1', role: 'owner', kind: 'human' }
const renderedOutput: RenderedOutputRef = {
  format: 'pdf',
  mimeType: 'application/pdf',
  storageKey: 'a1/v1/pdf-abc123',
  contentHash: 'abc123',
  sizeBytes: 4096,
  renderedAt: new Date().toISOString(),
}

describe('ShareLinkPublisher', () => {
  const publisher = new ShareLinkPublisher()

  it('has the expected id/displayName', () => {
    expect(publisher.id).toBe('share-link')
    expect(publisher.displayName).toBe('Share Link')
  })

  it('publish() succeeds without any external call and returns a token', async () => {
    const outcome = await publisher.publish({
      artifactVersionId: 'v1',
      destinationId: 'd1',
      renderedOutput,
      requestedBy: actor,
      destinationConfig: {},
    })
    expect(outcome.kind).toBe('success')
    if (outcome.kind === 'success') {
      expect(outcome.destinationReference).toMatch(/^[0-9a-f]{32}$/)
    }
  })

  it('publish() generates a different token on each call', async () => {
    const a = await publisher.publish({
      artifactVersionId: 'v1',
      destinationId: 'd1',
      renderedOutput,
      requestedBy: actor,
      destinationConfig: {},
    })
    const b = await publisher.publish({
      artifactVersionId: 'v1',
      destinationId: 'd1',
      renderedOutput,
      requestedBy: actor,
      destinationConfig: {},
    })
    expect(a.kind === 'success' && b.kind === 'success' && a.destinationReference !== b.destinationReference).toBe(true)
  })

  it('revoke() reports success (fully achievable, purely local — see module header)', async () => {
    const outcome = await publisher.revoke({
      destinationReference: 'sometoken',
      destinationConfig: {},
      requestedBy: actor,
    })
    expect(outcome.kind).toBe('success')
  })

  it('validateDestinationConfig accepts an empty config', () => {
    expect(publisher.validateDestinationConfig({})).toEqual({ valid: true, errors: [] })
  })

  it('validateDestinationConfig accepts a valid signedUrlTtlSeconds', () => {
    expect(publisher.validateDestinationConfig({ signedUrlTtlSeconds: 3600 })).toEqual({ valid: true, errors: [] })
  })

  it('validateDestinationConfig rejects a non-positive signedUrlTtlSeconds', () => {
    const result = publisher.validateDestinationConfig({ signedUrlTtlSeconds: -1 })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('validateDestinationConfig rejects a non-numeric signedUrlTtlSeconds', () => {
    const result = publisher.validateDestinationConfig({ signedUrlTtlSeconds: 'soon' })
    expect(result.valid).toBe(false)
  })
})

describe('DownloadPublisher', () => {
  const publisher = new DownloadPublisher()

  it('has the expected id/displayName', () => {
    expect(publisher.id).toBe('download')
    expect(publisher.displayName).toBe('Direct Download')
  })

  it('publish() succeeds and uses the storage key as its destination reference', async () => {
    const outcome = await publisher.publish({
      artifactVersionId: 'v1',
      destinationId: 'd1',
      renderedOutput,
      requestedBy: actor,
      destinationConfig: {},
    })
    expect(outcome.kind).toBe('success')
    if (outcome.kind === 'success') {
      expect(outcome.destinationReference).toBe(renderedOutput.storageKey)
    }
  })

  it('revoke() reports unsupported — no remote side-effect to undo', async () => {
    const outcome = await publisher.revoke({
      destinationReference: renderedOutput.storageKey,
      destinationConfig: {},
      requestedBy: actor,
    })
    expect(outcome.kind).toBe('unsupported')
  })

  it('validateDestinationConfig is always valid — Download takes no config', () => {
    expect(publisher.validateDestinationConfig({ anything: 'goes' })).toEqual({ valid: true, errors: [] })
  })
})
