/**
 * @brandos/control-plane-layer — brand-memory/service.ts
 *
 * CPL proxy for cognition operations.
 *
 * PLATFORM SPLIT: this file previously proxied to
 * getGlobalBrandIntelligenceRuntime() (@brandos/brand-intelligence). It now
 * proxies to getGlobalCognitionClient() (@brandos/cognition-client), the
 * only BrandOS package permitted to hold a CognitionProvider. Function
 * names are kept stable where a direct equivalent exists, so
 * apps/web routes did not need to change their imports.
 *
 * Option B (cognition-consumer split): BrandOS no longer owns raw-memory
 * reading or raw-signal review — both belong to IntelligenceOS. This file
 * previously also exported getBrandMemory() (no CognitionProvider
 * equivalent; always threw) and reviewBrandMemorySignal() (a passthrough
 * for CognitionProvider.review()). Both are removed along with review()
 * itself from the BrandOS-local CognitionProvider contract — see
 * @platform/cognition-contract's CognitionProvider.ts.
 *
 * Enforces the apps/web → CPL → cognition-client routing rule:
 *   apps/web must NOT import @brandos/cognition-client directly.
 *   All cognition access routes through CPL, which is the correct
 *   integration seam.
 *
 * Exported from @brandos/control-plane-layer/src/index.ts:
 *   recordBrandMemoryObservation
 *   resolveBrandCognitionContext
 *   getBrandSummary
 *
 * Engineering Workflow Audit fix: this file's exported functions previously
 * typed their input as `IArtifactObservationRequest | IObservationEvent`.
 * `IArtifactObservationRequest` lived in brand-cognition-contracts.ts,
 * already marked "deprecated — kept for V1 compat only, remove when all
 * callers use IObservationEvent" before the platform split, and was
 * removed from @brandos/contracts' exports when that file was cleaned up
 * during the split — breaking this file's build (a real, previously
 * undiscovered compile error, since `pnpm build` had never been run
 * against a repo with a real pnpm-workspace.yaml — see that file's own
 * comment). All 4 real call sites already pass a value satisfying
 * `IObservationEvent` exactly, so the union was narrowed to just that,
 * per the removal guidance that was already written down.
 */

import { getGlobalCognitionClient } from '@brandos/cognition-client'
import type { IObservationEvent } from '@brandos/contracts'

/**
 * recordBrandMemoryObservation — report a scored generation outcome.
 * Proxy for: CognitionProvider.observe()
 */
export async function recordBrandMemoryObservation(
  input: IObservationEvent,
): Promise<void> {
  const client = getGlobalCognitionClient()
  const normalized = normalizeObservationInput(input)
  return client.observe(normalized)
}

/**
 * resolveBrandCognitionContext — resolve the CognitionContext for generation.
 * Proxy for: CognitionProvider.resolveCognitionContext()
 *
 * PLATFORM SPLIT: the request shape is `{ workspaceId, taskType? }` only —
 * no `persona`/`brandContext` payload is forwarded here, and that is by
 * design, not a gap: explicit workspace configuration now reaches
 * IntelligenceOS through a separate ingestion call
 * (`syncWorkspaceConfiguration`, `./workspace-configuration/service.ts`,
 * EM-1.2 of the Cognitive Platform Evolution Program) rather than being
 * piggybacked onto every resolve() request. See
 * packages/cognition-contract/README.md — the item this used to reference
 * as an open gap is now resolved there.
 */
export async function resolveBrandCognitionContext(request: {
  workspaceId: string
  taskType?: string
}) {
  const client = getGlobalCognitionClient()
  return client.resolveCognitionContext({
    workspaceId: request.workspaceId,
    taskType: request.taskType,
  })
}

/**
 * getBrandSummary — get a display-ready cognition summary for profile UI.
 * Proxy for: CognitionProvider.summarizeCognition()
 *
 * PLATFORM SPLIT: `personaId` is accepted but ignored — summarizeCognition()
 * is workspace-scoped only under CognitionProvider; there is no per-persona
 * summary concept in the new contract. Kept on the parameter type so
 * existing callers (e.g. apps/web/app/api/memory/route.ts) don't fail
 * TypeScript's excess-property check on their existing object literal.
 */
export async function getBrandSummary(params: {
  workspaceId: string
  personaId?: string
}) {
  const client = getGlobalCognitionClient()
  return client.summarizeCognition(params.workspaceId)
}

// ─── Internal mapping ──────────────────────────────────────────────────────

/**
 * Bug found via a live end-to-end run's server logs (Cognitive Platform
 * Evolution Program follow-up): this function silently dropped
 * providerId/modelId/routingHint/tokenUsage/outcome/failureReason even
 * after IObservationEvent gained them, because it builds its return value
 * as an explicit field-by-field allowlist rather than a spread — exactly
 * the kind of narrowing that made the original EM-3.4 enrichment
 * (applied to `orchestrator.ts`'s direct `observe()` call) invisible on
 * the observation that actually matters, the one
 * `recordBrandMemoryAfterPipeline()` sends through this function with the
 * real, post-repair governance score. Now passes them through.
 */
/**
 * Exported for direct unit testing only (same "internal, testing-only"
 * convention as this codebase's `_resetGlobalXForTests` helpers) — not
 * part of this module's intended public surface. See
 * `__tests__/unit/normalizeObservationInput.test.ts`, which locks in the
 * exact bug a live end-to-end run found: this function used to silently
 * drop providerId/modelId/routingHint/tokenUsage/outcome/failureReason
 * even after `IObservationEvent` gained them.
 */
export function normalizeObservationInput(
  input: IObservationEvent
): {
  workspaceId: string
  requestId: string
  outputText: string
  score: number
  topic?: string
  artifactType?: string
  wasRepaired?: boolean
  observedAt?: string
  providerId?: string
  modelId?: string
  routingHint?: string
  tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  outcome?: 'success' | 'failure'
  failureReason?: string
} {
  const raw = input as unknown as Record<string, unknown>
  return {
    workspaceId: raw.workspaceId as string,
    requestId: raw.requestId as string,
    outputText: (raw.artifactText ?? raw.outputText ?? '') as string,
    score: (raw.artifactScore ?? raw.score ?? 0) as number,
    topic: raw.topic as string | undefined,
    artifactType: raw.artifactType as string | undefined,
    wasRepaired: raw.wasRepaired as boolean | undefined,
    observedAt: raw.observedAt as string | undefined,
    providerId: raw.providerId as string | undefined,
    modelId: raw.modelId as string | undefined,
    routingHint: raw.routingHint as string | undefined,
    tokenUsage: raw.tokenUsage as
      | { promptTokens?: number; completionTokens?: number; totalTokens?: number }
      | undefined,
    outcome: raw.outcome as 'success' | 'failure' | undefined,
    failureReason: raw.failureReason as string | undefined,
  }
}
