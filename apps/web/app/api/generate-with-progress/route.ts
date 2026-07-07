/**
 * BrandOS — /api/generate-with-progress
 *
 * Server-Sent Events endpoint that streams real pipeline stage events
 * from runControlPlane to GenerationProgressDisplay.
 *
 * Query params:
 *   topic      — required; the generation prompt
 *   runtimeMode — optional; forwarded to AdminSettingsService.resolveRuntimeMode()
 *   tone       — optional; defaults to 'executive'
 *   format     — optional; defaults to 'linkedin_post'
 *
 * NOTE: engineMode query param is no longer accepted (removed — was dead code).
 *
 * Event shape (matches GenerationProgress in GenerationProgressDisplay):
 *   { stage, progress, message, currentStep?, result?, error? }
 *
 * MED-001 FIX: structured artifact tasks (carousel, deck, report) pass through
 * executeArtifactPipeline() after runControlPlane() completes. The pipeline runs
 * outside the ReadableStream controller — controller is still open but not
 * actively streaming LLM tokens. This preserves streaming UX while ensuring
 * the final result is a compiled, governed ArtifactV2 object.
 *
 * Execution order:
 *   1. runControlPlane()         — streams events via onStageEvent callback
 *   2. [structured only] executeArtifactPipeline() — compile + govern
 *   3. SSE 'complete' event emitted with governed artifact
 */

import { NextRequest } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import {
  runControlPlane,
  AdminSettingsService,
  executeArtifactPipeline,
  isArtifactPipelineRejection,
} from '@brandos/control-plane-layer'
import type { StageEventCallback, TaskType } from '@brandos/control-plane-layer'
import { v4 as uuidv4 } from 'uuid'

export const runtime = 'nodejs'

// Map internal StageEventName → GenerationProgress stage string
const STAGE_TO_PROGRESS_STAGE: Record<string, string> = {
  analyzeIntent: 'analyzing',
  policyCheck:   'analyzing',
  llmStart:      'generating',
  compile:       'extracting',
  export:        'composing',
}

const FORMAT_TO_TASK: Record<string, TaskType> = {
  linkedin_post: 'post',
  article:       'post',
  carousel:      'carousel',
  deck:          'deck',
  report:        'report',
  campaign:      'campaign',
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const topic       = searchParams.get('topic') ?? ''
  const runtimeMode = AdminSettingsService.resolveRuntimeMode(searchParams.get('runtimeMode'))
  const tone        = searchParams.get('tone') ?? 'executive'
  const format      = searchParams.get('format') ?? 'linkedin_post'
  const applyBrandMemoryParam = searchParams.get('applyBrandMemory')
  const applyBrandMemory: boolean | undefined =
    applyBrandMemoryParam === 'true'  ? true  :
    applyBrandMemoryParam === 'false' ? false  :
    undefined
  // Phase 7: optional model override forwarded from create/page.tsx ModelSelector
  const modelParam = searchParams.get('model')
  const preferredModel: string | undefined =
    typeof modelParam === 'string' && modelParam.length > 0 ? modelParam : undefined

  if (!topic.trim()) {
    return new Response('Missing topic', { status: 400 })
  }

  const { user, workspaceId, supabase, unauthorized } = await requireUser()
  if (unauthorized) {
    return new Response('Unauthorized', { status: 401 })
  }

  const taskType  = FORMAT_TO_TASK[format] ?? 'post'
  const encoder   = new TextEncoder()
  const requestId = uuidv4()

  function sseData(payload: object): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
  }

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(sseData({ stage: 'queued', progress: 0, message: 'Queued…' }))

      try {
        const onStageEvent: StageEventCallback = (event) => {
          const progressStage = STAGE_TO_PROGRESS_STAGE[event.stage] ?? 'generating'
          controller.enqueue(sseData({
            stage:       progressStage,
            progress:    event.progress,
            message:     event.message,
            currentStep: event.stage,
          }))
        }

        const cpResponse = await runControlPlane(
          {
            request_id:        requestId,
            user_id:           user.id,
            // P0 — Implementation Wave 1A: see ControlPlaneRequestInput doc comment.
            workspace_id:      workspaceId,
            user_prompt:       topic.trim(),
            task_type:         taskType,
            tone,
            format,
            override_mode:     'standard',
            apply_brand_memory: applyBrandMemory,
            // Phase 7: optional model override from ModelSelector in create page
            preferred_model: preferredModel,
          },
          runtimeMode,
          supabase,
          onStageEvent
        )

        // ── MED-001 FIX: structured artifact pipeline ─────────────────────────
        const isStructuredTask = taskType === 'carousel' || taskType === 'deck' || taskType === 'report'

        if (isStructuredTask) {
          controller.enqueue(sseData({ stage: 'composing', progress: 85, message: 'Compiling and validating artifact…' }))

          const rawOutput: string =
            (cpResponse as any).rawLLMOutput ||
            (cpResponse as any).output ||
            ''

          try {
            const pipelineResult = await executeArtifactPipeline({
              topic:        topic.trim(),
              taskType,
              tone,
              rawLLMOutput: rawOutput,
              cpResponse:   (cpResponse as any)._generationResult ?? (cpResponse as any),
              runtimeMode,
              userId:       user.id,
              // P0 — Implementation Wave 1A: see ArtifactPipelineInput.workspaceId.
              workspaceId,
              requestId,
              supabase,
              identity:     (cpResponse as any).resolvedIdentity,
              // Forward original request state so repair calls inherit it unchanged.
              applyBrandMemory,
            })

            controller.enqueue(sseData({
              stage:    'complete',
              progress: 100,
              message:  'Done!',
              result: {
                format,
                content: pipelineResult.artifact,
                title:   topic.slice(0, 80),
                pipeline: {
                  validated:      true,
                  repaired:       pipelineResult.repaired,
                  repairAttempts: pipelineResult.repairAttempts,
                  richness_score: pipelineResult.richnessScore,
                },
                control_plane: {
                  final_score: cpResponse.quality?.score,
                  routing:     cpResponse.routing,
                },
              },
            }))
          } catch (pipelineErr: any) {
            if (isArtifactPipelineRejection(pipelineErr)) {
              // P3-RECOVERY: if a partial artifact is available, emit it as a
              // degraded complete event instead of an error event.
              // The SSE client reads recoverable_issues to display the warning banner.
              if (pipelineErr.isDegradedRecoverable && pipelineErr.lastValidArtifact) {
                controller.enqueue(sseData({
                  stage:    'complete',
                  progress: 100,
                  message:  'Done (with recoverable issues)',
                  result: {
                    format,
                    artifact:           pipelineErr.lastValidArtifact,
                    // P3-RECOVERY: UI reads this to show "⚠ Generated with recoverable issues"
                    recoverable_issues: true,
                    recoverable_reason: pipelineErr.reason,
                    title:              topic.slice(0, 80),
                  },
                }))
              } else {
                controller.enqueue(sseData({
                  stage:            'error',
                  progress:         0,
                  message:          'Artifact governance failed',
                  error:            pipelineErr.reason,
                  semantic_failure: true,
                }))
              }
            } else {
              controller.enqueue(sseData({
                stage:   'error',
                progress: 0,
                message: 'Artifact compilation failed',
                error:   pipelineErr?.message ?? 'Unknown error',
              }))
            }
          }
          return
        }

        // Non-structured tasks: return cpResponse.output directly
        controller.enqueue(sseData({
          stage:    'complete',
          progress: 100,
          message:  'Done!',
          result: {
            format,
            content: cpResponse.output,
            title:   topic.slice(0, 80),
            control_plane: {
              final_score: cpResponse.quality?.score,
              routing:     cpResponse.routing,
            },
          },
        }))
      } catch (err: any) {
        controller.enqueue(sseData({
          stage:   'error',
          progress: 0,
          message: 'Generation failed',
          error:   err?.message ?? 'Unknown error',
        }))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection:      'keep-alive',
    },
  })
}


