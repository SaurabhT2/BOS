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
 * Enforces the apps/web → CPL → cognition-client routing rule:
 *   apps/web must NOT import @brandos/cognition-client directly.
 *   All cognition access routes through CPL, which is the correct
 *   integration seam.
 *
 * Exported from @brandos/control-plane-layer/src/index.ts:
 *   getBrandMemory
 *   recordBrandMemoryObservation
 *   reviewBrandMemorySignal
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
 * getBrandMemory — NOT SUPPORTED under the new CognitionProvider contract.
 *
 * PLATFORM SPLIT / KNOWN GAP: CognitionProvider has no operation that
 * returns a list of raw or reviewable memory signals — by design, per
 * COGNITION_CONTRACT_SPEC.md §4's exclusion of raw/unconsolidated signals
 * from anything BrandOS can see. This function's caller
 * (apps/web's brand-memory route, feeding the /workspace/brand review UI)
 * has no working replacement yet.
 *
 * Throws rather than silently returning an empty list, so the gap is
 * visible at the API boundary instead of presenting as "you have no brand
 * memory yet." See packages/cognition-contract/README.md, "Known contract
 * gaps", item 1, for the decision this is waiting on.
 */
export async function getBrandMemory(
  _workspaceId: string,
  _classification?: 'A' | 'B' | 'C',
): Promise<never> {
  throw new Error(
    '[control-plane-layer] getBrandMemory() has no equivalent in CognitionProvider. ' +
    'See packages/cognition-contract/README.md, "Known contract gaps", item 1.'
  )
}

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
 * reviewBrandMemorySignal — pass through a human review decision.
 * Proxy for: CognitionProvider.review()
 */
export async function reviewBrandMemorySignal(
  workspaceId: string,
  entryId: string,
  approved: boolean,
  reviewedBy: string,
): Promise<void> {
  const client = getGlobalCognitionClient()
  return client.review({ workspaceId, entryId, approved, reviewedBy })
}

/**
 * resolveBrandCognitionContext — resolve the CognitionContext for generation.
 * Proxy for: CognitionProvider.resolveCognitionContext()
 *
 * PLATFORM SPLIT / KNOWN GAP: the request shape is now `{ workspaceId,
 * taskType? }` only — no `persona`/`brandContext` payload is forwarded.
 * See packages/cognition-contract/README.md, "Known contract gaps", item 2.
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

function normalizeObservationInput(
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
  }
}
