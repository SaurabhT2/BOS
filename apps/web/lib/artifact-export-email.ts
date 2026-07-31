/**
 * apps/web — lib/artifact-export-email.ts
 *
 * RENDERING V2 — PHASE 9 (part 2 of 2): Email HTML Renderer.
 * See RENDERING_ARCHITECTURE_V2.md §4.5, RENDERING_ENGINE_DESIGN.md
 * "Email HTML Renderer", RENDERING_ROADMAP_V2.md Phase 9.
 *
 * WHY THIS IS A SEPARATE RENDERER, NOT AN EXTENSION OF artifact-export-html.ts:
 *   Newsletter's true destination is an email inbox (Outlook/Gmail/Apple
 *   Mail), not a browser — a fundamentally different constraint set from
 *   "screen-friendly" (Phase 3) or "print-friendly" (Phase 4). Email
 *   clients: (a) frequently strip <style> blocks or apply them
 *   unreliably, so styling must be fully INLINE on every element; (b) have
 *   inconsistent flexbox/grid support, so layout must use <table> — the
 *   one layout primitive every email client renders consistently; (c)
 *   don't support CSS custom properties (:root { --x: ... }) at all, so
 *   this module inlines literal resolved theme values everywhere, unlike
 *   every other renderer in this codebase. Reusing artifact-export-
 *   html.ts's output here would not be "safe to paste into a send" — it
 *   would break in real inboxes.
 *
 * SCOPE — DELIBERATELY NOT WIRED INTO THE EXPORT ROUTE/ExportFormat THIS
 * PHASE, stated plainly rather than silently left half-done:
 *   @brandos/contracts' ExportFormat union has no 'email' value, and
 *   adding one is a real (if small) canonical-schema change — the
 *   assignment's constraint is "do not redesign the generation pipeline
 *   unless absolutely necessary," and ExportFormat is read by
 *   export_metadata on BaseArtifact, which IS part of that canonical
 *   schema. More importantly: actually being useful in production means
 *   being handed to an ESP (email service provider) and SENT, not
 *   downloaded as a file — which is Publishing-layer territory
 *   (RENDERING_ROADMAP_V2.md Phase 10, itself explicitly "under-specified,
 *   pending product decisions" in the roadmap). Wiring a route branch now
 *   that just downloads a .html file nobody asked to download would be
 *   solving the wrong problem to make this phase look more "complete."
 *   This module is therefore a real, complete, tested rendering
 *   capability, ready for Phase 10 to wire into an actual send path —
 *   not a partially-integrated one.
 *
 * NOT INDEPENDENTLY VERIFIED AGAINST REAL EMAIL CLIENTS: this sandbox has
 * no way to render this output in actual Outlook/Gmail/Apple Mail and
 * inspect the result — the well-known gap between "valid HTML" and "renders
 * correctly in email clients" (particularly Outlook's Word-based rendering
 * engine) cannot be closed by string-content tests alone. This module's
 * test suite verifies structural correctness (table-based layout, no
 * <style> block, no CSS custom properties, every element carries inline
 * styles) — not actual rendered appearance in a real client.
 */

import type { NewsletterArtifact } from '@brandos/contracts'
import { composeArtifact, type CompositionBlock, type CompositionUnit, type ResolvedTheme } from '@brandos/composition-layer'
import { escapeHtml } from './artifact-export-html'

const EMAIL_WIDTH = 600 // standard email-safe content width

function renderEmailBlock(block: CompositionBlock, theme: ResolvedTheme): string {
  const td = (content: string, style: string) =>
    `<tr><td style="${style}">${content}</td></tr>`

  switch (block.kind) {
    case 'heading': {
      const size = block.level === 1 ? '28px' : block.level === 2 ? '20px' : '14px'
      return td(
        escapeHtml(block.text),
        `font-family:${theme.typography.titleFont};font-size:${size};font-weight:700;color:${theme.palette.textPrimary};padding:0 0 16px 0;line-height:1.3;`
      )
    }
    case 'body':
      return td(
        escapeHtml(block.text),
        `font-family:${theme.typography.bodyFont};font-size:15px;color:${theme.palette.textSecondary};padding:0 0 16px 0;line-height:1.6;`
      )
    case 'bullets':
      return td(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${block.items
          .map(
            (item) =>
              `<tr><td style="font-family:${theme.typography.bodyFont};font-size:15px;color:${theme.palette.textSecondary};padding:0 0 8px 0;line-height:1.5;">&bull;&nbsp;&nbsp;${escapeHtml(item)}</td></tr>`
          )
          .join('')}</table>`,
        'padding:0 0 16px 0;'
      )
    case 'callout':
      return td(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${theme.palette.surface};border-left:4px solid ${theme.palette.accent};">
          <tr><td style="padding:16px 20px;font-family:${theme.typography.bodyFont};font-size:15px;color:${theme.palette.textPrimary};font-weight:700;line-height:1.5;">${escapeHtml(block.text)}</td></tr>
        </table>`,
        'padding:0 0 16px 0;'
      )
    case 'evidence-list':
      return td(
        block.items.map((e) => `<div style="font-size:12px;color:${theme.palette.textSecondary};padding-bottom:4px;">${escapeHtml(e)}</div>`).join(''),
        'padding:0 0 16px 0;'
      )
    case 'stat-row':
      return td(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>${block.stats
          .map(
            (s) =>
              `<td align="center" style="padding:0 8px;"><div style="font-family:${theme.typography.titleFont};font-size:24px;font-weight:900;color:${theme.palette.accent};">${escapeHtml(s.value)}</div><div style="font-size:11px;color:${theme.palette.textSecondary};text-transform:uppercase;">${escapeHtml(s.label)}</div></td>`
          )
          .join('')}</tr></table>`,
        'padding:0 0 16px 0;'
      )
    case 'speaker-notes':
      return '' // never rendered — presentation-only, same convention as every other renderer
  }
}

function renderEmailUnit(unit: CompositionUnit, theme: ResolvedTheme): string {
  const blockRows = unit.blocks.map((b) => renderEmailBlock(b, theme)).join('\n')
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px 0;">
    ${blockRows}
  </table>`
}

/**
 * Table-based, fully-inline-styled email HTML for a newsletter artifact.
 * Every literal color/font value comes from the resolved theme
 * (composeArtifact()) — no CSS custom properties (unsupported by most
 * email clients), no <style> block, no external stylesheet.
 */
export function renderNewsletterToEmailHTML(artifact: NewsletterArtifact): string {
  const doc = composeArtifact(artifact)
  const unitsHtml = doc.units.map((unit) => renderEmailUnit(unit, doc.theme)).join('\n')

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(artifact.subject_line || artifact.title || 'Newsletter')}</title>
</head>
<body style="margin:0;padding:0;background-color:${doc.theme.palette.background};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${EMAIL_WIDTH}" style="max-width:${EMAIL_WIDTH}px;">
          <tr>
            <td style="padding:0 0 24px 0;border-top:4px solid ${doc.theme.palette.primary};">
              <div style="font-family:${doc.theme.typography.titleFont};font-size:24px;font-weight:800;color:${doc.theme.palette.textPrimary};padding-top:16px;">${escapeHtml(artifact.title || 'Newsletter')}</div>
              ${artifact.preview_text ? `<div style="font-family:${doc.theme.typography.bodyFont};font-size:13px;color:${doc.theme.palette.textSecondary};margin-top:4px;">${escapeHtml(artifact.preview_text)}</div>` : ''}
            </td>
          </tr>
          <tr>
            <td>
              ${unitsHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 0 0 0;text-align:center;font-family:${doc.theme.typography.bodyFont};font-size:11px;color:${doc.theme.palette.textSecondary};">
              Sent via BrandOS
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
