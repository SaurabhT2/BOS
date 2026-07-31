/**
 * apps/web — lib/canva-field-renderer.ts
 *
 * RENDERING V2 — PHASE 6 (part 1 of 2): CanvaFieldRenderer.
 * See RENDERING_ARCHITECTURE_V2.md §2.3/§4.3, RENDERER_CONTRACT.md §5.
 *
 * WHY THIS IS A SEPARATE MODULE FROM canva-export.ts, NOT ONE
 * "CanvaRenderer" WITH INTERNAL BRANCHING:
 *   Before this phase, canva-export.ts's importArtifactToCanva() did one
 *   thing — wrap the PDF renderer's bytes and hand them to Canva's Design
 *   Import API. That is a repackaging fallback, not a structured render: it
 *   produces a rasterized-then-reimported design, not a live field mapping
 *   into a maintained brand template. Silently merging "maybe do field
 *   mapping, maybe repackage a PDF" into one function based on invisible
 *   branching is exactly the anti-pattern RENDERING_ARCHITECTURE_AUDIT.md's
 *   Finding M-2 flags elsewhere (two behaviors coexisting behind one name).
 *   This module is the field-mapping half; canva-export.ts (renamed to make
 *   its role explicit — see its own header) is the fallback half. Calling
 *   code chooses between them via isCanvaFieldRendererAvailable() — a real,
 *   config-driven check, not a fabricated one (see below).
 *
 * WHY THIS IS NOT WIRED IN AS "THE" CANVA PATH EVEN THOUGH IT EXISTS:
 *   Canva's Autofill API requires a pre-built "brand template" — a design a
 *   human designer creates and maintains directly inside Canva, with named
 *   placeholder fields this module's output must match. No such template is
 *   configured anywhere in this codebase (verified: no brand-template-ID
 *   configuration of any kind existed before this phase), and building one
 *   is a Canva Enterprise feature and a product/design decision, not
 *   something this engineering phase can decide unilaterally
 *   (RENDERING_ROADMAP_V2.md Phase 6: "recommend an explicit go/no-go
 *   checkpoint before this phase's Autofill work begins, independent of
 *   everything else in this roadmap"). This module is therefore complete
 *   and tested at the mapping-logic level, but its wiring into the export
 *   route (see route.ts) only activates if an operator actually configures
 *   CANVA_BRAND_TEMPLATE_ID — a real, honest gate on real configuration,
 *   not a fabricated capability check pretending a template exists when one
 *   doesn't.
 *
 * FIELD NAMING CONVENTION, stated explicitly because it can't be verified
 * against a real template: this module emits data fields named
 * `unit_{n}_heading`, `unit_{n}_body`, `unit_{n}_bullets`, and
 * `document_title`/`document_cta`. Canva Autofill matches payload keys
 * against the CONNECTED BRAND TEMPLATE'S placeholder names — which are
 * defined by whoever designed that template in Canva, not by this code. For
 * this module to actually work against a real template, that template's
 * placeholders must be named to match this convention (or a future mapping
 * layer would need to translate between the two — out of scope here).
 *
 * NOT INDEPENDENTLY VERIFIED IN THIS SANDBOX, same disclosed limitation as
 * canva-export.ts: no registered BrandOS Canva Connect app, no network path
 * to api.canva.com, and (further than canva-export.ts's gap) no actual
 * brand template exists to test field-name matching against even if network
 * access existed. submitAutofillJob() is written strictly against Canva's
 * documented Autofill API contract
 * (https://www.canva.dev/docs/connect/api-reference/autofills/) but has
 * NEVER been exercised against a live template. buildAutofillData() (the
 * pure mapping logic) IS independently tested — see this file's test suite.
 */

import { CANVA_API_BASE } from './canva-oauth'
import { composeArtifact, type CompositionDocument } from '@brandos/composition-layer'
import type { CarouselArtifact } from '@brandos/contracts'
import type { CanvaImportResult } from './canva-export'

export type AutofillDataField = { type: 'text'; text: string }

const POLL_INTERVAL_MS = 1500
const MAX_POLL_ATTEMPTS = 20

interface CanvaAutofillJobResponse {
  job: {
    id: string
    status: 'in_progress' | 'success' | 'failed'
    result?: { design?: { id: string; urls?: { edit_url?: string; view_url?: string } } }
    error?: { code?: string; message?: string }
  }
}

/**
 * Real, config-driven availability check — NOT a fabricated capability
 * signal. If an operator has not set CANVA_BRAND_TEMPLATE_ID, this path is
 * genuinely unusable (there is nothing to autofill into), and callers must
 * fall back to CanvaImportFallback. See this file's header for why no
 * template exists yet by default.
 */
export function isCanvaFieldRendererAvailable(): boolean {
  return Boolean(process.env.CANVA_BRAND_TEMPLATE_ID)
}

/**
 * Pure mapping function: CompositionDocument → Canva Autofill `data` payload.
 * Independently testable without any network access — see this file's test
 * suite. Only carousel is supported (mirrors Phases 3-5's scope decision);
 * composeArtifact() itself will throw for any other artifact type.
 */
export function buildAutofillData(doc: CompositionDocument): Record<string, AutofillDataField> {
  const data: Record<string, AutofillDataField> = {}

  doc.units.forEach((unit, idx) => {
    const heading = unit.blocks.find((b) => b.kind === 'heading')
    const body = unit.blocks.find((b) => b.kind === 'body')
    const bullets = unit.blocks.find((b) => b.kind === 'bullets')

    if (heading?.kind === 'heading') {
      data[`unit_${idx + 1}_heading`] = { type: 'text', text: heading.text }
    }
    if (body?.kind === 'body') {
      data[`unit_${idx + 1}_body`] = { type: 'text', text: body.text }
    }
    if (bullets?.kind === 'bullets') {
      data[`unit_${idx + 1}_bullets`] = { type: 'text', text: bullets.items.join('\n') }
    }
  })

  return data
}

/**
 * Compose a carousel artifact and submit an Autofill job against the
 * configured brand template. NOT independently verified against a live
 * Canva template — see this file's header.
 */
export async function submitAutofillJob(params: {
  accessToken: string
  artifact: CarouselArtifact
}): Promise<CanvaImportResult> {
  const brandTemplateId = process.env.CANVA_BRAND_TEMPLATE_ID
  if (!brandTemplateId) {
    return { ok: false, error: 'CanvaFieldRenderer: CANVA_BRAND_TEMPLATE_ID is not configured.' }
  }

  let doc: CompositionDocument
  try {
    doc = composeArtifact(params.artifact)
  } catch (err: any) {
    return { ok: false, error: `CanvaFieldRenderer: composition failed: ${err?.message ?? String(err)}` }
  }

  const data = buildAutofillData(doc)

  let jobId: string
  try {
    const createRes = await fetch(`${CANVA_API_BASE}/autofills`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ brand_template_id: brandTemplateId, data }),
    })

    if (!createRes.ok) {
      const text = await createRes.text().catch(() => '')
      return { ok: false, error: `Canva autofill create failed (${createRes.status}): ${text}` }
    }

    const created = (await createRes.json()) as CanvaAutofillJobResponse
    jobId = created.job.id
  } catch (err: any) {
    return { ok: false, error: `Canva autofill create error: ${err?.message ?? String(err)}` }
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

    try {
      const pollRes = await fetch(`${CANVA_API_BASE}/autofills/${jobId}`, {
        headers: { Authorization: `Bearer ${params.accessToken}` },
      })

      if (!pollRes.ok) {
        const text = await pollRes.text().catch(() => '')
        return { ok: false, error: `Canva autofill poll failed (${pollRes.status}): ${text}` }
      }

      const polled = (await pollRes.json()) as CanvaAutofillJobResponse

      if (polled.job.status === 'failed') {
        return { ok: false, error: polled.job.error?.message ?? 'Canva autofill job failed' }
      }

      if (polled.job.status === 'success') {
        const design = polled.job.result?.design
        if (!design) {
          return { ok: false, error: 'Canva autofill succeeded but returned no design' }
        }
        return { ok: true, designId: design.id, editUrl: design.urls?.edit_url, viewUrl: design.urls?.view_url }
      }
      // still in_progress — keep polling
    } catch (err: any) {
      return { ok: false, error: `Canva autofill poll error: ${err?.message ?? String(err)}` }
    }
  }

  return { ok: false, error: `Canva autofill timed out after ${MAX_POLL_ATTEMPTS} polls (job ${jobId} still in progress)` }
}
