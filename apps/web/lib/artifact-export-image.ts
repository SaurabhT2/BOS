/**
 * apps/web — lib/artifact-export-image.ts
 *
 * RENDERING V2 — PHASE 9 (part 1 of 2): Image/Social Renderer.
 * See RENDERING_ARCHITECTURE_V2.md §4.4, RENDERING_ENGINE_DESIGN.md
 * "Image / Social Renderer", RENDERING_ROADMAP_V2.md Phase 9.
 *
 * WHY THIS IS THE ONE LEGITIMATE "SCREENSHOT THE HTML" CASE:
 *   Every other renderer in this codebase is asked to avoid rendering
 *   through a browser and re-capturing pixels as a shortcut (PDF's Finding
 *   H-1 is precisely that mistake, for PRINT). Images are different: a
 *   raster image genuinely IS pixels, so "render HTML, capture pixels" is
 *   the correct approach for this format specifically, not a compromise
 *   (RENDERING_ARCHITECTURE_V2.md §4.4). This module therefore builds on
 *   Phase 3's HTML renderer output rather than reimplementing layout from
 *   the Composition Layer directly — the one case in this codebase where a
 *   renderer legitimately depends on another renderer's output.
 *
 * WHY 'png' AND NOT A NEW FORMAT: @brandos/contracts' ExportFormat union
 * already includes 'png' (verified directly in
 * packages/contracts/src/artifact-v2.ts before writing this file) — it has
 * simply never had an implementation (RENDERING_ARCHITECTURE_AUDIT.md
 * Finding M-2 flagged this: "PNG format defined but unimplemented"). This
 * module finally implements a format the schema already promised; it does
 * not require a schema change, and the export route's own local
 * ExportFormat type (narrower than the canonical one) is what needs
 * extending, not @brandos/contracts.
 *
 * ONE ARTIFACT → MULTIPLE IMAGES, so ONE FILE: a carousel with N slides
 * produces N images (one per CompositionUnit, matching a LinkedIn
 * carousel post's own one-image-per-slide structure). This module returns
 * an array of PNG buffers; route.ts is responsible for packaging them (a
 * ZIP archive, since a single HTTP response can only carry one file) — see
 * route.ts's 'png' branch.
 *
 * NOT INDEPENDENTLY VERIFIED IN THIS SANDBOX, same disclosed limitation as
 * artifact-export-pdf.ts: no Chromium binary and no network path to fetch
 * one. The per-unit standalone HTML this module builds (buildUnitHtml())
 * IS independently tested via string assertions — see this file's test
 * suite. The actual page.screenshot() capture is NOT exercised here.
 */

import type { CarouselArtifact } from '@brandos/contracts'
import { composeArtifact, type CompositionUnit, type ResolvedTheme } from '@brandos/composition-layer'
import { escapeHtml } from './artifact-export-html'

export interface ImageExportResult {
  images: Buffer[]
  mimeType: 'image/png'
}

export interface ImageExportOptions {
  /** Target canvas size. Defaults to LinkedIn's square carousel-post dimensions (1080x1080). */
  width?: number
  height?: number
}

const DEFAULT_CANVAS = { width: 1080, height: 1080 }

function themeToCssVars(theme: ResolvedTheme): string {
  return [
    `--color-primary:${theme.palette.primary}`,
    `--color-accent:${theme.palette.accent}`,
    `--color-bg:${theme.palette.background}`,
    `--color-surface:${theme.palette.surface}`,
    `--text-primary:${theme.palette.textPrimary}`,
    `--text-secondary:${theme.palette.textSecondary}`,
    `--font-title:${theme.typography.titleFont}`,
    `--font-body:${theme.typography.bodyFont}`,
  ].join(';')
}

/**
 * A self-contained, single-unit HTML document sized exactly to the target
 * canvas — Chromium screenshots this at (width, height) with no scrolling
 * or cropping decisions to make, unlike Phase 3's multi-slide scrolling
 * document. Independently testable without a browser (see this file's test
 * suite) — this is the part of "screenshot the HTML" that doesn't actually
 * require a browser to verify.
 */
export function buildUnitHtml(unit: CompositionUnit, theme: ResolvedTheme, width: number, height: number): string {
  const heading = unit.blocks.find((b) => b.kind === 'heading')
  const body = unit.blocks.find((b) => b.kind === 'body')
  const bullets = unit.blocks.find((b) => b.kind === 'bullets')
  const callout = unit.blocks.find((b) => b.kind === 'callout')

  const bodyHtml = [
    heading?.kind === 'heading'
      ? `<h1 style="font-family:var(--font-title);font-size:56px;font-weight:800;color:var(--text-primary);line-height:1.25;margin:0 0 24px;">${escapeHtml(heading.text)}</h1>`
      : '',
    body?.kind === 'body'
      ? `<p style="font-family:var(--font-body);font-size:28px;color:var(--text-secondary);line-height:1.5;margin:0 0 20px;">${escapeHtml(body.text)}</p>`
      : '',
    bullets?.kind === 'bullets'
      ? `<ul style="list-style:none;padding:0;margin:0;">${bullets.items
          .map((b) => `<li style="font-size:26px;color:var(--text-secondary);margin-bottom:14px;">${escapeHtml(b)}</li>`)
          .join('')}</ul>`
      : '',
    callout?.kind === 'callout'
      ? `<div style="margin-top:20px;padding:20px 24px;background:rgba(255,255,255,0.06);border-left:4px solid var(--color-accent);border-radius:0 12px 12px 0;"><p style="font-size:26px;color:var(--text-primary);font-weight:700;margin:0;">${escapeHtml(callout.text)}</p></div>`
      : '',
  ].join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    :root { ${themeToCssVars(theme)} }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      width: ${width}px; height: ${height}px;
      background: linear-gradient(135deg, var(--color-bg) 0%, var(--color-surface) 100%);
      overflow: hidden;
    }
    .canvas {
      width: 100%; height: 100%;
      display: flex; flex-direction: column; justify-content: center;
      padding: 80px;
    }
  </style>
</head>
<body>
  <div class="canvas">${bodyHtml}</div>
</body>
</html>`
}

/**
 * Composes a carousel artifact and produces one PNG buffer per unit,
 * screenshotting buildUnitHtml()'s output via headless Chromium. Reuses
 * the same launch/env-resolution approach as artifact-export-pdf.ts
 * (not duplicated here — see resolveBrowserLaunchOptions in that file).
 */
export async function renderCarouselToImages(
  artifact: CarouselArtifact,
  options: ImageExportOptions = {}
): Promise<ImageExportResult> {
  const width = options.width ?? DEFAULT_CANVAS.width
  const height = options.height ?? DEFAULT_CANVAS.height
  const doc = composeArtifact(artifact)

  const { resolveBrowserLaunchOptions } = await import('./artifact-export-pdf')
  const puppeteer = await import('puppeteer-core')
  const { executablePath, args, headless } = await resolveBrowserLaunchOptions()

  const images: Buffer[] = []
  let browser: import('puppeteer-core').Browser | null = null
  try {
    browser = await puppeteer.launch({ executablePath, args, headless })
    for (const unit of doc.units) {
      const page = await browser.newPage()
      await page.setViewport({ width, height })
      await page.setContent(buildUnitHtml(unit, doc.theme, width, height), { waitUntil: 'load' })
      const screenshot = await page.screenshot({ type: 'png' })
      images.push(Buffer.from(screenshot))
      await page.close()
    }
  } finally {
    await browser?.close()
  }

  return { images, mimeType: 'image/png' }
}
