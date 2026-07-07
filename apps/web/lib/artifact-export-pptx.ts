/**
 * apps/web — lib/artifact-export-pptx.ts
 *
 * PPTX export for ArtifactV2 (carousel | deck | report).
 *
 * ARCHITECTURE DECISION:
 *   Unlike PDF (lib/artifact-export-pdf.ts), PPTX has no "print this
 *   existing HTML" path — PowerPoint's native shape/text-box model is not
 *   reachable by rendering HTML through a browser. This module is
 *   therefore a genuinely separate, from-scratch renderer, NOT a
 *   duplicate of the HTML renderer: it builds native pptxgenjs slide
 *   objects (addShape/addText) rather than HTML strings.
 *
 *   To avoid duplicating "how do we safely read bullets/stats/sections off
 *   an artifact" a third time, this module imports the SAME extraction
 *   helpers artifact-export-html.ts uses (extractCarouselSlide,
 *   extractDeckSlide, extractReportSection) — only the rendering target
 *   differs (native PPTX shapes vs. HTML strings), not the data layer.
 *
 *   Visual language intentionally mirrors the HTML renderers (dark
 *   background, role/type-colored accent bar, same color tokens) so a
 *   PPTX export and an HTML/PDF export of the same artifact look like
 *   siblings, not unrelated outputs.
 *
 * ONE SLIDE-BUILDER FUNCTION PER ARTIFACT TYPE, reused by the route exactly
 * once each — no per-format duplication beyond what the three distinct
 * artifact shapes (carousel slides / deck slides / report sections)
 * structurally require.
 */

// NOTE: pptxgenjs is intentionally NOT statically imported at the top level,
// and is loaded via createRequire (not dynamic import()) inside newPresentation().
//
// Why createRequire, not `await import('pptxgenjs')`:
//
//   pptxgenjs 4.x ships a dual-build package with an exports map:
//     { "import": "./dist/pptxgen.es.js", "require": "./dist/pptxgen.cjs.js" }
//
//   When Turbopack externalises pptxgenjs (via serverExternalPackages) and the
//   call-site uses a dynamic import() expression, Turbopack generates an ESM
//   wrapper chunk for the external. Node then resolves the package through its
//   "import" exports condition → pptxgen.es.js. That file begins with:
//
//     import JSZip from 'jszip';
//
//   jszip is a CJS-only package (no "exports" map, no ESM build). In a Next.js
//   project without "type":"module", the runtime context is CJS, and Node
//   cannot load pptxgen.es.js — an ES module — from inside a CJS context via
//   Turbopack's external module wrapper. This produces:
//
//     SyntaxError: Cannot use import statement outside a module
//
//   The CJS build (pptxgen.cjs.js) is entirely free of this problem: it opens
//   with `'use strict'; var JSZip = require('jszip');` and works correctly in
//   every Node CJS context.
//
//   createRequire forces the "require" exports condition unconditionally,
//   always resolving to pptxgen.cjs.js regardless of how Turbopack wraps the
//   caller. It bypasses webpack/Turbopack bundling entirely (pptxgenjs is in
//   serverExternalPackages) and hands off to Node's native CJS loader.
//
// Why createRequire(process.cwd() + '/_'), not createRequire(__filename):
//
//   Under Next.js 16 + Turbopack, compiled server modules are assigned virtual
//   paths (e.g. `/ROOT/apps/web/lib/artifact-export-pptx.ts`) that do not
//   exist on the real filesystem. createRequire(__filename) anchors the module
//   search to that virtual path, so Node walks up from a directory that has no
//   node_modules and throws MODULE_NOT_FOUND.
//
//   process.cwd() is always the real Next.js project root on disk — the
//   directory Next.js is launched from (`apps/web`). node_modules lives there.
//   Appending a dummy filename ('/_') gives createRequire a valid absolute path
//   string to anchor from, and Node's normal upward node_modules search finds
//   pptxgenjs immediately in `<cwd>/node_modules/pptxgenjs`.
//
//   `require('pptxgenjs')` returns the PptxGenJS constructor directly (the
//   CJS default export is the class itself, not an object with a `.default`
//   key — confirmed by inspection of pptxgen.cjs.js and verified at runtime).
import { createRequire } from 'module'
import type PptxGenJSType from 'pptxgenjs'
import {
  extractCarouselSlide,
  extractDeckSlide,
  extractReportSection,
} from './artifact-export-html'

// Anchor to the real CWD so Node's node_modules search starts from the
// actual project root, not Turbopack's virtual __filename path.
const _requireCJS = createRequire(process.cwd() + '/_')
export interface PptxExportResult {
  bytes: Buffer
  mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

// ─── Shared layout constants ───────────────────────────────────────────────────
// 16:9 widescreen, matching PowerPoint's modern default — distinct from the
// HTML renderers' max-width readable-document layout, since PPTX slides are
// presented, not scrolled.

const LAYOUT_NAME = 'BRANDOS_16x9'
const LAYOUT_W = 13.33
const LAYOUT_H = 7.5

const DARK_BG = '0F172A'
const DARK_BG_2 = '1E293B'
const TEXT_PRIMARY = 'F8FAFC'
const TEXT_SECONDARY = '94A3B8'
const TEXT_BODY = 'CBD5E1'

function newPresentation() {
  // _requireCJS forces the "require" exports condition → pptxgen.cjs.js.
  // The CJS default export IS the constructor (no .default wrapper).
  // See the comment block at the top of this file for full rationale.
  const PptxGenJS = _requireCJS('pptxgenjs') as typeof PptxGenJSType
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: LAYOUT_NAME, width: LAYOUT_W, height: LAYOUT_H })
  pptx.layout = LAYOUT_NAME
  return pptx
}

async function toBuffer(pptx: ReturnType<typeof newPresentation>): Promise<Buffer> {
  const out = await pptx.write({ outputType: 'nodebuffer' })
  return out as Buffer
}

// ─── Carousel → PPTX ────────────────────────────────────────────────────────────

const CAROUSEL_ROLE_COLORS: Record<string, string> = {
  hook:      '06B6D4',
  problem:   'EF4444',
  reframe:   '8B5CF6',
  framework: 'F59E0B',
  evidence:  '10B981',
  insight:   'EC4899',
  cta:       '06B6D4',
}

export async function renderCarouselToPPTX(artifact: Record<string, unknown>): Promise<PptxExportResult> {
  const pptx = newPresentation()
  const title = String(artifact.title ?? 'Carousel')
  const hook = typeof artifact.hook === 'string' ? artifact.hook : ''
  const cta = typeof artifact.cta === 'string' ? artifact.cta : ''
  const slidesRaw: Array<Record<string, unknown>> = Array.isArray(artifact.slides)
    ? artifact.slides as Array<Record<string, unknown>>
    : []

  // Title slide
  const titleSlide = pptx.addSlide()
  titleSlide.background = { color: DARK_BG }
  titleSlide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: LAYOUT_W, h: 2.6, fill: { color: '0EA5E9', transparency: 0 },
  })
  titleSlide.addText(title, {
    x: 0.6, y: 0.5, w: LAYOUT_W - 1.2, h: 1.4,
    fontSize: 32, bold: true, color: 'FFFFFF', fontFace: 'Arial', align: 'left',
  })
  if (hook) {
    titleSlide.addText(hook, {
      x: 0.6, y: 1.8, w: LAYOUT_W - 1.2, h: 0.7,
      fontSize: 16, italic: true, color: 'E0F2FE', fontFace: 'Arial',
    })
  }

  // One slide per carousel slide
  slidesRaw.forEach((slideRaw, idx) => {
    const s = extractCarouselSlide(slideRaw, idx, slidesRaw.length)
    const accent = CAROUSEL_ROLE_COLORS[s.role] ?? '06B6D4'

    const slide = pptx.addSlide()
    slide.background = { color: DARK_BG_2 }
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: LAYOUT_H, fill: { color: accent } })

    slide.addText(`${s.role.toUpperCase()} · SLIDE ${idx + 1}`, {
      x: 0.6, y: 0.4, w: 6, h: 0.4,
      fontSize: 11, bold: true, color: accent, fontFace: 'Arial', charSpacing: 1,
    })
    slide.addText(s.headline, {
      x: 0.6, y: 0.85, w: LAYOUT_W - 1.2, h: 1.1,
      fontSize: 26, bold: true, color: TEXT_PRIMARY, fontFace: 'Arial',
    })

    let cursorY = 2.0
    if (s.subheadline) {
      slide.addText(s.subheadline, {
        x: 0.6, y: cursorY, w: LAYOUT_W - 1.2, h: 0.6,
        fontSize: 15, color: TEXT_SECONDARY, fontFace: 'Arial',
      })
      cursorY += 0.65
    }
    if (s.body) {
      slide.addText(s.body, {
        x: 0.6, y: cursorY, w: LAYOUT_W - 1.2, h: 1.0,
        fontSize: 14, color: TEXT_BODY, fontFace: 'Arial', valign: 'top',
      })
      cursorY += 1.1
    }
    if (s.bullets.length > 0) {
      slide.addText(
        s.bullets.map(b => ({ text: b, options: { bullet: { code: '2192' }, color: TEXT_BODY, breakLine: true } })),
        { x: 0.6, y: cursorY, w: LAYOUT_W - 1.2, h: 1.6, fontSize: 14, fontFace: 'Arial', valign: 'top' }
      )
      cursorY += 1.7
    }
    if (s.keyTakeaway) {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.6, y: Math.min(cursorY, LAYOUT_H - 1.3), w: LAYOUT_W - 1.2, h: 0.9,
        fill: { color: '0E2A3D' }, line: { color: accent, width: 1 }, rectRadius: 0.06,
      })
      slide.addText(s.keyTakeaway, {
        x: 0.8, y: Math.min(cursorY, LAYOUT_H - 1.3) + 0.1, w: LAYOUT_W - 1.6, h: 0.7,
        fontSize: 13, bold: true, color: TEXT_PRIMARY, fontFace: 'Arial', valign: 'middle',
      })
    }
  })

  // Closing CTA slide
  if (cta) {
    const closing = pptx.addSlide()
    closing.background = { color: '0EA5E9' }
    closing.addText(cta, {
      x: 0.8, y: LAYOUT_H / 2 - 0.6, w: LAYOUT_W - 1.6, h: 1.2,
      fontSize: 24, bold: true, color: 'FFFFFF', fontFace: 'Arial', align: 'center', valign: 'middle',
    })
  }

  return { bytes: await toBuffer(pptx), mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
}

// ─── Deck → PPTX ────────────────────────────────────────────────────────────────

const DECK_TYPE_COLORS: Record<string, string> = {
  cover:    '6366F1',
  agenda:   '06B6D4',
  content:  'F59E0B',
  divider:  '8B5CF6',
  stats:    '10B981',
  quote:    'EC4899',
  closing:  '6366F1',
}

export async function renderDeckToPPTX(artifact: Record<string, unknown>): Promise<PptxExportResult> {
  const pptx = newPresentation()
  const slidesRaw: Array<Record<string, unknown>> = Array.isArray(artifact.slides)
    ? artifact.slides as Array<Record<string, unknown>>
    : []

  slidesRaw.forEach((slideRaw, idx) => {
    const s = extractDeckSlide(slideRaw, idx)
    const accent = DECK_TYPE_COLORS[s.type] ?? '6366F1'
    const isCover = s.type === 'cover' || s.type === 'closing'

    const slide = pptx.addSlide()
    slide.background = { color: isCover ? accent : DARK_BG_2 }
    if (!isCover) {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: LAYOUT_H, fill: { color: accent } })
    }

    slide.addText(`${s.type.toUpperCase()} · SLIDE ${idx + 1}`, {
      x: 0.6, y: 0.4, w: 8, h: 0.4,
      fontSize: 11, bold: true, color: isCover ? 'FFFFFF' : accent, fontFace: 'Arial', charSpacing: 1,
    })
    slide.addText(s.title, {
      x: 0.6, y: isCover ? 2.6 : 0.85, w: LAYOUT_W - 1.2, h: 1.3,
      fontSize: isCover ? 36 : 26, bold: true, color: isCover ? 'FFFFFF' : TEXT_PRIMARY, fontFace: 'Arial',
      valign: isCover ? 'middle' : 'top',
      align: isCover ? 'center' : 'left',
    })

    let cursorY = isCover ? 4.0 : 2.1
    if (s.subtitle) {
      slide.addText(s.subtitle, {
        x: 0.6, y: cursorY, w: LAYOUT_W - 1.2, h: 0.6,
        fontSize: 16, color: isCover ? 'E0E7FF' : TEXT_SECONDARY, fontFace: 'Arial',
        align: isCover ? 'center' : 'left',
      })
      cursorY += 0.65
    }
    if (!isCover && s.body) {
      slide.addText(s.body, {
        x: 0.6, y: cursorY, w: LAYOUT_W - 1.2, h: 1.0,
        fontSize: 14, color: TEXT_BODY, fontFace: 'Arial', valign: 'top',
      })
      cursorY += 1.1
    }
    if (!isCover && s.bullets.length > 0) {
      slide.addText(
        s.bullets.map(b => ({ text: b, options: { bullet: true, color: TEXT_BODY, breakLine: true } })),
        { x: 0.6, y: cursorY, w: LAYOUT_W - 1.2, h: 2.0, fontSize: 14, fontFace: 'Arial', valign: 'top' }
      )
      cursorY += 2.1
    }
    if (!isCover && s.stats.length > 0) {
      const statWidth = (LAYOUT_W - 1.2) / Math.max(s.stats.length, 1)
      s.stats.forEach((stat, statIdx) => {
        const x = 0.6 + statIdx * statWidth
        slide.addText(stat.value, {
          x, y: cursorY, w: statWidth, h: 0.7,
          fontSize: 28, bold: true, color: accent, fontFace: 'Arial', align: 'center',
        })
        slide.addText(stat.label, {
          x, y: cursorY + 0.7, w: statWidth, h: 0.4,
          fontSize: 11, color: TEXT_SECONDARY, fontFace: 'Arial', align: 'center',
        })
      })
    }
  })

  return { bytes: await toBuffer(pptx), mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
}

// ─── Report → PPTX ──────────────────────────────────────────────────────────────
// Reports are a flowing document, not naturally slide-shaped — but PPTX has
// no other unit of output, so each section becomes one slide (a section's
// full body still fits comfortably as slide text; very long sections will
// simply run small rather than truncate, matching pptxgenjs's own autofit
// behavior, which is the standard tradeoff for document-to-slide export).

export async function renderReportToPPTX(artifact: Record<string, unknown>): Promise<PptxExportResult> {
  const pptx = newPresentation()
  const title = String(artifact.title ?? 'Report')
  const summary = typeof artifact.summary === 'string' ? artifact.summary : ''
  const sectionsRaw: Array<Record<string, unknown>> = Array.isArray(artifact.sections)
    ? artifact.sections as Array<Record<string, unknown>>
    : []

  // Title slide
  const titleSlide = pptx.addSlide()
  titleSlide.background = { color: 'BE185D' }
  titleSlide.addText(title, {
    x: 0.8, y: LAYOUT_H / 2 - 1.0, w: LAYOUT_W - 1.6, h: 1.4,
    fontSize: 34, bold: true, color: 'FFFFFF', fontFace: 'Arial', align: 'center', valign: 'middle',
  })
  if (summary) {
    titleSlide.addText(summary, {
      x: 0.8, y: LAYOUT_H / 2 + 0.5, w: LAYOUT_W - 1.6, h: 1.0,
      fontSize: 16, color: 'FCE7F3', fontFace: 'Arial', align: 'center',
    })
  }

  sectionsRaw.forEach((sectionRaw) => {
    const s = extractReportSection(sectionRaw)
    const slide = pptx.addSlide()
    slide.background = { color: DARK_BG_2 }
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: LAYOUT_H, fill: { color: 'F472B6' } })

    slide.addText(s.heading, {
      x: 0.6, y: 0.4, w: LAYOUT_W - 1.2, h: 0.9,
      fontSize: 24, bold: true, color: TEXT_PRIMARY, fontFace: 'Arial',
    })

    let cursorY = 1.3
    if (s.subheading) {
      slide.addText(s.subheading, {
        x: 0.6, y: cursorY, w: LAYOUT_W - 1.2, h: 0.5,
        fontSize: 14, bold: true, color: 'F472B6', fontFace: 'Arial',
      })
      cursorY += 0.55
    }
    if (s.body) {
      slide.addText(s.body, {
        x: 0.6, y: cursorY, w: LAYOUT_W - 1.2, h: 3.2,
        fontSize: 13, color: TEXT_BODY, fontFace: 'Arial', valign: 'top', autoFit: true,
      })
      cursorY += 3.3
    }
    if (s.dataPoints.length > 0) {
      const dpWidth = (LAYOUT_W - 1.2) / Math.max(s.dataPoints.length, 1)
      s.dataPoints.slice(0, 4).forEach((dp, dpIdx) => {
        const x = 0.6 + dpIdx * dpWidth
        slide.addText(dp.value, {
          x, y: cursorY, w: dpWidth - 0.1, h: 0.6,
          fontSize: 22, bold: true, color: 'F472B6', fontFace: 'Arial', align: 'center',
        })
        slide.addText(dp.label, {
          x, y: cursorY + 0.6, w: dpWidth - 0.1, h: 0.4,
          fontSize: 10, color: TEXT_SECONDARY, fontFace: 'Arial', align: 'center',
        })
      })
    }
    if (s.keyFindings.length > 0) {
      slide.addText(
        s.keyFindings.map(f => ({ text: f, options: { bullet: true, color: TEXT_BODY, breakLine: true } })),
        { x: 0.6, y: LAYOUT_H - 1.6, w: LAYOUT_W - 1.2, h: 1.2, fontSize: 12, fontFace: 'Arial', valign: 'top' }
      )
    }
  })

  return { bytes: await toBuffer(pptx), mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
}

// ─── Dispatch ──────────────────────────────────────────────────────────────────

export type SupportedPptxArtifactType = 'carousel' | 'deck' | 'report'

export async function renderArtifactToPPTX(
  artifact: Record<string, unknown>,
  artifactType: SupportedPptxArtifactType
): Promise<PptxExportResult> {
  switch (artifactType) {
    case 'carousel': return renderCarouselToPPTX(artifact)
    case 'deck':      return renderDeckToPPTX(artifact)
    case 'report':    return renderReportToPPTX(artifact)
  }
}
