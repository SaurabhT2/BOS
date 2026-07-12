/**
 * DegradedCognitionProvider.test.ts
 *
 * Covers the fix for "getGlobalCognitionClient() throws when
 * INTELLIGENCE_OS_API_URL/INTELLIGENCE_OS_API_KEY aren't set." Two things
 * need verifying: (1) DegradedCognitionProvider itself satisfies the full
 * CognitionProvider contract without ever attempting network I/O, and
 * (2) registering it via setGlobalCognitionClient() means
 * getGlobalCognitionClient() never throws — which is the actual bug that
 * reached CPLOrchestrator via /api/carousel.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { DegradedCognitionProvider } from '../DegradedCognitionProvider'
import {
  getGlobalCognitionClient,
  setGlobalCognitionClient,
  _resetGlobalCognitionClientForTests,
} from '../global-client'

describe('DegradedCognitionProvider', () => {
  const provider = new DegradedCognitionProvider()

  it('resolveCognitionContext() returns a degraded context, not a throw', async () => {
    const context = await provider.resolveCognitionContext({ workspaceId: 'ws-1' })
    expect(context.confidence).toBe('degraded')
    expect(context.workspaceId).toBe('ws-1')
    // Same shape createDegradedCognitionContext produces directly — this
    // is what HttpCognitionProvider itself falls back to on a failed HTTP
    // call, so downstream consumers (PersonaContributor, etc.) can't tell
    // which kind of degradation occurred.
    expect(context.identity).toBeNull()
    expect(context.visualIdentity).toBeNull()
    expect(context.provenance.signalCount).toBe(0)
  })

  it('observe() resolves without throwing (fire-and-forget contract)', async () => {
    await expect(
      provider.observe({ workspaceId: 'ws-1', requestId: 'req-1', outputText: 'x' } as any)
    ).resolves.toBeUndefined()
  })

  it('summarizeCognition() returns an all-null summary rather than throwing', async () => {
    const summary = await provider.summarizeCognition('ws-1')
    expect(summary).toEqual({
      preferredTone: null,
      audience: null,
      industry: null,
      positioning: null,
      keywords: null,
    })
  })

  it('checkHealth() reports unhealthy with a clear reason, never throws', async () => {
    const health = await provider.checkHealth()
    expect(health.healthy).toBe(false)
    expect(health.degradedReason).toMatch(/not configured/i)
  })
})

describe('setGlobalCognitionClient — the actual bootstrap-lifecycle bug', () => {
  afterEach(() => {
    _resetGlobalCognitionClientForTests()
  })

  it('getGlobalCognitionClient() throws when nothing was ever registered (the reported bug)', () => {
    expect(() => getGlobalCognitionClient()).toThrow(/not initialized/i)
  })

  it('registering a DegradedCognitionProvider means getGlobalCognitionClient() never throws', () => {
    setGlobalCognitionClient(new DegradedCognitionProvider())
    expect(() => getGlobalCognitionClient()).not.toThrow()
    expect(getGlobalCognitionClient()).toBeInstanceOf(DegradedCognitionProvider)
  })

  it('a second registration attempt is ignored — first registration wins', () => {
    const first = new DegradedCognitionProvider()
    setGlobalCognitionClient(first)
    setGlobalCognitionClient(new DegradedCognitionProvider())
    expect(getGlobalCognitionClient()).toBe(first)
  })
})
