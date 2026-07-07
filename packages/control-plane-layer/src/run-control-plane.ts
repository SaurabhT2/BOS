/**
 * @brandos/control-plane-layer — src/run-control-plane.ts
 *
 * IMPLEMENTATION: runControlPlane() — the legacy-compatible public entrypoint
 * for all artifact generation.
 *
 * ARCHITECTURAL ROLE:
 *   runControlPlane() is the single generation function all API routes call.
 *   It wraps CPLOrchestrator.orchestrate() and returns a legacy-shaped
 *   ControlPlaneResponse so existing routes need zero changes BEYOND
 *   resolving and passing `workspace_id` (P0 — Implementation Wave 1A).
 *
 *   P0: ControlPlaneRequestInput.workspace_id is a new REQUIRED field. Every
 *   route already calls requireUser() (apps/web/lib/supabase-server.ts),
 *   which now resolves `workspaceId` alongside `user`/`supabase` — pass that
 *   value through as `workspace_id`. This is the only required change to
 *   existing callers.
 *
 *   The response shape is documented by cpResponse field usage across routes:
 *     cpResponse.output             — raw content string
 *     cpResponse.quality.score      — governance score
 *     cpResponse.quality.fixes_applied
 *     cpResponse.quality.flags_remaining
 *     cpResponse.retry_state.attempt
 *     cpResponse.retry_state.previous_scores
 *     cpResponse.routing
 *     cpResponse.intent.detected_task
 *     cpResponse.override_mode
 *     cpResponse.delivered_at
 *     cpResponse.telemetry.latency_ms
 *     cpResponse.activity_log
 *     cpResponse.resolvedIdentity   (cast via `as any`)
 *
 * STAGE EVENTS:
 *   Optional 4th argument onStageEvent fires synthetic progress events so
 *   /api/generate-with-progress can stream pipeline stages via SSE.
 *
 * ADMIN SETTINGS:
 *   Settings are loaded per-request from AdminSettingsService (which reads
 *   from Supabase-backed config). This preserves the existing behaviour of
 *   settings flowing into execution per-request.
 */

import { CPLOrchestrator } from './orchestrator'
import { AdminSettingsService } from './admin/settings-service'
import type { RuntimeMode, TaskType, OverrideMode } from '@brandos/contracts'
import { CLOUD_PROVIDER_IDS } from '@brandos/contracts'
import { resolveWorkspaceSettings } from './workspace/settings-resolver'
import { checkWorkspaceLimits } from './workspace/limits-checker'
import { getProviderKeyMap } from '@brandos/runtime-config'

// ─── Request shape (legacy snake_case — matches all existing route callers) ───

export interface ControlPlaneRequestInput {
  request_id:       string
  user_id:          string
  /**
   * FK → workspaces.id. NOT NULL.
   *
   * P0 — Implementation Wave 1A: NEW required field. All apps/web routes
   * resolve this via requireUser()'s `workspaceId` (apps/web/lib/supabase-server.ts)
   * before calling runControlPlane(). Previously this function used
   * `input.user_id` as the workspace scoping key for
   * CPLOrchestrator.orchestrate() — that has been corrected; user_id and
   * workspace_id are no longer conflated anywhere in the generation path.
   *
   * Required (not optional) — there is no safe default. A caller with no
   * resolved workspace should not reach this function; requireUser()
   * returns `unauthorized: true` in that case (see apps/web/lib/supabase-server.ts).
   */
  workspace_id:     string
  user_prompt:      string
  task_type?:       TaskType
  tone?:            string
  format?:          string
  override_mode?:   OverrideMode
  persona?:         Record<string, unknown>
  brand_context?:   Record<string, unknown>
  /**
   * Whether Brand Memory should influence generation.
   * Forwarded directly into CPLOrchestrator.orchestrate() → GenerationRequest.
   * Defaults to true when undefined (backward-compatible for existing users).
   */
  apply_brand_memory?: boolean

  /**
   * Phase 4 — Runtime Consolidation: optional per-request provider override.
   *
   * Sourced from the generate API route body (`provider` field). When set,
   * takes precedence over the workspace preferred_provider setting as the
   * routingHint.preferred_provider forwarded to the runtime router.
   *
   * null/undefined = fall back to workspace preferred_provider or platform default.
   */
  preferred_provider?: string | undefined

  /**
   * Phase 4 — Runtime Consolidation: optional per-request model override.
   *
   * Sourced from the generate API route body (`model` field). When set,
   * forwarded to the runtime via routingHint.preferred_model → InvocationRequest.preferred_model
   * → ExecutionEngine dispatch (soft hint — adapter may fall back to its default).
   *
   * null/undefined = no model override; adapter uses its admin-configured default.
   */
  preferred_model?: string | undefined
}

// ─── Response shape (legacy — matches all existing route cpResponse usage) ───

export interface ControlPlaneResponse {
  /** Raw text content from the AI generation */
  output:         string
  /** Raw LLM output — alias of output for backward compat */
  rawLLMOutput:   string
  override_mode:  OverrideMode
  delivered_at:   string
  quality: {
    score:           number
    fixes_applied:   string[]
    flags_remaining: string[]
  }
  retry_state: {
    attempt:          number
    previous_scores:  number[]
  }
  routing: {
    preferred_tiers: string[]
    provider?:       string
  }
  intent: {
    detected_task: string
  }
  telemetry: {
    latency_ms: number
  }
  activity_log: string[]
  /** Resolved semantic identity — available on `as any` casts in routes */
  resolvedIdentity?: unknown
  /** The full GenerationResult from orchestrator — internal, for pipeline forwarding */
  _generationResult: import('./types').GenerationResult
  /**
   * Phase 5 — Runtime Consolidation: resolved provider used for this generation.
   * Replaces ad-hoc `(cpResponse as any).resolvedProvider` casts in route handlers.
   * Populated from the LLMResponse.provider field returned by callWithMode().
   */
  resolvedProvider?: string | undefined
  /**
   * Phase 5 — Runtime Consolidation: resolved model used for this generation.
   * Populated from LLMResponse.resolvedModel returned by callWithMode().
   */
  resolvedModel?: string | undefined
}

// ─── Stage event types ────────────────────────────────────────────────────────

export interface StageEvent {
  stage:    string
  progress: number
  message:  string
}

export type StageEventCallback = (event: StageEvent) => void

// ─── Implementation ────────────────────────────────────────────────────────────

export async function runControlPlane(
  input:        ControlPlaneRequestInput,
  runtimeMode?: RuntimeMode,
  _supabase?:   unknown,             // accepted for compat; not used here
  onStageEvent?: StageEventCallback
): Promise<ControlPlaneResponse> {
  const startMs = Date.now()

  // Emit synthetic stage events so SSE path gets progress signals
  onStageEvent?.({ stage: 'analyzeIntent',  progress: 10, message: 'Analyzing intent…'    })
  onStageEvent?.({ stage: 'policyCheck',    progress: 20, message: 'Checking policy…'     })
  onStageEvent?.({ stage: 'llmStart',       progress: 35, message: 'Invoking AI…'         })

  // ── A.3 Workspace Settings & Limits ──────────────────────────────────────
  // Resolve the three-level settings hierarchy and enforce monthly limit.
  // This is the ONLY workspace setting enforced in P0 (see limits-checker.ts).
  // The resolved settings are available here for future use (P1/P2 wiring).
  const workspaceSettings = await resolveWorkspaceSettings(input.workspace_id)

  if (_supabase) {
    const limitsCheck = await checkWorkspaceLimits(
      input.workspace_id,
      workspaceSettings,
      _supabase,
      input.task_type,   // P2: artifact-type gate
    )
    if (!limitsCheck.allowed) {
      return {
        ok: false,
        error: limitsCheck.reason ?? 'Monthly generation limit reached.',
        errorCode: 'WORKSPACE_LIMIT_EXCEEDED',
        used: limitsCheck.used,
        limit: limitsCheck.limit,
        tierGate: limitsCheck.tierGate ?? null,
      } as any
    }
  }

  // ── P3 — BYOK: Resolve workspace API key overrides ──────────────────────
  // Explorer is BYOK-ineligible — skip the DB round-trip entirely.
  // For Professional/Executive: one bulk query (F4) → decrypt in memory.
  // apiKeyOverrides is {} if no workspace keys are configured or if
  // BRANDOS_KEY_ENCRYPTION_SECRET is absent — runtime falls through to env keys.
  const apiKeyOverrides: Record<string, string> =
    workspaceSettings.plan === 'explorer'
      ? {}
      : await getProviderKeyMap(input.workspace_id, CLOUD_PROVIDER_IDS)

  // ── P3 — W9: Resolve effective runtimeMode from workspace settings ───────
  // workspace_settings.runtime_mode (if set) overrides the parameter passed
  // to this function by the API route. This is the W9 fix: the workspace
  // persisted preference now takes effect even when the Studio page doesn't
  // explicitly pass a mode. The route parameter acts as a final fallback.
  // Cast is safe: runtime_mode values are 'local' | 'cloud' | null (string column).
  const effectiveRuntimeMode: RuntimeMode =
    (workspaceSettings.runtime_mode as RuntimeMode | null) ?? runtimeMode ?? 'cloud'

  // Build GenerationRequest from legacy snake_case input
  const orchestrator = new CPLOrchestrator()
  const result = await orchestrator.orchestrate({
    requestId:       input.request_id,
    // P0 — Implementation Wave 1A: workspaceId now comes from
    // input.workspace_id (a real workspaces.id FK), not input.user_id.
    // userId carries the real requesting user — see GenerationRequest doc
    // comments in types.ts for the distinction and where each flows.
    workspaceId:     input.workspace_id,
    userId:          input.user_id,
    userPrompt:      input.user_prompt,
    taskType:        input.task_type,
    persona:         input.persona,
    brandContext:    input.brand_context,
    runtimeMode:     effectiveRuntimeMode,
    applyBrandMemory: input.apply_brand_memory,
    // P3 — W4: BYOK key overrides (empty object = use platform env keys)
    apiKeyOverrides,
    // P3 — W9: workspace preferred_provider for routing hint (may be null)
    // Phase 4: request-level preferred_provider (from generate body) takes precedence
    // over the workspace setting when provided.
    preferredProvider: input.preferred_provider ?? workspaceSettings.preferred_provider,
    // Phase 4: per-request model override forwarded from generate body
    preferredModel: input.preferred_model ?? undefined,
  })

  onStageEvent?.({ stage: 'compile', progress: 80, message: 'Compiling artifact…' })
  onStageEvent?.({ stage: 'export',  progress: 95, message: 'Finalising…'         })

  const latencyMs = Date.now() - startMs

  // Map GenerationResult → legacy ControlPlaneResponse
  return {
    output:        result.artifact.content,
    rawLLMOutput:  result.artifact.content,
    override_mode: input.override_mode ?? 'standard',
    delivered_at:  new Date().toISOString(),
    quality: {
      score:           result.score,
      fixes_applied:   result.wasRepaired ? ['llm_repair'] : [],
      flags_remaining: [],
    },
    retry_state: {
      attempt:         result.wasRepaired ? 2 : 1,
      previous_scores: result.wasRepaired ? [Math.max(0, result.score - 15)] : [],
    },
    routing: {
      preferred_tiers: [effectiveRuntimeMode],
    },
    intent: {
      detected_task: input.task_type ?? 'post',
    },
    telemetry: {
      latency_ms: latencyMs,
    },
    activity_log: [
      `[${new Date().toISOString()}] orchestrate.start requestId=${input.request_id}`,
      `[${new Date().toISOString()}] orchestrate.complete score=${result.score} durationMs=${latencyMs}`,
    ],
    // PLATFORM SPLIT: sourced from CognitionContext.identity (IdentityContribution),
    // not the deleted semanticIdentity field.
    resolvedIdentity:  result.cognitionContext?.identity ?? null,
    _generationResult: result,
    // Phase 5: resolved execution info — replaces `(cpResponse as any).resolvedProvider` casts
    resolvedProvider:  result.resolvedProvider,
    resolvedModel:     result.resolvedModel,
  }
}


