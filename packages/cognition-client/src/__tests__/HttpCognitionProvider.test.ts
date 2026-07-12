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
