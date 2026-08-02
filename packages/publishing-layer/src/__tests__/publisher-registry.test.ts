import { describe, it, expect } from 'vitest'
import { PublisherRegistry, PublisherNotFoundError } from '../publisher-registry'
import { DownloadPublisher } from '../publishers/download-publisher'
import { ShareLinkPublisher } from '../publishers/share-link-publisher'
import type { Actor, RenderedOutputRef } from '../types'

const actor: Actor = { userId: 'u1', role: 'owner', kind: 'human' }
const renderedOutput: RenderedOutputRef = {
  format: 'html',
  mimeType: 'text/html',
  storageKey: 'a1/v1/html-abc',
  contentHash: 'hash',
  sizeBytes: 100,
  renderedAt: new Date().toISOString(),
}

describe('PublisherRegistry', () => {
  it('starts empty', () => {
    const registry = new PublisherRegistry()
    expect(registry.list()).toEqual([])
    expect(registry.resolve('share-link')).toBeNull()
    expect(registry.has('share-link')).toBe(false)
  })

  it('registers and resolves a Publisher by id', () => {
    const registry = new PublisherRegistry()
    registry.register(new DownloadPublisher())
    expect(registry.has('download')).toBe(true)
    expect(registry.resolve('download')?.displayName).toBe('Direct Download')
    expect(registry.list()).toEqual(['download'])
  })

  it('registration is idempotent — later registration overwrites', () => {
    const registry = new PublisherRegistry()
    const first = new DownloadPublisher()
    const second = new DownloadPublisher()
    registry.register(first)
    registry.register(second)
    expect(registry.resolve('download')).toBe(second)
    expect(registry.list()).toEqual(['download'])
  })

  it('dispatches publish() to the resolved Publisher', async () => {
    const registry = new PublisherRegistry()
    registry.register(new DownloadPublisher())
    const outcome = await registry.publish('download', {
      artifactVersionId: 'v1',
      destinationId: 'd1',
      renderedOutput,
      requestedBy: actor,
      destinationConfig: {},
    })
    expect(outcome.kind).toBe('success')
  })

  it('throws PublisherNotFoundError when dispatching to an unregistered id', async () => {
    const registry = new PublisherRegistry()
    await expect(
      registry.publish('nonexistent', {
        artifactVersionId: 'v1',
        destinationId: 'd1',
        renderedOutput,
        requestedBy: actor,
        destinationConfig: {},
      }),
    ).rejects.toBeInstanceOf(PublisherNotFoundError)
  })

  it('throws PublisherNotFoundError when revoking against an unregistered id', async () => {
    const registry = new PublisherRegistry()
    await expect(
      registry.revoke('nonexistent', { destinationReference: 'ref', destinationConfig: {}, requestedBy: actor }),
    ).rejects.toBeInstanceOf(PublisherNotFoundError)
  })

  it('supports registering multiple distinct Publishers', () => {
    const registry = new PublisherRegistry()
    registry.register(new DownloadPublisher())
    registry.register(new ShareLinkPublisher())
    expect([...registry.list()].sort()).toEqual(['download', 'share-link'])
  })
})
