/**
 * POST /api/carousel (P0-A REFACTOR)
 *
 * Now delegates to executeArtifactPipeline() — the SAME canonical path as /api/generate.
 * No route-specific semantic behavior divergence.
 *
 * Pipeline (enforced by executeArtifactPipeline):
 *   1. runControlPlane → normalization, routing, scoring, retry
 *   2. compileCarouselArtifact (OCL) → deterministic CarouselArtifact
 *   3. runCarouselSemanticGovernance → semantic validation + repair (repair re-enters OCL)
 *   4. 422 if governance rejects after all attempts
 *   5. Persist CarouselArtifact
 *   6. Return CarouselArtifact
 *
 * PHASE 1 FIX (1.1): Removed inline brand_context assembly. persona is now
 * passed as an opaque object to runControlPlane. Brand Intelligence owns the
 * interpretation of persona fields into brand context — not the route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import {
  runControlPlane,
  AdminSettingsService,
  executeArtifactPipeline,
  isArtifactPipelineRejection,
  resolveWorkspaceSettings,
} from '@brandos/control-plane-layer'
import { trackServer } from '@/lib/server-analytics'
import { v4 as uuidv4 } from 'uuid'
import type { CarouselArtifact } from '@brandos/contracts'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const requestId = uuidv4()

  try {
    const { searchParams } = new URL(req.url)
    const body = await req.json()
    
    const {
      topic,
      tone = 'executive',
      personaId,
      runtimeMode: rawRuntimeMode,
      engineMode: _rawEngineMode,
      applyBrandMemory,
      // Phase 4 — Runtime Consolidation: per-request provider and model overrides.
      // Mirrors the same fields accepted by /api/generate. Forwarded to
      // runControlPlane() → CPLOrchestrator → routingHint.preferred_provider /
      // routingHint.preferred_model so the RouterEngine honours the caller's choice.
      provider,
      model,
    } = body

    if (!topic) {
      return NextResponse.json({ error: 'Missing topic' }, { status: 400 })
    }

    if ((body as any).engineMode || searchParams?.get?.('engineMode')) {
      return NextResponse.json({ error: 'engineMode is no longer accepted. Use runtimeMode.' }, { status: 400 })
    }
    const runtimeMode = AdminSettingsService.resolveRuntimeMode(rawRuntimeMode)
    console.debug(`[carousel/route][${requestId.slice(0, 8)}] mode resolved: ${runtimeMode}`)

    const { user, workspaceId, supabase, unauthorized } = await requireUser()
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // P2: Resolve workspace settings (includes plan) for tier enforcement
    const workspaceSettings = await resolveWorkspaceSettings(workspaceId)

    const { data: defaultPersona } = await supabase
      .from('personas')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_default', true)
      .single()

    // ── Step 1: Control Plane ─────────────────────────────────────────────────
    //
    // PHASE 1 FIX (1.1): persona is passed as an opaque object. Brand Intelligence
    // owns the resolution of audience_type, executive_level, and all brand context
    // fields — the route must NOT construct brand_context fragments from persona fields.

    console.info(`[carousel/route][${requestId.slice(0, 8)}] Invoking Control Plane — mode=${runtimeMode}`)

    const cpResponse = await runControlPlane(
      {
        request_id: requestId,
        user_id: user.id,
        // P0 — Implementation Wave 1A: see ControlPlaneRequestInput doc comment.
        workspace_id: workspaceId,
        user_prompt: topic,
        task_type: 'carousel',
        tone,
        format: 'carousel',
        override_mode: 'standard',
        persona: defaultPersona ?? undefined,
        // Brand Memory gate
        apply_brand_memory: typeof applyBrandMemory === 'boolean' ? applyBrandMemory : undefined,
        // Phase 4: per-request provider/model overrides forwarded from request body.
        // The workspace preferred_provider (from resolveWorkspaceSettings) is the
        // fallback inside runControlPlane when preferred_provider is undefined here.
        preferred_provider: typeof provider === 'string' ? provider : undefined,
        preferred_model:    typeof model    === 'string' ? model    : undefined,
      },
      runtimeMode,
      supabase
    )

    console.info(
      `[carousel/route][${requestId.slice(0, 8)}] Control Plane returned — ` +
      `score=${cpResponse.quality?.score ?? 'N/A'} ` +
      `retries=${(cpResponse.retry_state?.attempt ?? 1) - 1}`
    )

    // ── Step 2–4: Canonical governed pipeline ────────────────────────────────
    // executeArtifactPipeline handles: OCL compile → governance → repair → OCL
    // SAME path as /api/generate for carousel taskType.

    const rawOutput: string = (cpResponse as any).rawLLMOutput || (cpResponse as any).output || ''

    let pipelineResult: Awaited<ReturnType<typeof executeArtifactPipeline>>

    try {
      pipelineResult = await executeArtifactPipeline({
        topic,
        taskType: 'carousel',
        tone,
        rawLLMOutput: rawOutput,
        cpResponse: (cpResponse as any)._generationResult ?? (cpResponse as any),
        runtimeMode,
        userId: user.id,
        // P0 — Implementation Wave 1A: see ArtifactPipelineInput.workspaceId.
        workspaceId,
        requestId,
        supabase,
        identity: (cpResponse as any).resolvedIdentity,
        // Forward original request state so repair calls inherit it unchanged.
        applyBrandMemory: typeof applyBrandMemory === 'boolean' ? applyBrandMemory : undefined,
        persona: defaultPersona ?? undefined,
        personaId: personaId ?? undefined,
        // P2: tier-based repair limit
        workspacePlan: workspaceSettings.plan,
      })
    } catch (err) {
      if (isArtifactPipelineRejection(err)) {
        console.error(
          `[carousel/route][${requestId.slice(0, 8)}] Pipeline REJECTED — ` +
          `attempts=${err.repairAttempts} reason="${err.reason}" ` +
          `recoverable=${err.isDegradedRecoverable}`
        )

        // P3-RECOVERY: return degraded artifact if available
        //
        // RESPONSE-CONTRACT-001 (P0 fix): this response MUST use the same
        // envelope shape as the success response below (`success`, `result`,
        // `campaignId`, `runtimeMode`) — the frontend (generateCarousel() in
        // workspace/create/page.tsx) only ever reads `body.result` and does
        // not know about a separate `artifact` key. Previously this branch
        // returned `{ artifact: ... }` with HTTP 200, which the frontend
        // silently failed to parse (body.result was undefined, so the
        // "missing a valid artifact.slides array" guard fired and the UI
        // never updated) — see the runtime investigation, Issue D. The
        // recoverable_issues/recoverable_reason fields are additive so a
        // future UI can still show a degraded-quality banner if it chooses to.
        if (err.isDegradedRecoverable && err.lastValidArtifact) {
          try {
            trackServer(user.id, 'artifact_degraded_recovery', {
              format: 'carousel',
              runtimeMode,
              request_id: requestId,
              rejection_reason: err.reason,
              repair_attempts: err.repairAttempts,
            })
          } catch { /* non-critical */ }

          return NextResponse.json({
            success:            true,
            result:             err.lastValidArtifact,
            campaignId:         null,
            runtimeMode,
            repaired:           err.repairAttempts > 0,
            repairAttempts:     err.repairAttempts,
            recoverable_issues: true,
            recoverable_reason: err.reason,
            request_id:         requestId,
          })
        }

        try {
          trackServer(user.id, 'artifact_semantic_failure', {
            format: 'carousel',
            runtimeMode,
            request_id: requestId,
            rejection_reason: err.reason,
            repair_attempts: err.repairAttempts,
          })
        } catch { /* non-critical */ }

        return NextResponse.json(
          {
            error: 'Carousel generation failed: content could not be validated',
            detail: err.reason,
            request_id: requestId,
            semantic_failure: true,
          },
          { status: 422 }
        )
      }
      throw err
    }

    const artifact = pipelineResult.artifact as CarouselArtifact

    console.info(
      `[carousel/route][${requestId.slice(0, 8)}] Pipeline ACCEPTED — ` +
      `repaired=${pipelineResult.repaired} ` +
      `richness=${artifact.richness_metrics.overall_score} ` +
      `slides=${artifact.slides.length}`
    )

    // ── Step 5: Persist ───────────────────────────────────────────────────────

    const { data: campaign } = await supabase
      .from('campaigns')
      .insert({
        user_id: user.id,
        workspace_id: workspaceId,
        title: topic.slice(0, 80),
        topic,
        format: 'carousel' as const,
        status: 'generated',
        content: artifact as any,
        qa_score_before: null,
        qa_score_after: cpResponse.quality?.score ?? null,
        persona_id: personaId ?? null,
      })
      .select()
      .single()

    try { await supabase.rpc('increment_generations_used', { user_id: user.id }) } catch {}

    try {
      trackServer(user.id, 'generation_completed', {
        format: 'carousel',
        runtimeMode,
        qa_score: cpResponse.quality?.score,
        retries: (cpResponse.retry_state?.attempt ?? 1) - 1,
        pipeline_repaired: pipelineResult.repaired,
        pipeline_repair_attempts: pipelineResult.repairAttempts,
        richness_score: artifact.richness_metrics.overall_score,
        campaign_id: campaign?.id ?? null,
      })
    } catch {}

    // ── Step 6: Response ──────────────────────────────────────────────────────

    return NextResponse.json({
      success: true,
      result: artifact,
      campaignId: campaign?.id ?? null,
      runtimeMode,
      iskill: {
        validated: true,
        repaired: pipelineResult.repaired,
        repairAttempts: pipelineResult.repairAttempts,
        richness_score: artifact.richness_metrics.overall_score,
      },
    })

  } catch (error: any) {
    console.error(`[carousel/route][${requestId.slice(0, 8)}]`, error)
    return NextResponse.json(
      { error: error?.message || 'Carousel generation failed' },
      { status: 500 }
    )
  }
}
