/**
 * @brandos/control-plane-layer — artifact-pipeline.ts
 *
 * THE canonical governed artifact execution pipeline.
 *
 * ARCHITECTURAL LAW — every artifact generation MUST flow through here:
 *
 *   generation → ArtifactEngine.compileAndGovern()
 *              (OCL compile*Artifact() + governance.validate() run inside the engine)
 *              → [governance.repair() → compile()] → persistence → renderer
 *
 * NO route may bypass this. NO governance call may receive a raw LLM object.
 * OCL compilation ALWAYS occurs before governance.
 * Repair loops ALWAYS re-enter OCL before re-validation.
 *
 * NOTE: normalizeOutput() is NOT a live pipeline step. The 2026-05-23 refactor
 * moved normalization sub-steps (cleanOutput, extractJSON, transformTo*Schema)
 * inside each compile*Artifact() compiler directly. normalizeOutput() is dead.
 *
 * REFACTOR (2026-05-23) — Boundary Shift: CPL no longer owns ANY structural
 * transformation or data refactoring logic for any artifact type.
 *
 *   BEFORE: The carousel pipeline was the only type wired through ArtifactEngine.
 *   Deck and Report fell through to the default `throw` branch. Any carousel
 *   "refactoring" loops (palette manipulation, slide reordering) that crept
 *   into CPL routes or predecessor versions of this file have been removed.
 *
 *   AFTER:
 *     - ALL three types (carousel, deck, report) go through ArtifactEngine.compileAndGovern().
 *     - executeArtifactPipeline() routes by taskType to one of three thin pipeline
 *       functions. Each function:
 *         1. Extracts the raw string from the CP response.
 *         2. Passes it to ArtifactEngine.compileAndGovern() — which calls OCL internally.
 *         3. Returns the result as an immutable ArtifactPipelineResult.
 *       No structural fields are read, mutated, or re-shaped in CPL.
 *     - The CPL handshake contract:
 *         rawLLMOutput (string) → compile*Artifact()   [inside ArtifactEngine, calls OCL sub-steps directly]
 *                               → governance.validate() [inside ArtifactEngine]
 *                               → ArtifactPipelineResult { artifact: immutable DraftArtifactInput→ArtifactV2 }
 *         CPL does NOT inspect artifact.slides, artifact.sections, or any structural
 *         fields after this point. It forwards the artifact to persistence as-is.
 *
 * ROUTES MUST:
 *   1. Call runControlPlane() for generation
 *   2. Call executeArtifactPipeline() for compilation + governance
 *   3. Persist the returned artifact (immutable — do not reshape)
 *   4. Return the artifact to the renderer
 *
 * ROUTES MUST NOT:
 *   - Call compileCarouselArtifact(), compileDeckArtifact(), compileReportArtifact() directly
 *   - Call runCarouselSemanticGovernance() or any governance function directly
 *   - Implement inline governance or compile logic
 *   - Read or mutate artifact.slides, artifact.sections, artifact.richness_metrics, etc.
 */

import { v4 as uuidv4 } from 'uuid'
// HIGH-003 FIX: bootstrapArtifactEngine import removed. This file no longer calls
// bootstrap — it is a startup concern handled exclusively in instrumentation.ts.
import {
  globalArtifactEngine,
  ArtifactEngineRejection,
  isArtifactEngineRejection,
} from '@brandos/artifact-engine-layer'
import { AdminSettingsService } from './admin/settings-service'
import { CPLOrchestrator } from './orchestrator'
import { globalAuditTrail } from './governance/audit-trail'
import { globalArtifactVersioning } from './versioning/artifact-versioning'
import { globalApprovalService } from './approval/approval-service'
import { resolveTierLimits } from './workspace/tier-resolver'
import { recordBrandMemoryObservation } from './brand-memory/service'

import type {
  ArtifactV2,
  CarouselArtifact,
  DeckArtifact,
  ReportArtifact,
  NewsletterArtifact,
  IGovernanceResult,
  NormalizedOutput,
  CompileOptions,
  IAttemptHistory,
  IAttemptRecord,
} from '@brandos/contracts'

import {
  createEmptyAttemptHistory,
  appendAttemptRecord,
  buildGovernanceFeedbackFromEvaluation,
} from '@brandos/contracts'

import type { TaskType } from '@brandos/contracts'
import type { GenerationRequest, GenerationResult } from './types'
// Backward-compat aliases for pre-L5 code in this file
type ControlPlaneRequest = GenerationRequest
type ControlPlaneResponse = GenerationResult

// ─── Pipeline Input ───────────────────────────────────────────────────────────

export interface ArtifactPipelineInput {
  /** The user-facing topic / prompt for this generation */
  topic: string
  /** Task / artifact type */
  taskType: TaskType
  /** Tone override */
  tone?: string
  /** The raw string output from control plane (pre-OCL) */
  rawLLMOutput: string
  /** The full control plane response (used for normalization metadata) */
  cpResponse: ControlPlaneResponse
  /** Generation mode — forwarded to repair calls */
  runtimeMode: import('@brandos/contracts').RuntimeMode
  /**
   * User ID — needed for repair loop callLLM and forwarded to
   * GenerationRequest.userId on every repair/regen orchestrate() call.
   */
  userId: string

  /**
   * FK → workspaces.id — the workspace this generation is scoped to.
   *
   * P0 — Implementation Wave 1A: NEW required field. Forwarded to
   * GenerationRequest.workspaceId on every repair/regen orchestrate() call
   * inside buildRepairLLM() and the richness-retry path (~line 549).
   *
   * BEFORE this field existed, both of those call sites passed
   * `workspaceId: userId` — i.e. repairs and richness-retries resolved
   * brand cognition (BrandIntelligenceRuntime.resolve()) against the
   * requesting USER's id rather than their workspace. Pre-P0 this was
   * invisible (workspaceId and userId were the same string by
   * construction for the initial generation too). Post-P0 the initial
   * generation correctly uses request.workspaceId — but without this field,
   * repairs of that same artifact would have resolved against a DIFFERENT
   * (and likely non-existent) "workspace" identified by the user's id,
   * silently degrading to buildDegradedCognitionContext() for every repair.
   * This field closes that gap — repairs now resolve against the SAME
   * workspace as the initial generation.
   */
  workspaceId: string

  /** Request ID for traceability */
  requestId: string
  /** Supabase client — forwarded to runControlPlane for repair */
  supabase: any
  /** Resolved semantic identity — injected by orchestrator for SkillContext forwarding */
  identity?: import('@brandos/contracts').ISemanticIdentity
  /**
   * Resolved visual identity — v1.1. Injected by orchestrator for visual-aware ISkill context.
   * Optional — undefined for text-only tasks or when visual signals have not yet been learned.
   */
  visualIdentity?: import('@brandos/contracts').IVisualIdentity

  /**
   * Accumulated attempt history from prior governance evaluations for this request.
   * Undefined on the first attempt (no history yet).
   * Passed into each subsequent ContractAssembler.assemble() call so the Prompt Compiler
   * can produce progressively stronger prompts based on prior failures.
   */
  attemptHistory?: IAttemptHistory

  /**
   * Whether Brand Memory (persona, identity, audience, tone) should be applied during
   * generation. MUST be inherited by every repair and richness-retry call unchanged.
   *
   * This is the original request value — repair calls must never recompute or default
   * this field. Omitting it on a repair call causes the orchestrator to treat it as
   * undefined -> true, silently enabling Brand Memory even when the original request
   * had it disabled.
   *
   * Undefined means use the user preference default (backward-compatible).
   * false means explicitly disabled for this request and all its repairs.
   */
  applyBrandMemory?: boolean

  /**
   * Persona object from the original request — forwarded to every repair and
   * richness-retry orchestrate() call so Brand Intelligence receives the same
   * persona context that was used for the initial generation.
   *
   * Not forwarding this causes repair calls to resolve against the BI global default
   * persona instead of the user selected persona, producing inconsistent brand voice
   * between the initial generation and its repairs.
   */
  persona?: Readonly<Record<string, unknown>>

  /**
   * Persona ID from the original request — forwarded to repair calls for
   * sub-workspace persona scoping in Brand Intelligence resolution.
   */
  personaId?: string

  /**
   * P2 — Workspace plan (from workspaces.plan).
   * Used to resolve the tier repair attempt limit for this workspace.
   * Defaults to 'professional' (full repair budget) when not supplied,
   * so this field is optional for backward compatibility with callers
   * that predate P2.
   *
   * @example 'explorer' → 1 repair attempt (cost-controlled)
   * @example 'professional' | 'executive' → 3 repair attempts (platform default)
   */
  workspacePlan?: string
}

// ─── Pipeline Result ──────────────────────────────────────────────────────────

export interface ArtifactPipelineResult<TArtifact extends ArtifactV2 = ArtifactV2> {
  /** The governed, compiled artifact — ready for persistence and rendering.
   *  IMMUTABLE from the CPL perspective: routes must not mutate any field. */
  artifact: TArtifact
  /** Whether the ISkill governance triggered LLM repair */
  repaired: boolean
  /** Number of governance repair attempts */
  repairAttempts: number
  /** Richness score from final artifact */
  richnessScore: number
  /** Normalization metadata from OCL (populated by compile*Artifact() sub-steps inside the engine) */
  normalizedOutput: NormalizedOutput | null
  /** Full governance result */
  governanceResult: IGovernanceResult<TArtifact>
  /**
   * Final attempt history accumulated across all generation attempts for this request.
   * Carries all governance feedback records, scores, and violation codes.
   * Exposed here for control-plane telemetry and future UI visibility.
   */
  attemptHistory: IAttemptHistory
}

// ─── Pipeline Rejection ───────────────────────────────────────────────────────

export class ArtifactPipelineRejection extends Error {
  /**
   * P3-RECOVERY: When lastValidArtifact is set, callers (route handlers)
   * should render this artifact with a degraded/recoverable flag rather than
   * returning a hard failure.
   *
   * Docs corrected (runtime investigation, Issue E — was previously stale):
   * lastValidArtifact's governance status depends on which rejection path
   * populated it. From the carousel richness-retry loop (the only current
   * source of a "budget exhausted" or "regeneration failed" rejection),
   * lastValidArtifact IS governance-approved — see RICHNESS-RETRY-002 above:
   * it is specifically the highest-scoring attempt that passed
   * govResult.passed and only fell short of the separate richness-score
   * floor. It is not a partially-governed or ungoverned artifact. A
   * lastValidArtifact populated from an ArtifactEngineRejection thrown by
   * the OCL/governance repair loop itself (the outer catch blocks below)
   * may carry different guarantees — callers should not assume
   * "recoverable" implies "identical governance status" across all rejection
   * sources, but for the carousel richness path specifically, the artifact
   * is real, governance-valid content, not a fallback stub.
   */
  constructor(
    public readonly reason: string,
    public readonly repairAttempts: number,
    public readonly artifactType: string,
    public readonly requestId: string,
    public readonly lastValidArtifact?: ArtifactV2 | undefined,
  ) {
    super(
      `[ArtifactPipeline] ${artifactType} pipeline failed after ${repairAttempts} repair attempts: ${reason}`
    )
    this.name = 'ArtifactPipelineRejection'
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ArtifactPipelineRejection)
    }
  }

  /** True if the rejection carries a recoverable partial artifact for degraded rendering. */
  get isDegradedRecoverable(): boolean {
    return this.lastValidArtifact !== undefined
  }
}


export function isArtifactPipelineRejection(err: unknown): err is ArtifactPipelineRejection {
  return err instanceof ArtifactPipelineRejection
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * extractRawFromCpResponse — single point of truth for extracting the raw LLM
 * string from a ControlPlaneResponse.
 *
 * Priority:
 *   1. structuredOutput.content.artifact  (already serialized JSON object)
 *   2. structuredOutput.content.rawText   (raw text stored by normalization)
 *   3. structuredOutput.content           (fallback to JSON-serialize the whole content)
 *   4. cpResponse.output                  (raw pre-normalization string)
 *
 * CPL must NOT further parse, inspect, or transform what is extracted here.
 * It is handed directly to ArtifactEngine.compileAndGovern() as an opaque string.
 */
function extractRawFromCpResponse(cpResponse: ControlPlaneResponse): string {
  // ControlPlaneResponse is now GenerationResult (L5 refactor).
  // The raw content lives in artifact.content.
  const content = (cpResponse as any).artifact?.content
  if (typeof content === 'string' && content.length > 0) return content

  // Legacy fallback for any pre-L5 callers that still pass structuredOutput
  const so = (cpResponse as any).structuredOutput
  if (so && so.success && so.content) {
    const c = so.content as { artifact?: object; rawText?: string }
    if (c.artifact && typeof c.artifact === 'object') return JSON.stringify(c.artifact)
    if (c.rawText) return c.rawText
    return JSON.stringify(c)
  }
  const raw = (cpResponse as any).output ?? ''
  return typeof raw === 'string' ? raw : JSON.stringify(raw)
}

/**
 * buildAttemptRecord — constructs an IAttemptRecord from a completed governance evaluation.
 * Called after each compileAndGovern() to accumulate the attempt history.
 */
function buildAttemptRecord(params: {
  attemptNumber: number
  promptVersion: string
  govResult: IGovernanceResult<ArtifactV2>
  richnessScore: number
  passed: boolean
  artifactType: string
  durationMs?: number
  systemPromptSnapshot?: string
}): IAttemptRecord {
  const { attemptNumber, promptVersion, govResult, richnessScore, passed, artifactType, durationMs, systemPromptSnapshot } = params

  const feedback = buildGovernanceFeedbackFromEvaluation({
    passed,
    score: richnessScore,
    violations: govResult.violations ?? [],
    recommendations: [],
    flagsRemaining: [],
  })

  return {
    attemptNumber,
    promptVersion,
    systemPromptSnapshot,
    governanceFeedback: feedback,
    durationMs,
    artifactType,
  }
}

/**
 * buildRepairLLM — constructs the repair LLM callback for ArtifactEngine's
 * governance repair loop.
 *
 * Repair calls re-enter runControlPlane() with override_mode='raw' — which
 * bypasses governance and returns raw LLM output without scoring. This
 * preserves policy, routing, runtimeMode, and identity context across repair
 * attempts. CPL never calls a provider directly.
 *
 * CLOSED-LOOP FEEDBACK: The repair LLM now carries the current attemptHistory
 * into each subsequent orchestrator call so the Prompt Compiler can produce
 * progressively stronger prompts. The attempt history is updated before each
 * repair call with the previous governance result.
 *
 * The returned string is the raw LLM output — OCL will re-parse and
 * re-compile it inside ArtifactEngine's repair loop.
 */
function buildRepairLLM(
  input: ArtifactPipelineInput,
  taskType: TaskType,
  getLatestHistory: () => IAttemptHistory,
  setLatestHistory: (h: IAttemptHistory) => void,
): (repairPrompt: string) => Promise<string> {
  // Capture all original request fields that must be inherited by repair calls.
  // These must never be recomputed or defaulted — repair runs must use the exact
  // values from the original request to prevent state leakage.
  const { userId, workspaceId, runtimeMode, identity, visualIdentity, applyBrandMemory, persona, personaId } = input

  // TOPIC-DRIFT-FIX-004: Capture the original user topic at closure-creation time.
  // repairPrompt is governance failure text (e.g. "hook must be at least 5 chars").
  // If it were passed as userPrompt, intent.userPrompt in the Prompt Compiler would
  // become the governance feedback — not the user's actual topic — and the LLM
  // would generate content about the failure description, not the original request.
  //
  // Fix: originalTopic is the authoritative user prompt for ALL repair calls.
  // repairPrompt is forwarded as repairContext (additional system context for the
  // orchestrator's repair path). The Prompt Compiler reads userPrompt for the user
  // message and the attemptHistory for the governance feedback section.
  const originalTopic = input.topic

  return async (repairPrompt: string): Promise<string> => {
    // FIX-1: Record the failed attempt into historyRef BEFORE calling orchestrate
    // so the Prompt Compiler receives populated history on this repair call.
    // The closure is only invoked because governance just failed, so passed=false.
    // We derive violations from the current history's last record if present, or
    // fall back to an empty list — the repairPrompt itself encodes the failure reason
    // and the Prompt Compiler will produce a targeted prompt regardless.
    const historyBeforeRepair = getLatestHistory()
    const lastViolations = historyBeforeRepair.records.length > 0
      ? historyBeforeRepair.records[historyBeforeRepair.records.length - 1].governanceFeedback.violations
      : []
    const repairRecord: IAttemptRecord = {
      attemptNumber:    historyBeforeRepair.records.length + 1,
      promptVersion:    `v${historyBeforeRepair.records.length + 1}-pre-repair`,
      governanceFeedback: buildGovernanceFeedbackFromEvaluation({
        passed:          false,
        score:           40,
        violations:      lastViolations.map(v => v.message),
        recommendations: [],
      }),
      artifactType: taskType,
    }
    const historyForRepair = appendAttemptRecord(historyBeforeRepair, repairRecord)
    setLatestHistory(historyForRepair)

    // FIX-2: Forward runtimeMode so repair calls use the same provider as
    // the original generation (was defaulting to 'cloud' regardless of mode).
    //
    // TOPIC-DRIFT-FIX-004: userPrompt is always originalTopic — the user's actual
    // request. repairPrompt (governance feedback) is forwarded as repairContext so
    // the orchestrator can append it to the system prompt without replacing the topic.
    const orchestrator = new CPLOrchestrator()
    const repairResult = await orchestrator.orchestrate({
      requestId:                 uuidv4(),
      // P0 — Implementation Wave 1A: workspaceId (not userId) — see
      // ArtifactPipelineInput.workspaceId doc comment for why this matters.
      workspaceId:               workspaceId,
      userId:                    userId,
      personaId,
      taskType,
      userPrompt:                originalTopic,
      repairContext:             repairPrompt,
      runtimeMode,
      persona:                   persona as Readonly<Record<string, unknown>> | undefined,
      preResolvedIdentity:       identity,
      preResolvedVisualIdentity: visualIdentity,
      attemptHistory:            historyForRepair,
      // Inherit original request Brand Memory state — must not be recomputed.
      // Repair runs must honour the same applyBrandMemory value as the initial
      // generation. Omitting this causes undefined -> true defaulting, which
      // silently enables Brand Memory when the original request had it disabled.
      applyBrandMemory,
    })
    return repairResult.artifact.content ?? ''
  }
}

/**
 * buildTierRepairLLM — wraps buildRepairLLM with a tier-based attempt cap.
 *
 * P2: The engine's internal MAX_REPAIR_ATTEMPTS constant (3) is a hard ceiling.
 * For Explorer workspaces (cap = 1) we wrap the repairLLM callback so it
 * throws after N calls, causing ArtifactEngine's repair loop to exit early.
 *
 * This avoids touching engine.ts (RULE-ARTIFACT-ENGINE-NO-TOUCH) while still
 * enforcing per-tier repair budgets server-side.
 *
 * @param input - Full pipeline input (provides workspacePlan).
 * @param taskType - Artifact type forwarded to buildRepairLLM.
 * @param getLatestHistory - History accessor closure.
 * @param setLatestHistory - History mutator closure.
 */
function buildTierRepairLLM(
  input: ArtifactPipelineInput,
  taskType: import('@brandos/contracts').TaskType,
  getLatestHistory: () => import('@brandos/contracts').IAttemptHistory,
  setLatestHistory: (h: import('@brandos/contracts').IAttemptHistory) => void,
): (repairPrompt: string) => Promise<string> {
  // Resolve tier limits to get the repair attempt cap.
  // We only need repairAttempts here, so we pass a minimal settings stub.
  const tierLimits = resolveTierLimits(input.workspacePlan ?? 'professional', {
    preferred_provider:         'openai',
    runtime_mode:               'cloud',
    governance_score_threshold: 70,
    monthly_generation_limit:   null,
    asset_storage_limit_mb:     0,
    has_custom_generation_limit: false,
    plan:                       (input.workspacePlan ?? 'professional') as any,
  })
  const maxRepairs = tierLimits.repairAttempts

  // Build the base repair callback.
  const baseRepairLLM = buildRepairLLM(input, taskType, getLatestHistory, setLatestHistory)

  let callCount = 0

  return async (repairPrompt: string): Promise<string> => {
    callCount++
    if (callCount > maxRepairs) {
      // Signal to the engine's repair loop that no further repairs are
      // permitted at this tier. Throwing causes the loop to exit and
      // return the last governed (failed) artifact with repaired=false.
      throw new Error(
        `[TierRepairLimit] Workspace plan '${input.workspacePlan ?? 'professional'}' ` +
        `allows max ${maxRepairs} repair attempt(s). Repair budget exhausted.`
      )
    }
    return baseRepairLLM(repairPrompt)
  }
}

/**
 * buildExecutionContext — constructs the ExecutionContext that ArtifactEngine
 * uses to populate GenerationTrace and SkillContext.
 */
function buildExecutionContext(input: ArtifactPipelineInput) {
  return {
    requestId: input.requestId,
    userId: input.userId,
    topic: input.topic,
    tone: input.tone ?? 'executive',
    runtimeMode: input.runtimeMode,
    skillContext: {
      requestId: input.requestId,
      userId: input.userId,
      ...(input.identity ? { identity: input.identity } : {}),
    },
    ...(input.identity ? { identity: input.identity } : {}),
  }
}

/**
 * buildCompileOptions — constructs CompileOptions for ArtifactEngine.
 *
 * CPL supplies only routing/meta information — NOT structural fields.
 * ArtifactEngine owns all structural decisions (slide count, schema, etc.).
 */
function buildCompileOptions(input: ArtifactPipelineInput): CompileOptions {
  return {
    topic: input.topic,
    tone: input.tone,
    provider: (input.cpResponse as any).provider ?? 'unknown',
    requestId: input.requestId,
  } as CompileOptions
}

// ─── Phase C Lifecycle ────────────────────────────────────────────────────────
//
// AB-002 FIX: Phase C (audit trail, versioning, approval) now runs inside
// executeArtifactPipeline — the single canonical governed path.
//
// Previously Phase C ran inside CPLOrchestrator.runStructuredPipeline(), which
// also called compileAndGovern(). executeArtifactPipeline() then called
// compileAndGovern() again — resulting in double governance execution and Phase C
// running on a different artifact instance than the one persisted to Supabase.
//
// After this fix: the orchestrator returns raw LLM text only. This function
// is the single Phase C execution point, operating on the governed artifact.

function runPhaseCLifecycle(
  artifact:     ArtifactV2,
  govResult:    IGovernanceResult<ArtifactV2>,
  taskType:     TaskType,
  input:        ArtifactPipelineInput,
  governanceScore: number
): ArtifactV2 {
  // Audit trail (fire-and-forget)
  //
  // BUGFIX (GTM Critical Sprint, 2026-06-21): was passing input.userId as
  // workspaceId. ArtifactPipelineInput.workspaceId is a real, distinct,
  // correctly-populated field (see its doc comment — added in P0
  // Implementation Wave 1A specifically to stop userId/workspaceId
  // conflation). Stamping audit entries under userId meant any
  // workspace-scoped read (e.g. GET /api/governance/audit) would find
  // nothing for multi-user workspaces. Fixed to use the real workspace id.
  void globalAuditTrail.record({
    requestId:      input.requestId,
    workspaceId:    input.workspaceId,
    artifactType:   taskType,
    score:          governanceScore,
    passed:         govResult.passed,
    violations:     (govResult.violations ?? []) as string[],
    repaired:       govResult.repaired ?? false,
    repairAttempts: govResult.attempts ?? 0,
    timestamp:      new Date().toISOString(),
  })

  // Versioning (in-memory stamp + best-effort Supabase persistence)
  // BUGFIX: same input.userId → input.workspaceId correction as audit trail above.
  const stamped = globalArtifactVersioning.stamp(artifact, {
    requestId:   input.requestId,
    workspaceId: input.workspaceId,
    score:       governanceScore,
    artifactType: taskType,
  })

  // Approval workflow evaluation
  // NOTE: still passes input.userId as workspaceId here, matching its prior
  // (pre-fix) behavior. Not touched in this change — ApprovalService is
  // outside the scope of the GTM Critical backlog this pass implements, and
  // changing its workspace scoping needs its own verification pass against
  // brandos_artifact_approvals consumers before being changed.
  const approvalResult = globalApprovalService.evaluate(stamped, {
    score:        governanceScore,
    workspaceId:  input.userId,
    artifactType: taskType,
  })

  if (approvalResult.requiresApproval) {
    void globalApprovalService.submit(input.requestId, stamped, {
      score:        governanceScore,
      workspaceId:  input.userId,
      artifactType: taskType,
    })
  }

  return stamped
}



// ─── RC-1 Fix: Brand Memory observation with real governance score ─────────────
//
// CPLOrchestrator.orchestrate() fires recordArtifactObservation(score=0) because
// the real governance score is computed later inside executeArtifactPipeline().
// The orchestrator returns governanceScore=0 (placeholder) — brand memory's
// Gate 1 (score < 75) then silently drops every generation observation.
//
// Fix: after executeArtifactPipeline() computes the real governance score, call
// recordBrandMemoryObservation() with the real score so Brand Memory can learn
// from accepted generations. The orchestrator's fire-and-forget call with score=0
// is redundant but harmless (it fires before the pipeline score is known and
// will be dropped by Gate 1 as before — it is NOT removed here to preserve the
// orchestrator contract).
//
// Calling convention:
//   - Only called when govResult.passed === true (artifact accepted)
//   - wasRepaired mirrors govResult.repaired — repaired artifacts carry
//     governance-corrected content, not pure brand voice, so Gate 2 in
//     BrandMemoryServiceV2.learn() drops them.  Recording them would teach
//     Brand Memory the wrong style.
//   - Fire-and-forget (void) — a telemetry failure must never surface as
//     an unhandled rejection and must never affect artifact delivery.

function recordBrandMemoryAfterPipeline(
  input: ArtifactPipelineInput,
  taskType: TaskType,
  rawLLMText: string,
  realGovernanceScore: number,
  wasRepaired: boolean,
): void {
  void recordBrandMemoryObservation({
    requestId:    input.requestId,
    workspaceId:  input.workspaceId,
    artifactType: taskType,
    artifactText: rawLLMText,
    artifactScore: realGovernanceScore,
    wasRepaired,
    observedAt:   new Date().toISOString(),
  }).catch((err: unknown) => {
    // Non-critical — never surface as unhandled rejection
    console.warn(
      `[ArtifactPipeline][${input.requestId.slice(0, 8)}] ` +
      `brand memory observation failed (non-critical): `,
      (err as Error).message,
    )
  })
}

async function runCarouselPipeline(
  input: ArtifactPipelineInput
): Promise<ArtifactPipelineResult<CarouselArtifact>> {
  const { requestId } = input

  // RICHNESS-RETRY-001: When governance passes but richness score < threshold,
  // re-generate via CPL rather than hard-rejecting. The carousel governance layer
  // validates structure (roles, hook length, etc.) — a separate richness metric
  // measures content depth. A structurally valid carousel from Groq can score
  // 10-15 points below threshold when the LLM produces generic content.
  // Re-generating with explicit richness context recovers most of these cases.
  const MAX_RICHNESS_RETRIES = 2

  // RICHNESS-RETRY-002 (P1 fix): track the highest-scoring governance-valid
  // artifact seen across the whole retry sequence, not just the most recent
  // attempt. The retry loop's own scores are non-monotonic (a regeneration
  // aimed at fixing richness can score worse than an earlier attempt — see
  // the runtime investigation's observed 72 → 77 → 67 sequence), so "last"
  // and "best" are genuinely different artifacts. `bestRef` is threaded
  // through the recursive `attempt()` calls via closure, the same pattern
  // already used for `historyRef` below. Only governance-passed attempts are
  // ever recorded here — an attempt that failed governance outright is never
  // a valid recovery candidate, matching the existing `govResult.passed`
  // gate on every throw site in this function.
  const bestRef: {
    current: {
      artifact:      CarouselArtifact
      richnessScore: number
      govResult:     IGovernanceResult<CarouselArtifact>
    } | null
  } = { current: null }

  async function attempt(
    attemptInput: ArtifactPipelineInput,
    richnessAttempt: number,
  ): Promise<ArtifactPipelineResult<CarouselArtifact>> {
    const { rawLLMOutput, cpResponse, requestId: rid } = attemptInput

    const rawStr = rawLLMOutput || extractRawFromCpResponse(cpResponse)
    const normalizedOutput: NormalizedOutput | null = (cpResponse as any).structuredOutput ?? null

    let attemptHistory: IAttemptHistory = attemptInput.attemptHistory ?? createEmptyAttemptHistory()
    let currentAttempt = attemptHistory.records.length + 1

    const historyRef = { current: attemptHistory }

    try {
      const startMs = Date.now()
      const engineResult = await globalArtifactEngine.compileAndGovern(
        'carousel',
        rawStr,
        buildExecutionContext(attemptInput),
        buildCompileOptions(attemptInput),
        buildTierRepairLLM(attemptInput, 'carousel', () => historyRef.current, (h) => { historyRef.current = h }),
      )

      const finalArtifact = engineResult.artifact as CarouselArtifact
      const govResult = engineResult.governanceResult as IGovernanceResult<CarouselArtifact>
      const richnessScore = finalArtifact.richness_metrics.overall_score

      // RICHNESS-RETRY-002: record this attempt as the new best candidate if
      // it passed governance and scores higher than whatever we've kept so
      // far. Deliberately evaluated before the meetsThreshold branch below,
      // so an attempt that passes governance but still misses the richness
      // floor (e.g. 77/80) is still eligible to be the eventual recovery
      // artifact if no later attempt beats it.
      if (govResult.passed && (bestRef.current === null || richnessScore > bestRef.current.richnessScore)) {
        bestRef.current = { artifact: finalArtifact, richnessScore, govResult }
      }

      const policy = AdminSettingsService.getGovernancePolicy()
      const configuredThreshold = (policy.scoreThresholds as Record<string, number>)?.['carousel'] ?? 65

      // modeScale: local models (Ollama/LMStudio) produce shorter/simpler output on
      // average; a 40% relaxation prevents every local generation from being rejected.
      // This is the ONLY intentional threshold adjustment. No per-provider multiplier
      // is applied — cloud providers are held to the full configuredThreshold regardless
      // of which cloud provider is selected, so the admin-configured value is honoured.
      const modeScale = attemptInput.runtimeMode === 'local' ? 0.60 : 1.0
      const effectiveThreshold = Math.round(configuredThreshold * modeScale)
      const governanceScore = govResult.passed ? richnessScore : 50

      // BUGFIX (govFeedback undercounts richness-driven retries): this attempt only
      // truly "succeeds" when BOTH governance passes AND the richness floor is met —
      // that combined condition is what actually decides whether the pipeline retries
      // (see `!meetsThreshold && govResult.passed` below). Previously `passed` here
      // was `govResult.passed` alone, so an attempt that passed governance but missed
      // the richness floor was recorded as a "pass" — meaning `appendAttemptRecord()`'s
      // `totalFailures` counter (which only increments when `feedback.passed` is
      // false) never counted richness-driven regenerations. By attempt 3 the
      // compiled prompt's governance-feedback section would report "failures=0",
      // understating how many times generation had already fallen short and
      // producing a weaker escalation prompt than the retry depth warranted.
      const meetsThreshold = richnessScore >= effectiveThreshold

      const attemptRecord = buildAttemptRecord({
        attemptNumber:  currentAttempt,
        promptVersion:  `v${currentAttempt}`,
        govResult:      govResult as IGovernanceResult<ArtifactV2>,
        richnessScore,
        passed:         govResult.passed && meetsThreshold,
        artifactType:   'carousel',
        durationMs:     Date.now() - startMs,
      })
      attemptHistory = appendAttemptRecord(attemptHistory, attemptRecord)
      historyRef.current = attemptHistory

      if (!meetsThreshold && govResult.passed) {
        // RICHNESS-RETRY-001: Don't hard-reject — retry with richness context if budget allows
        if (richnessAttempt < MAX_RICHNESS_RETRIES) {
          console.warn(
            `[ArtifactPipeline][${rid}] Richness threshold NOT MET (attempt ${richnessAttempt + 1}/${MAX_RICHNESS_RETRIES + 1}): ` +
            `score=${richnessScore} effectiveThreshold=${effectiveThreshold} — regenerating with richness context`
          )

          // Re-invoke CPL with richness-targeted repair context so the next generation
          // understands exactly what depth improvement is needed.
          const richnessRepairContext =
            `Previous generation scored ${richnessScore}/${effectiveThreshold} on content richness. ` +
            `Richness failure means the content is too generic. ` +
            `Every slide must contain at least one: specific named example, concrete percentage or statistic, ` +
            `named individual or organisation, or precise mechanism the reader has not seen stated this way. ` +
            `Replace all vague claims ("many", "often", "significant") with specific, verifiable facts.`

          const orchestrator = new CPLOrchestrator()
          let regenResult: Awaited<ReturnType<typeof orchestrator.orchestrate>>
          try {
            regenResult = await orchestrator.orchestrate({
              requestId:                 uuidv4(),
              // P0 — Implementation Wave 1A: see buildRepairLLM's orchestrate()
              // call and ArtifactPipelineInput.workspaceId doc comment — same
              // workspaceId/userId fix applies to richness-retries.
              workspaceId:               attemptInput.workspaceId,
              userId:                    attemptInput.userId,
              personaId:                 attemptInput.personaId,
              taskType:                  'carousel',
              userPrompt:                attemptInput.topic,
              repairContext:             richnessRepairContext,
              runtimeMode:               attemptInput.runtimeMode,
              persona:                   attemptInput.persona as Readonly<Record<string, unknown>> | undefined,
              preResolvedIdentity:       attemptInput.identity,
              preResolvedVisualIdentity: attemptInput.visualIdentity,
              attemptHistory,
              // Inherit original request Brand Memory state — must not be recomputed.
              // Richness retries are repairs; they must honour the same applyBrandMemory
              // value as the initial generation.
              applyBrandMemory:          attemptInput.applyBrandMemory,
            })
          } catch (regenErr) {
            // BUGFIX (richness-retry provider failure discards a passing artifact):
            // finalArtifact here already PASSED governance (govResult.passed is true —
            // we're only in this branch because the separate richness floor wasn't
            // met). Previously a transient provider error on the regeneration call
            // (rate limit, timeout, etc.) propagated as a raw Error all the way to
            // the API route, which only knows how to degrade-recover an
            // ArtifactPipelineRejection with lastValidArtifact set — so the route's
            // existing degraded-recovery path never fired and the request hard-500'd,
            // throwing away a perfectly usable artifact instead of returning it.
            // Wrap the failure the same way exhausted-retries already are (below)
            // so the route's existing recovery path can serve this artifact instead.
            //
            // RICHNESS-RETRY-002: recover with `bestRef.current` (the highest-scoring
            // governance-passed attempt across the whole retry sequence so far), not
            // `finalArtifact` (this attempt only). They can differ — this attempt is
            // only in this branch because ITS regeneration failed; an earlier attempt
            // may already have scored higher. `bestRef.current` is guaranteed non-null
            // here because this attempt itself passed governance and was already
            // recorded into it above.
            const recovery = bestRef.current!
            console.warn(
              `[ArtifactPipeline][${rid}] Richness retry regeneration failed (attempt ${richnessAttempt + 1}/${MAX_RICHNESS_RETRIES + 1}): ` +
              `${regenErr instanceof Error ? regenErr.message : String(regenErr)} — ` +
              `falling back to best passing artifact across attempts (richness=${recovery.richnessScore})`
            )
            throw new ArtifactPipelineRejection(
              `Richness retry regeneration failed: ${regenErr instanceof Error ? regenErr.message : String(regenErr)} ` +
              `(best richness score across attempts ${recovery.richnessScore}/${effectiveThreshold}, governance passed)`,
              recovery.govResult.attempts,
              'carousel',
              rid,
              recovery.artifact, // lastValidArtifact — highest-scoring governance-valid attempt, not just the last one
            )
          }

          return attempt(
            {
              ...attemptInput,
              rawLLMOutput:   regenResult.artifact.content ?? '',
              cpResponse:     regenResult as any,
              attemptHistory,
            },
            richnessAttempt + 1,
          )
        }

        // Budget exhausted — hard reject
        // RICHNESS-RETRY-002: recover with the best-scoring governance-passed
        // attempt seen across the whole retry sequence (`bestRef.current`),
        // not this (the final) attempt. The three attempts in this loop are
        // not monotonically improving — a later regeneration can score worse
        // than an earlier one — so "final attempt" and "best attempt" are not
        // interchangeable. `bestRef.current` is guaranteed non-null here
        // because this attempt itself passed governance and was already
        // recorded into it above.
        const recovery = bestRef.current!
        console.warn(
          `[ArtifactPipeline][${rid}] Richness threshold NOT MET after ${richnessAttempt + 1} attempts: ` +
          `finalScore=${richnessScore} bestScore=${recovery.richnessScore} effectiveThreshold=${effectiveThreshold} ` +
          `configuredThreshold=${configuredThreshold} mode=${attemptInput.runtimeMode} taskType=carousel`
        )
        // P3-RECOVERY: the best-scoring attempt across the retry sequence
        // PASSED governance — it only failed the richness floor check. This
        // is genuinely the best possible recoverable artifact, not merely
        // the most recent one.
        throw new ArtifactPipelineRejection(
          `Richness score ${recovery.richnessScore} (best of ${richnessAttempt + 1} attempts; ` +
          `final attempt scored ${richnessScore}) below effective threshold ${effectiveThreshold} ` +
          `(configured=${configuredThreshold}, mode=${attemptInput.runtimeMode}) after ${richnessAttempt + 1} attempts`,
          recovery.govResult.attempts,
          'carousel',
          rid,
          recovery.artifact, // lastValidArtifact — highest-scoring governance-valid attempt across the retry sequence
        )
      }

      console.info(
        `[ArtifactPipeline][${rid}] carousel governance: ` +
        `richness=${richnessScore} effectiveThreshold=${effectiveThreshold} ` +
        `configuredThreshold=${configuredThreshold} mode=${attemptInput.runtimeMode} ` +
        `govPassed=${govResult.passed} meetsThreshold=${meetsThreshold} ` +
        `finalScore=${governanceScore} attemptHistory=${attemptHistory.records.length}records`
      )

      const stamped = runPhaseCLifecycle(
        finalArtifact,
        govResult as IGovernanceResult<ArtifactV2>,
        'carousel',
        attemptInput,
        governanceScore
      )

      // RC-1 FIX: record brand memory observation with the REAL governance score.
      // The orchestrator fires this with score=0 (before pipeline runs) — that call
      // is always dropped by BrandMemoryServiceV2 Gate 1 (0 < 75). This call uses
      // the real richness score so Brand Memory can actually learn from accepted artifacts.
      recordBrandMemoryAfterPipeline(
        attemptInput,
        'carousel',
        attemptInput.rawLLMOutput || extractRawFromCpResponse(attemptInput.cpResponse),
        governanceScore,
        govResult.repaired,
      )

      return {
        artifact: stamped as CarouselArtifact,
        repaired: govResult.repaired,
        repairAttempts: govResult.attempts,
        richnessScore,
        normalizedOutput,
        governanceResult: govResult,
        attemptHistory,
      }
    } catch (err) {
      if (isArtifactEngineRejection(err)) {
        throw new ArtifactPipelineRejection((err as any).reason, (err as any).repairAttempts, 'carousel', rid, (err as any).lastValidArtifact)
      }
      throw err
    }
  }

  return attempt(input, 0)
}

// ─── Deck Pipeline ────────────────────────────────────────────────────────────
//
// REFACTOR (2026-05-23): Deck now has a first-class pipeline wired through
// ArtifactEngine.compileAndGovern(), matching the carousel pattern exactly.
//
// CPL responsibility: hand rawStr to ArtifactEngine, return result as-is.
// OCL responsibility: transformToDeckSchema → compileDeckArtifact (sub-steps called directly; normalizeOutput() is not the entry point)
// ArtifactEngine responsibility: compile + governance + repair loop
//
// CPL does NOT read, reshape, or re-emit any field of the returned DeckArtifact.

async function runDeckPipeline(
  input: ArtifactPipelineInput
): Promise<ArtifactPipelineResult<DeckArtifact>> {
  const { rawLLMOutput, cpResponse, requestId } = input

  const rawStr = rawLLMOutput || extractRawFromCpResponse(cpResponse)
  const normalizedOutput: NormalizedOutput | null = (cpResponse as any).structuredOutput ?? null

  let attemptHistory: IAttemptHistory = input.attemptHistory ?? createEmptyAttemptHistory()
  const historyRef = { current: attemptHistory }

  try {
    const startMs = Date.now()
    const engineResult = await globalArtifactEngine.compileAndGovern(
      'deck',
      rawStr,
      buildExecutionContext(input),
      buildCompileOptions(input),
      buildTierRepairLLM(input, 'deck', () => historyRef.current, (h) => { historyRef.current = h }),
    )

    const finalArtifact = engineResult.artifact as DeckArtifact
    const govResult = engineResult.governanceResult as IGovernanceResult<DeckArtifact>
    const richnessScore = finalArtifact.richness_metrics.overall_score

    const policy = AdminSettingsService.getGovernancePolicy()
    const configuredThreshold = (policy.scoreThresholds as Record<string, number>)?.['deck'] ?? 65
    const modeScale = input.runtimeMode === 'local' ? 0.60 : 1.0
    const effectiveThreshold = Math.round(configuredThreshold * modeScale)
    const governanceScore = govResult.passed ? richnessScore : 50

    const attemptRecord = buildAttemptRecord({
      attemptNumber: attemptHistory.records.length + 1,
      promptVersion: `v${attemptHistory.records.length + 1}`,
      govResult:     govResult as IGovernanceResult<ArtifactV2>,
      richnessScore,
      passed:        govResult.passed,
      artifactType:  'deck',
      durationMs:    Date.now() - startMs,
    })
    attemptHistory = appendAttemptRecord(attemptHistory, attemptRecord)
    historyRef.current = attemptHistory

    const meetsThreshold = richnessScore >= effectiveThreshold
    if (!meetsThreshold && govResult.passed) {
      console.warn(
        `[ArtifactPipeline][${requestId}] Richness threshold NOT MET: ` +
        `score=${richnessScore} effectiveThreshold=${effectiveThreshold} ` +
        `configuredThreshold=${configuredThreshold} mode=${input.runtimeMode} taskType=deck`
      )
      // P3-RECOVERY: finalArtifact passed governance — only failed richness floor.
      throw new ArtifactPipelineRejection(
        `Richness score ${richnessScore} below effective threshold ${effectiveThreshold} (configured=${configuredThreshold}, mode=${input.runtimeMode})`,
        govResult.attempts,
        'deck',
        requestId,
        finalArtifact, // lastValidArtifact
      )
    }

    console.info(
      `[ArtifactPipeline][${requestId}] deck governance: ` +
      `richness=${richnessScore} effectiveThreshold=${effectiveThreshold} mode=${input.runtimeMode} ` +
      `govPassed=${govResult.passed} meetsThreshold=${meetsThreshold} finalScore=${governanceScore} ` +
      `attemptHistory=${attemptHistory.records.length}records`
    )

    const stamped = runPhaseCLifecycle(finalArtifact, govResult as IGovernanceResult<ArtifactV2>, 'deck', input, governanceScore)

    // RC-1 FIX: record brand memory with the real governance score.
    recordBrandMemoryAfterPipeline(
      input,
      'deck',
      rawStr,
      governanceScore,
      govResult.repaired,
    )

    return {
      artifact: stamped as DeckArtifact,
      repaired: govResult.repaired,
      repairAttempts: govResult.attempts,
      richnessScore,
      normalizedOutput,
      governanceResult: govResult,
      attemptHistory,
    }
  } catch (err) {
    if (isArtifactEngineRejection(err)) {
      throw new ArtifactPipelineRejection((err as any).reason, (err as any).repairAttempts, 'deck', requestId, (err as any).lastValidArtifact)
    }
    throw err
  }
}

// ─── Report Pipeline ──────────────────────────────────────────────────────────
//
// REFACTOR (2026-05-23): Report now has a first-class pipeline wired through
// ArtifactEngine.compileAndGovern(), matching carousel and deck exactly.
//
// Text-only reports (no JSON structure) are handled inside compileReportArtifact()
// via the rawText single-section fallback. CPL does not need to handle this case.

async function runReportPipeline(
  input: ArtifactPipelineInput
): Promise<ArtifactPipelineResult<ReportArtifact>> {
  const { rawLLMOutput, cpResponse, requestId } = input

  const rawStr = rawLLMOutput || extractRawFromCpResponse(cpResponse)
  const normalizedOutput: NormalizedOutput | null = (cpResponse as any).structuredOutput ?? null

  let attemptHistory: IAttemptHistory = input.attemptHistory ?? createEmptyAttemptHistory()
  const historyRef = { current: attemptHistory }

  try {
    const startMs = Date.now()
    const engineResult = await globalArtifactEngine.compileAndGovern(
      'report',
      rawStr,
      buildExecutionContext(input),
      buildCompileOptions(input),
      buildTierRepairLLM(input, 'report', () => historyRef.current, (h) => { historyRef.current = h }),
    )

    const finalArtifact = engineResult.artifact as ReportArtifact
    const govResult = engineResult.governanceResult as IGovernanceResult<ReportArtifact>
    const richnessScore = finalArtifact.richness_metrics.overall_score

    const policy = AdminSettingsService.getGovernancePolicy()
    const configuredThreshold = (policy.scoreThresholds as Record<string, number>)?.['report'] ?? 65
    const modeScale = input.runtimeMode === 'local' ? 0.60 : 1.0
    const effectiveThreshold = Math.round(configuredThreshold * modeScale)
    const governanceScore = govResult.passed ? richnessScore : 50

    const attemptRecord = buildAttemptRecord({
      attemptNumber: attemptHistory.records.length + 1,
      promptVersion: `v${attemptHistory.records.length + 1}`,
      govResult:     govResult as IGovernanceResult<ArtifactV2>,
      richnessScore,
      passed:        govResult.passed,
      artifactType:  'report',
      durationMs:    Date.now() - startMs,
    })
    attemptHistory = appendAttemptRecord(attemptHistory, attemptRecord)
    historyRef.current = attemptHistory

    const meetsThreshold = richnessScore >= effectiveThreshold
    if (!meetsThreshold && govResult.passed) {
      console.warn(
        `[ArtifactPipeline][${requestId}] Richness threshold NOT MET: ` +
        `score=${richnessScore} effectiveThreshold=${effectiveThreshold} ` +
        `configuredThreshold=${configuredThreshold} mode=${input.runtimeMode} taskType=report`
      )
      // P3-RECOVERY: finalArtifact passed governance — only failed richness floor.
      throw new ArtifactPipelineRejection(
        `Richness score ${richnessScore} below effective threshold ${effectiveThreshold} (configured=${configuredThreshold}, mode=${input.runtimeMode})`,
        govResult.attempts,
        'report',
        requestId,
        finalArtifact, // lastValidArtifact
      )
    }

    console.info(
      `[ArtifactPipeline][${requestId}] report governance: ` +
      `richness=${richnessScore} effectiveThreshold=${effectiveThreshold} mode=${input.runtimeMode} ` +
      `govPassed=${govResult.passed} meetsThreshold=${meetsThreshold} finalScore=${governanceScore} ` +
      `attemptHistory=${attemptHistory.records.length}records`
    )

    const stamped = runPhaseCLifecycle(finalArtifact, govResult as IGovernanceResult<ArtifactV2>, 'report', input, governanceScore)

    // RC-1 FIX: record brand memory with the real governance score.
    recordBrandMemoryAfterPipeline(
      input,
      'report',
      rawStr,
      governanceScore,
      govResult.repaired,
    )

    return {
      artifact: stamped as ReportArtifact,
      repaired: govResult.repaired,
      repairAttempts: govResult.attempts,
      richnessScore,
      normalizedOutput,
      governanceResult: govResult,
      attemptHistory,
    }
  } catch (err) {
    if (isArtifactEngineRejection(err)) {
      throw new ArtifactPipelineRejection((err as any).reason, (err as any).repairAttempts, 'report', requestId, (err as any).lastValidArtifact)
    }
    throw err
  }
}

async function runNewsletterPipeline(
  input: ArtifactPipelineInput
): Promise<ArtifactPipelineResult<NewsletterArtifact>> {
  const { rawLLMOutput, cpResponse, requestId } = input

  const rawStr = rawLLMOutput || extractRawFromCpResponse(cpResponse)
  const normalizedOutput: NormalizedOutput | null = (cpResponse as any).structuredOutput ?? null

  let attemptHistory: IAttemptHistory = input.attemptHistory ?? createEmptyAttemptHistory()
  const historyRef = { current: attemptHistory }

  try {
    const startMs = Date.now()
    const engineResult = await globalArtifactEngine.compileAndGovern(
      'newsletter',
      rawStr,
      buildExecutionContext(input),
      buildCompileOptions(input),
      buildTierRepairLLM(input, 'newsletter', () => historyRef.current, (h) => { historyRef.current = h }),
    )

    const finalArtifact = engineResult.artifact as NewsletterArtifact
    const govResult = engineResult.governanceResult as IGovernanceResult<NewsletterArtifact>
    const richnessScore = finalArtifact.richness_metrics.overall_score

    const policy = AdminSettingsService.getGovernancePolicy()
    const configuredThreshold = (policy.scoreThresholds as Record<string, number>)?.['newsletter'] ?? 58
    const modeScale = input.runtimeMode === 'local' ? 0.60 : 1.0
    const effectiveThreshold = Math.round(configuredThreshold * modeScale)
    const governanceScore = govResult.passed ? richnessScore : 50

    const attemptRecord = buildAttemptRecord({
      attemptNumber: attemptHistory.records.length + 1,
      promptVersion: `v${attemptHistory.records.length + 1}`,
      govResult:     govResult as IGovernanceResult<ArtifactV2>,
      richnessScore,
      passed:        govResult.passed,
      artifactType:  'newsletter',
      durationMs:    Date.now() - startMs,
    })
    attemptHistory = appendAttemptRecord(attemptHistory, attemptRecord)
    historyRef.current = attemptHistory

    const meetsThreshold = richnessScore >= effectiveThreshold
    if (!meetsThreshold && govResult.passed) {
      console.warn(
        `[ArtifactPipeline][${requestId}] Richness threshold NOT MET: ` +
        `score=${richnessScore} effectiveThreshold=${effectiveThreshold} ` +
        `configuredThreshold=${configuredThreshold} mode=${input.runtimeMode} taskType=newsletter`
      )
      // P3-RECOVERY: finalArtifact passed governance — only failed richness floor.
      throw new ArtifactPipelineRejection(
        `Richness score ${richnessScore} below effective threshold ${effectiveThreshold} (configured=${configuredThreshold}, mode=${input.runtimeMode})`,
        govResult.attempts,
        'newsletter',
        requestId,
        finalArtifact, // lastValidArtifact
      )
    }

    console.info(
      `[ArtifactPipeline][${requestId}] newsletter governance: ` +
      `richness=${richnessScore} effectiveThreshold=${effectiveThreshold} mode=${input.runtimeMode} ` +
      `govPassed=${govResult.passed} meetsThreshold=${meetsThreshold} finalScore=${governanceScore} ` +
      `attemptHistory=${attemptHistory.records.length}records`
    )

    const stamped = runPhaseCLifecycle(finalArtifact, govResult as IGovernanceResult<ArtifactV2>, 'newsletter', input, governanceScore)

    // RC-1 FIX: record brand memory with the real governance score.
    recordBrandMemoryAfterPipeline(
      input,
      'newsletter',
      rawStr,
      governanceScore,
      govResult.repaired,
    )

    return {
      artifact: stamped as NewsletterArtifact,
      repaired: govResult.repaired,
      repairAttempts: govResult.attempts,
      richnessScore,
      normalizedOutput,
      governanceResult: govResult,
      attemptHistory,
    }
  } catch (err) {
    if (isArtifactEngineRejection(err)) {
      throw new ArtifactPipelineRejection((err as any).reason, (err as any).repairAttempts, 'newsletter', requestId, (err as any).lastValidArtifact)
    }
    throw err
  }
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * executeArtifactPipeline — THE canonical governed pipeline for all artifact types.
 *
 * Routes call this after runControlPlane(). This function:
 *   1. Extracts the raw LLM string from the CP response (opaque to CPL).
 *   2. Delegates to the appropriate typed pipeline (carousel | deck | report | newsletter).
 *   3. Each typed pipeline hands the string to ArtifactEngine.compileAndGovern(),
 *      which internally calls OCL compile*Artifact() sub-steps + governance directly.
 *   4. Returns an immutable ArtifactPipelineResult.
 *
 * CPL INVARIANTS (enforced at this boundary):
 *   - The artifact returned by each pipeline is forwarded to persistence as-is.
 *   - CPL does NOT re-parse, reshape, or re-emit any structural field.
 *   - Governance repair runs inside ArtifactEngine — CPL has no visibility into it.
 *
 * Throws ArtifactPipelineRejection if governance ultimately fails.
 * Throws Error for unknown taskTypes.
 *
 * @param input — pipeline inputs including raw LLM output + CP response
 * @returns ArtifactPipelineResult with governed, compiled artifact (immutable)
 */
export async function executeArtifactPipeline(
  input: ArtifactPipelineInput
): Promise<ArtifactPipelineResult<ArtifactV2>> {
  const { taskType, requestId } = input

  console.info(
    `[ArtifactPipeline][${requestId.slice(0, 8)}] Starting pipeline — taskType=${taskType} ` +
    `mode=${input.runtimeMode}`
  )

  switch (taskType) {
    case 'carousel':
      return runCarouselPipeline(input)

    case 'deck':
      return runDeckPipeline(input)

    case 'report':
      return runReportPipeline(input)

    case 'newsletter':
      return runNewsletterPipeline(input)

    default:
      throw new Error(
        `[ArtifactPipeline][${requestId}] No pipeline registered for taskType="${taskType}". ` +
        `Register a compiler + governance adapter in artifact-engine-layer and add a case here.`
      )
  }
}
