// packages/ai-runtime-layer/src/__tests__/multimodal/vlm-service.test.ts
//
// P3 — VLM Service Integration Tests
//
// Verifies that analyzeImageWithVLM():
//   (a) Calls callWithMode() with the correct imageBase64 option
//   (b) Returns a well-structured VLMAnalysisResult on success
//   (c) Returns a fallback result when the runtime is unavailable
//   (d) Returns a fallback result when JSON parse fails
//   (e) Does not throw — returns fallback for all error conditions

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// We mock the llmRouter module so tests don't need a real runtime singleton
vi.mock('../../llmRouter', () => ({
  callWithMode: vi.fn(),
  isUnavailable: vi.fn(),
}))

import { callWithMode, isUnavailable } from '../../llmRouter'
import { analyzeImageWithVLM, checkBrandCompliance, extractTextFromImageWithVLM } from '../../vlmService'
import type { VLMAnalysisRequest } from '../../vlmService'

const SAMPLE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const VALID_VLM_JSON = JSON.stringify({
  colors:            { primary: ['#FF0000'], secondary: ['#00FF00'], accent: ['#0000FF'], background: ['#FFFFFF'], raw_description: 'Red, green, blue' },
  typography:        { styles: ['sans-serif'], weight: 'bold', personality: 'Modern' },
  layout:            { structure: 'grid', density: 'balanced', alignment: 'left', grid: '12-col' },
  brand_tone:        { mood: 'professional', energy: 'moderate', formality: 'formal', archetype: 'The Expert' },
  cta_patterns:      { present: true, style: 'button', placement: 'bottom', urgency: 'medium' },
  design_language:   { style: 'minimalist', era: '2020s', influences: ['Swiss design'], keywords: ['clean', 'modern'] },
  brand_consistency: { score: 85, signals: ['consistent colors'], issues: [] },
  competitor_signals: [],
  creative_direction: 'Use bold typography and a blue palette.',
  confidence:        82,
})

describe('P3 — analyzeImageWithVLM()', () => {
  beforeEach(() => {
    vi.mocked(isUnavailable).mockReturnValue(false)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('passes imageBase64 to callWithMode in the options object', async () => {
    vi.mocked(callWithMode).mockResolvedValue({ content: VALID_VLM_JSON } as any)

    const req: VLMAnalysisRequest = { imageBase64: SAMPLE_BASE64, context: 'logo' }
    await analyzeImageWithVLM(req)

    expect(callWithMode).toHaveBeenCalledWith(
      expect.any(String),
      'cloud',
      expect.objectContaining({ imageBase64: SAMPLE_BASE64 }),
    )
  })

  it('returns parsed VLMAnalysisResult on success', async () => {
    vi.mocked(callWithMode).mockResolvedValue({ content: VALID_VLM_JSON } as any)

    const result = await analyzeImageWithVLM({ imageBase64: SAMPLE_BASE64 })

    expect(result.confidence).toBe(82)
    expect(result.colors.primary).toContain('#FF0000')
    expect(result.brand_tone.mood).toBe('professional')
    expect(result.creative_direction).toContain('bold typography')
  })

  it('strips ```json fences before parsing', async () => {
    vi.mocked(callWithMode).mockResolvedValue({
      content: '```json\n' + VALID_VLM_JSON + '\n```',
    } as any)

    const result = await analyzeImageWithVLM({ imageBase64: SAMPLE_BASE64 })
    expect(result.confidence).toBe(82)
  })

  it('returns fallback result when runtime is unavailable', async () => {
    vi.mocked(isUnavailable).mockReturnValue(true)
    vi.mocked(callWithMode).mockResolvedValue({ unavailable: true, message: 'No providers' } as any)

    const result = await analyzeImageWithVLM({ imageBase64: SAMPLE_BASE64 })

    expect(result.confidence).toBe(0)
    expect(result.colors.raw_description).toContain('VLM analysis unavailable')
  })

  it('returns fallback result when JSON parse fails', async () => {
    vi.mocked(callWithMode).mockResolvedValue({ content: 'not valid JSON at all' } as any)

    const result = await analyzeImageWithVLM({ imageBase64: SAMPLE_BASE64 })

    // Fallback with creative_direction set to partial raw content
    expect(result.confidence).toBe(0)
    expect(result.creative_direction).toContain('not valid JSON')
  })

  it('returns fallback result when callWithMode throws', async () => {
    vi.mocked(callWithMode).mockRejectedValue(new Error('Network error'))

    const result = await analyzeImageWithVLM({ imageBase64: SAMPLE_BASE64 })

    expect(result.confidence).toBe(0)
    // Should not throw
  })

  it('extracts hex colors from raw response on parse failure', async () => {
    vi.mocked(callWithMode).mockResolvedValue({
      content: 'Brand uses #FF0000 and #00BFFF as primary colors. Very nice.',
    } as any)

    const result = await analyzeImageWithVLM({ imageBase64: SAMPLE_BASE64 })

    // Should have extracted colors even when JSON parse failed
    const allColors = [
      ...result.colors.primary,
      ...result.colors.secondary,
      ...result.colors.accent,
    ]
    expect(allColors.some(c => c === '#FF0000' || c === '#00BFFF')).toBe(true)
  })

  it('sends different system prompt based on context', async () => {
    vi.mocked(callWithMode).mockResolvedValue({ content: VALID_VLM_JSON } as any)

    await analyzeImageWithVLM({ imageBase64: SAMPLE_BASE64, context: 'logo' })
    const logoPrompt = vi.mocked(callWithMode).mock.calls[0]![0] as string
    expect(logoPrompt).toContain('logo')

    vi.mocked(callWithMode).mockClear()

    await analyzeImageWithVLM({ imageBase64: SAMPLE_BASE64, context: 'competitor' })
    const competitorPrompt = vi.mocked(callWithMode).mock.calls[0]![0] as string
    expect(competitorPrompt).toContain('competitor')
  })
})

describe('P3 — checkBrandCompliance()', () => {
  afterEach(() => { vi.resetAllMocks() })

  it('returns compliance result on success', async () => {
    vi.mocked(isUnavailable).mockReturnValue(false)
    vi.mocked(callWithMode).mockResolvedValue({
      content: JSON.stringify({ score: 78, issues: ['Color mismatch'], suggestions: ['Use brand blue'] }),
    } as any)

    const result = await checkBrandCompliance(SAMPLE_BASE64, { semantic_profile: { primary_domain: 'tech' } })

    expect(result.score).toBe(78)
    expect(result.issues).toContain('Color mismatch')
    expect(result.suggestions).toContain('Use brand blue')
  })

  it('returns fallback on runtime unavailability', async () => {
    vi.mocked(isUnavailable).mockReturnValue(true)
    vi.mocked(callWithMode).mockResolvedValue({ unavailable: true } as any)

    const result = await checkBrandCompliance(SAMPLE_BASE64, {})
    expect(result.score).toBe(50)
    expect(result.issues[0]).toContain('unavailable')
  })
})

// G-19 (Architecture Verification Report, P2) — scanned-PDF OCR reuses
// this package's existing VLM infra via extractTextFromImageWithVLM(),
// a thin sibling of analyzeImageWithVLM() above: same callWithMode()
// primitive, different prompt (verbatim transcription, not structured
// brand analysis), plain-text return instead of a parsed VLMAnalysisResult.
describe('G-19 — extractTextFromImageWithVLM()', () => {
  beforeEach(() => {
    vi.mocked(isUnavailable).mockReturnValue(false)
  })

  afterEach(() => { vi.resetAllMocks() })

  it('passes imageBase64 to callWithMode and returns the trimmed transcription', async () => {
    vi.mocked(callWithMode).mockResolvedValue({ content: '  Invoice #1042\nTotal: $500.00  ' } as any)

    const text = await extractTextFromImageWithVLM(SAMPLE_BASE64)

    expect(text).toBe('Invoice #1042\nTotal: $500.00')
    const [, , options] = vi.mocked(callWithMode).mock.calls[0]!
    expect(options).toEqual({ imageBase64: SAMPLE_BASE64 })
  })

  it('sends an OCR-transcription prompt, not a structured-analysis prompt', async () => {
    vi.mocked(callWithMode).mockResolvedValue({ content: 'some text' } as any)

    await extractTextFromImageWithVLM(SAMPLE_BASE64)

    const prompt = vi.mocked(callWithMode).mock.calls[0]![0] as string
    expect(prompt.toLowerCase()).toContain('ocr')
    expect(prompt.toLowerCase()).toContain('transcribe')
    // Must NOT ask for JSON — this is plain-text transcription, unlike
    // every other function in this file.
    expect(prompt).not.toContain('Return ONLY valid JSON')
  })

  it('returns an empty string (not a placeholder) when no vision provider is available', async () => {
    vi.mocked(isUnavailable).mockReturnValue(true)
    vi.mocked(callWithMode).mockResolvedValue({ unavailable: true, message: 'no key configured' } as any)

    const text = await extractTextFromImageWithVLM(SAMPLE_BASE64)

    expect(text).toBe('')
  })

  it('returns an empty string (never throws) when the provider call rejects', async () => {
    vi.mocked(callWithMode).mockRejectedValue(new Error('network error'))

    const text = await extractTextFromImageWithVLM(SAMPLE_BASE64)

    expect(text).toBe('')
  })
})
