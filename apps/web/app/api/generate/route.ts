/**
 * BrandOS — /api/generate (P0-A REFACTOR)
 *
 * ARCHITECTURAL LAW ENFORCED:
 *   ALL generation routes through the canonical governed pipeline:
 *   generation → ArtifactEngine.compileAndGovern() (OCL compile*Artifact() sub-steps + governance.validate())
 *              → [repair → compile*Artifact()] → persistence → renderer
 *
 * NOTE: normalizeOutput() is NOT a step in this pipeline. The 2026-05-23 refactor
 * inlined normalization sub-steps inside each compile*Artifact() compiler.
 *
 * P0-A FIX: This route no longer calls runCarouselSemanticGovernance() directly
 * on raw blueprint objects. All carousel generation now routes through
 * executeArtifactPipeline(), which enforces OCL compilation before governance.
 *
 * /api/generate and /api/carousel now use the SAME execution path.
 * No route-specific semantic behavior divergence exists.
 *
 * PHASE 1 FIX (1.1): Removed inline brand_context assembly. persona is now
 * passed as an opaque object to runControlPlane. Brand Intelligence owns the
 * interpretation of persona fields into brand context — not the route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import {
  AdminSettingsService,
  runControlPlane,
  executeArtifactPipeline,
  isArtifactPipelineRejection,
  resolveWorkspaceSettings,
  globalArtifactVersioning,
} from '@brandos/control-plane-layer'
import { trackServer } from '@/lib/server-analytics'
import { v4 as uuidv4 } from 'uuid'

import type { OverrideMode, TaskType } from '@brandos/control-plane-layer'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const requestId = uuidv4()

  try {
    const body = await req.json()
    const {
      prompt,
      tone = 'executive',
      format = 'linkedin_post',
      runtimeMode: rawRuntimeMode,
      personaId,
      overrideMode = 'standard',
      applyBrandMemory,
      // Phase 4 — Runtime Consolidation: optional per-request provider and model overrides.
      // Both are optional strings forwarded to ControlPlaneRequestInput and threaded
      // through CPL → orchestrator → callWithMode() → InvocationRequest.
      // Validated defensively: only plain strings are accepted; anything else is ignored.
      provider,
      model,
    } = body

    const campaignBriefId = typeof body.campaign_brief_id === 'string' ? body.campaign_brief_id : undefined

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Missing prompt' }, { status: 400 })
    }

    const trimmedPrompt = prompt.trim()

    if (trimmedPrompt.length === 0) {
      return NextResponse.json({ error: 'Prompt cannot be empty' }, { status: 400 })
    }

    if (trimmedPrompt.length > 8000) {
      return NextResponse.json({ error: 'Prompt exceeds maximum length of 8000 characters' }, { status: 400 })
    }

    if ((body as any).engineMode) {
      return NextResponse.json({ error: 'engineMode is no longer accepted. Use runtimeMode in admin settings.' }, { status: 400 })
    }
    const runtimeMode = AdminSettingsService.resolveRuntimeMode(rawRuntimeMode)

    const { user, workspaceId, supabase, unauthorized } = await requireUser()

    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // P2: Resolve workspace settings (includes plan) for tier enforcement
    const workspaceSettings = await resolveWorkspaceSettings(workspaceId)

    const personaQuery = supabase.from('personas').select('*').eq('user_id', user.id)

    const { data: persona } = await (
      personaId
        ? personaQuery.eq('id', personaId).single()
        : personaQuery.eq('is_default', true).single()
    )

    const formatToTask: Record<string, TaskType> = {
      linkedin_post: 'post',
      article: 'post',
      carousel: 'carousel',
      deck: 'deck',
      report: 'report',
      newsletter: 'newsletter',
      campaign: 'campaign',
    }

    const taskType = formatToTask[format] ?? 'post'

    // ── Step 1: Control Plane ─────────────────────────────────────────────────
    // Intent analysis, policy, brand merge, routing, generation, scoring, retry.
    // OCL normalization for structured tasks happens inside runControlPlane.
    //
    // PHASE 1 FIX (1.1): persona is passed as an opaque object. BI resolves
    // audience_type, executive_level, and all brand context fields internally.
    // The route must NOT construct brand_context fragments from persona fields.

    const cpResponse = await runControlPlane(
      {
        request_id: requestId,
        user_id: user.id,
        // P0 — Implementation Wave 1A: workspace_id resolved by requireUser()
        // — see runControlPlane's ControlPlaneRequestInput doc comment.
        workspace_id: workspaceId,
        user_prompt: trimmedPrompt,
        task_type: taskType,
        tone,
        format,
        override_mode: (overrideMode as OverrideMode) ?? 'standard',
        persona: persona ?? undefined,
        // Brand Memory gate: boolean from request body (undefined = use user preference default)
        apply_brand_memory: typeof applyBrandMemory === 'boolean' ? applyBrandMemory : undefined,
        // Phase 4: optional per-request provider/model overrides from request body
        // Validated as plain strings — any other type is ignored (treated as absent).
        preferred_provider: typeof provider === 'string' ? provider : undefined,
        preferred_model:    typeof model === 'string' ? model : undefined,
      },
      runtimeMode,
      supabase
    )

    // ── Phase 5 — Runtime Consolidation: structured generation log ─────────────
    // Emits one log line per generation with the full resolved execution trace:
    // requested provider/model (from route body), resolved provider/model (from CPL),
    // and runtime mode. Replaces ad-hoc (cpResponse as any).resolvedProvider casts
    // scattered across the route with a single canonical structured log.
    console.info('[GenerationComplete]', JSON.stringify({
      requestId,
      workspaceId,
      userId:            user.id,
      runtimeMode,
      requestedProvider: typeof provider === 'string' ? provider : null,
      requestedModel:    typeof model === 'string' ? model : null,
      resolvedProvider:  cpResponse.resolvedProvider ?? null,
      resolvedModel:     cpResponse.resolvedModel ?? null,
      qaScore:           cpResponse.quality?.score ?? null,
    }))

    // ── Step 2: Structured artifact pipeline (carousel / deck / report) ────────
    // CANONICAL PATH: all structured artifacts go through executeArtifactPipeline().
    // This enforces OCL → governance → repair → OCL order.
    // No raw governance calls. No OCL bypass. One path.
    //
    // CRIT-001 FIX: report is a structured artifact type. It must pass through
    // executeArtifactPipeline() → runReportPipeline() → compileAndGovern('report').
    // Prior code excluded report, routing it to the unstructured text path (Step 3)
    // which returned raw LLM text with no compilation, no governance, no richness
    // scoring, and stored an incorrect shape in campaigns.content.

    const isStructuredTask = taskType === 'carousel' || taskType === 'deck' || taskType === 'report' || taskType === 'newsletter'

    if (isStructuredTask) {
      const rawOutput: string =
        (cpResponse as any).rawLLMOutput ||
        (cpResponse as any).output ||
        ''

      let pipelineResult: Awaited<ReturnType<typeof executeArtifactPipeline>>

      try {
        pipelineResult = await executeArtifactPipeline({
          topic: trimmedPrompt,
          taskType,
          tone,
          rawLLMOutput: rawOutput,
          cpResponse: (cpResponse as any)._generationResult ?? (cpResponse as any),
          runtimeMode,
          userId: user.id,
          // P0 — Implementation Wave 1A: required by ArtifactPipelineInput —
          // see its doc comment for why repair/richness-retry calls need this.
          workspaceId,
          requestId,
          supabase,
          identity: (cpResponse as any).resolvedIdentity,
          // Forward original request state so repair calls inherit it unchanged.
          applyBrandMemory: typeof applyBrandMemory === 'boolean' ? applyBrandMemory : undefined,
          persona: persona ?? undefined,
          personaId: personaId ?? undefined,
          // P2: tier-based repair limit
          workspacePlan: workspaceSettings.plan,
        })
      } catch (err) {
        if (isArtifactPipelineRejection(err)) {
          // P3-RECOVERY: if the rejection carries a partial artifact, surface it
          // as a degraded result rather than returning a hard 422 failure.
          // The UI must display a recoverable warning banner, not a crash.
          if (err.isDegradedRecoverable && err.lastValidArtifact) {
            console.warn(
              `[GenerateRoute][${requestId}] Pipeline rejected but partial artifact recovered — ` +
              `returning degraded result. type=${err.artifactType} reason="${err.reason}"`,
            )
            try {
              trackServer(user.id, 'artifact_degraded_recovery', {
                format,
                runtimeMode,
                request_id: requestId,
                rejection_reason: err.reason,
                repair_attempts: err.repairAttempts,
              })
            } catch { /* non-critical */ }

            return NextResponse.json({
              artifact:           err.lastValidArtifact,
              repaired:           err.repairAttempts > 0,
              repairAttempts:     err.repairAttempts,
              // P3-RECOVERY: UI reads this flag to display the warning banner.
              // Never omit this flag when returning a degraded artifact —
              // the renderer must always know it is showing unvalidated output.
              recoverable_issues: true,
              recoverable_reason: err.reason,
              request_id:         requestId,
            })
          }

          // No partial artifact available — hard failure
          try {
            trackServer(user.id, 'artifact_semantic_failure', {
              format,
              runtimeMode,
              request_id: requestId,
              rejection_reason: err.reason,
              repair_attempts: err.repairAttempts,
            })
          } catch { /* non-critical */ }

          return NextResponse.json(
            {
              error: 'Generation failed: content could not be validated',
              detail: err.reason,
              request_id: requestId,
              semantic_failure: true,
            },
            { status: 422 }
          )
        }
        throw err
      }

      const { artifact, repaired, repairAttempts, richnessScore } = pipelineResult

      // Persist governed artifact
      const safeTitle = trimmedPrompt.slice(0, 80).replace(/\s+/g, ' ').trim() ||
        (format + ' - ' + new Date().toLocaleDateString())

      const { data: campaign, error: dbError } = await supabase
        .from('campaigns')
        .insert({
          user_id: user.id,
          workspace_id: workspaceId,
          title: safeTitle,
          topic: trimmedPrompt,
          format: format as any,
          status: 'generated',
          content: artifact as any,
          qa_score_before: cpResponse.retry_state?.previous_scores?.[0] ?? null,
          qa_score_after: cpResponse.quality?.score ?? null,
          persona_id: personaId ?? null,
          ...(campaignBriefId ? { campaign_brief_id: campaignBriefId } : {}),
        })
        .select()
        .single()

      if (dbError) {
        console.error('[generate] DB save failed:', dbError.message)
      }

      // Phase Final P2: record score to persistent score history
      try {
        const { globalScoreHistory } = await import('@brandos/control-plane-layer')
        globalScoreHistory.record(
          {
            request_id:   requestId,
            user_id:      user.id,
            workspace_id: workspaceId,
            task_type:    taskType,
            model_id:     (cpResponse.routing as any)?.preferred_tiers?.[0] ?? 'unknown',
            provider:     cpResponse.resolvedProvider ?? 'unknown',
            score:        cpResponse.quality?.score ?? 0,
            retries:      (cpResponse.retry_state?.attempt ?? 1) - 1,
            latency_ms:   cpResponse.telemetry?.latency_ms ?? 0,
            approved:     null,
            timestamp:    new Date().toISOString(),
          },
          { campaignId: campaign?.id, artifactType: taskType, version: 1 }
        )
      } catch { /* non-critical */ }

      // Phase Final P1: resolve the real version number now that the
      // owning campaign exists. stamp() (inside executeArtifactPipeline,
      // via runPhaseCLifecycle) wrote a provisional version=1 row with
      // campaign_id=null because the campaign didn't exist yet at that
      // point. This call links the two and computes the real,
      // COUNT(*)+1-derived version number. Fire-and-forget — matches the
      // versioning service's existing never-block-the-response pattern;
      // a failure here only means version history is momentarily
      // unlinked, not that generation failed.
      if (campaign?.id) {
        void globalArtifactVersioning.linkAndFinalizeVersion(requestId, workspaceId, campaign.id)
      }

      try { await supabase.rpc('increment_generations_used', { user_id: user.id }) } catch {}

      try {
        trackServer(user.id, 'generation_completed', {
          format,
          runtimeMode,
          qa_score: cpResponse.quality?.score,
          retries: (cpResponse.retry_state?.attempt ?? 1) - 1,
          pipeline_repaired: repaired,
          pipeline_repair_attempts: repairAttempts,
          richness_score: richnessScore,
          campaign_id: campaign?.id ?? null,
        })
      } catch {}

      return NextResponse.json({
        success: true,
        result: artifact,
        campaignId: campaign?.id ?? null,
        runtimeMode,
        pipeline: {
          validated: true,
          repaired,
          repairAttempts,
          richness_score: richnessScore,
        },
      })
    }

    // ── Step 3: Non-structured tasks (post, report text, etc.) ────────────────
    // These do not require OCL compilation or semantic governance.
    // They return the scored control-plane output directly.

    const finalContent = cpResponse.output

    const wordCount =
      typeof finalContent === 'string'
        ? finalContent.split(/\s+/).filter(Boolean).length
        : 0

    const safeTitle =
      trimmedPrompt.slice(0, 80).replace(/\s+/g, ' ').trim() ||
      (format + ' - ' + new Date().toLocaleDateString())

    const finalResult: any = {
      format,
      title: safeTitle,
      content: finalContent,
      raw_output: cpResponse.output,
      metadata: {
        tone,
        audience: cpResponse.intent?.detected_task,
        word_count: wordCount,
        generated_at: cpResponse.delivered_at,
        structured: false,
      },
      control_plane: {
        original_score: cpResponse.retry_state?.previous_scores?.[0] ?? cpResponse.quality?.score,
        final_score: cpResponse.quality?.score,
        fixes_applied: cpResponse.quality?.fixes_applied,
        flags_remaining: cpResponse.quality?.flags_remaining,
        retries: (cpResponse.retry_state?.attempt ?? 1) - 1,
        routing: cpResponse.routing,
        intent: cpResponse.intent,
        override_mode: cpResponse.override_mode,
        activity_log: cpResponse.activity_log,
      },
      engine_badge:
        // Phase 5: use typed resolvedProvider from ControlPlaneResponse instead of `as any` cast
        (cpResponse.resolvedProvider || (cpResponse.routing as any)?.preferred_tiers?.[0] || 'AI') +
        ' - BrandOS Powered',
     engine_badge_detail:
  'via ' +
  ((cpResponse.routing as any)?.preferred_tiers?.[0] || 'standard'),
      runtimeMode,
      fallback: false,
    }

    const { data: campaign, error: dbError } = await supabase
      .from('campaigns')
      .insert({
        user_id: user.id,
        workspace_id: workspaceId,
        title: finalResult.title,
        topic: trimmedPrompt,
        format: format as any,
        status: 'generated',
        content: finalResult as any,
        qa_score_before: cpResponse.retry_state?.previous_scores?.[0] ?? null,
        qa_score_after: cpResponse.quality?.score ?? null,
        persona_id: personaId ?? null,
        ...(campaignBriefId ? { campaign_brief_id: campaignBriefId } : {}),
      })
      .select()
      .single()

    if (dbError) {
      console.error('[generate] DB save failed:', dbError.message)
    }

    try { await supabase.rpc('increment_generations_used', { user_id: user.id }) } catch {}

    try {
      trackServer(user.id, 'generation_completed', {
        format,
        runtimeMode,
        override_mode: cpResponse.override_mode,
        latency_ms: cpResponse.telemetry?.latency_ms,
        qa_score: cpResponse.quality?.score,
        retries: (cpResponse.retry_state?.attempt ?? 1) - 1,
        campaign_id: campaign?.id ?? null,
      })
    } catch {}

    return NextResponse.json({
      success: true,
      result: finalResult,
      campaignId: campaign?.id ?? null,
    })

  } catch (error: any) {
    console.error(`[generate/route][${requestId.slice(0, 8)}]`, error)
    return NextResponse.json(
      { error: error?.message || 'Generation failed' },
      { status: 500 }
    )
  }
}
