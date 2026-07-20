/**
 * @brandos/cognition-client — src/HttpCognitionProvider.ts
 *
 * The ONLY concrete implementation of CognitionProvider held anywhere in
 * BrandOS. A thin HTTP adapter — it performs no reasoning, no memory
 * lookups, no scoring, and no style resolution. It serializes a
 * CognitionRequest, calls IntelligenceOS's HTTP API, and deserializes a
 * CognitionContext. That is its entire job.
 *
 * Per INTELLIGENCE_PLATFORM_ARCHITECTURE.md's dependency rule: only this
 * package may import @platform/cognition-contract's CognitionProvider and
 * construct a concrete instance. Every other BrandOS package receives an
 * already-resolved CognitionContext value from control-plane-layer — never
 * this client, and never the contract's provider interface directly.
 */

import {
  createDegradedCognitionContext,
  type CognitionContext,
  type CognitionHealth,
  type CognitionProvider,
  type CognitionRequest,
  type CognitionSummary,
  type ObservationInput,
} from '@platform/cognition-contract'
import { Logger, withRetry } from '@brandos/shared-utils'
import { FIRE_AND_FORGET_RETRY_OPTIONS } from './retryPolicy'

const logger = new Logger('info')

export interface HttpCognitionProviderConfig {
  /** Base URL of the IntelligenceOS API, e.g. 'https://cognition.internal' */
  readonly baseUrl: string
  /** Service-to-service API key/token for authenticating to IntelligenceOS. */
  readonly apiKey: string
  /** Request timeout in ms. Default 2500 — the resolve path is synchronous
   *  in a user-facing generation request, so this must stay tight.
   *
   *  G-16 (Architecture Verification Report, P2): this default is not
   *  changed by that finding. The finding's own recommended approach is to
   *  measure real resolveCognitionContext() latency in staging/production
   *  first and set a value informed by that data — an environment this
   *  session has no access to. Raising the default without real numbers
   *  would be exactly the "arbitrary increase" the finding explicitly
   *  warns against, and this value is already a first-class override
   *  (`timeoutMs` on this config) for any deployment that has since
   *  gathered that data. See HttpCognitionProvider.test.ts's dedicated
   *  timeout/degrade test, added as part of this finding, for coverage
   *  that is valid regardless of what the eventual number should be.
   */
  readonly timeoutMs?: number
  /** Max retry attempts for resolveCognitionContext only. observe() is not
   *  retried by this client — callers that need at-least-once delivery
   *  should queue it upstream. */
  readonly maxRetries?: number
}

const DEFAULT_TIMEOUT_MS = 2500
const DEFAULT_MAX_RETRIES = 1

export class HttpCognitionProvider implements CognitionProvider {
  constructor(private readonly config: HttpCognitionProviderConfig) {}

  async resolveCognitionContext(request: CognitionRequest): Promise<CognitionContext> {
    try {
      return await withRetry(
        () => this._post<CognitionContext>('/v1/cognition/resolve', request),
        { attempts: this.config.maxRetries ?? DEFAULT_MAX_RETRIES }
      )
    } catch (err) {
      // Degraded-mode fallback: a generation request must never fail
      // outright because IntelligenceOS is unavailable. Pure data, no
      // reasoning performed here — see createDegradedCognitionContext.
      logger.error('[CognitionClient] resolveCognitionContext failed — falling back to degraded context', {
        workspaceId: request.workspaceId,
        error: (err as Error).message,
      })
      return createDegradedCognitionContext(request.workspaceId)
    }
  }

  async observe(input: ObservationInput): Promise<void> {
    try {
      // G-14 (Architecture Verification Report, P1) — was the single
      // named example of a currently-unretried call in this finding.
      // Still fully fire-and-forget from the caller's point of view
      // (void-called, never awaited at the CPL call site) — retrying
      // here only improves the odds this observation actually reaches
      // IntelligenceOS before giving up, it does not change when/whether
      // the caller waits for it.
      await withRetry(() => this._post<void>('/v1/cognition/observe', input), FIRE_AND_FORGET_RETRY_OPTIONS)
    } catch (err) {
      // Fire-and-forget by contract: observation failures must never
      // propagate to the generation path that triggered them.
      logger.warn('[CognitionClient] observe() failed — dropping observation', {
        workspaceId: input.workspaceId,
        requestId: input.requestId,
        error: (err as Error).message,
      })
    }
  }

  async summarizeCognition(workspaceId: string): Promise<CognitionSummary> {
    return this._get<CognitionSummary>(`/v1/cognition/summary?workspaceId=${encodeURIComponent(workspaceId)}`)
  }

  async checkHealth(): Promise<CognitionHealth> {
    // Integration Fix (Milestone 3, Phase 0 audit): IntelligenceOS's
    // /v1/cognition/health route encodes health state in the HTTP status
    // (200 when healthy, 503 when not) *and* returns a full CognitionHealth
    // JSON body either way. The generic `_get` helper treats any non-2xx
    // response as a transport failure and throws before the body is read,
    // which silently discarded the real `degradedReason` and replaced it
    // with a generic "returned 503" message. checkHealth() is documented as
    // "never throws" and must faithfully pass through whatever
    // CognitionHealth IntelligenceOS actually computed, so this path reads
    // the body on both 200 and 503 and only falls back to a synthetic value
    // on a genuine transport failure (network error, timeout, non-JSON body).
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    try {
      const res = await fetch(`${this.config.baseUrl}/v1/cognition/health`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: controller.signal,
      })

      // 200 (healthy) and 503 (unhealthy) both carry a real CognitionHealth
      // body — only other statuses (e.g. 401, 404, 500) indicate the
      // endpoint itself couldn't produce a health judgment.
      if (res.status === 200 || res.status === 503) {
        return (await res.json()) as CognitionHealth
      }

      throw new Error(`IntelligenceOS API GET /v1/cognition/health returned ${res.status}`)
    } catch (err) {
      logger.warn('[CognitionClient] checkHealth() failed — returning synthetic unhealthy result', {
        error: (err as Error).message,
      })
      return { healthy: false, degradedReason: (err as Error).message }
    } finally {
      clearTimeout(timeout)
    }
  }

  // ─── Internal HTTP plumbing ──────────────────────────────────────────────

  private async _post<T>(path: string, body: unknown): Promise<T> {
    return this._request<T>(path, 'POST', body)
  }

  private async _get<T>(path: string): Promise<T> {
    return this._request<T>(path, 'GET')
  }

  private async _request<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    try {
      const res = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(`IntelligenceOS API ${method} ${path} returned ${res.status}`)
      }

      if (res.status === 204) return undefined as T
      return (await res.json()) as T
    } finally {
      clearTimeout(timeout)
    }
  }
}
