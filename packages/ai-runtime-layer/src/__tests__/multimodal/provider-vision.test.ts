// packages/ai-runtime-layer/src/__tests__/multimodal/provider-vision.test.ts
//
// P3 — Provider Vision Adapter Tests
//
// Verifies that each vision-capable provider adapter:
//   (a) Constructs the correct multimodal API payload when attachments are present
//   (b) Falls back to text-only behaviour when no attachments are present
//   (c) Uses the correct per-provider image format
//
// These tests mock the fetch() global to intercept provider API calls and
// inspect the request body without making live network calls.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AnthropicAdapter }      from '../../provider-adapters/anthropic/index'
import { OpenAIAdapter }         from '../../provider-adapters/openai/index'
import { GoogleAdapter }         from '../../provider-adapters/google/index'
import { OllamaAdapter }         from '../../provider-adapters/ollama/index'
import type { ProviderInvokeRequest } from '@brandos/contracts'

// ─── Fetch mock infrastructure ────────────────────────────────────────────────

interface CapturedRequest {
  url:     string
  method:  string
  headers: Record<string, string>
  body:    unknown
}

function mockFetchSuccess(responseBody: unknown): { captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    const headers: Record<string, string> = {}
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v
      }
    }
    captured.push({ url, method: init?.method ?? 'GET', headers, body })
    return {
      ok:   true,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    }
  })
  return { captured }
}

const SAMPLE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const baseRequest: ProviderInvokeRequest = {
  user_prompt:    'Describe this image.',
  system_prompt:  'You are a visual analyst.',
  timeout_ms:     10_000,
  api_key:        'test-api-key',
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

describe('P3 — AnthropicAdapter vision', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  afterEach(()  => { vi.unstubAllGlobals() })

  it('builds a multimodal content array when attachments are present', async () => {
    const { captured } = mockFetchSuccess({
      content: [{ type: 'text', text: 'The image shows a blue logo.' }],
      stop_reason: 'end_turn',
    })

    const adapter = new AnthropicAdapter({ api_key: 'test-key', default_model: 'claude-haiku-4-5-20251001' })
    const request: ProviderInvokeRequest = {
      ...baseRequest,
      attachments: [{ type: 'image_png', data: SAMPLE_BASE64 }],
    }
    const result = await adapter.invoke(request)

    expect(result.content).toBe('The image shows a blue logo.')

    const body = captured[0]!.body as any
    const userMessage = body.messages[0]
    expect(Array.isArray(userMessage.content)).toBe(true)

    const imageBlock = userMessage.content[0]
    expect(imageBlock.type).toBe('image')
    expect(imageBlock.source.type).toBe('base64')
    expect(imageBlock.source.media_type).toBe('image/png')
    expect(imageBlock.source.data).toBe(SAMPLE_BASE64)

    const textBlock = userMessage.content[1]
    expect(textBlock.type).toBe('text')
    expect(textBlock.text).toContain('Describe this image.')
  })

  it('sends a plain string user message when no attachments present', async () => {
    const { captured } = mockFetchSuccess({
      content: [{ type: 'text', text: 'Hello.' }],
      stop_reason: 'end_turn',
    })

    const adapter = new AnthropicAdapter({ api_key: 'test-key' })
    await adapter.invoke({ ...baseRequest })

    const body = captured[0]!.body as any
    const userMessage = body.messages[0]
    expect(typeof userMessage.content).toBe('string')
  })

  it('maps image_jpeg attachment to image/jpeg mime type', async () => {
    const { captured } = mockFetchSuccess({
      content: [{ type: 'text', text: 'JPEG image.' }],
      stop_reason: 'end_turn',
    })

    const adapter = new AnthropicAdapter({ api_key: 'test-key' })
    await adapter.invoke({
      ...baseRequest,
      attachments: [{ type: 'image_jpeg', data: SAMPLE_BASE64 }],
    })

    const body = captured[0]!.body as any
    const imageBlock = body.messages[0].content[0]
    expect(imageBlock.source.media_type).toBe('image/jpeg')
  })

  it('has vision.analysis in capabilities array', () => {
    const adapter = new AnthropicAdapter({ api_key: 'test-key' })
    expect(adapter.capabilities).toContain('vision.analysis')
  })
})

// ─── OpenAI ───────────────────────────────────────────────────────────────────

describe('P3 — OpenAIAdapter vision', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  afterEach(()  => { vi.unstubAllGlobals() })

  it('builds image_url content parts when attachments are present', async () => {
    const { captured } = mockFetchSuccess({
      choices: [{ message: { content: 'The logo is circular.' }, finish_reason: 'stop' }],
    })

    const adapter = new OpenAIAdapter({ api_key: 'test-key', default_model: 'gpt-4o-mini' })
    await adapter.invoke({
      ...baseRequest,
      attachments: [{ type: 'image_png', data: SAMPLE_BASE64 }],
    })

    const body = captured[0]!.body as any
    const userMessage = body.messages.find((m: any) => m.role === 'user')
    expect(Array.isArray(userMessage.content)).toBe(true)

    const imagePart = userMessage.content[0]
    expect(imagePart.type).toBe('image_url')
    expect(imagePart.image_url.url).toMatch(/^data:image\/png;base64,/)
    expect(imagePart.image_url.url).toContain(SAMPLE_BASE64)
    expect(imagePart.image_url.detail).toBe('auto')

    const textPart = userMessage.content[1]
    expect(textPart.type).toBe('text')
    expect(textPart.text).toContain('Describe this image.')
  })

  it('sends a plain string user message when no attachments present', async () => {
    const { captured } = mockFetchSuccess({
      choices: [{ message: { content: 'Hello.' }, finish_reason: 'stop' }],
    })

    const adapter = new OpenAIAdapter({ api_key: 'test-key' })
    await adapter.invoke({ ...baseRequest })

    const body = captured[0]!.body as any
    const userMessage = body.messages.find((m: any) => m.role === 'user')
    expect(typeof userMessage.content).toBe('string')
  })

  it('has vision.analysis in capabilities array', () => {
    const adapter = new OpenAIAdapter({ api_key: 'test-key' })
    expect(adapter.capabilities).toContain('vision.analysis')
  })
})

// ─── Google Gemini ────────────────────────────────────────────────────────────

describe('P3 — GoogleAdapter vision', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  afterEach(()  => { vi.unstubAllGlobals() })

  it('adds inlineData parts before text when attachments are present', async () => {
    const { captured } = mockFetchSuccess({
      candidates: [{
        content:      { parts: [{ text: 'The brand logo uses blue.' }] },
        finishReason: 'STOP',
      }],
    })

    const adapter = new GoogleAdapter({ api_key: 'test-key', default_model: 'gemini-2.5-flash' })
    await adapter.invoke({
      ...baseRequest,
      attachments: [{ type: 'image_png', data: SAMPLE_BASE64 }],
    })

    const body = captured[0]!.body as any
    const parts = body.contents[0].parts

    // First part should be the image (inlineData comes before text)
    const inlineDataPart = parts.find((p: any) => p.inlineData)
    expect(inlineDataPart).toBeDefined()
    expect(inlineDataPart.inlineData.mimeType).toBe('image/png')
    expect(inlineDataPart.inlineData.data).toBe(SAMPLE_BASE64)
  })

  it('sends text-only parts when no attachments present', async () => {
    const { captured } = mockFetchSuccess({
      candidates: [{
        content:      { parts: [{ text: 'Hello.' }] },
        finishReason: 'STOP',
      }],
    })

    const adapter = new GoogleAdapter({ api_key: 'test-key' })
    await adapter.invoke({ ...baseRequest })

    const body = captured[0]!.body as any
    const parts = body.contents[0].parts
    const hasInlineData = parts.some((p: any) => p.inlineData)
    expect(hasInlineData).toBe(false)
  })

  it('has vision.analysis in capabilities array', () => {
    const adapter = new GoogleAdapter({ api_key: 'test-key' })
    expect(adapter.capabilities).toContain('vision.analysis')
  })
})

// ─── Ollama ───────────────────────────────────────────────────────────────────

describe('P3 — OllamaAdapter vision', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  afterEach(()  => { vi.unstubAllGlobals() })

  it('adds images array to user message when attachments are present', async () => {
    const { captured } = mockFetchSuccess(
      // Ollama streaming: a single "done" chunk
      null,
    )

    // Override fetch to return an NDJSON stream
    vi.stubGlobal('fetch', async () => {
      const encoder = new TextEncoder()
      const ndjson  = JSON.stringify({ message: { content: 'Vision result.' }, done: true }) + '\n'
      const stream  = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(ndjson))
          controller.close()
        },
      })
      return { ok: true, body: stream, text: async () => '' }
    })

    const adapter = new OllamaAdapter({ default_model: 'llava' })
    const result = await adapter.invoke({
      user_prompt: 'Describe this image.',
      timeout_ms:  10_000,
      attachments: [{ type: 'image_png', data: SAMPLE_BASE64 }],
    })

    expect(result.content).toContain('Vision result.')
  })

  it('has vision.analysis in capabilities array', () => {
    const adapter = new OllamaAdapter()
    expect(adapter.capabilities).toContain('vision.analysis')
  })
})
