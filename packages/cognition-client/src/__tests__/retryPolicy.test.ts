/**
 * retryPolicy.test.ts — G-14 (Architecture Verification Report, P1)
 */

import { describe, it, expect } from 'vitest'
import { isRetryableCognitionTransportError } from '../retryPolicy'

describe('isRetryableCognitionTransportError', () => {
  it('treats 5xx responses as retryable', () => {
    expect(isRetryableCognitionTransportError(new Error('IntelligenceOS API POST /v1/x returned 500'))).toBe(true)
    expect(isRetryableCognitionTransportError(new Error('IntelligenceOS API POST /v1/x returned 503'))).toBe(true)
  })

  it('treats 429 (rate limited) as retryable', () => {
    expect(isRetryableCognitionTransportError(new Error('IntelligenceOS API POST /v1/x returned 429'))).toBe(true)
  })

  it('treats other 4xx responses as non-retryable', () => {
    expect(isRetryableCognitionTransportError(new Error('IntelligenceOS API POST /v1/x returned 400'))).toBe(false)
    expect(isRetryableCognitionTransportError(new Error('IntelligenceOS API POST /v1/x returned 401'))).toBe(false)
    expect(isRetryableCognitionTransportError(new Error('IntelligenceOS API POST /v1/x returned 404'))).toBe(false)
  })

  it('treats network errors / aborts (no status code in the message) as retryable', () => {
    expect(isRetryableCognitionTransportError(new Error('This operation was aborted'))).toBe(true)
    expect(isRetryableCognitionTransportError(new Error('ECONNREFUSED'))).toBe(true)
  })

  it('handles non-Error thrown values without crashing', () => {
    expect(isRetryableCognitionTransportError('a plain string error')).toBe(true)
    expect(isRetryableCognitionTransportError(undefined)).toBe(true)
  })
})
