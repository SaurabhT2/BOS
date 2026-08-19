/**
 * apps/web — lib/registry-dispatch-image.ts
 * One of four per-format dispatch modules — see
 * lib/registry-dispatch-shared.ts for why this split exists.
 *
 * RENDERING V2 PHASE 9: unlike the html/pdf/pptx dispatch functions, this
 * one is NOT gated behind isRegistryDispatchEnabled() — 'png' is a net-new
 * export capability (no pre-Phase-9 behavior to gate against). It always
 * tries the registry first and falls back to a direct call only if the
 * registry has nothing registered or throws.
 */
import type { ArtifactType } from '@brandos/contracts'
import type { IArtifactRegistry } from '@brandos/artifact-engine-layer'
import { getGlobalRegistry } from './registry-dispatch-shared'

export async function dispatchImageExport(
  artifact: Record<string, unknown>,
  artifactType: 'carousel',
  registry?: IArtifactRegistry
): Promise<{ images: Buffer[] }> {
  try {
    const resolvedRegistry = registry ?? (await getGlobalRegistry())
    const exporter = resolvedRegistry.resolveExporter(artifactType as ArtifactType, 'png')
    if (exporter) {
      const result = await exporter.export(artifact as never, { format: 'png' })
      if (result.success && result.data) {
        return { images: result.data as Buffer[] }
      }
    }
  } catch (err) {
    console.error('[registry-dispatch] PNG registry export failed — falling back to direct call.', err)
  }
  const { renderCarouselToImages } = await import('./artifact-export-image')
  const result = await renderCarouselToImages(artifact as never)
  return { images: result.images }
}
