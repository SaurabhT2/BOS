/**
 * apps/web — lib/artifact-export-html.ts
 *
 * Pure HTML rendering functions for ArtifactV2 (carousel | deck | report).
 *
 * ARCHITECTURE:
 *   - Single source of truth for "what a self-contained, printable HTML
 *     export of an artifact looks like." Used by:
 *       1. /api/artifact/export — format=html (direct .html download)
 *       2. lib/artifact-export-pdf.ts — renders this same HTML to PDF via
 *          headless Chromium (Print to PDF), so HTML and PDF exports are
 *          guaranteed to look identical — no second rendering pipeline.
 *   - renderCarouselToHTML() is carried over UNCHANGED from the original
 *     /api/artifact/export/route.ts (was inline there since the route's
 *     P0-G comment called it "the SOLE export authority" — that authority
 *     now lives in this module + the two new sibling functions; the route
 *     itself stays the sole *endpoint*).
 *   - Pure functions only. No LLM calls. No inference. No reconstruction
 *     of structure — each function receives a fully governed ArtifactV2
 *     and renders exactly what's there (P0-F law, carried forward).
 */

import type { CarouselArtifact, DeckArtifact, ReportArtifact, NewsletterArtifact } from '@brandos/contracts'

// ─── Shared helpers ───────────────────────────────────────────────────────────

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** Safe filename stem shared by every export format. */
export function safeFilenameStem(title: unknown, fallback: string): string {
  return String(title ?? fallback)
    .replace(/[^a-z0-9_-]/gi, '-')
    .toLowerCase()
    .slice(0, 60)
}

// ─── Shared field extraction helpers ───────────────────────────────────────────
// Used by both this module's HTML renderers and artifact-export-pptx.ts, so
// "how do we safely read bullets/stats/sections off an arbitrary artifact
// Record" has exactly one implementation, not one per export format.

export function extractStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(s => s.trim()) : []
}

export interface ExtractedDeckSlide {
  type: string
  title: string
  subtitle: string | null
  body: string | null
  bullets: string[]
  stats: Array<{ value: string; label: string; delta?: string }>
  speakerNotes: string | null
}

export function extractDeckSlide(slide: Record<string, unknown>, idx: number): ExtractedDeckSlide {
  return {
    type: String(slide.type ?? 'content'),
    title: String(slide.title ?? `Slide ${idx + 1}`),
    subtitle: typeof slide.subtitle === 'string' && slide.subtitle.trim() ? slide.subtitle : null,
    body: typeof slide.body === 'string' && slide.body.trim() ? slide.body : null,
    bullets: extractStringArray(slide.bullets),
    stats: Array.isArray(slide.stats) ? slide.stats as ExtractedDeckSlide['stats'] : [],
    speakerNotes: typeof slide.speaker_notes === 'string' && slide.speaker_notes.trim() ? slide.speaker_notes : null,
  }
}

export interface ExtractedReportSection {
  heading: string
  subheading: string | null
  body: string
  keyFindings: string[]
  dataPoints: Array<{ label: string; value: string; source?: string }>
}

export function extractReportSection(section: Record<string, unknown>): ExtractedReportSection {
  return {
    heading: String(section.heading ?? ''),
    subheading: typeof section.subheading === 'string' && section.subheading.trim() ? section.subheading : null,
    body: String(section.body ?? ''),
    keyFindings: extractStringArray(section.key_findings),
    dataPoints: Array.isArray(section.data_points) ? section.data_points as ExtractedReportSection['dataPoints'] : [],
  }
}

export interface ExtractedCarouselSlide {
  role: string
  headline: string
  subheadline: string | null
  body: string | null
  bullets: string[]
  insight: string | null
  keyTakeaway: string | null
  evidence: string[]
}

export function extractCarouselSlide(
  slide: Record<string, unknown>,
  idx: number,
  totalSlides: number
): ExtractedCarouselSlide {
  return {
    role: String(slide.role ?? (idx === 0 ? 'hook' : idx === totalSlides - 1 ? 'cta' : 'insight')),
    headline: String(slide.headline ?? slide.title ?? ''),
    subheadline: typeof slide.subheadline === 'string' && slide.subheadline.trim() ? slide.subheadline : null,
    body: typeof slide.body === 'string' && slide.body.trim() ? slide.body : null,
    bullets: extractStringArray(slide.bullets),
    insight: typeof slide.insight === 'string' && slide.insight.trim() ? slide.insight : null,
    keyTakeaway: typeof slide.key_takeaway === 'string' && slide.key_takeaway.trim() ? slide.key_takeaway : null,
    evidence: extractStringArray(slide.supporting_evidence),
  }
}

// ─── Carousel HTML renderer ───────────────────────────────────────────────────
// UNCHANGED from the original /api/artifact/export/route.ts inline version.

const CAROUSEL_ROLE_COLORS: Record<string, string> = {
  hook:      '#06b6d4',
  problem:   '#ef4444',
  reframe:   '#8b5cf6',
  framework: '#f59e0b',
  evidence:  '#10b981',
  insight:   '#ec4899',
  cta:       '#06b6d4',
}

export function renderCarouselToHTML(artifact: Record<string, unknown>): string {
  const title = String(artifact.title ?? 'Carousel')
  const hook = String(artifact.hook ?? '')
  const cta = String(artifact.cta ?? '')
  const slides: Array<Record<string, unknown>> = Array.isArray(artifact.slides)
    ? artifact.slides as Array<Record<string, unknown>>
    : []

  const slideHTML = slides.map((slide, idx) => {
    const headline    = String(slide.headline ?? slide.title ?? '')
    const subheadline = typeof slide.subheadline === 'string' && slide.subheadline.trim() ? slide.subheadline : null
    const body        = typeof slide.body === 'string' && slide.body.trim() ? slide.body : null
    const insight      = typeof slide.insight === 'string' && slide.insight.trim() ? slide.insight : null
    const keyTakeaway  = typeof slide.key_takeaway === 'string' && slide.key_takeaway.trim() ? slide.key_takeaway : null
    const bullets: string[] = Array.isArray(slide.bullets)
      ? slide.bullets.map(String).filter(b => b.trim())
      : []
    const evidence: string[] = Array.isArray(slide.supporting_evidence)
      ? slide.supporting_evidence.map(String).filter(Boolean)
      : []

    const role = String(slide.role ?? (idx === 0 ? 'hook' : idx === slides.length - 1 ? 'cta' : 'insight'))
    const accentColor = CAROUSEL_ROLE_COLORS[role] ?? '#06b6d4'

    const hasContent = subheadline || body || bullets.length > 0 || insight || keyTakeaway || evidence.length > 0
    const headlineMargin = hasContent ? '12px' : '0'

    const bulletItems = bullets.map(b => `
        <li style="margin-bottom:10px;line-height:1.6;color:#d1d5db;">${escapeHtml(b)}</li>
    `).join('')

    const evidenceItems = evidence.map(e => `
        <li style="margin-bottom:8px;line-height:1.5;color:#94a3b8;font-size:14px;">${escapeHtml(e)}</li>
    `).join('')

    return `
    <div class="slide" style="
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 32px;
      margin-bottom: 20px;
      position: relative;
      overflow: hidden;
    ">
      <div style="
        position:absolute;top:0;left:0;width:4px;height:100%;
        background:${accentColor};border-radius:4px 0 0 4px;
      "></div>
      <div style="margin-left:12px;">
        <div style="
          display:inline-block;
          background:${accentColor}22;
          border:1px solid ${accentColor}44;
          color:${accentColor};
          font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
          padding:4px 10px;border-radius:20px;margin-bottom:14px;
        ">${escapeHtml(role.toUpperCase())} · Slide ${idx + 1}</div>
        <h2 style="
          font-size:22px;font-weight:800;color:#f8fafc;
          line-height:1.3;margin:0 0 ${headlineMargin};
        ">${escapeHtml(headline)}</h2>
        ${subheadline ? `<p style="font-size:16px;color:#94a3b8;margin:0 0 14px;line-height:1.55;">${escapeHtml(subheadline)}</p>` : ''}
        ${body ? `<p style="font-size:15px;color:#cbd5e1;margin:0 0 14px;line-height:1.7;">${escapeHtml(body)}</p>` : ''}
        ${bullets.length > 0 ? `<ul style="list-style:none;padding:0;margin:0 0 14px;">${bulletItems}</ul>` : ''}
        ${insight ? `
        <div style="margin-top:14px;padding:12px 16px;background:rgba(255,255,255,0.04);border-left:3px solid ${accentColor};border-radius:0 8px 8px 0;">
          <p style="font-size:11px;font-weight:700;color:${accentColor};margin:0 0 5px;text-transform:uppercase;letter-spacing:0.08em;">Key Insight</p>
          <p style="font-size:14px;color:#e2e8f0;margin:0;line-height:1.6;">${escapeHtml(insight)}</p>
        </div>` : ''}
        ${keyTakeaway ? `
        <div style="margin-top:12px;padding:10px 14px;background:rgba(255,255,255,0.03);border-radius:8px;">
          <p style="font-size:11px;font-weight:700;color:#64748b;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.08em;">Takeaway</p>
          <p style="font-size:14px;color:#cbd5e1;margin:0;line-height:1.55;">${escapeHtml(keyTakeaway)}</p>
        </div>` : ''}
        ${evidence.length > 0 ? `
        <div style="margin-top:12px;">
          <p style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 6px;">Evidence</p>
          <ul style="list-style:disc;padding-left:18px;margin:0;">${evidenceItems}</ul>
        </div>` : ''}
      </div>
    </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — BrandOS Carousel</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #020617;
      color: #e2e8f0;
      margin: 0;
      padding: 32px 16px;
      min-height: 100vh;
    }
    .container { max-width: 720px; margin: 0 auto; }
    .carousel-header {
      margin-bottom: 36px; padding: 36px;
      background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%);
      border-radius: 20px;
    }
    .carousel-title { font-size: 30px; font-weight: 900; color: #fff; margin: 0 0 12px; line-height: 1.2; }
    .carousel-hook { font-size: 16px; color: rgba(255,255,255,0.85); line-height: 1.6; margin: 0; }
    .carousel-cta {
      margin-top: 32px; padding: 24px 32px;
      background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%);
      border-radius: 14px; text-align: center;
    }
    .carousel-cta p { font-size: 17px; font-weight: 700; color: #fff; margin: 0; }
    .brandos-badge { text-align: center; margin-top: 24px; font-size: 12px; color: #475569; }
    @media print {
      body { background: #fff; color: #111; }
      .slide { border: 1px solid #ccc !important; background: #f9f9f9 !important; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="carousel-header">
      <h1 class="carousel-title">${escapeHtml(title)}</h1>
      ${hook ? `<p class="carousel-hook">${escapeHtml(hook)}</p>` : ''}
    </div>

    ${slideHTML}

    ${cta ? `
    <div class="carousel-cta">
      <p>${escapeHtml(cta)}</p>
    </div>` : ''}

    <div class="brandos-badge">
      Generated by BrandOS · ${new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}
    </div>
  </div>
</body>
</html>`
}

// ─── Deck HTML renderer ────────────────────────────────────────────────────────
// New. Mirrors the carousel renderer's visual language (dark theme, role-
// colored accent bar, print-friendly) but reads DeckSlide's distinct fields
// (type, stats, layout_hint) rather than carousel's (role, bullets, insight).

const DECK_TYPE_COLORS: Record<string, string> = {
  cover:    '#6366f1',
  agenda:   '#06b6d4',
  content:  '#f59e0b',
  divider:  '#8b5cf6',
  stats:    '#10b981',
  quote:    '#ec4899',
  closing:  '#6366f1',
}

export function renderDeckToHTML(artifact: Record<string, unknown>): string {
  const title = String(artifact.title ?? 'Deck')
  const summary = typeof artifact.summary === 'string' ? artifact.summary : ''
  const slides: Array<Record<string, unknown>> = Array.isArray(artifact.slides)
    ? artifact.slides as Array<Record<string, unknown>>
    : []

  const slideHTML = slides.map((slide, idx) => {
    const type = String(slide.type ?? 'content')
    const slideTitle = String(slide.title ?? '')
    const subtitle = typeof slide.subtitle === 'string' && slide.subtitle.trim() ? slide.subtitle : null
    const body = typeof slide.body === 'string' && slide.body.trim() ? slide.body : null
    const bullets: string[] = Array.isArray(slide.bullets) ? slide.bullets.map(String).filter(b => b.trim()) : []
    const stats: Array<{ value: string; label: string; delta?: string }> = Array.isArray(slide.stats)
      ? slide.stats as Array<{ value: string; label: string; delta?: string }>
      : []
    const speakerNotes = typeof slide.speaker_notes === 'string' && slide.speaker_notes.trim() ? slide.speaker_notes : null

    const accentColor = DECK_TYPE_COLORS[type] ?? '#6366f1'
    const isCover = type === 'cover' || type === 'closing'

    const bulletItems = bullets.map(b => `
        <li style="margin-bottom:10px;line-height:1.6;color:#d1d5db;">${escapeHtml(b)}</li>
    `).join('')

    const statItems = stats.map(s => `
        <div style="text-align:center;padding:0 16px;">
          <div style="font-size:32px;font-weight:900;color:${accentColor};line-height:1;">${escapeHtml(s.value)}</div>
          <div style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin-top:6px;">${escapeHtml(s.label)}</div>
          ${s.delta ? `<div style="font-size:12px;color:#10b981;margin-top:4px;">${escapeHtml(s.delta)}</div>` : ''}
        </div>
    `).join('')

    return `
    <div class="slide" style="
      ${isCover
        ? `background: linear-gradient(135deg, ${accentColor} 0%, #1e293b 100%); padding: 56px 40px;`
        : 'background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 40px;'}
      border: 1px solid #334155;
      border-radius: 16px;
      margin-bottom: 20px;
      position: relative;
      overflow: hidden;
      min-height: ${isCover ? '280px' : 'auto'};
      display: flex;
      flex-direction: column;
      justify-content: center;
    ">
      <div style="
        position:absolute;top:0;left:0;width:4px;height:100%;
        background:${accentColor};border-radius:4px 0 0 4px;
      "></div>
      <div style="margin-left:8px;">
        <div style="
          display:inline-block;
          background:${accentColor}22;
          border:1px solid ${accentColor}44;
          color:${accentColor};
          font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
          padding:4px 10px;border-radius:20px;margin-bottom:16px;
        ">${escapeHtml(type.toUpperCase())} · Slide ${idx + 1}</div>
        <h2 style="
          font-size:${isCover ? '34px' : '24px'};font-weight:800;color:#f8fafc;
          line-height:1.25;margin:0 0 12px;
        ">${escapeHtml(slideTitle)}</h2>
        ${subtitle ? `<p style="font-size:16px;color:#94a3b8;margin:0 0 16px;line-height:1.55;">${escapeHtml(subtitle)}</p>` : ''}
        ${body ? `<p style="font-size:15px;color:#cbd5e1;margin:0 0 16px;line-height:1.7;">${escapeHtml(body)}</p>` : ''}
        ${bullets.length > 0 ? `<ul style="list-style:none;padding:0;margin:0 0 16px;">${bulletItems}</ul>` : ''}
        ${stats.length > 0 ? `<div style="display:flex;gap:8px;justify-content:center;margin:8px 0;">${statItems}</div>` : ''}
        ${speakerNotes ? `
        <div style="margin-top:16px;padding:12px 16px;background:rgba(255,255,255,0.03);border-radius:8px;border-left:3px solid #475569;">
          <p style="font-size:11px;font-weight:700;color:#64748b;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.08em;">Speaker Notes</p>
          <p style="font-size:13px;color:#94a3b8;margin:0;line-height:1.6;font-style:italic;">${escapeHtml(speakerNotes)}</p>
        </div>` : ''}
      </div>
    </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — BrandOS Deck</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #020617; color: #e2e8f0; margin: 0; padding: 32px 16px; min-height: 100vh;
    }
    .container { max-width: 860px; margin: 0 auto; }
    .deck-header { margin-bottom: 36px; padding: 36px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 20px; }
    .deck-title { font-size: 30px; font-weight: 900; color: #fff; margin: 0 0 12px; line-height: 1.2; }
    .deck-summary { font-size: 16px; color: rgba(255,255,255,0.85); line-height: 1.6; margin: 0; }
    .brandos-badge { text-align: center; margin-top: 24px; font-size: 12px; color: #475569; }
    @media print {
      body { background: #fff; color: #111; }
      .slide { border: 1px solid #ccc !important; background: #f9f9f9 !important; page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="deck-header">
      <h1 class="deck-title">${escapeHtml(title)}</h1>
      ${summary ? `<p class="deck-summary">${escapeHtml(summary)}</p>` : ''}
    </div>

    ${slideHTML}

    <div class="brandos-badge">
      Generated by BrandOS · ${new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}
    </div>
  </div>
</body>
</html>`
}

// ─── Report HTML renderer ──────────────────────────────────────────────────────
// New. Reports have sections (heading/body/key_findings/data_points), not
// slides — a single flowing document layout rather than discrete cards,
// matching how a report is actually consumed (read top to bottom, not
// paged through).

export function renderReportToHTML(artifact: Record<string, unknown>): string {
  const title = String(artifact.title ?? 'Report')
  const summary = typeof artifact.summary === 'string' ? artifact.summary : ''
  const sections: Array<Record<string, unknown>> = Array.isArray(artifact.sections)
    ? artifact.sections as Array<Record<string, unknown>>
    : []

  const sectionHTML = sections.map((section) => {
    const heading = String(section.heading ?? '')
    const subheading = typeof section.subheading === 'string' && section.subheading.trim() ? section.subheading : null
    const body = String(section.body ?? '')
    const keyFindings: string[] = Array.isArray(section.key_findings)
      ? section.key_findings.map(String).filter(Boolean)
      : []
    const dataPoints: Array<{ label: string; value: string; source?: string }> = Array.isArray(section.data_points)
      ? section.data_points as Array<{ label: string; value: string; source?: string }>
      : []

    const findingItems = keyFindings.map(f => `
        <li style="margin-bottom:8px;line-height:1.6;color:#d1d5db;">${escapeHtml(f)}</li>
    `).join('')

    const dataPointItems = dataPoints.map(d => `
        <div style="padding:14px 18px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid #334155;min-width:140px;">
          <div style="font-size:20px;font-weight:800;color:#f472b6;">${escapeHtml(d.value)}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:4px;">${escapeHtml(d.label)}</div>
          ${d.source ? `<div style="font-size:10px;color:#64748b;margin-top:6px;">Source: ${escapeHtml(d.source)}</div>` : ''}
        </div>
    `).join('')

    // Body paragraphs split on blank lines so multi-paragraph section bodies
    // render as real paragraphs rather than one dense block.
    const bodyParas = body.split(/\n{2,}/).filter(p => p.trim())
      .map(p => `<p style="font-size:15px;color:#cbd5e1;line-height:1.75;margin:0 0 14px;">${escapeHtml(p.trim())}</p>`)
      .join('')

    return `
    <section style="margin-bottom:32px;">
      <h2 style="font-size:22px;font-weight:800;color:#f8fafc;margin:0 0 6px;line-height:1.3;">${escapeHtml(heading)}</h2>
      ${subheading ? `<p style="font-size:15px;color:#f472b6;margin:0 0 16px;font-weight:600;">${escapeHtml(subheading)}</p>` : ''}
      ${bodyParas}
      ${dataPoints.length > 0 ? `<div style="display:flex;gap:12px;flex-wrap:wrap;margin:16px 0;">${dataPointItems}</div>` : ''}
      ${keyFindings.length > 0 ? `
      <div style="margin-top:16px;padding:16px 20px;background:rgba(244,114,182,0.06);border-left:3px solid #f472b6;border-radius:0 10px 10px 0;">
        <p style="font-size:11px;font-weight:700;color:#f472b6;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.08em;">Key Findings</p>
        <ul style="list-style:disc;padding-left:18px;margin:0;">${findingItems}</ul>
      </div>` : ''}
    </section>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — BrandOS Report</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #020617; color: #e2e8f0; margin: 0; padding: 32px 16px; min-height: 100vh;
    }
    .container { max-width: 720px; margin: 0 auto; }
    .report-header { margin-bottom: 36px; padding: 36px; background: linear-gradient(135deg, #f472b6 0%, #be185d 100%); border-radius: 20px; }
    .report-title { font-size: 30px; font-weight: 900; color: #fff; margin: 0 0 12px; line-height: 1.2; }
    .report-summary { font-size: 16px; color: rgba(255,255,255,0.85); line-height: 1.6; margin: 0; }
    .report-body { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border: 1px solid #334155; border-radius: 16px; padding: 36px; }
    .brandos-badge { text-align: center; margin-top: 24px; font-size: 12px; color: #475569; }
    @media print {
      body { background: #fff; color: #111; }
      .report-body { border: 1px solid #ccc !important; background: #f9f9f9 !important; }
      section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="report-header">
      <h1 class="report-title">${escapeHtml(title)}</h1>
      ${summary ? `<p class="report-summary">${escapeHtml(summary)}</p>` : ''}
    </div>

    <div class="report-body">
      ${sectionHTML}
    </div>

    <div class="brandos-badge">
      Generated by BrandOS · ${new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}
    </div>
  </div>
</body>
</html>`
}

// ─── Newsletter HTML renderer ──────────────────────────────────────────────────
// SPRINT1-FIX (F-01): Implements the missing renderNewsletterToHTML() function.
//
// Newsletter artifacts have sections (intro, story, quick-takes, callout, cta,
// sponsor, divider) rather than slides. The HTML renderer mirrors the visual
// language of the existing carousel/deck/report renderers (dark theme, accent
// colours per section type, print-friendly) but maps to newsletter's distinct
// structure: email header (subject line, preview text, meta), followed by
// per-section cards.
//
// Section types and their fields are sourced directly from NewsletterRenderer.tsx
// in @brandos/presentation-layer — the canonical display model for all section
// types (intro/story/sponsor → body+heading+bullets; quick-takes → bullets;
// callout → callout or body; cta → body+heading+bullets; divider → HR).

const NEWSLETTER_SECTION_ACCENT: Record<string, string> = {
  intro:          '#3b82f6',   // blue-500
  story:          '#94a3b8',   // slate-400
  'quick-takes':  '#10b981',   // emerald-500
  callout:        '#f59e0b',   // amber-500
  cta:            '#8b5cf6',   // violet-500
  sponsor:        '#6b7280',   // gray-500
  divider:        '#334155',   // slate-700
}

const NEWSLETTER_SECTION_LABELS: Record<string, string> = {
  intro:          'Opening',
  story:          'Main Story',
  'quick-takes':  'Quick Takes',
  callout:        'Callout',
  cta:            'Call to Action',
  sponsor:        'Sponsor',
  divider:        '',
}

export function renderNewsletterToHTML(artifact: Record<string, unknown>): string {
  const title       = String(artifact.title ?? 'Newsletter')
  const subjectLine = String(artifact.subject_line ?? title)
  const previewText = typeof artifact.preview_text === 'string' && artifact.preview_text.trim()
    ? artifact.preview_text : ''
  const hook        = typeof artifact.hook === 'string' && artifact.hook.trim()
    ? artifact.hook : ''
  const sections: Array<Record<string, unknown>> = Array.isArray(artifact.sections)
    ? artifact.sections as Array<Record<string, unknown>>
    : []
  const meta = artifact.newsletter_meta as Record<string, unknown> | undefined

  const readMins    = typeof meta?.estimated_read_minutes === 'number' ? meta.estimated_read_minutes : null
  const sectionCnt  = typeof meta?.section_count === 'number' ? meta.section_count : sections.length
  const wordCnt     = typeof meta?.word_count === 'number' ? meta.word_count : null

  // ── Email header ─────────────────────────────────────────────────────────────
  const metaItems: string[] = []
  if (readMins !== null)  metaItems.push(`${readMins} min read`)
  if (sectionCnt)         metaItems.push(`${sectionCnt} sections`)
  if (wordCnt !== null)   metaItems.push(`${wordCnt} words`)

  const headerHTML = `
  <div style="
    background: linear-gradient(135deg, #1e3a5f 0%, #1e293b 100%);
    border: 1px solid #334155;
    border-radius: 16px;
    padding: 28px 32px;
    margin-bottom: 20px;
  ">
    <div style="
      display:inline-block;
      background: #3b82f622;
      border: 1px solid #3b82f644;
      color: #3b82f6;
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em;
      padding: 3px 10px; border-radius: 20px; margin-bottom: 12px;
    ">Newsletter</div>
    <p style="font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 4px;">Subject</p>
    <h1 style="font-size: 22px; font-weight: 800; color: #f8fafc; line-height: 1.3; margin: 0 0 10px;">${escapeHtml(subjectLine)}</h1>
    ${previewText ? `<p style="font-size: 14px; color: #94a3b8; margin: 0 0 12px; line-height: 1.6;">${escapeHtml(previewText)}</p>` : ''}
    ${metaItems.length > 0
      ? `<div style="display:flex;gap:14px;flex-wrap:wrap;">
           ${metaItems.map(m => `<span style="font-size:11px;color:#64748b;">${escapeHtml(m)}</span>`).join('')}
         </div>`
      : ''}
  </div>`

  // ── Section renderer ──────────────────────────────────────────────────────────

  function renderSection(section: Record<string, unknown>): string {
    const type    = String(section.type ?? 'story')
    const sectionId = String(section.id ?? type)
    const heading = typeof section.heading === 'string' && section.heading.trim() ? section.heading : null
    const body    = typeof section.body === 'string' && section.body.trim() ? section.body : null
    const bullets: string[] = Array.isArray(section.bullets)
      ? section.bullets.map(String).filter(b => b.trim())
      : []
    const callout = typeof section.callout === 'string' && section.callout.trim() ? section.callout : null

    if (type === 'divider') {
      return `<hr style="border:none;border-top:1px solid #334155;margin:16px 0;" />`
    }

    const accent = NEWSLETTER_SECTION_ACCENT[type] ?? '#94a3b8'
    const label  = NEWSLETTER_SECTION_LABELS[type] ?? type

    // Section-type-specific inner content (mirrors NewsletterRenderer.tsx logic)
    let innerContent = ''

    if (type === 'quick-takes') {
      if (body) {
        innerContent += `<p style="font-size:14px;color:#cbd5e1;line-height:1.7;margin:0 0 10px;">${escapeHtml(body)}</p>`
      }
      if (bullets.length > 0) {
        const bulletItems = bullets.map(b => `
          <li style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;">
            <span style="margin-top:6px;width:6px;height:6px;border-radius:50%;background:${accent};flex-shrink:0;display:inline-block;"></span>
            <span style="font-size:14px;color:#d1d5db;line-height:1.6;">${escapeHtml(b)}</span>
          </li>`).join('')
        innerContent += `<ul style="list-style:none;padding:0;margin:0;">${bulletItems}</ul>`
      }
    } else if (type === 'callout') {
      if (callout) {
        innerContent = `
          <div style="border-left:3px solid ${accent};padding-left:16px;">
            <p style="font-size:14px;color:#fde68a;font-weight:500;font-style:italic;line-height:1.6;margin:0;">${escapeHtml(callout)}</p>
          </div>`
      } else if (body) {
        innerContent = `<p style="font-size:14px;color:#cbd5e1;line-height:1.7;margin:0;">${escapeHtml(body)}</p>`
      }
    } else if (type === 'cta') {
      // CTA: centred layout with heading, body, optional bullets
      innerContent = '<div style="text-align:center;">'
      if (heading) {
        innerContent += `<h3 style="font-size:15px;font-weight:700;color:#c4b5fd;margin:0 0 8px;">${escapeHtml(heading)}</h3>`
      }
      if (body) {
        innerContent += `<p style="font-size:14px;color:#d1d5db;line-height:1.7;margin:0 0 10px;">${escapeHtml(body)}</p>`
      }
      if (bullets.length > 0) {
        const bulletItems = bullets.map(b => `
          <div style="display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:${accent};margin-bottom:4px;">
            <span>›</span><span>${escapeHtml(b)}</span>
          </div>`).join('')
        innerContent += `<div style="margin-top:6px;">${bulletItems}</div>`
      }
      innerContent += '</div>'
    } else {
      // Standard sections: intro, story, sponsor (heading + body + bullets)
      if (heading) {
        innerContent += `<h3 style="font-size:15px;font-weight:700;color:#f8fafc;margin:0 0 8px;">${escapeHtml(heading)}</h3>`
      }
      if (body) {
        // Multi-paragraph support (split on blank lines, same as renderReportToHTML)
        const paras = body.split(/\n{2,}/).filter(p => p.trim())
        const paraHTML = paras.length > 1
          ? paras.map(p => `<p style="font-size:14px;color:#cbd5e1;line-height:1.7;margin:0 0 10px;">${escapeHtml(p.trim())}</p>`).join('')
          : `<p style="font-size:14px;color:#cbd5e1;line-height:1.7;margin:0 0 10px;">${escapeHtml(body)}</p>`
        innerContent += paraHTML
      }
      if (bullets.length > 0) {
        const bulletItems = bullets.map(b => `
          <li style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;">
            <span style="margin-top:6px;width:4px;height:4px;border-radius:50%;background:#64748b;flex-shrink:0;display:inline-block;"></span>
            <span style="font-size:13px;color:#94a3b8;line-height:1.6;">${escapeHtml(b)}</span>
          </li>`).join('')
        innerContent += `<ul style="list-style:none;padding:0;margin:0;">${bulletItems}</ul>`
      }
    }

    return `
    <div style="
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      border: 1px solid #334155;
      border-radius: 14px;
      padding: 24px 28px;
      margin-bottom: 14px;
      position: relative;
      overflow: hidden;
    ">
      <div style="position:absolute;top:0;left:0;width:3px;height:100%;background:${accent};border-radius:3px 0 0 3px;"></div>
      <div style="margin-left:8px;">
        ${label
          ? `<p style="font-size:9px;text-transform:uppercase;letter-spacing:0.12em;color:#64748b;margin:0 0 8px;font-weight:700;">${escapeHtml(label)}</p>`
          : ''}
        ${innerContent}
      </div>
    </div>`
  }

  const sectionsHTML = sections.map(s => renderSection(s)).join('\n')

  // Artifact-level CTA (if not already in a section)
  const hasCTASection = sections.some(s => s.type === 'cta')
  const artifactCta   = typeof artifact.cta === 'string' && artifact.cta.trim() ? artifact.cta : ''
  const ctaSection    = (!hasCTASection && artifactCta) ? `
    <div style="
      background: linear-gradient(135deg, #2e1065 0%, #1e293b 100%);
      border: 1px solid #5b21b633;
      border-radius: 14px;
      padding: 24px 28px;
      margin-bottom: 14px;
      text-align: center;
    ">
      <p style="font-size:9px;text-transform:uppercase;letter-spacing:0.12em;color:#64748b;margin:0 0 8px;font-weight:700;">Call to Action</p>
      <p style="font-size:14px;color:#d1d5db;line-height:1.7;margin:0;">${escapeHtml(artifactCta)}</p>
    </div>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subjectLine)} — BrandOS Newsletter</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #020617;
      color: #e2e8f0;
      margin: 0;
      padding: 32px 16px;
      min-height: 100vh;
    }
    .container { max-width: 680px; margin: 0 auto; }
    .brandos-badge { text-align: center; margin-top: 24px; font-size: 12px; color: #475569; }
    @media print {
      body { background: #fff; color: #111; }
      div[style*="border-radius"] { border: 1px solid #ccc !important; background: #f9f9f9 !important; }
      hr { border-top-color: #ccc !important; }
    }
  </style>
</head>
<body>
  <div class="container">
    ${headerHTML}
    ${hook ? `<div style="font-size:15px;color:#94a3b8;line-height:1.7;margin-bottom:20px;padding:0 4px;">${escapeHtml(hook)}</div>` : ''}
    ${sectionsHTML}
    ${ctaSection}
    <div class="brandos-badge">
      Generated by BrandOS · ${new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}
    </div>
  </div>
</body>
</html>`
}

// ─── Dispatch ──────────────────────────────────────────────────────────────────

// SPRINT1-FIX (F-01): 'newsletter' added to SupportedHtmlArtifactType.
// Previously the union was 'carousel' | 'deck' | 'report', leaving newsletter
// exports returning HTTP 400 from the export route.
export type SupportedHtmlArtifactType = 'carousel' | 'deck' | 'report' | 'newsletter'

/**
 * Render any supported artifact type to HTML, dispatching on artifact_type.
 * Shared by the html export branch and the PDF renderer
 * (PDF = print this same HTML via headless Chromium).
 *
 * SPRINT1-FIX (F-01): newsletter case added.
 */
export function renderArtifactToHTML(
  artifact: Record<string, unknown>,
  artifactType: SupportedHtmlArtifactType
): string {
  switch (artifactType) {
    case 'carousel':   return renderCarouselToHTML(artifact)
    case 'deck':       return renderDeckToHTML(artifact)
    case 'report':     return renderReportToHTML(artifact)
    case 'newsletter': return renderNewsletterToHTML(artifact)
  }
}

/** Re-exported for callers that already have typed artifacts. */
export type { CarouselArtifact, DeckArtifact, ReportArtifact, NewsletterArtifact }
