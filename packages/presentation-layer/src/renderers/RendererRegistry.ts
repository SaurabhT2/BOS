/**
 * @brandos/presentation-layer — RendererRegistry.ts
 *
 * Pluggable renderer registry for ArtifactV2 artifacts.
 *
 * Owned capability: presentation.render.*
 *
 * PURPOSE:
 *   Decouples "which renderer to use" from "how to render".
 *   Consumers call resolveRenderer(artifactType) to get the React component
 *   for that artifact type. Adding a new artifact type requires only:
 *     1. Implement the renderer component
 *     2. Call RendererRegistry.register(artifactType, Component)
 *     3. Export from index.ts
 *
 * DESIGN:
 *   - Registry is a module-level singleton (not a React context).
 *   - Components are registered by artifact_type string key.
 *   - resolveRenderer() returns null for unknown types (caller decides fallback).
 *   - No React state — registration is idempotent and synchronous.
 *
 * INVARIANTS:
 *   - Renderers MUST accept { artifact: TArtifact } as their primary prop.
 *   - Renderers MUST be 'use client' components (they are always browser-rendered).
 *   - Renderers MUST NOT import from @brandos/ai-runtime-layer or @brandos/control-plane-layer.
 *   - Registry is read-only after bootstrapRenderers() completes.
 *
 * SPRINT2-CHANGE (F-05): bootstrapRenderers() implemented.
 *   Registers all four canonical artifact renderers (carousel, deck, report,
 *   newsletter) into the singleton registry. Designed to be called from
 *   apps/web/app/layout.tsx server bootstrap.
 *
 *   - Safe to call multiple times (idempotent via _bootstrapped guard on globalThis).
 *   - Must NOT use browser APIs (layout.tsx is a Server Component).
 *   - Renderers are React components; they are safe to register server-side
 *     because registration only stores a function reference (no DOM access).
 *   - resolveRenderer() is the intended call site in the Studio page; calling
 *     it before bootstrapRenderers() returns null for all types.
 */

import type { ArtifactType, ArtifactV2 } from '@brandos/contracts'
import type React from 'react'
// Engineering Workflow Audit fix: these were previously loaded via a
// runtime `require('./CarouselRenderer')` call inside bootstrapRenderers()
// below. That pattern relied on the consuming bundler (webpack/Turbopack)
// to statically resolve and transform the require() call at build time —
// which works in the real Next.js build, but a raw CJS require() of a
// .tsx file has no such transform available under Node or Vitest's
// module loader, so it could never actually succeed outside of a full
// Next.js bundle. This surfaced as a real, previously-undiscovered test
// failure the first time `pnpm test` ran against a fully-installed
// workspace (packages/presentation-layer/__tests__/contract/
// renderers.contract.test.ts, which deliberately calls the real
// bootstrapRenderers() rather than mocking it, specifically to catch
// registration regressions like this one). Static imports behave
// identically to the old require() calls from the bundler's perspective —
// same server/client component reference semantics described below — and
// additionally work correctly under Node and Vitest.
import CarouselRenderer from './CarouselRenderer'
import DeckRenderer from './DeckRenderer'
import ReportRenderer from './ReportRenderer'
import NewsletterRenderer from './NewsletterRenderer'

// ─── Renderer component type ───────────────────────────────────────────────────

export type ArtifactRendererComponent<TArtifact extends ArtifactV2 = ArtifactV2> =
  React.ComponentType<{ artifact: TArtifact; [key: string]: unknown }>

// ─── Registry implementation ───────────────────────────────────────────────────

class RendererRegistryImpl {
  private readonly _renderers = new Map<string, ArtifactRendererComponent<ArtifactV2>>()

  /**
   * Register a renderer component for an artifact type.
   * Safe to call multiple times with the same type — later registration wins.
   * (Idempotent to support HMR in development.)
   */
  register<TArtifact extends ArtifactV2>(
    artifactType: ArtifactType,
    component: ArtifactRendererComponent<TArtifact>
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._renderers.set(artifactType, component as any)
  }

  /**
   * Resolve a renderer component for an artifact type.
   * Returns null if no renderer is registered (caller provides fallback UI).
   */
  resolveRenderer(artifactType: ArtifactType): ArtifactRendererComponent<ArtifactV2> | null {
    return this._renderers.get(artifactType) ?? null
  }

  /**
   * List all registered artifact types.
   */
  listArtifactTypes(): ArtifactType[] {
    return Array.from(this._renderers.keys()) as ArtifactType[]
  }

  /**
   * Check if a renderer is registered for the given artifact type.
   */
  has(artifactType: ArtifactType): boolean {
    return this._renderers.has(artifactType)
  }
}

// ─── Singleton export ──────────────────────────────────────────────────────────

export const RendererRegistry = new RendererRegistryImpl()

// ─── bootstrapRenderers ───────────────────────────────────────────────────────
//
// SPRINT2-CHANGE (F-05): Implements bootstrapRenderers() — previously referenced
// in doc comments and contract tests but never implemented.
//
// DESIGN DECISIONS:
//   1. Uses a globalThis idempotency guard (not a module-level `let`) so the
//      flag survives webpack hot module reloads in development.
//   2. Dynamic imports of renderer components are NOT used: the components are
//      statically imported below. This is correct — bootstrapRenderers() runs
//      in the server layout.tsx context; the renderer modules themselves are
//      'use client' components but are safe to import on the server as function
//      references (Next.js allows this; only their JSX output requires a DOM).
//   3. All four canonical renderer types (carousel, deck, report, newsletter)
//      are registered unconditionally. Newsletter was added in Sprint 1 (F-01).
//   4. No browser API calls. No React hooks. Pure module-level function.
//
// CALL SITE: apps/web/app/layout.tsx (Server Component, runs once per process).
// CONSUMERS: Studio page (resolveRenderer(artifact.artifact_type)).

declare global {
  // eslint-disable-next-line no-var
  var __BRANDOS_RENDERERS_BOOTSTRAPPED__: boolean | undefined
}

/**
 * bootstrapRenderers — register all canonical artifact renderers.
 *
 * CALL ONCE at server startup from apps/web/app/layout.tsx.
 * Subsequent calls are idempotent (no-op).
 *
 * After this function returns:
 *   - RendererRegistry.resolveRenderer('carousel') returns CarouselRenderer
 *   - RendererRegistry.resolveRenderer('deck')     returns DeckRenderer
 *   - RendererRegistry.resolveRenderer('report')   returns ReportRenderer
 *   - RendererRegistry.resolveRenderer('newsletter') returns NewsletterRenderer
 *
 * NOTE: Renderers are 'use client' components imported as server-side references.
 * This is intentional and correct — Next.js allows server components to hold
 * references to client component functions; only rendering them requires a client.
 */
export function bootstrapRenderers(): void {
  if (globalThis.__BRANDOS_RENDERERS_BOOTSTRAPPED__) {
    console.warn(
      '[PresentationLayer] bootstrapRenderers() called more than once — skipping. ' +
      'This is safe but indicates a redundant call site. Check apps/web/app/layout.tsx.'
    )
    return
  }

  // Each renderer's props are typed to its own specific artifact subtype
  // (e.g. NewsletterRendererProps only accepts NewsletterArtifact), which
  // is correct and desirable for the component itself, but not assignable
  // to the registry's shared ArtifactRendererComponent<ArtifactV2> slot —
  // a standard variance mismatch for any registry keyed by a discriminated
  // union tag. resolveRenderer()'s runtime dispatch by artifact_type
  // guarantees each renderer only ever receives its own artifact subtype,
  // so this cast reflects a real, sound runtime invariant, not an unsound
  // one. (Previously this was implicitly `any` via require()'s untyped
  // return — the cast makes explicit what the require() version silently
  // relied on.)
  RendererRegistry.register('carousel',   CarouselRenderer as ArtifactRendererComponent<ArtifactV2>)
  RendererRegistry.register('deck',       DeckRenderer as ArtifactRendererComponent<ArtifactV2>)
  RendererRegistry.register('report',     ReportRenderer as ArtifactRendererComponent<ArtifactV2>)
  RendererRegistry.register('newsletter', NewsletterRenderer as ArtifactRendererComponent<ArtifactV2>)

  globalThis.__BRANDOS_RENDERERS_BOOTSTRAPPED__ = true

  console.info(
    '[PresentationLayer] bootstrapRenderers() complete. ' +
    `Registered: [${RendererRegistry.listArtifactTypes().join(', ')}]`
  )
}


