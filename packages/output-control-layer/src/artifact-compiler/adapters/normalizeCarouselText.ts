// ============================================================
// @brandos/output-control-layer — artifact-compiler/adapters/normalizeCarouselText.ts
//
// Handles raw LLM text output for carousel generation —
// normalising the format before structured parsing.
//
// Responsibilities (artifact-compiler/adapters owns these):
//   - normalizeCarouselOutput : adapt LLM variability in carousel text format
//   - parseCarouselTextOutput : parse text-format carousel into structured slides
// ============================================================

// ─── Local structural types ───────────────────────────────────────────────────

export interface ParsedCarouselSlide {
  slide: number
  role: 'hook' | 'problem' | 'reframe' | 'framework' | 'evidence' | 'insight' | 'cta'
  headline: string
  subtext: string
  visual_direction: string
}

export interface ParsedCarouselMeta {
  palette: string[]
  font_style: string
  spacing: string
  cover_style: string
  cta_style: string
}

export interface ParsedCarouselResult {
  topic: string
  tone: string
  slides: ParsedCarouselSlide[]
  carousel_meta: ParsedCarouselMeta
  /** Placeholder — quality_score is populated by the control-plane orchestrator, never here */
  quality_score: 0
  engine_badge: string
}

// ─── normalizeCarouselOutput ─────────────────────────────────────────────────

/**
 * normalizeCarouselOutput — adapts LLM variability in carousel text format.
 *
 * Handles four LLM output variations:
 *   Case 1: Already in expected SLIDE N format — pass through
 *   Case 2: Numbered format  (1. Hook...)
 *   Case 3: JSON output      ({ slides: [...] })
 *   Case 4: Fallback         — return raw unchanged
 */
export function normalizeCarouselOutput(raw: string): string {
  // Case 1: Already in expected format
  if (/SLIDE\s+1/i.test(raw)) {
    return raw
  }

  // Case 2: Numbered format (1. Hook...)
  if (/^\s*1[\.\\)]/m.test(raw)) {
    const lines = raw.split('\n')
    let slideIndex = 1
    let normalized = ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (/^\d+[\.\\)]/.test(trimmed)) {
        const roleMatch = trimmed.match(/(hook|problem|reframe|framework|evidence|insight|cta)/i)
        const role = roleMatch ? roleMatch[0].toUpperCase() : 'INSIGHT'
        normalized += `\nSLIDE ${slideIndex} — ${role}\n`
        slideIndex++
      } else if (trimmed.length > 0) {
        if (!normalized.endsWith('Headline:\n')) {
          normalized += `Headline: ${trimmed}\n`
        }
      }
    }
    return normalized
  }

  // Case 3: JSON output
  try {
    const json = JSON.parse(raw)
    if (json.slides) {
      return json.slides
        .map(
          (s: Record<string, unknown>, i: number) => `
SLIDE ${i + 1} — ${(String(s['role'] ?? 'INSIGHT')).toUpperCase()}
Headline: ${s['headline'] ?? ''}
Subtext: ${s['subtext'] ?? ''}
Visual Direction: ${s['visual_direction'] ?? ''}
`
        )
        .join('\n')
    }
  } catch {
    // fall through
  }

  // Case 4: fallback — return raw
  return raw
}

// ─── parseCarouselTextOutput ─────────────────────────────────────────────────

const SLIDE_ROLES: ParsedCarouselSlide['role'][] = [
  'hook', 'problem', 'reframe', 'framework', 'evidence', 'insight', 'cta',
]

/**
 * parseCarouselTextOutput — parse text-format carousel into structured slides.
 *
 * Call AFTER normalizeCarouselOutput.
 * Throws if fewer than 4 slides are parsed — caller should treat this as a
 * retry signal.
 */
export function parseCarouselTextOutput(
  normalized: string,
  topic: string,
  tone: string,
  visualStyle?: Record<string, unknown> | undefined
): ParsedCarouselResult {
  const slides: ParsedCarouselSlide[] = []
  const lines = normalized.split('\n')

  let currentSlide: Partial<ParsedCarouselSlide> | null = null
  let slideIndex = 0

  for (const line of lines) {
    const trimmed = line.trim()

    if (/^SLIDE\s+\d+/i.test(trimmed)) {
      if (currentSlide?.headline && slideIndex <= 7) {
        slides.push({
          slide: slideIndex,
          role: SLIDE_ROLES[slideIndex - 1] ?? 'insight',
          headline: currentSlide.headline ?? '',
          subtext: currentSlide.subtext ?? '',
          visual_direction: currentSlide.visual_direction ?? '',
        })
      }
      slideIndex++
      currentSlide = {}
    } else if (/^Headline:/i.test(trimmed)) {
      if (currentSlide) currentSlide.headline = trimmed.replace(/^Headline:\s*/i, '').trim()
    } else if (/^Subtext:/i.test(trimmed)) {
      if (currentSlide) currentSlide.subtext = trimmed.replace(/^Subtext:\s*/i, '').trim()
    } else if (/^Visual Direction:/i.test(trimmed)) {
      if (currentSlide)
        currentSlide.visual_direction = trimmed.replace(/^Visual Direction:\s*/i, '').trim()
    }
  }

  // Flush last slide
  if (currentSlide?.headline && slideIndex <= 7) {
    slides.push({
      slide: slideIndex,
      role: SLIDE_ROLES[slideIndex - 1] ?? 'insight',
      headline: currentSlide.headline ?? '',
      subtext: currentSlide.subtext ?? '',
      visual_direction: currentSlide.visual_direction ?? '',
    })
  }

  if (slides.length < 4) {
    throw new Error(
      `Carousel parsing returned only ${slides.length} slides. LLM output may be malformed — please retry.`
    )
  }

  const palette: string[] = Array.isArray(visualStyle?.['palette'])
    ? (visualStyle['palette'] as string[])
    : ['#03142F', '#11D7FF', '#FFFFFF']

  return {
    topic,
    tone,
    slides: slides.slice(0, 7),
    carousel_meta: {
      palette,
      font_style: typeof visualStyle?.['typography'] === 'string' ? visualStyle['typography'] : 'bold executive',
      spacing: typeof visualStyle?.['spacing'] === 'string' ? visualStyle['spacing'] : 'generous',
      cover_style: 'bold-headline-dark',
      cta_style: 'follow-and-connect',
    },
    quality_score: 0,
    engine_badge: 'Model-Assisted • BrandOS Powered',
  }
}


