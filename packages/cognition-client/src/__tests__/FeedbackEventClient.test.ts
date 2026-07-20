/**
 * FeedbackEventClient.test.ts — G-14 (Architecture Verification Report, P1)
 *
 * This client had no test coverage at all before this finding. Scoped to
 * what G-14 actually changed (retry behavior) rather than adding full
 * general-purpose coverage as a side effect of an unrelated finding.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FeedbackEventClient, type FeedbackEventInput } from '../FeedbackEventClient'

const BASE_URL = 'https://cognition.internal'
const API_KEY = 'test-api-key'

const EVENT: FeedbackEventInput = {
  userId: 'user-1',
  artifactId: 'artifact-1',
  artifactType: 'carousel',
  eventType: 'explicit_feedback',
  explicitReason: 'useful',
}

describe('FeedbackEventClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let client: FeedbackEventClient

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    client = new FeedbackEventClient({ baseUrl: BASE_URL, apiKey: API_KEY })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to /v1/intelligence/feedback and resolves on success', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(client.record(EVENT)).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/v1/intelligence/feedback`)
    expect(JSON.parse(init.body)).toEqual(EVENT)
  })

  it('retries a transient (5xx) failure and succeeds on the second attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await client.record(EVENT)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up and propagates the error once the retry budget is exhausted', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))

    await expect(client.record(EVENT)).rejects.toThrow(/returned 500/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-retryable 4xx error', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 400 }))

    await expect(client.record(EVENT)).rejects.toThrow(/returned 400/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('each retry attempt uses its own AbortController — a retry is not started with an already-aborted signal', async () => {
    const signals: AbortSignal[] = []
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      signals.push(init.signal)
      return Promise.resolve(new Response('', { status: 503 }))
    })

    await expect(client.record(EVENT)).rejects.toThrow()

    expect(signals).toHaveLength(2)
    expect(signals[0]).not.toBe(signals[1])
    expect(signals[0]!.aborted).toBe(false)
    expect(signals[1]!.aborted).toBe(false)
  })
})
