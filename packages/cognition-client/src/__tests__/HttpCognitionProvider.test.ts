/**
 * HttpCognitionProvider.test.ts
 *
 * Milestone 3, Phase 3 (Testing). Previously this package — "the single
 * adapter boundary between BrandOS and IntelligenceOS" — had no tests of
 * its own, despite being the exact seam Phase 0's integration audit is
 * concerned with. These tests mock `fetch` at the wire boundary (request
 * method/path/headers/body; response status/body) so they exercise the
 * real serialization/deserialization logic without a network dependency,
 * and they encode the request/response shapes verified compatible against
 * IntelligenceOS's `src/api/http/server.ts` during the Phase 0 audit — if
 * either side's wire shape drifts, these tests are the ones that should
 * catch it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HttpCognitionProvider } from '../HttpCognitionProvider'
import type {
  CognitionContext,
  ObservationInput,
} from '@platform/cognition-contract'

const BASE_URL = 'https://cognition.internal'
const API_KEY = 'test-api-key'

function makeContext(overrides: Partial<CognitionContext> = {}): CognitionContext {
  return {
    contractVersion: '1.0.0',
    workspaceId: 'ws-1',
    resolvedAt: '2026-06-01T00:00:00.000Z',
    confidence: 'high',
    voice: {
      tone: 'professional',
      cadence: 'medium',
      audienceType: 'b2b',
      executiveLevel: false,
      domain: 'saas',
      bannedPhrases: [],
    },
    identity: null,
    visualIdentity: null,
    provenance: { signalCount: 4, lastConsolidatedAt: null },
    // EM-1.1 (Cognitive Platform Evolution Program) — now-required
    // (nullable) fields; null is this factory's correct default, same as
    // identity/visualIdentity above. Overridable via `overrides` like
    // every other field here.
    knowledge: null,
    reasoning: null,
    positioning: null,
    ...overrides,
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('HttpCognitionProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let provider: HttpCognitionProvider

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    provider = new HttpCognitionProvider({ baseUrl: BASE_URL, apiKey: API_KEY, maxRetries: 1 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('resolveCognitionContext', () => {
    it('POSTs to /v1/cognition/resolve with the request body and Bearer auth', async () => {
      const context = makeContext()
      fetchMock.mockResolvedValueOnce(jsonResponse(200, context))

      const result = await provider.resolveCognitionContext({ workspaceId: 'ws-1', taskType: 'blog' })

      expect(result).toEqual(context)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`${BASE_URL}/v1/cognition/resolve`)
      expect(init.method).toBe('POST')
      expect(init.headers.Authorization).toBe(`Bearer ${API_KEY}`)
      expect(init.headers['Content-Type']).toBe('application/json')
      expect(JSON.parse(init.body)).toEqual({ workspaceId: 'ws-1', taskType: 'blog' })
    })

    it('falls back to a degraded context (never throws) when IntelligenceOS is unreachable', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

      const result = await provider.resolveCognitionContext({ workspaceId: 'ws-2' })

      expect(result.workspaceId).toBe('ws-2')
      expect(result.confidence).toBe('degraded')
    })

    it('falls back to a degraded context when the API returns a non-2xx status', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 500 }))

      const result = await provider.resolveCognitionContext({ workspaceId: 'ws-3' })

      expect(result.confidence).toBe('degraded')
      expect(result.workspaceId).toBe('ws-3')
    })

    // G-16 (Architecture Verification Report, P2) — this package had no
    // test exercising the timeout path at all. A numeric change to
    // DEFAULT_TIMEOUT_MS is deliberately NOT made as part of this finding
    // (see this file's own note below and the completion report) — real
    // production/staging latency data is needed to pick a value with
    // actual margin, which isn't available in this environment. This test
    // is valuable independent of whatever that number ends up being: it
    // pins down that a response slower than the configured timeout is
    // aborted and degrades gracefully, never hangs, and never throws.
    it('aborts and degrades gracefully when IntelligenceOS responds slower than the configured timeout', async () => {
      // Fake timers so this test resolves instantly instead of taking
      // wall-clock milliseconds.
      vi.useFakeTimers()
      try {
        const slowProvider = new HttpCognitionProvider({
          baseUrl: BASE_URL,
          apiKey: API_KEY,
          timeoutMs: 100,
          maxRetries: 1, // one attempt only — isolates the timeout behavior itself
        })

        // fetch() that never resolves on its own — only the AbortSignal
        // (wired up by HttpCognitionProvider around this call) ends it,
        // exactly like a real hung connection to a slow/unresponsive
        // IntelligenceOS instance.
        fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
          return new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              const err = new Error('This operation was aborted')
              err.name = 'AbortError'
              reject(err)
            })
          })
        })

        const resultPromise = slowProvider.resolveCognitionContext({ workspaceId: 'ws-slow' })
        await vi.advanceTimersByTimeAsync(100)
        const result = await resultPromise

        expect(result.confidence).toBe('degraded')
        expect(result.workspaceId).toBe('ws-slow')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('observe', () => {
    it('POSTs to /v1/cognition/observe and resolves even on failure (fire-and-forget)', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

      const input: ObservationInput = {
        workspaceId: 'ws-1',
        requestId: 'req-1',
        outputText: 'hello',
        score: 0.9,
      }
      await expect(provider.observe(input)).resolves.toBeUndefined()

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`${BASE_URL}/v1/cognition/observe`)
      expect(JSON.parse(init.body)).toEqual(input)
    })

    it('swallows errors instead of propagating them', async () => {
      fetchMock.mockRejectedValue(new Error('network down'))

      await expect(
        provider.observe({ workspaceId: 'ws-1', requestId: 'req-2', outputText: 'x', score: 0.5 })
      ).resolves.toBeUndefined()
    })

    // G-14 (Architecture Verification Report, P1) — observe() was the
    // finding's explicitly named example of a currently-unretried call.
    it('retries a transient (5xx) failure and succeeds on the second attempt', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('', { status: 503 }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }))

      await provider.observe({ workspaceId: 'ws-1', requestId: 'req-3', outputText: 'x', score: 0.5 })

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('gives up (but still resolves, not throws) once the retry budget is exhausted', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 503 }))

      await expect(
        provider.observe({ workspaceId: 'ws-1', requestId: 'req-4', outputText: 'x', score: 0.5 })
      ).resolves.toBeUndefined()

      // FIRE_AND_FORGET_RETRY_OPTIONS.attempts = 2 — one retry, two calls total.
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('does not retry a 400 (non-retryable) — fails fast on the first attempt', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 400 }))

      await expect(
        provider.observe({ workspaceId: 'ws-1', requestId: 'req-5', outputText: 'x', score: 0.5 })
      ).resolves.toBeUndefined()

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('summarizeCognition', () => {
    it('GETs /v1/cognition/summary with an encoded workspaceId query param', async () => {
      const summary = {
        preferredTone: 'confident',
        audience: 'b2b',
        industry: 'saas',
        positioning: null,
        keywords: null,
      }
      fetchMock.mockResolvedValueOnce(jsonResponse(200, summary))

      const result = await provider.summarizeCognition('ws with spaces')

      expect(result).toEqual(summary)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`${BASE_URL}/v1/cognition/summary?workspaceId=ws%20with%20spaces`)
      expect(init.method).toBe('GET')
    })
  })

  describe('checkHealth', () => {
    it('returns the real body on a healthy (200) response', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { healthy: true }))

      const result = await provider.checkHealth()

      expect(result).toEqual({ healthy: true })
    })

    // Integration Fix regression test — see HttpCognitionProvider.checkHealth().
    // IntelligenceOS's /health route returns 503 (not 200) when unhealthy,
    // but still sends a full CognitionHealth JSON body with the real reason.
    it('preserves the real degradedReason from a 503 response instead of discarding it', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(503, { healthy: false, degradedReason: 'database connection refused' })
      )

      const result = await provider.checkHealth()

      expect(result).toEqual({ healthy: false, degradedReason: 'database connection refused' })
    })

    it('falls back to a synthetic unhealthy result on a genuine transport failure', async () => {
      fetchMock.mockRejectedValue(new Error('ETIMEDOUT'))

      const result = await provider.checkHealth()

      expect(result.healthy).toBe(false)
      expect(result.degradedReason).toMatch(/ETIMEDOUT/)
    })

    it('falls back to a synthetic unhealthy result on an unexpected status (e.g. 401)', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))

      const result = await provider.checkHealth()

      expect(result.healthy).toBe(false)
      expect(result.degradedReason).toMatch(/401/)
    })
  })
})
