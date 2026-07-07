/**
 * @brandos/control-plane-layer — src/orchestrator.ts
 *
 * IMPLEMENTED: BrandOS Architecture Assessment 2026-05-29
 * UPDATED: Platform split — BrandOS becomes the Execution Platform
 *
 * CPLOrchestrator is the single orchestration entry point for all artifact
 * generation. Phase C features (audit trail, versioning, approval) are wired
 * inline after the governed pipeline completes.
 *
 * PLATFORM SPLIT: Step 1 (brand cognition) previously called
 * BrandIntelligenceRuntime.resolve() directly, in-process. It now calls
 * @brandos/cognition-client's CognitionProvider.resolveCognitionContext()
 * — an HTTP call to IntelligenceOS. The orchestrator itself performs no
 * reasoning either way; only the transport changed.
 *
 * KNOWN GAP: request.persona / request.brandContext are no longer forwarded
 * into cognition resolution — CognitionRequest accepts only
 * { workspaceId, taskType }. See
 * packages/cognition-contract/README.md, "Known contract gaps", item 2.
 */

import type {
  TaskType,
} from '@brandos/contracts'
import {
  getGlobalCognitionClient,
  createDegradedCognitionContext,
  type CognitionContext,
  type CognitionProvider,
} from '@brandos/cognition-client'
import type { GenerationRequest, GenerationResult, OrchestrationContext } from './types'
import { Logger } from '@brandos/shared-utils'
import {
  ContractAssemblerFactory,
  compilePromptFromContract,
} from '@brandos/output-control-layer'
import { callWithMode, isUnavailable, type TaskType as ARLTaskType } from '@brandos/ai-runtime-layer'
import { recordProviderUsage } from '@brandos/auth'
import { recordProviderOutcome } from '@brandos/runtime-config'

const logger = new Logger('info')

export class CPLOrchestrator {
  private readonly cognitionClient: CognitionProvider

  constructor(cognitionClient?: CognitionProvider) {
    this.cognitionClient = cognitionClient ?? getGlobalCognitionClient()
  }

  async orchestrate(request: GenerationRequest): Promise<GenerationResult> {
    const startMs = Date.now()
    logger.info(`[CPLOrchestrator] start requestId=${request.requestId}`)

    // Step 1: Cognition resolution.
    // resolveCognitionContext() already falls back to a degraded context
    // internally on any HTTP failure (see HttpCognitionProvider), and when
    // IntelligenceOS isn't configured at all in this environment,
    // this.cognitionClient is a DegradedCognitionProvider registered at
    // startup (see apps/web/instrumentation.ts) whose resolveCognitionContext()
    // returns the same degraded shape without attempting network I/O. The
    // try/catch here is defense-in-depth only, for the unlikely case of an
    // unexpected throw from a differently-configured CognitionProvider.
    let cognitionContext: CognitionContext
    try {
      cognitionContext = await this.cognitionClient.resolveCognitionContext({
        workspaceId: request.workspaceId,
        taskType: request.taskType as TaskType | undefined,
      })
    } catch {
      logger.warn('[CPLOrchestrator] Cognition resolution failed — using degraded context')
      cognitionContext = createDegradedCognitionContext(request.workspaceId)
    }

    const taskType = (request.taskType ?? 'post') as TaskType
    const isStructured = taskType === 'carousel' || taskType === 'deck' || taskType === 'report'
    const ctx = this.buildOrchestrationContext(request, cognitionContext)

    // Brand Memory gate — log clearly so CPL traces show the applied state
    const brandMemoryApplied = ctx.applyBrandMemory !== false
    logger.info(`[CPLOrchestrator] brandMemoryApplied=${brandMemoryApplied}`)

    let content:          string
    let governanceScore = 0   // FIX-SCORE-001: was 80 hardcoded; real score set by pipeline
    let wasRepaired     = false
    // Phase 5: execution trace — populated from whichever pipeline ran
    let resolvedProvider: string | undefined
    let resolvedModel:    string | undefined

    if (isStructured) {
      const result = await this.runStructuredPipeline(ctx, taskType)
      // content is the raw LLM text — executeArtifactPipeline will compile+govern it
      content           = result.rawText
      governanceScore   = result.governanceScore
      wasRepaired       = result.wasRepaired
      resolvedProvider  = result.resolvedProvider
      resolvedModel     = result.resolvedModel
    } else {
      const result = await this.runTextPipeline(ctx, taskType)
      content          = result.content
      resolvedProvider = result.resolvedProvider
      resolvedModel    = result.resolvedModel
    }

    // Step 8: Observe (fire-and-forget).
    // observe() itself never throws (see HttpCognitionProvider) — it logs
    // and swallows failures internally, matching the contract's
    // fire-and-forget guarantee.
    void this.cognitionClient.observe({
      requestId:    request.requestId,
      workspaceId:  request.workspaceId,
      artifactType: (request.taskType ?? 'unknown') as string,
      outputText:   content,
      score:        governanceScore,
      wasRepaired:  wasRepaired,
      observedAt:   new Date().toISOString(),
    })

    const durationMs = Date.now() - startMs
    logger.info(
      `[CPLOrchestrator] complete requestId=${request.requestId} score=${governanceScore} durationMs=${durationMs}`
    )

    return {
      requestId: request.requestId,
      artifact:  { content, artifactType: taskType },
      score:     governanceScore,
      wasRepaired,
      cognitionContext,
      durationMs,
      // Phase 5: resolved execution info for RuntimeExecutionProfile assembly
      resolvedProvider,
      resolvedModel,
    }
  }

  // ─── Structured artifact pipeline ─────────────────────────────────────────
  //
  // AB-002 FIX: runStructuredPipeline now returns raw LLM text only.
  //
  // Responsibility boundary (enforced after Wave 1):
  //   CPLOrchestrator.runStructuredPipeline()  — cognition resolution → contract
  //                                              assembly → prompt compile
  //                                              → LLM invocation → raw text
  //   executeArtifactPipeline()                — normalise → compile+govern
  //                                              → Phase C lifecycle
  //                                              (SINGLE canonical path)
  //
  // Previously runStructuredPipeline called compileAndGovern() AND
  // executeArtifactPipeline() also called it — governance ran twice on the
  // same content, producing duplicate audit trail entries and approval
  // evaluations. This is now fixed: the orchestrator stops at rawText.

  private async runStructuredPipeline(
    ctx: OrchestrationContext,
    taskType: TaskType
  ): Promise<{
    rawText:           string
    governanceScore:   number  // placeholder until real score comes back from pipeline
    wasRepaired:       boolean
    resolvedProvider?: string | undefined
    resolvedModel?:    string | undefined
  }> {
    // 1. Contract assembly
    const assembler = ContractAssemblerFactory.create({ contributorSet: 'default' })
    const contract  = await assembler.assemble({
      // P0 — Implementation Wave 1A: userId and workspaceId are now distinct
      // (previously both carried ctx.workspaceId, which itself carried
      // user_id pre-P0). userId is the requesting user (may be undefined for
      // system-initiated generation); workspaceId is the resolved workspace
      // — see ContributorContext doc comments in generation-contract.ts.
      userId:      ctx.userId,
      workspaceId: ctx.workspaceId,
      requestId:   ctx.requestId,
      userPrompt:  ctx.userPrompt,
      taskType:    taskType as string,
      runtimeMode: ctx.runtimeMode,
      attempt:     ctx.attemptNumber ?? 1,
      // PLATFORM SPLIT: the resolved CognitionContext is forwarded whole.
      // IdentityContributor and PersonaContributor both read fields
      // directly off it (cognitionContext.identity, cognitionContext.voice)
      // — there is no separate runtime/callback field anymore, and no
      // re-merging of confidence into a nested object (CognitionContext
      // already carries confidence at the top level).
      cognitionContext: ctx.cognitionContext,
      attemptHistory: ctx.attemptHistory,
      repairContext: ctx.repairContext,
      // Brand Memory gate: when false, PersonaContributor and IdentityContributor
      // both return null, suppressing all audience/tone/brand-profile injection.
      applyBrandMemory: ctx.applyBrandMemory,
    })

    logger.info(
      `[CPLOrchestrator] cognition injected ` +
      `hasIdentity=${ctx.cognitionContext.identity !== null} ` +
      `confidence=${ctx.cognitionContext.confidence} ` +
      `audienceType=${ctx.cognitionContext.voice.audienceType}`
    )

    // 2. Compile prompt
    const compiled = compilePromptFromContract(contract)

    // 3. Invoke AI runtime — use ctx.runtimeMode propagated from the API route
    // P3 — W4: inject BYOK key overrides (empty obj = use platform env keys)
    // P3 — W9: inject preferred_provider as routingHint.preferred_provider (soft hint)
    // NOTE: preferred_tiers is Array<'local'|'cloud'> and cannot carry a provider name.
    // The correct field is RoutingHint.preferred_provider, added in W9 to the contract.
    const structuredRoutingHint: import('@brandos/contracts').RoutingHint | undefined =
      (ctx.preferredProvider || ctx.preferredModel)
        ? {
            ...(ctx.preferredProvider
              ? { preferred_provider: ctx.preferredProvider as import('@brandos/contracts').ProviderName }
              : {}),
            // Phase 4: per-request model override forwarded into the routing hint
            ...(ctx.preferredModel ? { preferred_model: ctx.preferredModel } : {}),
          }
        : undefined

    const runtimeResult = await callWithMode(compiled.user, ctx.runtimeMode, {
      systemPrompt:    compiled.system,
      taskType:        (taskType === 'carousel' ? 'carousel' : 'text') as ARLTaskType,
      // P0 — Implementation Wave 1A: ctx.userId (real user), not
      // ctx.workspaceId. callWithMode forwards this as the provider's
      // user_id field for per-end-user telemetry/abuse attribution.
      userId:          ctx.userId,
      // P3 — BYOK: per-provider API key overrides
      apiKeyOverrides: ctx.apiKeyOverrides,
      // P3 — W9: workspace preferred_provider routing hint
      // Phase 4: preferred_model included in hint when set
      routingHint:     structuredRoutingHint,
    })

    if (isUnavailable(runtimeResult)) {
      // P3 — Fire-and-forget health recording (non-critical)
      // UnavailableResponse carries no provider field — all providers were exhausted,
      // so there is no single provider to attribute the failure to; record 'unknown'.
      void recordProviderOutcome(ctx.workspaceId, 'unknown', 'failure')
      throw new Error(
        `[CPLOrchestrator] AI runtime unavailable: ${runtimeResult.message}`
      )
    }

    // P3 — Fire-and-forget usage + health telemetry (non-critical, never awaited)
    // NOTE: callWithMode() returns LLMResponse (provider/modelId), NOT AIRuntimeOutput
    // (engine_used/model_used) — those are the internal runtime-engine field names.
    // FIX-2: reject-safe wrapper — mirrors recordProviderOutcome's try/catch pattern
    // so that a telemetry DB failure never surfaces as an unhandled rejection and
    // never affects generation (consistent with fire-and-forget resilience guarantee).
    void recordProviderUsage({
      workspace_id:       ctx.workspaceId,
      provider:           runtimeResult.provider,
      model_id:           runtimeResult.modelId ?? null,
      request_id:         ctx.requestId ?? null,
      prompt_tokens:      null,     // F6: LLMResponse does not expose token counts yet
      completion_tokens:  null,
      total_tokens:       null,
      estimated_cost_usd: null,
    }).catch((err: unknown) => {
      console.warn(
        `[CPLOrchestrator] usage write failed for provider=${runtimeResult.provider} (non-critical):`,
        (err as Error).message,
      )
    })
    void recordProviderOutcome(ctx.workspaceId, runtimeResult.provider, 'success')

    const rawText = runtimeResult.content ?? ''

    // Return raw text. compile+govern+Phase C is owned by executeArtifactPipeline.
    // FIX-SCORE-001: governanceScore here is a placeholder only — the real score
    // comes back from executeArtifactPipeline after richness calculation.
    // The orchestrator.orchestrate() caller (artifact-pipeline) overwrites this
    // with the real pipeline score. Log it clearly so it's never mistaken for truth.
    logger.info('[CPLOrchestrator] structured pipeline raw text ready — score=PENDING (pipeline will calculate)')
    return {
      rawText,
      governanceScore:  0,  // FIX-SCORE-001: was 80 hardcoded. Replaced with 0 to surface when not overwritten.
      wasRepaired:      false,
      // Phase 5: carry resolved execution info for RuntimeExecutionProfile assembly
      resolvedProvider: isUnavailable(runtimeResult) ? undefined : runtimeResult.provider,
      resolvedModel:    isUnavailable(runtimeResult) ? undefined : (runtimeResult.resolvedModel ?? undefined),
    }
  }

  // ─── Text/post pipeline ────────────────────────────────────────────────────

  private async runTextPipeline(
    ctx: OrchestrationContext,
    taskType: TaskType
  ): Promise<{ content: string; resolvedProvider?: string; resolvedModel?: string }> {
    const assembler = ContractAssemblerFactory.create({ contributorSet: 'default' })
    const contract  = await assembler.assemble({
      // See runStructuredPipeline for the userId/workspaceId rationale.
      userId:      ctx.userId,
      workspaceId: ctx.workspaceId,
      requestId:   ctx.requestId,
      userPrompt:  ctx.userPrompt,
      taskType:    taskType as string,
      runtimeMode: ctx.runtimeMode,
      attempt:     ctx.attemptNumber ?? 1,
      // PLATFORM SPLIT: same as runStructuredPipeline — forward the whole
      // resolved CognitionContext, no separate runtime/callback field.
      cognitionContext: ctx.cognitionContext,
      attemptHistory: ctx.attemptHistory,
      // TOPIC-DRIFT-FIX-004: Forward repairContext
      repairContext: ctx.repairContext,
      // Brand Memory gate: when false, PersonaContributor and IdentityContributor
      // both return null, suppressing all audience/tone/brand-profile injection.
      applyBrandMemory: ctx.applyBrandMemory,
    })

    const compiled = compilePromptFromContract(contract)

    // P3 — W4: inject BYOK key overrides
    // P3 — W9: inject preferred_provider as routingHint.preferred_provider (soft hint)
    // Phase 4: include preferred_model in routingHint when set
    const textRoutingHint: import('@brandos/contracts').RoutingHint | undefined =
      (ctx.preferredProvider || ctx.preferredModel)
        ? {
            ...(ctx.preferredProvider
              ? { preferred_provider: ctx.preferredProvider as import('@brandos/contracts').ProviderName }
              : {}),
            ...(ctx.preferredModel ? { preferred_model: ctx.preferredModel } : {}),
          }
        : undefined

    const runtimeResult = await callWithMode(compiled.user, ctx.runtimeMode, {
      systemPrompt:    compiled.system,
      taskType:        'text' as ARLTaskType,
      // See runStructuredPipeline for the userId/workspaceId rationale.
      userId:          ctx.userId,
      // P3 — BYOK: per-provider API key overrides
      apiKeyOverrides: ctx.apiKeyOverrides,
      // P3 — W9: workspace preferred_provider routing hint
      // Phase 4: preferred_model included when set
      routingHint:     textRoutingHint,
    })

    if (isUnavailable(runtimeResult)) {
      void recordProviderOutcome(ctx.workspaceId, 'unknown', 'failure')
      throw new Error(`[CPLOrchestrator] AI runtime unavailable: ${runtimeResult.message}`)
    }

    // P3 — Fire-and-forget usage + health telemetry
    // FIX-2: reject-safe wrapper — mirrors recordProviderOutcome's try/catch pattern.
    void recordProviderUsage({
      workspace_id:       ctx.workspaceId,
      provider:           runtimeResult.provider,
      model_id:           runtimeResult.modelId ?? null,
      request_id:         ctx.requestId ?? null,
      prompt_tokens:      null,
      completion_tokens:  null,
      total_tokens:       null,
      estimated_cost_usd: null,
    }).catch((err: unknown) => {
      console.warn(
        `[CPLOrchestrator] usage write failed for provider=${runtimeResult.provider} (non-critical):`,
        (err as Error).message,
      )
    })
    void recordProviderOutcome(ctx.workspaceId, runtimeResult.provider, 'success')

    return {
      content:          runtimeResult.content ?? '',
      // Phase 5: carry resolved execution info for RuntimeExecutionProfile assembly
      resolvedProvider: runtimeResult.provider,
      resolvedModel:    runtimeResult.resolvedModel ?? undefined,
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private buildOrchestrationContext(
    request:          GenerationRequest,
    cognitionContext: CognitionContext
  ): OrchestrationContext {
    const attemptHistory = request.attemptHistory
    const attemptNumber  = attemptHistory ? attemptHistory.records.length + 1 : 1
    return {
      requestId:        request.requestId,
      workspaceId:      request.workspaceId,
      userId:           request.userId,
      personaId:        request.personaId,
      taskType:         request.taskType,
      userPrompt:       request.userPrompt,
      runtimeMode:      request.runtimeMode ?? 'cloud',
      cognitionContext,
      promptContext:    request.preBuiltPromptContext ?? null,
      visualContext:    request.preBuiltVisualContext ?? null,
      attemptNumber,
      attemptHistory,
      repairContext:     request.repairContext,
      applyBrandMemory:  request.applyBrandMemory,
      // P3 — W4/W9: BYOK overrides + preferred provider routing
      apiKeyOverrides:   request.apiKeyOverrides,
      preferredProvider: request.preferredProvider,
      // Phase 4: per-request model override
      preferredModel:    request.preferredModel,
    }
  }
}
