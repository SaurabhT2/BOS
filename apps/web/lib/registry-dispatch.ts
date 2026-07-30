/**
 * apps/web — lib/registry-dispatch.ts
 *
 * RENDERING V2 — PHASE 7: registry cutover.
 * See RENDERING_ARCHITECTURE_V2.md, RENDERER_CONTRACT.md §6,
 * RENDERING_ROADMAP_V2.md Phase 7.
 *
 * WHAT THIS CLOSES (Finding M-2): apps/web/lib/export-adapters.ts already
 * implements and registers real IRendererAdapter/IExporter instances into
 * @brandos/artifact-engine-layer's globalArtifactRegistry at server boot
 * (see instrumentation.ts) — but the export route
 * (app/api/artifact/export/route.ts) has always called the underlying
 * lib/artifact-export-*.ts functions DIRECTLY, never through the registry.
 * The registry has been fully populated and completely unconsulted by the
 * one real production caller since it was introduced. This module is the
 * cutover: it tries the registry first, and only falls back to the direct
 * lib call if the registry has nothing registered for that (type, format)
 * pair, or if the registry path itself throws.
 *
 * SCOPE — HONESTLY NARROWER THAN "THE FULL REGISTRY," STATED PLAINLY:
 *   export-adapters.ts only registers renderers for 'html' and exporters
 *   for 'pdf'/'pptx' — there is no IExporter registered for 'json' or
 *   'canva' anywhere in this codebase. This module therefore only cuts
 *   over html/pdf/pptx dispatch. json and canva remain on their pre-Phase-7
 *   direct-call paths in route.ts, undisturbed — building JSON/Canva
 *   IExporter registrations was not part of this phase's scope and is not
 *   fabricated here just to claim broader coverage than what actually
 *   exists.
 *
 * DEPENDENCY-INJECTABLE REGISTRY, not just a hardcoded singleton import:
 *   Each dispatch function accepts an optional `registry` parameter,
 *   defaulting to the real `globalArtifactRegistry`. This is not testing
 *   ceremony for its own sake — it is what makes it possible to prove, in a
 *   unit test, that the registry path is genuinely being consulted (by
 *   registering a distinguishing stub adapter into a fresh, isolated
 *   registry instance) rather than merely asserting the output looks
 *   right, which the registry adapters and the legacy direct-call path
 *   would produce identically anyway (they wrap the same underlying lib
 *   functions).
 *
 * WHY THE REAL globalArtifactRegistry IS LOADED LAZILY (dynamic import),
 * NOT VIA A STATIC TOP-LEVEL IMPORT:
 *   @brandos/artifact-engine-layer transitively imports
 *   @brandos/governance-layer, whose tsconfig ("module": "ESNext") emits
 *   relative re-exports without a file extension (e.g. `from
 *   './governanceEngine'`, not './governanceEngine.js'). Next.js's
 *   bundler-style module resolution tolerates this in the real running
 *   app; Node's native ESM loader (which Vitest uses to resolve workspace
 *   packages) does not, and throws at import time — before any code in
 *   this file even runs. A static `import { globalArtifactRegistry } from
 *   '@brandos/artifact-engine-layer'` at the top of this file would force
 *   that resolution to happen the moment ANYTHING imports this module,
 *   including tests that always pass an explicit stub registry and never
 *   even touch the default-parameter path. Loading it lazily, only inside
 *   getGlobalRegistry() — called only when a caller omits the `registry`
 *   argument — defers that cost (and, in a test environment, that failure)
 *   to the one code path that actually needs it. This is not a test-only
 *   workaround: it is a legitimate lazy-singleton-access pattern, the same
 *   idea as this codebase's own pptxgenjs createRequire pattern
 *   (artifact-export-pptx.ts) — defer loading a heavy dependency graph
 *   until it's actually needed, not at module-evaluation time.
 */

import type { ArtifactType } from '@brandos/contracts'
import type { IArtifactRegistry } from '@brandos/artifact-engine-layer'
import { renderArtifactToHTML, type SupportedHtmlArtifactType } from './artifact-export-html'
import { renderArtifactToPDF, type PdfExportResult } from './artifact-export-pdf'
import { renderArtifactToPPTX, type PptxExportResult, type SupportedPptxArtifactType } from './artifact-export-pptx'

export function isRegistryDispatchEnabled(): boolean {
  return process.env.RENDERING_V2_REGISTRY_DISPATCH === 'true'
}

let cachedGlobalRegistry: IArtifactRegistry | null = null

/** Lazily imports and caches the real production registry singleton — see this file's header. */
async function getGlobalRegistry(): Promise<IArtifactRegistry> {
  if (!cachedGlobalRegistry) {
    const mod = await import('@brandos/artifact-engine-layer')
    cachedGlobalRegistry = mod.globalArtifactRegistry
  }
  return cachedGlobalRegistry
}

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
