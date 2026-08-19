/**
 * apps/web — lib/registry-dispatch-pdf.ts
 * One of four per-format dispatch modules — see
 * lib/registry-dispatch-shared.ts for why this split exists. Deliberately
 * imports ONLY artifact-export-pdf.ts (which pulls in puppeteer-core /
 * @sparticuz/chromium); never import artifact-export-pptx from this file.
 */
import type { ArtifactType } from '@brandos/contracts'
import type { IArtifactRegistry } from '@brandos/artifact-engine-layer'
import { renderArtifactToPDF, type PdfExportResult } from './artifact-export-pdf'
import type { SupportedHtmlArtifactType } from './artifact-export-html'
import { isRegistryDispatchEnabled, getGlobalRegistry } from './registry-dispatch-shared'

export async function dispatchPdfExport(
  artifact: Record<string, unknown>,
  artifactType: SupportedHtmlArtifactType,
  registry?: IArtifactRegistry
): Promise<PdfExportResult> {
  if (isRegistryDispatchEnabled()) {
    try {
      const resolvedRegistry = registry ?? (await getGlobalRegistry())
      const exporter = resolvedRegistry.resolveExporter(artifactType as ArtifactType, 'pdf')
      if (exporter) {
        const result = await exporter.export(artifact as never, { format: 'pdf' })
        if (result.success && result.data) {
          return { bytes: result.data as Buffer, mimeType: 'application/pdf' }
        }
        // success:false or no data — treat as a registry-path failure and fall through.
      }
    } catch (err) {
      console.error('[registry-dispatch] PDF registry export failed — falling back to direct call.', err)
    }
  }
  return renderArtifactToPDF(artifact, artifactType)
}
