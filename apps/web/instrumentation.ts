/**
 * apps/web — instrumentation.ts
 *
 * Server startup bootstrap. Runs once per server process.
 *
 * V2 Boot order:
 *   0. primeRuntime()              — forces AIRuntimeAdapter onto globalThis BEFORE AEL bootstrap
 *   1. bootstrapArtifactEngine()   — registers carousel/deck/report/newsletter compilers + governance
 *   2. bootstrapGovernancePlugins() — registers governance plugin registry
 *   3. initCognitionClient()        — PLATFORM SPLIT: HTTP client wired to IntelligenceOS
 *   3b. initKnowledgeIngestClient() — Milestone 3, Phase 1: knowledge ingestion HTTP client
 *   3c. initWorkspaceConfigurationClient() — EM-1.2: workspace configuration sync HTTP client
 *   3d. initFeedbackEventClient()          — EM-3.1: feedback event HTTP client
 *   3e. initCorrectionClient()             — EM-3.3: correction HTTP client
 *   4. bootstrapContractAssembler() — registers contributors (Identity, Persona, Intent, Runtime, Artifact)
 *   5. bootstrapSkillRuntime()     — ISkill runtime
 *   6. SupabaseAdminSettingsService.load() — admin settings cold-start wire (SPRINT1-FIX F-03)
 *   7. registerRendererAdapters() + registerExporterAdapters() — AEL registry slots (SPRINT2-CHANGE F-04)
 *
 * Step 0 is required for Phase 1.1 (registerArtifactPrompt bridge):
 *   bootstrapArtifactEngine() calls registerTaskPrompt() which looks for
 *   globalThis.__brandos_runtime_adapter. Without step 0, the adapter does not
 *   exist yet (it is created lazily on first callRuntime()) and the registration
 *   silently no-ops, disabling JSON mode + temperature-0 for all artifact calls.
 *
 * PLATFORM SPLIT: step 3 previously constructed a Supabase client and
 * SupabaseBrandSignalRepository to initialize @brandos/brand-intelligence's
 * runtime in-process. That package is deleted. IntelligenceOS now owns all
 * brand-memory persistence; step 3 configures an HTTP client
 * (@brandos/cognition-client) pointed at it when configured, or registers
 * a DegradedCognitionProvider when it isn't — either way, some
 * CognitionProvider is always registered as the global cognition client,
 * so getGlobalCognitionClient() (called unconditionally by every
 * CPLOrchestrator construction) never throws.
 */
import * as Sentry from '@sentry/nextjs'


export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')

    // ── 0. Prime the LLMRouter singleton ──────────────────────────────────────
    // Forces AIRuntimeAdapter construction and sets globalThis.__brandos_runtime_adapter
    // BEFORE bootstrapArtifactEngine() (step 1) calls registerTaskPrompt().
    // Without this, registerArtifactPrompt() always finds undefined at bootstrap
    // because getRuntime() is lazy — it is only called on the first carousel request.
    // This one call activates the Phase 1.1 bridge: artifact task prompts are
    // registered on the adapter at startup and applied to every LLM invocation
    // (JSON mode, temperature-0, schema prompt prepend).
    const { primeRuntime } = await import('@brandos/ai-runtime-layer')
    primeRuntime()

    // ── 1. Artifact Engine bootstrap ───────────────────────────────────────────
    // Registers carousel/deck/report/newsletter compilers + governance in the horizontal registry.
    // Must run before any artifact generation request is handled.
    // Phase 3E-1: bootstrapArtifactEngine() is now called ONCE at startup (not per-request).
    const { bootstrapArtifactEngine, globalArtifactEngine } = await import('@brandos/artifact-engine-layer')
    bootstrapArtifactEngine()

    // ── 2. Governance plugin bootstrap ─────────────────────────────────────────
    const {
      bootstrapGovernancePlugins
    } = await import('@brandos/governance-layer')
    bootstrapGovernancePlugins()

    // ── 3. Cognition client initialization (PLATFORM SPLIT) ───────────────────
    // Replaces the former V2 BrandIntelligence runtime init (Supabase +
    // SupabaseBrandSignalRepository, in-process). IntelligenceOS now owns all
    // brand-memory persistence itself; BrandOS only needs an HTTP client
    // pointed at it. No Supabase client is constructed here anymore.
    //
    // getGlobalCognitionClient() (called unconditionally by CPLOrchestrator's
    // constructor, on every generation request) throws if nothing was ever
    // registered — so *some* CognitionProvider must be registered here in
    // every environment, real or degraded. Previously, the "not configured"
    // branch only logged a warning and registered nothing at all, leaving
    // the singleton unset; CPLOrchestrator's constructor would then throw
    // "Client not initialized" on the very first generation request. This
    // registers DegradedCognitionProvider instead, so degraded mode means
    // what the log message already claimed it meant.
    try {
      const { initCognitionClient, setGlobalCognitionClient, DegradedCognitionProvider } =
        await import('@brandos/cognition-client')

      const intelligenceOsApiUrl = process.env.INTELLIGENCE_OS_API_URL
      const intelligenceOsApiKey = process.env.INTELLIGENCE_OS_API_KEY

      if (intelligenceOsApiUrl && intelligenceOsApiKey) {
        initCognitionClient({
          baseUrl: intelligenceOsApiUrl,
          apiKey: intelligenceOsApiKey,
        })

        console.info('[instrumentation] Cognition client initialized (IntelligenceOS HTTP API)')
      } else {
        setGlobalCognitionClient(new DegradedCognitionProvider())
        console.warn('[instrumentation] INTELLIGENCE_OS_API_URL / INTELLIGENCE_OS_API_KEY not set — degraded cognition client registered (resolveCognitionContext will always return a degraded CognitionContext)')
      }
    } catch (err: any) {
      // Registration itself failed unexpectedly (not "not configured" —
      // an actual error constructing/registering a provider). Fall back to
      // the same degraded provider so getGlobalCognitionClient() still
      // never throws, rather than leaving the singleton unset.
      console.error('[instrumentation] Cognition client init failed:', err.message)
      console.warn('[instrumentation] Registering degraded cognition client — generation will continue without brand personalization')
      try {
        const { setGlobalCognitionClient, DegradedCognitionProvider } = await import('@brandos/cognition-client')
        setGlobalCognitionClient(new DegradedCognitionProvider())
      } catch (fallbackErr: any) {
        console.error('[instrumentation] Degraded cognition client registration also failed:', fallbackErr.message)
      }
    }

    // ── 3b. Knowledge ingest client initialization (Milestone 3, Phase 1) ─────
    // Same IntelligenceOS deployment, same credentials as step 3, but a
    // separate client/singleton (see cognition-client/src/KnowledgeIngestClient.ts
    // for why). Unlike step 3, there is no degraded-provider requirement here:
    // getGlobalKnowledgeIngestClient() returns null rather than throwing when
    // unconfigured, and apps/web/app/api/assets/route.ts already treats a
    // null/failed ingest as "skip extraction," not an upload failure — so
    // there is nothing to register when the env vars are absent.
    try {
      const { initKnowledgeIngestClient } = await import('@brandos/cognition-client')
      const intelligenceOsApiUrl = process.env.INTELLIGENCE_OS_API_URL
      const intelligenceOsApiKey = process.env.INTELLIGENCE_OS_API_KEY

      if (intelligenceOsApiUrl && intelligenceOsApiKey) {
        initKnowledgeIngestClient({
          baseUrl: intelligenceOsApiUrl,
          apiKey: intelligenceOsApiKey,
        })
        console.info('[instrumentation] Knowledge ingest client initialized (IntelligenceOS HTTP API)')
      } else {
        console.warn('[instrumentation] INTELLIGENCE_OS_API_URL / INTELLIGENCE_OS_API_KEY not set — knowledge ingestion disabled (asset uploads will succeed without IntelligenceOS extraction)')
      }
    } catch (err: any) {
      console.error('[instrumentation] Knowledge ingest client init failed:', err.message)
      console.warn('[instrumentation] Knowledge ingestion disabled — asset uploads will continue without IntelligenceOS extraction')
    }

    // ── 3c. Workspace configuration client initialization (EM-1.2) ────────────
    // Cognitive Platform Evolution Program, Milestone 1. Same IntelligenceOS
    // deployment/credentials as steps 3 and 3b, separate client/singleton
    // (see cognition-client/src/WorkspaceConfigurationClient.ts). No
    // degraded-provider requirement, same reasoning as step 3b:
    // getGlobalWorkspaceConfigurationClient() returns null rather than
    // throwing when unconfigured, and @brandos/auth's persona write path
    // treats a null/failed sync as "the local cache write still succeeds,
    // IntelligenceOS sync is skipped," not a failed persona edit.
    try {
      const { initWorkspaceConfigurationClient } = await import('@brandos/cognition-client')
      const intelligenceOsApiUrl = process.env.INTELLIGENCE_OS_API_URL
      const intelligenceOsApiKey = process.env.INTELLIGENCE_OS_API_KEY

      if (intelligenceOsApiUrl && intelligenceOsApiKey) {
        initWorkspaceConfigurationClient({
          baseUrl: intelligenceOsApiUrl,
          apiKey: intelligenceOsApiKey,
        })
        console.info('[instrumentation] Workspace configuration client initialized (IntelligenceOS HTTP API)')
      } else {
        console.warn('[instrumentation] INTELLIGENCE_OS_API_URL / INTELLIGENCE_OS_API_KEY not set — workspace configuration sync disabled (persona edits will stay local to BrandOS)')
      }
    } catch (err: any) {
      console.error('[instrumentation] Workspace configuration client init failed:', err.message)
      console.warn('[instrumentation] Workspace configuration sync disabled — persona edits will continue to stay local to BrandOS')
    }

    // ── 3d. Feedback event client initialization (EM-3.1) ──────────────────────
    // Cognitive Platform Evolution Program, Milestone 3. Same IntelligenceOS
    // deployment/credentials as steps 3, 3b, 3c.
    try {
      const { initFeedbackEventClient } = await import('@brandos/cognition-client')
      const intelligenceOsApiUrl = process.env.INTELLIGENCE_OS_API_URL
      const intelligenceOsApiKey = process.env.INTELLIGENCE_OS_API_KEY

      if (intelligenceOsApiUrl && intelligenceOsApiKey) {
        initFeedbackEventClient({ baseUrl: intelligenceOsApiUrl, apiKey: intelligenceOsApiKey })
        console.info('[instrumentation] Feedback event client initialized (IntelligenceOS HTTP API)')
      } else {
        console.warn('[instrumentation] INTELLIGENCE_OS_API_URL / INTELLIGENCE_OS_API_KEY not set — feedback forwarding disabled (feedback will stay local to BrandOS)')
      }
    } catch (err: any) {
      console.error('[instrumentation] Feedback event client init failed:', err.message)
      console.warn('[instrumentation] Feedback forwarding disabled — feedback will continue to stay local to BrandOS')
    }

    // ── 3e. Correction client initialization (EM-3.3) ──────────────────────────
    try {
      const { initCorrectionClient } = await import('@brandos/cognition-client')
      const intelligenceOsApiUrl = process.env.INTELLIGENCE_OS_API_URL
      const intelligenceOsApiKey = process.env.INTELLIGENCE_OS_API_KEY

      if (intelligenceOsApiUrl && intelligenceOsApiKey) {
        initCorrectionClient({ baseUrl: intelligenceOsApiUrl, apiKey: intelligenceOsApiKey })
        console.info('[instrumentation] Correction client initialized (IntelligenceOS HTTP API)')
      } else {
        console.warn('[instrumentation] INTELLIGENCE_OS_API_URL / INTELLIGENCE_OS_API_KEY not set — correction recording disabled')
      }
    } catch (err: any) {
      console.error('[instrumentation] Correction client init failed:', err.message)
      console.warn('[instrumentation] Correction recording disabled')
    }

    // ── 4. Contract Assembler (no bootstrap needed) ───────────────────────────
    // V2: ContractAssemblerFactory.create() is called per-request in CPLOrchestrator.
    // It instantiates all 5 OCL contributors fresh on each call. There is no
    // startup singleton to populate. bootstrapContractAssembler() is retired.
    console.info('[instrumentation] ContractAssembler: per-request factory active (V2 — no startup bootstrap needed)');

    // ── 5. ISkill Runtime bootstrap ────────────────────────────────────────────
    // Registers CarouselFounderSkill + AI_FOUNDER_GTM_BUNDLE.
    // An adapter wraps globalArtifactEngine.govern() into the IArtifactEngineGovernable
    // interface that iskill-runtime's bridge expects (simpler context shape).
    try {
      const { bootstrapSkillRuntime, createGovernanceBridge } = await import('@brandos/iskill-runtime')

      // Adapter: bridges IArtifactEngine.govern() -> IArtifactEngineGovernable
      const artifactEngineAdapter = {
        govern: async (
          artifact: any,
          simpleCtx: { requestId: string; userId: string; workspaceId?: string },
          repairLLM?: (prompt: string) => Promise<string>
        ) => {
          const fullCtx = {
            requestId: simpleCtx.requestId,
            userId: simpleCtx.userId,
            workspaceId: simpleCtx.workspaceId,
            runtimeMode: 'cloud',
            skillContext: { requestId: simpleCtx.requestId },
          }
          return globalArtifactEngine.govern(artifact, fullCtx as any, repairLLM)
        },
      }

      const bridge = createGovernanceBridge(artifactEngineAdapter)
      bootstrapSkillRuntime({ governanceCaller: bridge })

      // Phase 2.6 gate-lift: human-approved activation (2026-06-21).
      // Per the documented activation path (@brandos/contracts/src/index.ts,
      // ISkill JSDoc): set the flag only after bootstrapSkillRuntime()
      // succeeds, so SkillContributor never contributes a workflow for a
      // skill whose governance bridge isn't actually wired up.
      ;(globalThis as Record<string, unknown>).__brandos_iskill_contract_contributor = true
      console.info('[instrumentation] ISkill production gate: ACTIVE — SkillContributor will contribute for registered skills (carousel-founder)')

      console.info('[instrumentation] ISkill Runtime bootstrapped')
    } catch (err: any) {
      console.error('[instrumentation] ISkill Runtime bootstrap failed:', err.message)
      console.warn('[instrumentation] ISkill Runtime disabled — carousel route falls back to artifact-pipeline')
    }

    console.info('[instrumentation] BrandOS server bootstrap complete')

    // ── 6. Admin Settings cold-start wire ──────────────────────────────────────
    // SPRINT1-FIX (F-03): SupabaseAdminSettingsService.load() was previously only
    // triggered by admin-panel routes. On cold starts where no admin route is hit
    // first, generation routes served requests using ENV-based defaults, silently
    // ignoring admin-configured provider routing and governance thresholds.
    //
    // This call wires setRuntimeConfigProvider() and populates _governancePolicyStore
    // at boot, guaranteeing admin settings apply from the very first generation
    // request on every server instance (including Vercel cold starts).
    //
    // load() is idempotent (ensureConfigProviderWired() guards with a boolean flag)
    // and gracefully falls back to defaults if Supabase is unavailable.
    try {
      const { SupabaseAdminSettingsService } = await import('@brandos/control-plane-layer')
      await SupabaseAdminSettingsService.load()
      console.info('[instrumentation] Admin settings loaded — RuntimeConfigProvider and governance thresholds active from boot')
    } catch (err: any) {
      console.error('[instrumentation] Admin settings load failed at boot:', err.message)
      console.warn('[instrumentation] Generation will continue with ENV-based defaults')
    }

    // ── 7. Export adapter registration ────────────────────────────────────────
    // SPRINT2-CHANGE (F-04): Registers IRendererAdapter (HTML ×4 types) and
    // IExporter (PDF ×4 types, PPTX ×3 types) into the global ArtifactRegistry.
    //
    // Previously the ArtifactRegistry's exporter/renderer slots were empty in
    // production — bootstrap.ts only registered compilers and governance adapters.
    // This step populates the remaining two dimensions of the registry, making
    // globalArtifactRegistry.resolveExporter() and resolveRenderer() return
    // live adapters for the first time.
    //
    // PLACEMENT: Must run AFTER bootstrapArtifactEngine() (step 1) because it
    // registers into the same globalArtifactRegistry that bootstrap.ts creates
    // and populates. Running before step 1 would risk the registry not existing yet.
    //
    // DEPENDENCY: PDF adapter depends on Sprint 1 (F-01) — renderNewsletterToHTML()
    // and renderArtifactToPDF() accepting 'newsletter' type. Both are present in
    // the Sprint 1 baseline. PPTX adapter excludes newsletter (email format).
    try {
      const { globalArtifactRegistry } = await import('@brandos/artifact-engine-layer')
      const { registerRendererAdapters, registerExporterAdapters } = await import('./lib/export-adapters')
      registerRendererAdapters(globalArtifactRegistry)
      registerExporterAdapters(globalArtifactRegistry)
      console.info('[instrumentation] Export adapters registered — ArtifactRegistry renderer and exporter slots now live')
    } catch (err: any) {
      console.error('[instrumentation] Export adapter registration failed:', err.message)
      console.warn('[instrumentation] Export adapter registry slots will remain empty; /api/artifact/export route is unaffected')
    }
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
export const onRequestError = Sentry.captureRequestError

