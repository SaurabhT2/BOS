/**
 * apps/web — lib/canva-export.ts
 *
 * RENDERING V2 — PHASE 6 (part 2 of 2): CanvaImportFallback.
 * See RENDERING_ARCHITECTURE_V2.md §2.3/§4.3, RENDERER_CONTRACT.md §5,
 * and lib/canva-field-renderer.ts's header for the sibling module this
 * one is now explicitly named and framed against.
 *
 * THIS MODULE'S ROLE, changed from its original framing (unchanged
 * behavior — see the ARCHITECTURE section below, carried over verbatim):
 *   Before Phase 6, this was simply "the Canva export path." It still does
 *   exactly the same thing it always did (render PDF, hand it to Canva's
 *   Design Import API, poll for completion) — what changed is that it is
 *   now explicitly named and documented as the FALLBACK path, sitting
 *   alongside CanvaFieldRenderer (lib/canva-field-renderer.ts) rather than
 *   being "the" Canva renderer with an undocumented, unbuilt Autofill
 *   alternative implied by old comments. importArtifactToCanvaFallback()
 *   is called whenever CanvaFieldRenderer.isCanvaFieldRendererAvailable()
 *   is false (i.e. no brand template is configured) — see route.ts's
 *   dispatch, which makes this choice visible at the call site rather than
 *   inside either module.
 *
 * ARCHITECTURE (unchanged from before Phase 6):
 *   Smallest viable integration: send the SAME PDF bytes the PDF renderer
 *   already produces (renderArtifactToPDF) to Canva's Design Import API,
 *   which converts it into an editable Canva design and returns an edit
 *   URL. Design Import (POST /v1/imports) requires no Enterprise tier and
 *   no pre-built template — available to any connected user, unlike
 *   CanvaFieldRenderer's Autofill path. Zero marginal rendering cost: a
 *   thin adapter around the PDF renderer, no new visual design logic.
 *
 * FLOW (asynchronous job, per Canva's documented pattern):
 *   1. Render artifact → PDF bytes (reuses lib/artifact-export-pdf.ts).
 *   2. POST /v1/imports with the PDF bytes (application/octet-stream) and
 *      an Import-Metadata header (title, mime_type).
 *   3. Poll GET /v1/imports/{jobId} until status is success/failed.
 *   4. Return the resulting design's edit_url to the caller.
 *
 * NOT INDEPENDENTLY VERIFIED IN THIS SANDBOX: there is no registered
 * BrandOS Canva Connect app and no network path to api.canva.com from
 * this environment (outside the allowed domains list). This module is
 * written strictly against Canva's documented Design Import API contract
 * (https://www.canva.dev/docs/connect/api-reference/design-imports/) but
 * the actual request/response cycle against Canva's live servers has not
 * been exercised. Flagged in the completion report's Remaining Risks.
 */

import { CANVA_API_BASE } from './canva-oauth'
import { renderArtifactToPDF } from './artifact-export-pdf'
import type { SupportedHtmlArtifactType } from './artifact-export-html'
import { safeFilenameStem } from './artifact-export-html'

export interface CanvaImportResult {
  ok: boolean
  error?: string
  designId?: string
  editUrl?: string
  viewUrl?: string
}

interface CanvaImportJobResponse {
  job: {
    id: string
    status: 'in_progress' | 'success' | 'failed'
    result?: {
      designs: Array<{
        id: string
        urls?: { edit_url?: string; view_url?: string }
      }>
    }
    error?: { code?: string; message?: string }
  }
}

const POLL_INTERVAL_MS = 1500
const MAX_POLL_ATTEMPTS = 20 // ~30s ceiling — Canva imports of a single-doc PDF are typically fast

/**
 * Render an artifact to PDF (reusing the PDF renderer) and import the
 * result into Canva as a new, editable design for the connected user.
 * This IS the fallback path (see this file's header) — use CanvaFieldRenderer
 * (lib/canva-field-renderer.ts) instead when a brand template is configured.
 */
export async function importArtifactToCanvaFallback(params: {
  accessToken: string
  artifact: Record<string, unknown>
  artifactType: SupportedHtmlArtifactType
}): Promise<CanvaImportResult> {
  const { accessToken, artifact, artifactType } = params

  let pdfBytes: Buffer
  try {
    const { bytes } = await renderArtifactToPDF(artifact, artifactType)
    pdfBytes = bytes
  } catch (err: any) {
    return { ok: false, error: `PDF render failed before Canva import: ${err?.message ?? String(err)}` }
  }

  const title = safeFilenameStem(artifact.title, artifactType)
  const importMetadata = Buffer.from(
    JSON.stringify({ title_base64: Buffer.from(title).toString('base64'), mime_type: 'application/pdf' })
  ).toString('utf8')

  // ── 1. Create the import job ────────────────────────────────────────────
  let jobId: string
  try {
    const createRes = await fetch(`${CANVA_API_BASE}/imports`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Import-Metadata': importMetadata,
      },
      body: new Uint8Array(pdfBytes),
    })

    if (!createRes.ok) {
      const text = await createRes.text().catch(() => '')
      return { ok: false, error: `Canva import create failed (${createRes.status}): ${text}` }
    }

    const created = (await createRes.json()) as CanvaImportJobResponse
    jobId = created.job.id
  } catch (err: any) {
    return { ok: false, error: `Canva import create error: ${err?.message ?? String(err)}` }
  }

  // ── 2. Poll until success/failed ────────────────────────────────────────
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))

    try {
      const pollRes = await fetch(`${CANVA_API_BASE}/imports/${jobId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!pollRes.ok) {
        const text = await pollRes.text().catch(() => '')
        return { ok: false, error: `Canva import poll failed (${pollRes.status}): ${text}` }
      }

      const polled = (await pollRes.json()) as CanvaImportJobResponse

      if (polled.job.status === 'failed') {
        return { ok: false, error: polled.job.error?.message ?? 'Canva import job failed' }
      }

      if (polled.job.status === 'success') {
        const design = polled.job.result?.designs?.[0]
        if (!design) {
          return { ok: false, error: 'Canva import succeeded but returned no design' }
        }
        return {
          ok: true,
          designId: design.id,
          editUrl: design.urls?.edit_url,
          viewUrl: design.urls?.view_url,
        }
      }
      // still in_progress — keep polling
    } catch (err: any) {
      return { ok: false, error: `Canva import poll error: ${err?.message ?? String(err)}` }
    }
  }

  return { ok: false, error: `Canva import timed out after ${MAX_POLL_ATTEMPTS} polls (job ${jobId} still in progress)` }
}
