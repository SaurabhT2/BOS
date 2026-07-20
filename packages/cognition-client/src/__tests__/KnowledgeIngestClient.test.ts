/**
 * KnowledgeIngestClient.test.ts — G-14 (Architecture Verification Report, P1)
 *
 * This client had no test coverage at all before this finding. Scoped to
 * what G-14 actually changed (retry behavior) rather than adding full
 * general-purpose coverage as a side effect of an unrelated finding.
 *
 * The key behavior under test here is deliberately asymmetric: retries are
 * only applied when `existingAssetId` is supplied (upsert-safe). A first
 * ingest (no `existingAssetId`) is NOT retried automatically, since a
 * retry after an ambiguous failure could create a duplicate KnowledgeAsset
 * row — see the client's own docblock and retryPolicy.ts's header for the
 * full reasoning.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { KnowledgeIngestClient, type KnowledgeAssetIngestInput } from '../KnowledgeIngestClient'

const BASE_URL = 'https://cognition.internal'
const API_KEY = 'test-api-key'

const ASSET: KnowledgeAssetIngestInput = {
  ownerType: 'workspace',
  workspaceId: 'ws-1',
  assetType: 'reference',
  title: 'Doc',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('KnowledgeIngestClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let client: KnowledgeIngestClient

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    client = new KnowledgeIngestClient({ baseUrl: BASE_URL, apiKey: API_KEY })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to /v1/knowledge/ingest and returns the assetId on success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { assetId: 'asset-1' }))

    const result = await client.ingestKnowledgeAsset(ASSET, 'raw content')

    expect(result).toEqual({ assetId: 'asset-1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/v1/knowledge/ingest`)
    expect(JSON.parse(init.body)).toEqual({ asset: ASSET, rawContent: 'raw content', existingAssetId: undefined })
  })

  describe('first ingest (no existingAssetId) — NOT retried', () => {
    it('fails on the first transient (5xx) error without retrying', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 503 }))

      await expect(client.ingestKnowledgeAsset(ASSET, 'raw content')).rejects.toThrow(/returned 503/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('re-ingest (existingAssetId supplied) — upsert-safe, retried', () => {
    it('retries a transient (5xx) failure and succeeds on the second attempt', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('', { status: 503 }))
        .mockResolvedValueOnce(jsonResponse(200, { assetId: 'asset-1' }))

      const result = await client.ingestKnowledgeAsset(ASSET, 'raw content', 'asset-1')

      expect(result).toEqual({ assetId: 'asset-1' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('gives up and propagates the error once the retry budget is exhausted', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 500 }))

      await expect(
        client.ingestKnowledgeAsset(ASSET, 'raw content', 'asset-1')
      ).rejects.toThrow(/returned 500/)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('does not retry a non-retryable 4xx error', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 400 }))

      await expect(
        client.ingestKnowledgeAsset(ASSET, 'raw content', 'asset-1')
      ).rejects.toThrow(/returned 400/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })
})
