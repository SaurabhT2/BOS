/**
 * apps/web — lib/registry-dispatch-html.ts
 * One of four per-format dispatch modules — see
 * lib/registry-dispatch-shared.ts for why this split exists. Deliberately
 * imports ONLY artifact-export-html.ts; never import artifact-export-pdf
 * or artifact-export-pptx from this file.
 */
import type { ArtifactType } from '@brandos/contracts'
import type { IArtifactRegistry } from '@brandos/artifact-engine-layer'
import { renderArtifactToHTML, type SupportedHtmlArtifactType } from './artifact-export-html'
import { isRegistryDispatchEnabled, getGlobalRegistry } from './registry-dispatch-shared'

export async function dispatchHtmlExport(
  artifact: Record<string, unknown>,
  artifactType: SupportedHtmlArtifactType,
  registry?: IArtifactRegistry
): Promise<string> {
  if (isRegistryDispatchEnabled()) {
    try {
      const resolvedRegistry = registry ?? (await getGlobalRegistry())
      const adapter = resolvedRegistry.resolveRenderer(artifactType as ArtifactType, 'html')
      if (adapter) {
        const result = await adapter.render(artifact as never)
        if (typeof result === 'string') return result
      }
      // adapter === null: nothing registered for this (type, 'html') pair —
      // soft miss per IArtifactRegistry's own documented contract, fall
      // through to the direct-call path below rather than treating this as
      // an error.
    } catch (err) {
      console.error('[registry-dispatch] HTML registry render failed — falling back to direct call.', err)
    }
  }
  return renderArtifactToHTML(artifact, artifactType)
}
