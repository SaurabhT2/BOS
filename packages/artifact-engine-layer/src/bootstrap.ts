/**
 * @brandos/artifact-engine-layer — bootstrap.ts
 *
 * Engine bootstrap: registers ALL artifact types into the global registry.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  FOR AGENTS: This is the startup entry point. It is DANGEROUS to        │
 * │  modify — changes here alter initialization order for all environments. │
 * │                                                                         │
 * │  L4 CHANGE (Wave 2): registerTaskPrompt() is now called here, from      │
 * │  ARTIFACT_TASK_PROMPTS in output-control-layer. The ai-runtime-layer    │
 * │  no longer imports ARTIFACT_TASK_PROMPTS directly. It receives prompt   │
 * │  registrations via AIRuntimeAdapter.registerArtifactPrompt().           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ADDING A NEW ARTIFACT TYPE (e.g., 'infographic'):
 *   1. Create src/compiler/infographic.ts   → implements ICompiler<InfographicArtifact>
 *   2. Create src/governance/infographic.ts → implements IGovernanceAdapter<InfographicArtifact>
 *   3. Add registerInfographicArtifactType() below (follow the pattern exactly).
 *   4. Call it inside bootstrapArtifactEngine().
 *   5. Export InfographicCompiler from src/index.ts.
 *   6. Add a registerTaskPrompt() call below with the matching invocationType.
 *   7. Verify: globalArtifactRegistry.isFullyRegistered('infographic') === true.
 *
 * OWNED CAPABILITIES (declared for multi-agent coordination):
 *   - artifact.compile      — ICompiler registration and dispatch
 *   - artifact.govern       — IGovernanceAdapter registration and dispatch
 *   - artifact.export       — IExporter registration and dispatch
 *   - artifact.render       — IRendererAdapter registration and dispatch
 *   - artifact.taskprompt   — Task prompt registration (formerly owned by ai-runtime-layer)
 */

import { globalArtifactRegistry } from './registry'
import { ArtifactEngine } from './engine'

import { CarouselCompiler } from './compiler/carousel'
import { DeckCompiler }     from './compiler/deck'
import { ReportCompiler }   from './compiler/report'
import { NewsletterCompiler } from './compiler/newsletter'

import { CarouselGovernanceAdapter } from './governance/carousel'
import { DeckGovernanceAdapter }     from './governance/deck'
import { ReportGovernanceAdapter }   from './governance/report'
import { NewsletterGovernanceAdapter } from './governance/newsletter'

// ─── Task prompt import ────────────────────────────────────────────────────────
//
// OWNERSHIP CHANGE (Wave 2 / Phase 1.1):
//   Previously: AIRuntimeAdapter imported ARTIFACT_TASK_PROMPTS from output-control-layer.
//   Now:        artifact-engine-layer imports them and calls registerArtifactPrompt() on
//               the runtime adapter singleton at bootstrap time.
//
// This removes the ai-runtime-layer → output-control-layer domain coupling.
// Adding a new artifact type requires touching only artifact-engine-layer and
// output-control-layer; the runtime layer is prompt-agnostic.
//
// NOTE: If AIRuntimeAdapter is not yet refactored to expose registerArtifactPrompt(),
//       this call is a no-op via the provided registerTaskPrompt() helper below.
//       Phase 1.1 runtime side must land before this takes effect in production.

import { ARTIFACT_TASK_PROMPTS } from '@brandos/output-control-layer'

// ─── Per-type registration functions ──────────────────────────────────────────

function registerCarouselArtifactType(): void {
  globalArtifactRegistry.registerCompiler(new CarouselCompiler())
  globalArtifactRegistry.registerGovernance(new CarouselGovernanceAdapter())
  console.info('[ArtifactEngine] Registered artifact type: carousel')
}

function registerDeckArtifactType(): void {
  globalArtifactRegistry.registerCompiler(new DeckCompiler())
  globalArtifactRegistry.registerGovernance(new DeckGovernanceAdapter())
  console.info('[ArtifactEngine] Registered artifact type: deck')
}

function registerReportArtifactType(): void {
  globalArtifactRegistry.registerCompiler(new ReportCompiler())
  globalArtifactRegistry.registerGovernance(new ReportGovernanceAdapter())
  console.info('[ArtifactEngine] Registered artifact type: report')
}

function registerNewsletterArtifactType(): void {
  globalArtifactRegistry.registerCompiler(new NewsletterCompiler())
  globalArtifactRegistry.registerGovernance(new NewsletterGovernanceAdapter())
  console.info('[ArtifactEngine] Registered artifact type: newsletter')
}

// ─── Task prompt registration helper ──────────────────────────────────────────
//
// Registers a task-specific system prompt with the AIRuntimeAdapter singleton.
//
// CALLER: bootstrapArtifactEngine() — called once at server startup.
// EFFECT: AIRuntimeAdapter will prepend the registered prompt to any LLM
//         request whose task_type matches the registered invocationType.
//
// INTERFACE DEPENDENCY:
//   This function calls globalThis.__brandos_runtime_adapter?.registerArtifactPrompt?.()
//   to decouple the import graph. If the runtime adapter has not yet been initialized
//   or does not expose this method, the registration is logged as a warning.
//   The runtime-side implementation (Phase 1.1) must add:
//     AIRuntimeAdapter.registerArtifactPrompt(invocationType: string, prompt: string): void
//
// AGENT INVARIANT: Do not import AIRuntimeAdapter here. Dependency direction must
// remain: artifact-engine-layer → output-control-layer (prompts only), never → ai-runtime-layer.

function registerTaskPrompt(invocationType: string, prompt: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = (globalThis as any).__brandos_runtime_adapter
  if (adapter && typeof adapter.registerArtifactPrompt === 'function') {
    adapter.registerArtifactPrompt(invocationType, prompt)
    console.info(`[ArtifactEngine] Registered task prompt for: ${invocationType}`)
  } else {
    console.warn(
      `[ArtifactEngine] AIRuntimeAdapter.registerArtifactPrompt() not available for ` +
      `invocationType="${invocationType}". Phase 1.1 runtime refactor required to activate. ` +
      `Prompt will not be injected until runtime adapter exposes registerArtifactPrompt().`
    )
  }
}

// ─── Idempotency guard ────────────────────────────────────────────────────────
// Must live on globalThis — a module-level `let` resets per webpack chunk,
// allowing bootstrapArtifactEngine() to be called multiple times across chunks.
declare global {
  // eslint-disable-next-line no-var
  var __BRANDOS_ARTIFACT_BOOTSTRAPPED__: boolean | undefined
}

// ─── bootstrapArtifactEngine ──────────────────────────────────────────────────

/**
 * bootstrapArtifactEngine — register all artifact types and task prompts.
 *
 * CALL ONCE at server startup before any requests are handled.
 * Subsequent calls are idempotent (no-op with a warning).
 *
 * WAVE 2 ADDITION:
 *   After registering compilers and governance adapters, this function
 *   also registers task-specific system prompts with AIRuntimeAdapter.
 *   This transfers prompt ownership from ai-runtime-layer to artifact-engine-layer,
 *   completing Phase 1.1 of the Architecture Evolution Roadmap.
 *
 * After this function returns:
 *   - globalArtifactRegistry.isFullyRegistered('carousel') === true
 *   - globalArtifactRegistry.isFullyRegistered('deck') === true
 *   - globalArtifactRegistry.isFullyRegistered('report') === true
 *   - Task prompts for generate_carousel, generate_deck, generate_report registered.
 *   - globalArtifactEngine is ready to compile, govern, and export.
 */
export function bootstrapArtifactEngine(): void {
  if (globalThis.__BRANDOS_ARTIFACT_BOOTSTRAPPED__) {
    console.warn(
      '[ArtifactEngine] bootstrapArtifactEngine() called more than once — skipping. ' +
      'This is safe but indicates a redundant call site. Check instrumentation.ts.'
    )
    return
  }

  // Register all currently supported artifact types (compiler + governance)
  registerCarouselArtifactType()
  registerDeckArtifactType()
  registerReportArtifactType()
  registerNewsletterArtifactType()

  // ── Task prompt registration (Wave 2 / Phase 1.1) ─────────────────────────
  //
  // Prompts are sourced from output-control-layer (canonical definition).
  // They are pushed to AIRuntimeAdapter via the globalThis bridge.
  // This co-locates prompt registration with compiler/governance registration —
  // adding a new artifact type requires touching ONLY this file and output-control-layer.

  const prompts = ARTIFACT_TASK_PROMPTS as Readonly<Record<string, string>>

  if (prompts['generate_carousel']) {
    registerTaskPrompt('generate_carousel', prompts['generate_carousel'])
  }
  if (prompts['generate_deck']) {
    registerTaskPrompt('generate_deck', prompts['generate_deck'])
  }
  if (prompts['generate_report']) {
    registerTaskPrompt('generate_report', prompts['generate_report'])
  }
  if (prompts['generate_newsletter']) {
    registerTaskPrompt('generate_newsletter', prompts['generate_newsletter'])
  }

  globalThis.__BRANDOS_ARTIFACT_BOOTSTRAPPED__ = true

  const registeredTypes = globalArtifactRegistry.listArtifactTypes()
  console.info(
    `[ArtifactEngine] Bootstrap complete. ` +
    `Registered types: [${registeredTypes.join(', ')}]`
  )

  for (const type of registeredTypes) {
    if (!globalArtifactRegistry.isFullyRegistered(type)) {
      console.error(
        `[ArtifactEngine] WARNING: artifactType="${type}" has a compiler OR governance adapter ` +
        `but NOT both. This type will not be production-ready. ` +
        `Verify registerXxxArtifactType() calls in bootstrap.ts.`
      )
    }
  }
}

// ─── Singleton global engine ───────────────────────────────────────────────────
//
// NEXT.JS MODULE SPLIT FIX: same pattern as globalArtifactRegistry above.
// The engine wraps the registry; both must be the same instance.
declare global {
  // eslint-disable-next-line no-var
  var __BRANDOS_ARTIFACT_ENGINE__: ArtifactEngine | undefined
}

function _getOrCreateEngine(): ArtifactEngine {
  if (!globalThis.__BRANDOS_ARTIFACT_ENGINE__) {
    globalThis.__BRANDOS_ARTIFACT_ENGINE__ = new ArtifactEngine(globalArtifactRegistry)
  }
  return globalThis.__BRANDOS_ARTIFACT_ENGINE__
}

export const globalArtifactEngine: ArtifactEngine = _getOrCreateEngine()


