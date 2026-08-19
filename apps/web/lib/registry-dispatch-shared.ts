/**
 * apps/web — lib/registry-dispatch-shared.ts
 *
 * FUNCTION-SIZE SPLIT (post-mortem: hotfix/vercel-file-tracing-pptxgenjs):
 * The original lib/registry-dispatch.ts had dispatchHtmlExport,
 * dispatchPdfExport, and dispatchPptxExport all in one file, with static
 * top-level imports of artifact-export-html.ts, artifact-export-pdf.ts
 * (which imports puppeteer-core), AND artifact-export-pptx.ts all
 * together. That meant importing even just dispatchHtmlExport pulled
 * Chromium and pptxgenjs into whatever route imported it — silently
 * recreating the same 250MB function-size problem that motivated splitting
 * app/api/artifact/export/route.ts into per-format routes in the first
 * place (see lib/artifact-export-request.ts for that half of the story).
 *
 * Fix: one dispatch module per format (registry-dispatch-html.ts,
 * -pdf.ts, -pptx.ts, -image.ts), each importing only its own renderer.
 * This file holds what they all share — the lazy registry singleton
 * loader and the feature flag check — and has no heavy imports itself.
 *
 * lib/registry-dispatch.ts still exists as a backward-compatible barrel
 * re-exporting all four dispatch functions (used by
 * __tests__/registry-dispatch.test.ts and any future non-route caller
 * that genuinely needs all formats). Route files must import directly
 * from the per-format modules below, never from that barrel — see each
 * route's own comment.
 *
 * WHY THE REAL globalArtifactRegistry IS LOADED LAZILY (dynamic import),
 * NOT VIA A STATIC TOP-LEVEL IMPORT: see the original detailed rationale,
 * preserved here — @brandos/artifact-engine-layer transitively imports
 * @brandos/governance-layer, whose tsconfig ("module": "ESNext") emits
 * relative re-exports without a file extension. Next.js's bundler-style
 * module resolution tolerates this; Node's native ESM loader (used by
 * Vitest to resolve workspace packages) does not. Loading it lazily, only
 * inside getGlobalRegistry(), defers that cost/failure to the one code
 * path that actually needs it.
 */

import type { IArtifactRegistry } from '@brandos/artifact-engine-layer'

export function isRegistryDispatchEnabled(): boolean {
  return process.env.RENDERING_V2_REGISTRY_DISPATCH === 'true'
}

let cachedGlobalRegistry: IArtifactRegistry | null = null

/** Lazily imports and caches the real production registry singleton — see this file's header. */
export async function getGlobalRegistry(): Promise<IArtifactRegistry> {
  if (!cachedGlobalRegistry) {
    const mod = await import('@brandos/artifact-engine-layer')
    cachedGlobalRegistry = mod.globalArtifactRegistry
  }
  return cachedGlobalRegistry
}
