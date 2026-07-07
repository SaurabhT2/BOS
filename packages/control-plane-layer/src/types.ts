/**
 * @brandos/control-plane-layer — src/types.ts
 *
 * REFACTORED: BrandOS L5 Agentic Upgrade — 2026-05-27
 * UPDATED: Platform split — BrandOS becomes the Execution Platform
 *
 * WHAT CHANGED (L5, 2026-05-27):
 *   - GenerationRequest no longer carries brand-merge inputs as raw fields.
 *     Brand cognition inputs are namespaced under `brandContext` and `persona`.
 *   - GenerationResult now carries IBrandCognitionContext (readonly snapshot).
 *   - Removed: BrandContextPayload (inline brand assembly — now BI's job).
 *   - Added: preResolvedIdentity, preResolvedVisualIdentity (skip-DB optimization).
 *   - OrchestrationContext now contains cognitionContext (resolved by BI).
 *
 * WHAT CHANGED (platform split):
 *   - GenerationResult.cognitionContext and OrchestrationContext.cognitionContext
 *     are now CognitionContext (@platform/cognition-contract), not
 *     IBrandCognitionContext (@brandos/contracts — deleted).
 *   - GenerationRequest.persona / .brandContext / .preResolvedIdentity /
 *     .preResolvedVisualIdentity are DEPRECATED and no longer read by
 *     the orchestrator (CognitionRequest accepts only
 *     { workspaceId, taskType }). Kept on the type, and left as no-ops if
 *     set, rather than removed — a breaking type change was judged worse
 *     than an unused field, per "keep public BrandOS APIs stable wherever
 *     possible." See packages/cognition-contract/README.md, "Known
 *     contract gaps", item 2, for the open question this leaves.
 *
 * BACKWARD COMPAT:
 *   Fields present in the previous GenerationRequest are preserved.
 *   Callers do not need changes.
 */

import type {
  TaskType,
  PromptPersonalizationContext,
  VisualPersonalizationContext,
  ArtifactVisualMetadata,
} from '@brandos/contracts'
import type { CognitionContext } from '@platform/cognition-contract'

// ─── Generation Request ───────────────────────────────────────────────────────

export interface GenerationRequest {
  /** Unique request ID — used for signal correlation */
  readonly requestId: string

  /**
   * FK → workspaces.id. The workspace this generation is scoped to —
   * brand cognition (BI), brand-memory observation, and persona/identity
   * resolution are all keyed on this value.
   *
   * P0 — Implementation Wave 1A: prior to P0, callers passed `user_id` here
   * (workspaceId and the requesting user's id were the same string by
   * construction). They are now distinct — see `userId` below for the
   * requesting user's id. Do NOT pass a user id here.
   */
  readonly workspaceId: string

  /**
   * The id of the user making this request (auth.users.id / public.users.id).
   *
   * P0 — Implementation Wave 1A: NEW field. Used for:
   *   - ContributorContext.userId (ContractAssembler / contributors —
   *     "the user making the request")
   *   - callWithMode()'s `userId` option (ai-runtime-layer → provider
   *     `user_id` field, for per-end-user telemetry/abuse attribution —
   *     this is intentionally per-USER, not per-workspace)
   *
   * Distinct from workspaceId. In P0 (single-owner workspaces), userId is
   * always the workspace owner, but contributors and the AI runtime should
   * reference userId for user-level concerns and workspaceId for
   * workspace-level (brand cognition / memory) concerns — do not conflate
   * them even though they currently co-vary.
   *
   * Optional for backward compatibility with any caller that does not yet
   * have a user id available (e.g. background/system-initiated generation).
   * When absent, ContractAssembler.assemble() and callWithMode() receive
   * `undefined` for the corresponding fields rather than falling back to
   * workspaceId — see orchestrator.ts buildOrchestrationContext().
   */
  readonly userId?: string

  readonly personaId?: string
  readonly taskType?: TaskType
  readonly userPrompt: string

  /**
   * Runtime mode — propagated from the API route through CPL to the LLM router.
   * Defaults to 'cloud' when absent (backward compat).
   * Set by the route from AdminSettingsService.resolveRuntimeMode(rawMode).
   */
  readonly runtimeMode?: import('@brandos/contracts').RuntimeMode

  /**
   * @deprecated PLATFORM SPLIT: no longer read. CognitionRequest accepts
   * only { workspaceId, taskType } — see
   * packages/cognition-contract/README.md, "Known contract gaps", item 2.
   * Kept on the type for backward compatibility; the orchestrator ignores it.
   */
  readonly persona?: Readonly<Record<string, unknown>>

  /**
   * @deprecated PLATFORM SPLIT: no longer read — see `persona` above.
   */
  readonly brandContext?: Readonly<Record<string, unknown>>

  /**
   * @deprecated PLATFORM SPLIT: no longer read. Identity resolution is
   * entirely IntelligenceOS's responsibility now; there is no BrandOS-side
   * repository call left to skip.
   */
  readonly preResolvedIdentity?: unknown

  /**
   * @deprecated PLATFORM SPLIT: no longer read — see `preResolvedIdentity` above.
   */
  readonly preResolvedVisualIdentity?: unknown

  /**
   * Pre-built prompt context — when OCL has already built the personalization context.
   * Optional optimization — avoids duplicate build in orchestrator.
   */
  readonly preBuiltPromptContext?: PromptPersonalizationContext

  /**
   * Pre-built visual context — when OCL has already built the visual personalization context.
   */
  readonly preBuiltVisualContext?: VisualPersonalizationContext

  /**
   * Accumulated attempt history from prior governance evaluations for this request.
   * Undefined on the first attempt (no history yet).
   * Passed by the repair LLM callback in ArtifactPipeline so each repair call
   * can carry prior failure information into the Prompt Compiler.
   * The Prompt Compiler uses this to produce progressively stronger prompts.
   */
  readonly attemptHistory?: import('@brandos/contracts').IAttemptHistory

  /**
   * TOPIC-DRIFT-FIX-004: Governance repair context.
   * Populated only during repair calls — contains the governance failure description
   * that the repair LLM should address (e.g. "hook must be at least 5 chars").
   *
   * This field is explicitly separate from userPrompt so that repair calls can
   * forward governance feedback into the system context without replacing the
   * user's original topic in userPrompt. The Prompt Compiler reads userPrompt
   * as the LLM user message (the actual topic) and appends repairContext into
   * the governance feedback section of the system prompt.
   *
   * Undefined on first-attempt (non-repair) calls.
   */
  readonly repairContext?: string

  /**
   * Whether Brand Memory should influence generation.
   *
   * When false: audience, tone, industry, positioning, keywords, and brand
   * profile are NOT injected. PersonaContributor and IdentityContributor both
   * return null. The prompt compiler emits persona:NO identity:NO.
   *
   * Defaults to true when undefined (backward-compatible for existing users).
   * New users receive false as the default per product spec.
   * Persisted as a per-user preference and passed in from the API route.
   */
  readonly applyBrandMemory?: boolean

  /**
   * P3 — BYOK: per-provider API key overrides resolved from workspace_api_keys.
   *
   * Populated by run-control-plane.ts (W4) after getProviderKeyMap() resolves
   * active BYOK rows for this workspace. Empty object (or absent) means no
   * workspace BYOK keys configured — runtime falls through to platform env keys.
   *
   * SECURITY: never log this object. It contains plaintext API keys.
   */
  readonly apiKeyOverrides?: Record<string, string>

  /**
   * P3 — W9: preferred provider from workspace_settings.preferred_provider.
   *
   * Threaded from run-control-plane.ts → orchestrate() → buildOrchestrationContext()
   * → OrchestrationContext.preferredProvider → callWithMode() routingHint.
   * null/undefined = no workspace override, use platform default routing.
   */
  readonly preferredProvider?: string | null

  /**
   * Phase 4 — Runtime Consolidation: optional per-request model override.
   *
   * Sourced from the generate API route body (`model` field), forwarded through
   * run-control-plane → orchestrate() → callWithMode() → routingHint.preferred_model
   * → InvocationRequest.preferred_model → ExecutionEngine dispatch.
   *
   * Soft hint — honored when present, ignored when absent (adapter default applies).
   * null/undefined = no model override, adapter uses its admin-configured default.
   */
  readonly preferredModel?: string | null
}

// ─── Generation Result ────────────────────────────────────────────────────────

export interface GenerationResult {
  readonly requestId: string
  readonly artifact: GeneratedArtifact
  readonly score: number
  readonly wasRepaired: boolean
  /**
   * The cognition context that was used for generation.
   * Provided by @brandos/cognition-client — CPL passes it through unchanged.
   * Can be stored for audit, replay, or debugging.
   */
  readonly cognitionContext: CognitionContext
  readonly durationMs: number
  /**
   * Phase 5 — Runtime Consolidation: the provider that actually executed this request.
   * Populated from LLMResponse.provider returned by callWithMode().
   * Used by run-control-plane to populate ControlPlaneResponse.resolvedProvider
   * without relying on unsafe `as any` casts.
   */
  readonly resolvedProvider?: string | undefined
  /**
   * Phase 5 — Runtime Consolidation: the model that actually ran for this request.
   * Populated from LLMResponse.resolvedModel returned by callWithMode().
   * Used by run-control-plane to populate ControlPlaneResponse.resolvedModel.
   */
  readonly resolvedModel?: string | undefined
}

export interface GeneratedArtifact {
  readonly content: string
  readonly artifactType: string
  readonly visualMetadata?: ArtifactVisualMetadata
}

// ─── Orchestration Context ────────────────────────────────────────────────────

/**
 * OrchestrationContext — internal to CPL orchestrator.
 * Not exported from package barrel.
 *
 * This context is constructed by the orchestrator after cognition resolution
 * and passed through the generation pipeline.
 *
 * RULE: cognitionContext is always present after Step 1 of orchestration.
 *       Downstream pipeline steps must not re-resolve it.
 */
export interface OrchestrationContext {
  readonly requestId: string
  readonly workspaceId: string
  /**
   * The id of the user making this request. See
   * GenerationRequest.userId for the workspaceId/userId distinction.
   * Forwarded into ContributorContext.userId and callWithMode()'s userId
   * option — both of which are user-level, not workspace-level, concerns.
   */
  readonly userId?: string
  readonly personaId?: string
  readonly taskType?: TaskType
  readonly userPrompt: string

  /**
   * Runtime mode — carried from GenerationRequest through the orchestration context
   * so runStructuredPipeline / runTextPipeline can pass it to callWithMode().
   * Defaults to 'cloud' when absent.
   */
  readonly runtimeMode: import('@brandos/contracts').RuntimeMode

  /**
   * Resolved cognition context — provided by @brandos/cognition-client.
   * Readonly snapshot. Immutable after construction.
   */
  readonly cognitionContext: CognitionContext

  /** Prompt personalization context — may be null for low-confidence workspaces */
  readonly promptContext: PromptPersonalizationContext | null

  /** Visual personalization context — may be null if no visual identity */
  readonly visualContext: VisualPersonalizationContext | null

  /**
   * Current attempt number (1-based). Populated from attemptHistory.records.length + 1
   * when attemptHistory is present. Defaults to 1 for first attempts.
   */
  readonly attemptNumber: number

  /**
   * Attempt history from prior governance evaluations — carried from GenerationRequest
   * into the orchestration context so runStructuredPipeline() can forward it into
   * ContractAssembler.assemble(), which passes it through to the Prompt Compiler.
   */
  readonly attemptHistory?: import('@brandos/contracts').IAttemptHistory

  /**
   * TOPIC-DRIFT-FIX-004: Repair context forwarded from GenerationRequest.
   * Present only on repair calls. Forwarded to ContractAssembler.assemble() so the
   * Prompt Compiler can append it to the governance feedback section while keeping
   * userPrompt (intent.userPrompt) as the original user topic.
   */
  readonly repairContext?: string

  /**
   * Whether Brand Memory should influence generation.
   * Carried from GenerationRequest into both structured and text pipelines,
   * then forwarded into ContractAssembler.assemble() as applyBrandMemory.
   * Defaults to true when undefined (backward-compatible for existing users).
   */
  readonly applyBrandMemory?: boolean

  /**
   * P3 — BYOK: per-provider API key overrides resolved from workspace_api_keys.
   *
   * Map of provider → plaintext API key. Populated by run-control-plane.ts
   * (W4) after getProviderKeyMap() resolves active BYOK rows for this workspace.
   * Empty object (or absent) means no workspace BYOK keys — the runtime falls
   * through to platform environment keys for all providers.
   *
   * SECURITY: never log this object. It contains plaintext API keys.
   * Passed through to callWithMode() as CallOptions.apiKeyOverrides.
   */
  readonly apiKeyOverrides?: Record<string, string>

  /**
   * P3 — W9: preferred provider from workspace settings.
   *
   * Resolved from workspace_settings.preferred_provider by run-control-plane.ts.
   * Forwarded to callWithMode() as routingHint.preferred_tiers so the runtime
   * router prefers this provider when building the execution plan.
   *
   * null/undefined = no workspace override, use platform default routing.
   */
  readonly preferredProvider?: string | null

  /**
   * Phase 4 — Runtime Consolidation: per-request model override.
   *
   * Forwarded from GenerationRequest.preferredModel → callWithMode() routingHint.
   * null/undefined = no override; adapter uses its admin-configured default.
   */
  readonly preferredModel?: string | null
}

// PHASE 3 CLEANUP (3.3): Deprecated type aliases removed.
//   BrandContext     → Use CognitionContext from @platform/cognition-contract
//   BrandMemoryEntry → No successor. Raw memory signals never cross the
//                      BrandOS boundary — see
//                      packages/cognition-contract/README.md, "Known
//                      contract gaps", item 1.
//
// These aliases were scheduled for removal in CPL v3.0.0 per the L5 refactor
// (2026-05-27). Removed 2026-06-08 — ownership audit Phase 3.
// Update all import sites to @brandos/contracts / @platform/cognition-contract directly.
