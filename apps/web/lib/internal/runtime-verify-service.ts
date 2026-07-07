/**
 * apps/web/lib/internal/runtime-verify-service.ts
 *
 * All business logic for `/api/internal/runtime-verify/*` (Runtime
 * Verification V2). Route handlers delegate entirely here — no business
 * logic in the routes themselves.
 *
 * Pattern: Route → Service → runtime internals.
 * (Same pattern as apps/web/lib/runtime-diagnostics.ts for
 * /api/admin/runtime-debug — this file is the equivalent for the
 * secret-authenticated internal verification surface.)
 *
 * WHY THIS EXISTS (see scripts/platform-runtime-verify.ps1 header for the
 * full V1 → V2 rationale):
 *   V1 verified runtime behavior by impersonating a browser session against
 *   the *public* API (/api/carousel, /api/governance, /api/models) using a
 *   manually-extracted bearer token and workspace id. That doesn't match how
 *   BrandOS actually authenticates (Supabase SSR cookies, not bearer
 *   headers), so it produced false failures, and the manual-extraction
 *   workflow could not run in CI.
 *
 *   V2 drives the SAME underlying runtime primitives apps/web's real routes
 *   use (runControlPlane → executeArtifactPipeline → CPL brand-memory
 *   proxies), but does so directly from a secret-authenticated internal
 *   route, using a self-provisioning verification identity instead of a
 *   real user session. This verifies actual runtime behavior — the same
 *   code path /api/carousel runs — without needing a browser at all.
 *
 * Every exported check returns at least one `RuntimeTrace` (see
 * @brandos/contracts) so the PowerShell verifier (and any future client)
 * can assert pass/fail against one canonical shape instead of parsing
 * per-endpoint ad-hoc fields.
 */

import { v4 as uuidv4 } from 'uuid'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  runControlPlane,
  AdminSettingsService,
  executeArtifactPipeline,
  isArtifactPipelineRejection,
  resolveWorkspaceSettings,
  resolveBrandCognitionContext,
} from '@brandos/control-plane-layer'
import type { ControlPlaneResponse } from '@brandos/control-plane-layer'
import {
  createRuntimeTrace,
  validateRuntimeTrace,
  isCarouselArtifact,
} from '@brandos/contracts'
import type { RuntimeTrace, RuntimeMode, RuntimeTraceValidationResult, ArtifactV2 } from '@brandos/contracts'
import { RuntimeDiagnosticsService } from '@/lib/runtime-diagnostics'
import { resolveVerificationIdentity } from './runtime-verify-context'

/**
 * Repair-loop ceiling. Mirrors MAX_REPAIR_ATTEMPTS in
 * packages/artifact-engine-layer (see .context/runtime_trace.generated.md
 * §3 — "Raised from 2 → 3 to match raised governance thresholds"). Kept as
 * a local constant rather than imported because artifact-engine-layer does
 * not export it; if it changes again, update both places (and note the
 * drift in the next .context regeneration).
 */
export const EXPECTED_MAX_REPAIR_ATTEMPTS = 3

const DEFAULT_VERIFY_TOPIC = 'Announce our new product launch with confidence and clarity'
/** Degenerate prompt known to fail semantic governance in most configs (same fixture V1 used). */
const ADVERSARIAL_VERIFY_TOPIC = '.'

/**
 * resolveRuntimeVersion — identifies which build of BrandOS produced a
 * trace. Prefers an explicit deploy-time version string; falls back to
 * whatever npm/pnpm sets at install time; never fabricates a value.
 */
function resolveRuntimeVersion(): string {
  return process.env.BRANDOS_RUNTIME_VERSION || process.env.npm_package_version || 'unknown'
}

/**
 * resolveConfiguredProvider — "what the runtime was configured to use"
 * for this call, before any fallback: the explicit force/preferred
 * provider if the caller supplied one, else the top-priority enabled
 * provider per AdminSettingsService. Returns undefined (never a guess)
 * if AdminSettingsService can't answer.
 */
function resolveConfiguredProvider(forceProvider?: string): string | undefined {
  if (forceProvider) return forceProvider
  try {
    return AdminSettingsService.getEnabledProvidersInPriorityOrder()[0]
  } catch {
    return undefined
  }
}

export interface VerifyOptions {
  workspaceId?: string
  userId?: string
  forceProvider?: string
  runtimeMode?: RuntimeMode
}

// ─── Shared: drive one real generation through the canonical pipeline ─────────

interface GenerationRunResult {
  requestId: string
  durationMs: number
  cpResponse: ControlPlaneResponse
  pipelineResult: Awaited<ReturnType<typeof executeArtifactPipeline>> | null
  rejection: { reason: string; repairAttempts: number } | null
  workspaceId: string
  userId: string
  supabase: SupabaseClient
}

/**
 * runVerificationGeneration — the exact two-step canonical pipeline
 * (runControlPlane → executeArtifactPipeline) that /api/carousel runs,
 * driven by a verification identity instead of a logged-in user.
 *
 * Catches ArtifactPipelineRejection (governance 422 path) and returns it as
 * structured data instead of throwing, so callers can inspect both the
 * "accepted" and "rejected" outcome uniformly.
 */
async function runVerificationGeneration(opts: VerifyOptions & {
  topic: string
  applyBrandMemory?: boolean
  persona?: Record<string, unknown>
}): Promise<GenerationRunResult> {
  const requestId = uuidv4()
  const start = Date.now()

  const identity = await resolveVerificationIdentity({ workspaceId: opts.workspaceId, userId: opts.userId })
  const runtimeMode = opts.runtimeMode ?? AdminSettingsService.resolveRuntimeMode()
  const workspaceSettings = await resolveWorkspaceSettings(identity.workspaceId)

  const cpResponse = await runControlPlane(
    {
      request_id: requestId,
      user_id: identity.userId,
      workspace_id: identity.workspaceId,
      user_prompt: opts.topic,
      task_type: 'carousel',
      tone: 'executive',
      format: 'carousel',
      override_mode: 'standard',
      apply_brand_memory: opts.applyBrandMemory,
      preferred_provider: opts.forceProvider,
      persona: opts.persona,
    },
    runtimeMode,
    identity.supabase
  )

  let pipelineResult: Awaited<ReturnType<typeof executeArtifactPipeline>> | null = null
  let rejection: GenerationRunResult['rejection'] = null

  try {
    pipelineResult = await executeArtifactPipeline({
      topic: opts.topic,
      taskType: 'carousel',
      tone: 'executive',
      rawLLMOutput: (cpResponse as any).rawLLMOutput || (cpResponse as any).output || '',
      cpResponse: (cpResponse as any)._generationResult ?? (cpResponse as any),
      runtimeMode,
      userId: identity.userId,
      workspaceId: identity.workspaceId,
      requestId,
      supabase: identity.supabase,
      identity: (cpResponse as any).resolvedIdentity,
      applyBrandMemory: opts.applyBrandMemory,
      workspacePlan: workspaceSettings.plan,
    })
  } catch (err) {
    if (isArtifactPipelineRejection(err)) {
      rejection = { reason: err.reason, repairAttempts: err.repairAttempts }
    } else {
      throw err
    }
  }

  return {
    requestId,
    durationMs: Date.now() - start,
    cpResponse,
    pipelineResult,
    rejection,
    workspaceId: identity.workspaceId,
    userId: identity.userId,
    supabase: identity.supabase,
  }
}

function traceFromRun(
  run: GenerationRunResult,
  fields: Partial<Omit<RuntimeTrace, 'requestId' | 'checkedAt' | 'provider' | 'model'>> = {},
  opts: { forceProvider?: string } = {}
): RuntimeTrace {
  const resolvedProvider = run.cpResponse.resolvedProvider ?? ''
  const configuredProvider = resolveConfiguredProvider(opts.forceProvider)
  const fallbackUsed =
    configuredProvider && resolvedProvider ? configuredProvider !== resolvedProvider : undefined
  const persistenceStatus: RuntimeTrace['persistenceStatus'] =
    fields.persistenceStatus ?? (run.rejection ? 'not_persisted' : 'not_applicable')
  const schemaVersion = run.pipelineResult?.artifact ? (run.pipelineResult.artifact as ArtifactV2).$schema : undefined

  return createRuntimeTrace(run.requestId, {
    provider: resolvedProvider,
    model: run.cpResponse.resolvedModel ?? '',
    configuredProvider,
    configuredModel: undefined, // not resolvable per-run without a second config lookup; left honestly absent
    fallbackUsed,
    brandMemoryApplied: fields.brandMemoryApplied ?? true,
    governanceScore: run.cpResponse.quality?.score,
    repairAttempts: run.pipelineResult?.repairAttempts ?? run.rejection?.repairAttempts,
    persistenceStatus,
    schemaVersion,
    runtimeVersion: resolveRuntimeVersion(),
    durationMs: run.durationMs,
    ...fields,
  })
}

// ─── Provider Verification ──────────────────────────────────────────────────────
// GET /api/internal/runtime-verify/provider
// Verify: provider resolution, provider selection, provider propagation.

export interface ProviderVerifyResult {
  ok: boolean
  trace: RuntimeTrace
  activeProviders: Array<{ id: string; priority: number | null; configuredModel?: string | undefined }>
  disabledProviders: string[]
  mismatchedProviders: Array<{ id: string; enabled_in_db: boolean; enabled_in_runtime: boolean }>
  warnings: string[]
}

export async function verifyProvider(opts: VerifyOptions = {}): Promise<ProviderVerifyResult> {
  const requestId = uuidv4()
  const start = Date.now()

  const snapshot = await RuntimeDiagnosticsService.getSnapshot({
    runLiveTest: true,
    forceProvider: opts.forceProvider,
    requestId,
  })

  const resolvedProvider = snapshot.test_invoke?.provider ?? ''
  const configuredProvider = resolveConfiguredProvider(opts.forceProvider)

  const trace = createRuntimeTrace(requestId, {
    provider: resolvedProvider,
    model: snapshot.test_invoke?.model ?? '',
    configuredProvider,
    fallbackUsed: configuredProvider && resolvedProvider ? configuredProvider !== resolvedProvider : undefined,
    brandMemoryApplied: false,
    persistenceStatus: 'not_applicable',
    runtimeVersion: resolveRuntimeVersion(),
    durationMs: Date.now() - start,
  })

  return {
    ok: snapshot.test_invoke?.ok === true && snapshot.mismatched_providers.length === 0,
    trace,
    activeProviders: snapshot.resolved_config.active_providers,
    disabledProviders: snapshot.resolved_config.disabled_providers,
    mismatchedProviders: snapshot.mismatched_providers,
    warnings: snapshot.warnings,
  }
}

// ─── Model Verification ──────────────────────────────────────────────────────────
// GET /api/internal/runtime-verify/model
// Verify: configured model, selected model, runtime model propagation.

export interface ModelVerifyResult {
  ok: boolean
  trace: RuntimeTrace
  configuredModel: string | undefined
  resolvedModel: string | undefined
  propagationOk: boolean
}

export async function verifyModel(opts: VerifyOptions = {}): Promise<ModelVerifyResult> {
  const requestId = uuidv4()
  const start = Date.now()

  const snapshot = await RuntimeDiagnosticsService.getSnapshot({
    runLiveTest: true,
    forceProvider: opts.forceProvider,
    requestId,
  })

  const resolvedProvider = snapshot.test_invoke?.provider ?? ''
  const configuredProvider = resolveConfiguredProvider(opts.forceProvider)

  const trace = createRuntimeTrace(requestId, {
    provider: resolvedProvider,
    model: snapshot.test_invoke?.model ?? '',
    configuredProvider,
    configuredModel: snapshot.test_invoke?.configuredModel,
    fallbackUsed: configuredProvider && resolvedProvider ? configuredProvider !== resolvedProvider : undefined,
    brandMemoryApplied: false,
    persistenceStatus: 'not_applicable',
    runtimeVersion: resolveRuntimeVersion(),
    durationMs: Date.now() - start,
  })

  // Propagation is "ok" when the runtime actually resolved a model distinct
  // from an unset/blank value — i.e. configuredModel → resolvedModel made it
  // all the way through routing to the adapter that served the request.
  const propagationOk = !!snapshot.test_invoke?.ok && !!snapshot.test_invoke?.resolvedModel

  return {
    ok: propagationOk,
    trace,
    configuredModel: snapshot.test_invoke?.configuredModel,
    resolvedModel: snapshot.test_invoke?.resolvedModel,
    propagationOk,
  }
}

// ─── Brand Intelligence Verification ─────────────────────────────────────────────
// POST /api/internal/runtime-verify/brand-memory
// Verify: Brand Memory OFF path, Brand Memory ON path, identity contribution
// generation, style projection generation, semantic identity propagation.

export interface BrandMemoryPathResult {
  trace: RuntimeTrace
  accepted: boolean
  rejection: { reason: string; repairAttempts: number } | null
}

export interface BrandMemoryVerifyResult {
  ok: boolean
  onPath: BrandMemoryPathResult
  offPath: BrandMemoryPathResult
  identityContribution: {
    /** PLATFORM SPLIT: replaces hasSubstantialIdentity — identity !== null
     *  already reflects IntelligenceOS's own confidence gate. */
    hasIdentity: boolean
    /** PLATFORM SPLIT: coarse CognitionContext.confidence enum, not a number. */
    confidence: 'high' | 'medium' | 'low' | 'degraded'
    /** PLATFORM SPLIT: sourced from CognitionContext.contractVersion, not
     *  semanticIdentity.version (no longer exists). Field name kept for
     *  trace-schema stability. */
    identityVersion: string
    /** PLATFORM SPLIT: replaces styleProjectionPresent (no successor field —
     *  identity presence is the closest available signal). */
    identityPresent: boolean
  } | null
  cognitionError: string | null
}

export async function verifyBrandMemory(
  opts: VerifyOptions & { topic?: string } = {}
): Promise<BrandMemoryVerifyResult> {
  const topic = opts.topic ?? DEFAULT_VERIFY_TOPIC

  const [onRun, offRun] = await Promise.all([
    runVerificationGeneration({ ...opts, topic, applyBrandMemory: true }),
    runVerificationGeneration({ ...opts, topic, applyBrandMemory: false }),
  ])

  let identityContribution: BrandMemoryVerifyResult['identityContribution'] = null
  let cognitionError: string | null = null
  try {
    const identity = await resolveVerificationIdentity({ workspaceId: opts.workspaceId, userId: opts.userId })
    const cognition = await resolveBrandCognitionContext({
      workspaceId: identity.workspaceId,
      taskType: 'carousel',
    })
    identityContribution = {
      hasIdentity: cognition.identity !== null,
      confidence: cognition.confidence,
      identityVersion: cognition.contractVersion,
      identityPresent: cognition.identity !== null,
    }
  } catch (err) {
    cognitionError = (err as Error).message
  }

  const onPath: BrandMemoryPathResult = {
    trace: traceFromRun(onRun, {
      brandMemoryApplied: true,
      identityVersion: identityContribution?.identityVersion,
    }, { forceProvider: opts.forceProvider }),
    accepted: !onRun.rejection,
    rejection: onRun.rejection,
  }

  const offPath: BrandMemoryPathResult = {
    trace: traceFromRun(offRun, { brandMemoryApplied: false }, { forceProvider: opts.forceProvider }),
    accepted: !offRun.rejection,
    rejection: offRun.rejection,
  }

  return {
    ok: onPath.accepted && offPath.accepted,
    onPath,
    offPath,
    identityContribution,
    cognitionError,
  }
}

// ─── Governance Verification ─────────────────────────────────────────────────────
// POST /api/internal/runtime-verify/governance
// Verify: governance execution, repair execution, threshold evaluation.

export interface GovernanceCheckResult {
  trace: RuntimeTrace
  accepted: boolean
  repaired: boolean
  repairAttempts: number
  withinRepairCeiling: boolean
  scoreMeetsThreshold: boolean | null
  rejection: { reason: string; repairAttempts: number } | null
}

export interface GovernanceVerifyResult {
  ok: boolean
  maxRepairAttempts: number
  governanceScoreThreshold0to100: number
  clean: GovernanceCheckResult
  adversarial: GovernanceCheckResult
}

function summarizeGovernanceRun(
  run: GenerationRunResult,
  thresholdOn100Scale: number,
  forceProvider?: string
): GovernanceCheckResult {
  const repairAttempts = run.pipelineResult?.repairAttempts ?? run.rejection?.repairAttempts ?? 0
  const score = run.cpResponse.quality?.score
  return {
    trace: traceFromRun(run, { brandMemoryApplied: false }, { forceProvider }),
    accepted: !run.rejection,
    repaired: run.pipelineResult?.repaired ?? false,
    repairAttempts,
    withinRepairCeiling: repairAttempts <= EXPECTED_MAX_REPAIR_ATTEMPTS,
    scoreMeetsThreshold: typeof score === 'number' ? score >= thresholdOn100Scale : null,
    rejection: run.rejection,
  }
}

export async function verifyGovernance(
  opts: VerifyOptions & { topic?: string; adversarialTopic?: string } = {}
): Promise<GovernanceVerifyResult> {
  const identity = await resolveVerificationIdentity({ workspaceId: opts.workspaceId, userId: opts.userId })
  const workspaceSettings = await resolveWorkspaceSettings(identity.workspaceId)
  // governance_score_threshold is stored on a 0-1 scale (see
  // packages/control-plane-layer/src/workspace/settings-resolver.ts) while
  // cpResponse.quality.score is 0-100 — convert once, here, so every
  // downstream comparison uses the same scale.
  const thresholdOn100Scale = workspaceSettings.governance_score_threshold * 100

  const [cleanRun, adversarialRun] = await Promise.all([
    runVerificationGeneration({
      ...opts,
      topic: opts.topic ?? DEFAULT_VERIFY_TOPIC,
      applyBrandMemory: false,
    }),
    runVerificationGeneration({
      ...opts,
      topic: opts.adversarialTopic ?? ADVERSARIAL_VERIFY_TOPIC,
      applyBrandMemory: false,
    }),
  ])

  const clean = summarizeGovernanceRun(cleanRun, thresholdOn100Scale, opts.forceProvider)
  const adversarial = summarizeGovernanceRun(adversarialRun, thresholdOn100Scale, opts.forceProvider)

  return {
    ok: clean.withinRepairCeiling && adversarial.withinRepairCeiling,
    maxRepairAttempts: EXPECTED_MAX_REPAIR_ATTEMPTS,
    governanceScoreThreshold0to100: thresholdOn100Scale,
    clean,
    adversarial,
  }
}

// ─── Persistence Verification ────────────────────────────────────────────────────
// POST /api/internal/runtime-verify/persistence
// Verify: artifact persistence, metadata persistence (provider, model, governance).

export interface PersistenceVerifyResult {
  ok: boolean
  trace: RuntimeTrace
  persisted: boolean
  readBackOk: boolean
  providerMetadataOk: boolean
  modelMetadataOk: boolean
  governanceMetadataOk: boolean
  campaignId: string | null
  error: string | null
}

export async function verifyPersistence(
  opts: VerifyOptions & { topic?: string } = {}
): Promise<PersistenceVerifyResult> {
  const topic = opts.topic ?? DEFAULT_VERIFY_TOPIC
  const run = await runVerificationGeneration({ ...opts, topic, applyBrandMemory: false })

  if (run.rejection || !run.pipelineResult) {
    return {
      ok: false,
      trace: traceFromRun(
        run,
        { brandMemoryApplied: false, artifactPersisted: false, persistenceStatus: 'not_persisted' },
        { forceProvider: opts.forceProvider }
      ),
      persisted: false,
      readBackOk: false,
      providerMetadataOk: !!run.cpResponse.resolvedProvider,
      modelMetadataOk: !!run.cpResponse.resolvedModel,
      governanceMetadataOk: typeof run.cpResponse.quality?.score === 'number',
      campaignId: null,
      error: run.rejection?.reason ?? 'Pipeline produced no artifact to persist',
    }
  }

  const artifact = run.pipelineResult.artifact

  const { data: campaign, error: insertError } = await run.supabase
    .from('campaigns')
    .insert({
      user_id: run.userId,
      workspace_id: run.workspaceId,
      title: topic.slice(0, 80),
      topic,
      format: 'carousel',
      status: 'generated',
      content: artifact as any,
      qa_score_before: null,
      qa_score_after: run.cpResponse.quality?.score ?? null,
      persona_id: null,
      cp_request_id: run.requestId,
    })
    .select()
    .single()

  const persisted = !insertError && !!campaign
  let readBackOk = false

  if (persisted) {
    const { data: readBack } = await run.supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaign.id)
      .single()

    readBackOk =
      !!readBack &&
      readBack.qa_score_after === (run.cpResponse.quality?.score ?? null) &&
      readBack.workspace_id === run.workspaceId

    // Verification campaigns are synthetic — clean up so they don't
    // accumulate in the fixture workspace's campaign list. Cleanup failure
    // is logged but does not fail the check; persistence + read-back already
    // proved the behavior under test.
    try {
      await run.supabase.from('campaigns').delete().eq('id', campaign.id)
    } catch (cleanupErr) {
      console.warn('[runtime-verify] persistence check: cleanup of verification campaign failed', cleanupErr)
    }
  }

  return {
    ok: persisted && readBackOk,
    trace: traceFromRun(
      run,
      {
        brandMemoryApplied: false,
        artifactPersisted: persisted,
        persistenceStatus: persisted ? (readBackOk ? 'persisted' : 'failed') : 'failed',
      },
      { forceProvider: opts.forceProvider }
    ),
    persisted,
    readBackOk,
    providerMetadataOk: !!run.cpResponse.resolvedProvider,
    modelMetadataOk: !!run.cpResponse.resolvedModel,
    governanceMetadataOk: typeof run.cpResponse.quality?.score === 'number',
    campaignId: persisted ? campaign.id : null,
    error: insertError?.message ?? null,
  }
}

// ─── Diagnostics (combined snapshot) ─────────────────────────────────────────────
// GET /api/internal/runtime-verify/diagnostics
// Cheap, read-mostly combined snapshot — matches the example JSON shape from
// the Runtime Verification V2 spec.

export interface DiagnosticsVerifyResult {
  trace: RuntimeTrace
  healthy: boolean
  warnings: string[]
  traceValidation: RuntimeTraceValidationResult
}

export async function verifyDiagnostics(opts: VerifyOptions = {}): Promise<DiagnosticsVerifyResult> {
  const requestId = uuidv4()
  const start = Date.now()

  const snapshot = await RuntimeDiagnosticsService.getSnapshot({
    runLiveTest: true,
    forceProvider: opts.forceProvider,
    requestId,
  })

  let brandMemoryApplied = false
  let identityVersion: string | undefined
  try {
    const identity = await resolveVerificationIdentity({ workspaceId: opts.workspaceId, userId: opts.userId })
    const cognition = await resolveBrandCognitionContext({ workspaceId: identity.workspaceId, taskType: 'carousel' })
    brandMemoryApplied = cognition.identity !== null
    identityVersion = cognition.contractVersion
  } catch {
    // Diagnostics tolerates Brand Intelligence being unavailable — it's a
    // status snapshot, not a hard dependency check.
  }

  const resolvedProvider = snapshot.test_invoke?.provider ?? ''
  const configuredProvider = resolveConfiguredProvider(opts.forceProvider)

  const trace = createRuntimeTrace(requestId, {
    provider: resolvedProvider,
    model: snapshot.test_invoke?.model ?? '',
    configuredProvider,
    configuredModel: snapshot.test_invoke?.configuredModel,
    fallbackUsed: configuredProvider && resolvedProvider ? configuredProvider !== resolvedProvider : undefined,
    brandMemoryApplied,
    identityVersion,
    persistenceStatus: 'not_applicable',
    runtimeVersion: resolveRuntimeVersion(),
    durationMs: Date.now() - start,
  })

  return { trace, healthy: snapshot.healthy, warnings: snapshot.warnings, traceValidation: validateRuntimeTrace(trace) }
}

// ─── Semantic Verification (§7) ──────────────────────────────────────────────────
// POST /api/internal/runtime-verify/semantic
// Verifies that a generated artifact is semantically correct, not merely
// that execution succeeded — i.e. it inspects the actual artifact and
// runtime metadata, not just HTTP status codes.
//
// HONEST METHODOLOGY NOTE: some of the items requested for this stage
// (topic preservation, persona injection) describe genuinely subjective
// qualities of LLM output that cannot be checked with certainty without a
// second LLM acting as a judge — which would make the verifier's own
// correctness depend on a model call, undermining it as a deterministic
// gate. Instead, this stage uses a CANARY-INJECTION technique: it injects a
// unique, identifiable token (a UUID-tagged topic phrase, a UUID-tagged
// brand name) into the request, then deterministically checks for that
// token's presence in the actual generated artifact. This is the same
// black-box technique production smoke tests use to verify generative
// pipelines without an LLM judge. Where a check is genuinely deterministic
// (schema conformance, governance score recording, persistence metadata,
// trace completeness) it is checked with full rigor and can FAIL. Where a
// check is a canary/heuristic proxy for a subjective quality, a miss is
// reported as WARN, not FAIL, and the check's `detail` says so explicitly —
// this stage never overclaims certainty it doesn't have.

export interface SemanticCheckItem {
  name: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

export interface SemanticVerifyResult {
  /** true iff there are zero 'fail'-status checks. WARNs do not affect this. */
  ok: boolean
  trace: RuntimeTrace
  checks: SemanticCheckItem[]
  traceValidation: RuntimeTraceValidationResult
}

const SEMANTIC_STOPWORDS = new Set([
  'with', 'this', 'that', 'from', 'into', 'about', 'over', 'under', 'their',
  'them', 'will', 'have', 'your', 'our', 'and', 'the', 'for', 'are', 'was',
])

/** Lowercased, de-duplicated, stopword-filtered tokens of length > 3. */
function extractSignificantTokens(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 3 && !SEMANTIC_STOPWORDS.has(t))
    )
  )
}

/** Flattens an artifact (or anything) to lowercase searchable text via JSON.stringify. */
function searchableText(value: unknown): string {
  try {
    return JSON.stringify(value).toLowerCase()
  } catch {
    return ''
  }
}

/** Fraction of `topic`'s significant tokens that appear verbatim somewhere in `value`. */
function topicOverlap(topic: string, value: unknown): { ratio: number; matched: string[]; total: number } {
  const tokens = extractSignificantTokens(topic)
  if (tokens.length === 0) return { ratio: 1, matched: [], total: 0 }
  const haystack = searchableText(value)
  const matched = tokens.filter(t => haystack.includes(t))
  return { ratio: matched.length / tokens.length, matched, total: tokens.length }
}

const AUDIENCE_SOPHISTICATION_LEVELS = new Set(['beginner', 'intermediate', 'advanced', 'expert'])

export async function verifySemantic(
  opts: VerifyOptions & { topic?: string } = {}
): Promise<SemanticVerifyResult> {
  const checks: SemanticCheckItem[] = []
  const record = (name: string, status: SemanticCheckItem['status'], detail: string) =>
    checks.push({ name, status, detail })

  const canaryId = uuidv4().slice(0, 8)
  const canaryBrandName = `VerifyBrand${canaryId.toUpperCase()}`
  const baseTopic = opts.topic ?? DEFAULT_VERIFY_TOPIC
  // The canary token is appended, not prepended, so it never reads as the
  // actual subject — preservation of the BASE topic's tokens is what's
  // being measured; the canary just lets this run be told apart from others.
  const topic = `${baseTopic} [verify:${canaryId}]`

  // ON path carries the canary persona (for persona-injection + brand-memory
  // checks); OFF path is the differential baseline (for the "brand memory
  // doesn't replace the topic" + "applied correctly" checks).
  const [onRun, offRun] = await Promise.all([
    runVerificationGeneration({
      ...opts,
      topic,
      applyBrandMemory: true,
      persona: { brandVoice: { brandName: canaryBrandName, tone: 'authoritative' } },
    }),
    runVerificationGeneration({ ...opts, topic, applyBrandMemory: false }),
  ])

  const onArtifact = onRun.pipelineResult?.artifact
  const offArtifact = offRun.pipelineResult?.artifact

  // ── 1. User topic is preserved ──────────────────────────────────────────
  if (onArtifact) {
    const overlap = topicOverlap(baseTopic, onArtifact)
    if (overlap.total === 0) {
      record('User topic is preserved', 'warn', 'Topic had no significant tokens to check (too short).')
    } else if (overlap.ratio >= 0.5) {
      record(
        'User topic is preserved',
        'pass',
        `${overlap.matched.length}/${overlap.total} significant topic tokens found in the generated artifact.`
      )
    } else if (overlap.ratio > 0) {
      record(
        'User topic is preserved',
        'warn',
        `Only ${overlap.matched.length}/${overlap.total} significant topic tokens found — possible topic drift (heuristic check, not a content-quality judgment).`
      )
    } else {
      record('User topic is preserved', 'fail', 'None of the topic\'s significant tokens were found in the generated artifact.')
    }
  } else {
    record('User topic is preserved', 'fail', 'No artifact was generated to check (Brand Memory ON run produced no artifact).')
  }

  // ── 2 & 3. Brand Memory applied correctly + does not replace the topic ──
  let cognition: Awaited<ReturnType<typeof resolveBrandCognitionContext>> | null = null
  let cognitionError: string | null = null
  try {
    const identity = await resolveVerificationIdentity({ workspaceId: opts.workspaceId, userId: opts.userId })
    cognition = await resolveBrandCognitionContext({ workspaceId: identity.workspaceId, taskType: 'carousel' })
  } catch (err) {
    cognitionError = (err as Error).message
  }

  if (cognitionError) {
    record('Brand Memory was applied correctly', 'warn', `Brand cognition context unavailable: ${cognitionError}`)
  } else if (!cognition!.identity) {
    record(
      'Brand Memory was applied correctly',
      'warn',
      'Workspace has no substantial brand identity yet (expected for a fresh fixture/workspace) — nothing for Brand Memory to apply.'
    )
  } else if (onArtifact && offArtifact) {
    const onText = searchableText(onArtifact)
    const offText = searchableText(offArtifact)
    if (onText !== offText) {
      record(
        'Brand Memory was applied correctly',
        'pass',
        'Workspace has a substantial identity and the Brand-Memory-ON artifact differs from the OFF artifact.'
      )
    } else {
      record(
        'Brand Memory was applied correctly',
        'warn',
        'Workspace has a substantial identity but the ON and OFF artifacts were byte-identical — Brand Memory may not be influencing output (or both calls happened to produce identical text).'
      )
    }
  } else {
    record('Brand Memory was applied correctly', 'fail', 'ON or OFF run produced no artifact to compare.')
  }

  if (onArtifact) {
    const onOverlap = topicOverlap(baseTopic, onArtifact)
    if (onOverlap.total === 0 || onOverlap.ratio >= 0.5) {
      record(
        "Brand Memory does not replace the user's topic",
        'pass',
        `Topic tokens still present with Brand Memory ON (${onOverlap.matched.length}/${onOverlap.total}).`
      )
    } else {
      record(
        "Brand Memory does not replace the user's topic",
        'warn',
        `Topic overlap dropped to ${onOverlap.matched.length}/${onOverlap.total} with Brand Memory ON — possible sign brand voice is overriding the requested topic (heuristic check).`
      )
    }
  } else {
    record("Brand Memory does not replace the user's topic", 'fail', 'No ON-path artifact was generated to check.')
  }

  // ── 4. Persona injection is correct ─────────────────────────────────────
  if (onArtifact) {
    const hasCanaryBrand = searchableText(onArtifact).includes(canaryBrandName.toLowerCase())
    record(
      'Persona injection is correct',
      hasCanaryBrand ? 'pass' : 'warn',
      hasCanaryBrand
        ? `Injected persona brand name ('${canaryBrandName}') appears in the generated artifact.`
        : `Injected persona brand name ('${canaryBrandName}') was not found verbatim in the artifact — the LLM may have paraphrased it rather than dropping the persona (heuristic check, not proof of failure).`
    )
  } else {
    record('Persona injection is correct', 'fail', 'No ON-path artifact was generated to check.')
  }

  // ── 5. Audience resolution is correct ───────────────────────────────────
  const audience = onArtifact?.audience
  if (!audience) {
    record('Audience resolution is correct', 'fail', 'Generated artifact has no `audience` field.')
  } else if (typeof audience.sophistication !== 'string' || !AUDIENCE_SOPHISTICATION_LEVELS.has(audience.sophistication)) {
    record(
      'Audience resolution is correct',
      'fail',
      `audience.sophistication ('${audience.sophistication}') is not one of beginner/intermediate/advanced/expert.`
    )
  } else {
    record('Audience resolution is correct', 'pass', `audience.sophistication = '${audience.sophistication}'.`)
  }

  // ── 6. Identity contribution is correct ─────────────────────────────────
  if (cognitionError) {
    record('Identity contribution is correct', 'warn', `Brand cognition context unavailable: ${cognitionError}`)
  } else if (!cognition!.identity) {
    record('Identity contribution is correct', 'warn', 'No substantial identity to contribute (fresh fixture/workspace) — not a failure.')
  } else if (!cognition!.contractVersion) {
    record('Identity contribution is correct', 'fail', 'identity is present but contractVersion is missing from the CognitionContext.')
  } else {
    record(
      'Identity contribution is correct',
      'pass',
      `contract v${cognition!.contractVersion}, confidence=${cognition!.confidence}, identityPresent=${!!cognition!.identity}.`
    )
  }

  // ── 7. Artifact schema matches the requested artifact ───────────────────
  if (!onArtifact) {
    record('Artifact schema matches the requested artifact', 'fail', 'No artifact was generated.')
  } else if (isCarouselArtifact(onArtifact as ArtifactV2)) {
    record(
      'Artifact schema matches the requested artifact',
      'pass',
      `isCarouselArtifact(artifact) is true, $schema='${(onArtifact as ArtifactV2).$schema}'.`
    )
  } else {
    record(
      'Artifact schema matches the requested artifact',
      'fail',
      `Requested taskType 'carousel' but artifact_type was '${onArtifact?.artifact_type}'.`
    )
  }

  // ── 8 & 9. Governance score recorded + artifact passes governance ───────
  const governanceScore = onRun.cpResponse.quality?.score
  if (typeof governanceScore === 'number') {
    record('Governance score is recorded', 'pass', `governanceScore = ${governanceScore}.`)
  } else {
    record('Governance score is recorded', 'fail', 'cpResponse.quality.score is not a number.')
  }
  if (!onRun.rejection) {
    record('Artifact passes governance', 'pass', `Accepted after ${onRun.pipelineResult?.repairAttempts ?? 0} repair attempt(s).`)
  } else {
    record('Artifact passes governance', 'fail', `Rejected: ${onRun.rejection.reason}`)
  }

  // ── 10. Persistence metadata matches the generated artifact ─────────────
  if (onRun.rejection || !onArtifact) {
    record('Persistence metadata matches the generated artifact', 'warn', 'Artifact was rejected upstream — persistence intentionally not attempted.')
  } else {
    const { data: campaign, error: insertError } = await onRun.supabase
      .from('campaigns')
      .insert({
        user_id: onRun.userId,
        workspace_id: onRun.workspaceId,
        title: topic.slice(0, 80),
        topic,
        format: 'carousel',
        status: 'generated',
        content: onArtifact as any,
        qa_score_before: null,
        qa_score_after: governanceScore ?? null,
        persona_id: null,
        cp_request_id: onRun.requestId,
      })
      .select()
      .single()

    if (insertError || !campaign) {
      record('Persistence metadata matches the generated artifact', 'fail', `Insert failed: ${insertError?.message ?? 'unknown error'}`)
    } else {
      const persistedArtifact = campaign.content as ArtifactV2
      const idMatches = persistedArtifact?.id === (onArtifact as ArtifactV2).id
      const typeMatches = persistedArtifact?.artifact_type === (onArtifact as ArtifactV2).artifact_type
      const schemaMatches = persistedArtifact?.$schema === (onArtifact as ArtifactV2).$schema
      const scoreMatches = campaign.qa_score_after === (governanceScore ?? null)

      if (idMatches && typeMatches && schemaMatches && scoreMatches) {
        record('Persistence metadata matches the generated artifact', 'pass', 'id, artifact_type, $schema, and qa_score_after all match the live artifact.')
      } else {
        record(
          'Persistence metadata matches the generated artifact',
          'fail',
          `Mismatch — id:${idMatches} type:${typeMatches} schema:${schemaMatches} score:${scoreMatches}.`
        )
      }

      try {
        await onRun.supabase.from('campaigns').delete().eq('id', campaign.id)
      } catch (cleanupErr) {
        console.warn('[runtime-verify] semantic check: cleanup of verification campaign failed', cleanupErr)
      }
    }
  }

  // ── 11 & 12. Runtime trace is complete + provider/model info is correct ─
  const configuredProvider = resolveConfiguredProvider(opts.forceProvider)
  const resolvedProvider = onRun.cpResponse.resolvedProvider ?? ''
  const trace = traceFromRun(
    onRun,
    {
      brandMemoryApplied: true,
      identityVersion: cognition?.identity ? cognition.contractVersion : undefined,
    },
    { forceProvider: opts.forceProvider }
  )

  const traceValidation = validateRuntimeTrace(trace, { maxRepairAttempts: EXPECTED_MAX_REPAIR_ATTEMPTS })
  const traceFails = traceValidation.issues.filter(i => i.severity === 'fail')
  if (traceFails.length === 0 && traceValidation.issues.length === 0) {
    record('Runtime trace is complete', 'pass', `All ${traceValidation.checkedFields.length} expected fields populated and consistent.`)
  } else if (traceFails.length === 0) {
    record(
      'Runtime trace is complete',
      'warn',
      `${traceValidation.issues.length} field(s) missing: ${traceValidation.issues.map(i => i.field).join(', ')}.`
    )
  } else {
    record(
      'Runtime trace is complete',
      'fail',
      `${traceFails.length} inconsistenc(y/ies): ${traceFails.map(i => i.message).join(' ')}`
    )
  }

  if (resolvedProvider && trace.model) {
    record('Provider/model information is correct', 'pass', `provider='${resolvedProvider}', model='${trace.model}'.`)
  } else {
    record(
      'Provider/model information is correct',
      'fail',
      `provider='${resolvedProvider || '(empty)'}', model='${trace.model || '(empty)'}'.`
    )
  }

  const ok = checks.every(c => c.status !== 'fail')
  return { ok, trace, checks, traceValidation }
}

// ─── Verifier Self-Test (§0 Health Check) ────────────────────────────────────────
// GET /api/internal/runtime-verify/ping
// Cheap, no-generation reachability + config check. Used by the PowerShell
// verifier's §0 health check before it runs anything that costs tokens.

export const RUNTIME_VERIFY_ENDPOINTS = [
  '/api/internal/runtime-verify/ping',
  '/api/internal/runtime-verify/provider',
  '/api/internal/runtime-verify/model',
  '/api/internal/runtime-verify/brand-memory',
  '/api/internal/runtime-verify/governance',
  '/api/internal/runtime-verify/persistence',
  '/api/internal/runtime-verify/diagnostics',
  '/api/internal/runtime-verify/semantic',
] as const

export interface PingResult {
  ok: true
  service: 'brandos-runtime-verify'
  endpoints: typeof RUNTIME_VERIFY_ENDPOINTS
  checkedAt: string
}

export function pingRuntimeVerify(): PingResult {
  return {
    ok: true,
    service: 'brandos-runtime-verify',
    endpoints: RUNTIME_VERIFY_ENDPOINTS,
    checkedAt: new Date().toISOString(),
  }
}
