/**
 * BrandOS VLM Service
 * FIXED: Replaced non-existent callLLMWithTier with callWithMode from llmRouter.
 */

import { callWithMode, isUnavailable } from './llmRouter'

export interface VLMAnalysisResult {
  colors: {
    primary: string[]
    secondary: string[]
    accent: string[]
    background: string[]
    raw_description: string
  }
  typography: {
    styles: string[]
    weight: 'light' | 'regular' | 'medium' | 'bold' | 'heavy'
    personality: string
  }
  layout: {
    structure: string
    density: 'minimal' | 'balanced' | 'dense'
    alignment: 'left' | 'center' | 'right' | 'mixed'
    grid: string
  }
  brand_tone: {
    mood: string
    energy: 'calm' | 'moderate' | 'energetic'
    formality: 'casual' | 'neutral' | 'formal'
    archetype: string
  }
  cta_patterns: {
    present: boolean
    style: string
    placement: string
    urgency: 'low' | 'medium' | 'high'
  }
  design_language: {
    style: string
    era: string
    influences: string[]
    keywords: string[]
  }
  brand_consistency: {
    score: number
    signals: string[]
    issues: string[]
  }
  competitor_signals: string[]
  creative_direction: string
  confidence: number
}

export interface VLMAnalysisRequest {
  imageBase64: string
  context?: 'brand_asset' | 'competitor' | 'ad' | 'website' | 'logo' | 'social_post' | 'deck' | undefined
  existingBrandProfile?: Record<string, any> | undefined
}

function buildAnalysisPrompt(context: VLMAnalysisRequest['context'] = 'brand_asset', existingProfile?: Record<string, any>): string {
  const contextHints: Record<string, string> = {
    brand_asset: 'This is a brand asset (logo, brand guideline, or marketing material).',
    competitor: 'This is a competitor creative or advertisement.',
    ad: 'This is an advertisement or paid creative.',
    website: 'This is a website screenshot or landing page.',
    logo: 'This is a logo or brand mark.',
    social_post: 'This is a social media post or feed content.',
    deck: 'This is a presentation slide or pitch deck.',
  }

  const existingHint = existingProfile?.semantic_profile?.primary_domain
    ? `The brand operates in: ${existingProfile.semantic_profile.primary_domain}`
    : ''

  return `You are a senior brand strategist and visual designer analyzing an image.
${contextHints[context] ?? ''}
${existingHint}

Analyze this image and return a JSON object with this exact structure:
{
  "colors": { "primary": ["#hex"], "secondary": ["#hex"], "accent": ["#hex"], "background": ["#hex"], "raw_description": "color story" },
  "typography": { "styles": ["descriptions"], "weight": "bold", "personality": "description" },
  "layout": { "structure": "description", "density": "balanced", "alignment": "left", "grid": "description" },
  "brand_tone": { "mood": "professional", "energy": "moderate", "formality": "formal", "archetype": "The Expert" },
  "cta_patterns": { "present": true, "style": "description", "placement": "bottom right", "urgency": "medium" },
  "design_language": { "style": "modern minimalist", "era": "2020s", "influences": ["influence"], "keywords": ["keyword"] },
  "brand_consistency": { "score": 78, "signals": ["signal"], "issues": ["issue"] },
  "competitor_signals": ["signal"],
  "creative_direction": "One paragraph of actionable creative direction.",
  "confidence": 82
}

Return ONLY valid JSON, no markdown, no commentary.`
}

function extractHexColors(text: string): string[] {
  const hexPattern = /#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})\b/g
  const matches = text.match(hexPattern) ?? []
  return [...new Set(matches)].slice(0, 8)
}

function buildFallbackResult(): VLMAnalysisResult {
  return {
    colors: {
      primary: ['#03142F', '#08264D'],
      secondary: ['#334155'],
      accent: ['#11D7FF'],
      background: ['#FFFFFF'],
      raw_description: 'VLM analysis unavailable — add a vision-capable API key (ANTHROPIC_API_KEY or OPENAI_API_KEY) to enable this feature.',
    },
    typography: { styles: ['sans-serif', 'bold headers'], weight: 'bold', personality: 'Professional and authoritative' },
    layout: { structure: 'Standard content layout', density: 'balanced', alignment: 'left', grid: '12-column grid' },
    brand_tone: { mood: 'professional', energy: 'moderate', formality: 'formal', archetype: 'The Expert' },
    cta_patterns: { present: false, style: 'unknown', placement: 'unknown', urgency: 'medium' },
    design_language: { style: 'modern', era: '2020s', influences: [], keywords: ['professional', 'clean'] },
    brand_consistency: { score: 0, signals: [], issues: ['Visual analysis not available — configure a vision-capable model to enable'] },
    competitor_signals: [],
    creative_direction: 'Visual analysis not available. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to enable AI-powered design insights.',
    confidence: 0,
  }
}

export async function analyzeImageWithVLM(req: VLMAnalysisRequest): Promise<VLMAnalysisResult> {
  const prompt = buildAnalysisPrompt(req.context, req.existingBrandProfile)

  let raw: string

  try {
    const result = await callWithMode(prompt, 'cloud', { imageBase64: req.imageBase64 })

    if (isUnavailable(result)) {
      console.warn('[VLMService] No vision providers available:', result.message)
      return buildFallbackResult()
    }
    raw = result.content
  } catch (err) {
    console.warn('[VLMService] Vision provider call failed:', (err as Error).message)
    return buildFallbackResult()
  }

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    return JSON.parse(cleaned) as VLMAnalysisResult
  } catch (parseErr) {
    console.warn('[VLMService] Failed to parse VLM JSON response:', parseErr)
    const extractedColors = extractHexColors(raw)
    const fallback = buildFallbackResult()
    if (extractedColors.length > 0) {
      fallback.colors.primary = extractedColors.slice(0, 2)
      fallback.colors.secondary = extractedColors.slice(2, 4)
    }
    fallback.creative_direction = raw.slice(0, 500)
    return fallback
  }
}

export async function analyzeMultipleImages(
  images: VLMAnalysisRequest[]
): Promise<{ results: VLMAnalysisResult[]; consolidated: Partial<VLMAnalysisResult> }> {

  const results = await Promise.allSettled(
    images.map(analyzeImageWithVLM)
  );

  const successful = results
    .filter(
      (r): r is PromiseFulfilledResult<VLMAnalysisResult> =>
        r.status === "fulfilled"
    )
    .map((r) => r.value);

  if (successful.length === 0) {
    return { results: [], consolidated: {} };
  }

  const primary = successful[0];

  if (!primary) {
    throw new Error("No successful VLM analyses");
  }

  const dedupe = (arr: string[]) =>
    [...new Set(arr)].slice(0, 5);

  const consolidated: Partial<VLMAnalysisResult> = {
    colors: {
      primary: dedupe(successful.flatMap(r => r.colors.primary)),
      secondary: dedupe(successful.flatMap(r => r.colors.secondary)),
      accent: dedupe(successful.flatMap(r => r.colors.accent)),
      background: dedupe(successful.flatMap(r => r.colors.background)),
      raw_description: `Consolidated from ${successful.length} images`,
    },

    design_language: {
      style: primary.design_language.style,
      era: primary.design_language.era,
      influences: dedupe(
        successful.flatMap(r => r.design_language.influences)
      ),
      keywords: dedupe(
        successful.flatMap(r => r.design_language.keywords)
      ),
    },

    brand_tone: primary.brand_tone,

    confidence: Math.round(
      successful.reduce((sum, r) => sum + r.confidence, 0) /
      successful.length
    ),
  };

  return {
    results: successful,
    consolidated,
  };
}

/**
 * G-19 (Architecture Verification Report, P2) — scanned-PDF OCR.
 *
 * Approved approach (see completion report): reuse this package's existing
 * VLM/vision provider infrastructure (the exact same `callWithMode(...,
 * 'cloud', { imageBase64 })` primitive `analyzeImageWithVLM` above already
 * uses) instead of adding a new dedicated OCR vendor/library. This function
 * is deliberately a thin sibling of `analyzeImageWithVLM`, not a variant of
 * it — the prompt asks for verbatim text transcription, not structured
 * brand analysis, and the return type is plain text, not
 * `VLMAnalysisResult`. Used by apps/web's `scanned-pdf-ocr.ts` to turn a
 * rasterized scanned-PDF page image into real `rawContent` for
 * `KnowledgeProcessor`, closing the gap `document-extraction.ts`'s own
 * "no LLM calls" boundary deliberately leaves open for a higher layer to
 * fill.
 *
 * Returns `''` (not a placeholder string) on failure/unavailability —
 * callers are expected to fall back to their own placeholder/status
 * convention (see DocumentExtractionResult), not this function's.
 */
export async function extractTextFromImageWithVLM(imageBase64: string): Promise<string> {
  const prompt = `You are an OCR engine. Transcribe ALL text visible in this image, verbatim, exactly as it appears — do not summarize, paraphrase, or describe the image. Preserve reading order (top to bottom, left to right). Output ONLY the transcribed text, with no commentary, no markdown formatting, and no preamble like "Here is the text:". If the image contains no legible text, output nothing.`

  try {
    const result = await callWithMode(prompt, 'cloud', { imageBase64 })
    if (isUnavailable(result)) {
      console.warn('[VLMService] OCR unavailable — no vision providers:', result.message)
      return ''
    }
    return result.content.trim()
  } catch (err) {
    console.warn('[VLMService] OCR provider call failed:', (err as Error).message)
    return ''
  }
}

export async function checkBrandCompliance(
  imageBase64: string,
  brandProfile: Record<string, any>
): Promise<{ score: number; issues: string[]; suggestions: string[] }> {
  const palette = brandProfile?.visualStyle?.palette ?? brandProfile?.design_profile?.brand_colors ?? []
  const toneProfile = brandProfile?.semantic_profile?.voice ?? 'Professional'

  const prompt = `You are a brand compliance auditor.
Analyze this image against these brand guidelines:
- Brand colors: ${palette.join(', ') || 'not specified'}
- Brand voice: ${toneProfile}
- Domain: ${brandProfile?.semantic_profile?.primary_domain ?? 'not specified'}

Return JSON: { "score": 75, "issues": ["..."], "suggestions": ["..."] }
Return ONLY valid JSON.`

  try {
    const result = await callWithMode(prompt, 'cloud', { imageBase64 })
    if (isUnavailable(result)) return { score: 50, issues: ['VLM compliance check unavailable — add a cloud API key'], suggestions: [] }
    const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    return JSON.parse(cleaned)
  } catch {
    return { score: 50, issues: ['VLM compliance check unavailable'], suggestions: [] }
  }
}


