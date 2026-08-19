/**
 * apps/web — lib/registry-dispatch-pptx.ts
 * One of four per-format dispatch modules — see
 * lib/registry-dispatch-shared.ts for why this split exists. Deliberately
 * imports ONLY artifact-export-pptx.ts (pptxgenjs/jszip); never import
 * artifact-export-pdf from this file.
 */
import type { ArtifactType } from '@brandos/contracts'
import type { IArtifactRegistry } from '@brandos/artifact-engine-layer'
import { renderArtifactToPPTX, type PptxExportResult, type SupportedPptxArtifactType } from './artifact-export-pptx'
import { isRegistryDispatchEnabled, getGlobalRegistry } from './registry-dispatch-shared'

export async function dispatchPptxExport(
  artifact: Record<string, unknown>,
  artifactType: SupportedPptxArtifactType,
  registry?: IArtifactRegistry
): Promise<PptxExportResult> {
  if (isRegistryDispatchEnabled()) {
    try {
      const resolvedRegistry = registry ?? (await getGlobalRegistry())
      const exporter = resolvedRegistry.resolveExporter(artifactType as ArtifactType, 'pptx')
      if (exporter) {
        const result = await exporter.export(artifact as never, { format: 'pptx' })
        if (result.success && result.data) {
          return {
            bytes: result.data as Buffer,
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          }
        }
      }
    } catch (err) {
      console.error('[registry-dispatch] PPTX registry export failed — falling back to direct call.', err)
    }
  }
  return renderArtifactToPPTX(artifact, artifactType)
}
