/**
 * CorrectionClient.test.ts — G-14 (Architecture Verification Report, P1)
 *
 * This client had no test coverage at all before this finding. Scoped to
 * what G-14 actually changed (retry behavior) rather than adding full
 * general-purpose coverage as a side effect of an unrelated finding.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CorrectionClient, type CorrectionInput } from '../CorrectionClient'

const BASE_URL = 'https://cognition.internal'
const API_KEY = 'test-api-key'

const CORRECTION: CorrectionInput = {
  userId: 'user-1',
  correctionType: 'tone',
  correctedValue: 'more formal',
}

describe('CorrectionClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let client: CorrectionClient

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    client = new CorrectionClient({ baseUrl: BASE_URL, apiKey: API_KEY })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to /v1/intelligence/correction and resolves on success', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(client.record(CORRECTION)).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/v1/intelligence/correction`)
    expect(JSON.parse(init.body)).toEqual(CORRECTION)
  })

  it('retries a transient (5xx) failure and succeeds on the second attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await client.record(CORRECTION)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up and propagates the error once the retry budget is exhausted', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))

    await expect(client.record(CORRECTION)).rejects.toThrow(/returned 500/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-retryable 4xx error', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 422 }))

    await expect(client.record(CORRECTION)).rejects.toThrow(/returned 422/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
