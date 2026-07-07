/**
 * apps/web — lib/export-adapters.ts
 *
 * SPRINT2-CHANGE (F-04): IRendererAdapter and IExporter wrappers for all
 * supported artifact types. Registered in instrumentation.ts at server boot.
 *
 * ARCHITECTURE:
 *   This file activates the IExporter / IRendererAdapter registry slots in
 *   @brandos/artifact-engine-layer's ArtifactRegistry, which were previously
 *   empty (confirmed by audit, Finding F-04). Adding a new export format or
 *   artifact type now only requires:
 *     1. Implement the render/export function in the relevant lib/ file.
 *     2. Create an adapter class here.
 *     3. Register it in instrumentation.ts.
 *     No route changes needed. No dispatch logic changes needed.
 *
 *   LAYER PLACEMENT (correct — L10 implements L6 interfaces):
 *     - L6 interfaces (IRendererAdapter, IExporter) live in @brandos/artifact-engine-layer.
 *     - L10 implementations live here in apps/web (the only layer that can
 *       import both the lib/ functions and the L6 interfaces).
 *     - The adapters import lib/ functions (apps/web-internal, same layer).
 *     - No new cross-layer imports: this file stays within L10.
 *
 *   SEPARATION FROM PRESENTATION-LAYER RendererRegistry (RendererRegistry.ts):
 *     - RendererRegistry (PL, L9): React component references for client rendering.
 *       Populated by bootstrapRenderers() in apps/web/app/layout.tsx.
 *     - ArtifactRegistry renderer slots (AEL, L6): IRendererAdapter for
 *       server-side HTML string generation (SSR export, not React render).
 *       Populated by registerRendererAdapters() in apps/web/instrumentation.ts.
 *     These are two different registries for two different purposes. The
 *     IRendererAdapter here produces an HTML string; the PL RendererRegistry
 *     holds a React component. Both use the same lib/ HTML renderer functions.
 *
 *   RELATION TO EXPORT ROUTE:
 *     The export route (apps/web/app/api/artifact/export/route.ts) currently
 *     calls lib/ functions directly and continues to work unchanged. This
 *     adapter layer adds the registry path alongside the direct-call path —
 *     it does not replace or break the existing route. The route is the sole
 *     public export endpoint; these adapters enable programmatic use via the
 *     ArtifactEngine.export() method and make the engine's availableFormats()
 *     eventually queryable (deferred to F-14 / Sprint 3 deferred items).
 *
 * INVARIANTS (per IRendererAdapter spec in interfaces.ts):
 *   1. render() NEVER compiles or validates — only converts format.
 *   2. render() MUST be pure: same artifact + options = same HTML string.
 *   3. render() MUST NOT call an LLM.
 *
 * INVARIANTS (per IExporter spec in interfaces.ts):
 *   1. export() NEVER re-compiles or re-validates — only serializes.
 *   2. export() MAY perform I/O (PDF uses headless Chromium).
 *   3. export() MUST return an ExportResult with the data field populated.
 *
 * CAST PATTERN NOTE:
 *   The lib render functions (renderArtifactToHTML, renderArtifactToPDF,
 *   renderArtifactToPPTX) accept `Record<string, unknown>` rather than
 *   ArtifactV2, because they were written before the typed ArtifactV2 union
 *   existed and use dynamic field access internally. TypeScript 6 no longer
 *   allows a direct `as Record<string, unknown>` cast from a named interface
 *   (no index signature overlap). The correct pattern is a two-step cast
 *   through `unknown`: `artifact as unknown as Record<string, unknown>`.
 *   This is intentional and safe — the lib functions are read-only consumers
 *   of the artifact data; they never mutate or re-type the value.
 */

import type {
  ArtifactType,
  ArtifactV2,
  ExportFormat,
  ExportOptions,
  ExportResult,
  CarouselArtifact,
  DeckArtifact,
  ReportArtifact,
} from '@brandos/contracts'
import type {
  IRendererAdapter,
  IExporter,
  IArtifactRegistry,
} from '@brandos/artifact-engine-layer'

import {
  renderArtifactToHTML,
  type SupportedHtmlArtifactType,
} from './artifact-export-html'
import { renderArtifactToPDF } from './artifact-export-pdf'
import {
  renderArtifactToPPTX,
  type SupportedPptxArtifactType,
} from './artifact-export-pptx'

// ─── Cast helper ──────────────────────────────────────────────────────────────
//
// TypeScript 6 requires a two-step cast through `unknown` when converting a
// named interface (e.g. ArtifactV2) to `Record<string, unknown>` because the
// named interface has no index signature. This helper makes every call site
// explicit about the intent without repeating the pattern inline.

function toRecord(artifact: ArtifactV2): Record<string, unknown> {
  return artifact as unknown as Record<string, unknown>
}

// ─── HTML IRendererAdapter ────────────────────────────────────────────────────
//
// Server-side HTML renderer adapters. One adapter class per artifact type,
// all backed by the same renderArtifactToHTML() dispatcher from artifact-export-html.ts.
//
// These adapters enable engine.resolveRenderer(artifactType, 'html') calls and
// allow future server-side snapshot/SSR workflows to go through the registry
// rather than importing lib functions directly.
//
// Separate classes (not one class with multiple supportedArtifactTypes) because
// IRendererAdapter.artifactType is a SINGLE ArtifactType (not an array) — the
// registry keys on `${artifactType}:${rendererFormat}` per adapter.

class CarouselHtmlRendererAdapter implements IRendererAdapter {
  readonly artifactType: ArtifactType = 'carousel'
  readonly rendererFormat: 'html' = 'html'

  async render(artifact: ArtifactV2): Promise<string> {
    return renderArtifactToHTML(toRecord(artifact), 'carousel' as SupportedHtmlArtifactType)
  }
}

class DeckHtmlRendererAdapter implements IRendererAdapter {
  readonly artifactType: ArtifactType = 'deck'
  readonly rendererFormat: 'html' = 'html'

  async render(artifact: ArtifactV2): Promise<string> {
    return renderArtifactToHTML(toRecord(artifact), 'deck' as SupportedHtmlArtifactType)
  }
}

class ReportHtmlRendererAdapter implements IRendererAdapter {
  readonly artifactType: ArtifactType = 'report'
  readonly rendererFormat: 'html' = 'html'

  async render(artifact: ArtifactV2): Promise<string> {
    return renderArtifactToHTML(toRecord(artifact), 'report' as SupportedHtmlArtifactType)
  }
}

// SPRINT2-CHANGE (F-04): Newsletter HTML renderer adapter.
// Depends on Sprint 1 (F-01) which implemented renderNewsletterToHTML() and
// added 'newsletter' to SupportedHtmlArtifactType.
class NewsletterHtmlRendererAdapter implements IRendererAdapter {
  readonly artifactType: ArtifactType = 'newsletter'
  readonly rendererFormat: 'html' = 'html'

  async render(artifact: ArtifactV2): Promise<string> {
    return renderArtifactToHTML(toRecord(artifact), 'newsletter' as SupportedHtmlArtifactType)
  }
}

// ─── PDF IExporter ────────────────────────────────────────────────────────────
//
// Single exporter for all PDF-capable artifact types. PDF export renders the
// same HTML that the IRendererAdapter produces, then prints it via headless
// Chromium (renderArtifactToPDF). This keeps PDF and HTML export in sync
// automatically — the HTML renderer is the single source of visual truth.

class PdfExporter implements IExporter {
  readonly supportedFormats: ExportFormat[] = ['pdf']
  readonly supportedArtifactTypes: ArtifactType[] = ['carousel', 'deck', 'report', 'newsletter']

  async export(artifact: ArtifactV2, _options: ExportOptions): Promise<ExportResult> {
    const t0 = Date.now()
    const artifactType = artifact.artifact_type as SupportedHtmlArtifactType

    const result = await renderArtifactToPDF(toRecord(artifact), artifactType)

    return {
      format: 'pdf',
      data: result.bytes,
      sizeBytes: result.bytes.byteLength,
      slideCount: 1, // PDF is a single document (no slide concept)
      durationMs: Date.now() - t0,
      success: true,
    }
  }
}

// ─── PPTX IExporter ──────────────────────────────────────────────────────────
//
// Single exporter for PPTX-capable artifact types. Newsletter is intentionally
// excluded: newsletter is an email format, not a slide deck. Attempting to
// export a newsletter as PPTX returns an error result rather than throwing
// (caller should handle the null from resolveExporter, but we add a guard here
// for defensive correctness in case this exporter is ever called directly).

class PptxExporter implements IExporter {
  readonly supportedFormats: ExportFormat[] = ['pptx']
  // Matches SupportedPptxArtifactType: 'carousel' | 'deck' | 'report'
  readonly supportedArtifactTypes: ArtifactType[] = ['carousel', 'deck', 'report']

  async export(artifact: ArtifactV2, _options: ExportOptions): Promise<ExportResult> {
    const t0 = Date.now()
    const artifactType = artifact.artifact_type

    // Guard: newsletter is not a supported PPTX type (it is email, not slides).
    if (artifactType === 'newsletter') {
      return {
        format: 'pptx',
        slideCount: 0,
        durationMs: Date.now() - t0,
        success: false,
        error: 'Newsletter artifacts cannot be exported as PPTX. Use HTML or PDF export instead.',
      }
    }

    // At this point artifact_type is 'carousel' | 'deck' | 'report' (newsletter
    // branched above). Cast is safe: PptxExporter.supportedArtifactTypes excludes
    // newsletter, so the registry will never call this with a newsletter artifact.
    const pptxArtifact = artifact as CarouselArtifact | DeckArtifact | ReportArtifact

    const result = await renderArtifactToPPTX(
      toRecord(artifact),
      artifactType as SupportedPptxArtifactType
    )

    // Slide count: read from the typed fields directly (no Record cast needed).
    const slideCount =
      'slides' in pptxArtifact && Array.isArray(pptxArtifact.slides)
        ? pptxArtifact.slides.length
        : 'sections' in pptxArtifact && Array.isArray(pptxArtifact.sections)
          ? pptxArtifact.sections.length
          : 1

    return {
      format: 'pptx',
      data: result.bytes,
      sizeBytes: result.bytes.byteLength,
      slideCount,
      durationMs: Date.now() - t0,
      success: true,
    }
  }
}

// ─── Adapter singletons ───────────────────────────────────────────────────────

export const carouselHtmlRendererAdapter   = new CarouselHtmlRendererAdapter()
export const deckHtmlRendererAdapter       = new DeckHtmlRendererAdapter()
export const reportHtmlRendererAdapter     = new ReportHtmlRendererAdapter()
export const newsletterHtmlRendererAdapter = new NewsletterHtmlRendererAdapter()

export const pdfExporter  = new PdfExporter()
export const pptxExporter = new PptxExporter()

// ─── Registration helpers ─────────────────────────────────────────────────────
//
// Called from apps/web/instrumentation.ts after bootstrapArtifactEngine().
// Co-locating registration logic with adapter definitions keeps the
// instrumentation file as a thin orchestrator.

/**
 * registerRendererAdapters — register all HTML IRendererAdapter instances.
 *
 * CALL FROM: apps/web/instrumentation.ts, after bootstrapArtifactEngine().
 * EFFECT: globalArtifactRegistry.resolveRenderer(type, 'html') returns the adapter.
 */
export function registerRendererAdapters(registry: IArtifactRegistry): void {
  registry.registerRenderer(carouselHtmlRendererAdapter)
  registry.registerRenderer(deckHtmlRendererAdapter)
  registry.registerRenderer(reportHtmlRendererAdapter)
  registry.registerRenderer(newsletterHtmlRendererAdapter)
  console.info('[ExportAdapters] HTML renderer adapters registered: carousel, deck, report, newsletter')
}

/**
 * registerExporterAdapters — register all IExporter instances.
 *
 * CALL FROM: apps/web/instrumentation.ts, after bootstrapArtifactEngine().
 * EFFECT: globalArtifactRegistry.resolveExporter(type, format) returns the adapter.
 */
export function registerExporterAdapters(registry: IArtifactRegistry): void {
  registry.registerExporter(pdfExporter)
  registry.registerExporter(pptxExporter)
  console.info('[ExportAdapters] Exporters registered: pdf (all 4 types), pptx (carousel, deck, report)')
}
