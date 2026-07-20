/**
 * @brandos/cognition-client — src/KnowledgeIngestClient.ts
 *
 * Milestone 3, Phase 1 (Knowledge API).
 *
 * A thin HTTP adapter for IntelligenceOS's `POST /v1/knowledge/ingest`
 * route — the same role `HttpCognitionProvider` plays for the cognition
 * read/observe contract, but deliberately kept separate from it.
 *
 * Why a separate client instead of adding a method to HttpCognitionProvider
 * / CognitionProvider: `CognitionProvider` (`@platform/cognition-contract`)
 * is documented as "the entire cognitive vocabulary BrandOS is permitted to
 * have" — it exists to keep BrandOS from depending on anything about *how*
 * IntelligenceOS reasons, only on what it concludes. Knowledge ingestion is
 * not a cognition read — it is a plain write endpoint (hand off an
 * uploaded asset, get back an id) with no bearing on that contract's
 * scope. Giving it its own tiny client keeps that boundary intact instead
 * of quietly growing CognitionProvider to cover an unrelated concern.
 *
 * Still lives in this package (not apps/web) because the
 * apps/web → CPL → cognition-client routing rule applies here too — see
 * `packages/control-plane-layer/src/brand-memory/service.ts`'s header.
 * apps/web must not talk to IntelligenceOS directly.
 */

import { withRetry } from '@brandos/shared-utils'
import { KNOWLEDGE_INGEST_RETRY_OPTIONS } from './retryPolicy'

/**
 * Found via a live end-to-end run's server logs (Cognitive Platform
 * Evolution Program follow-up): `[analyze] knowledge ingestion failed
 * (non-fatal): This operation was aborted` on the first several documents
 * of a session, before settling down. Root cause: IntelligenceOS's
 * `ingestKnowledgeAsset()` runs its full extraction pipeline
 * (Vocabulary/Framework/Pattern/VisualFeature extractors + validation)
 * SYNCHRONOUSLY, inside the HTTP request — documented on that method as
 * temporary ("Sprint 4 will move this behind the event bus"), not a bug
 * on the IntelligenceOS side. 5 seconds is a reasonable timeout for a
 * typical write endpoint; it is not reasonable for a call whose
 * documented server-side behavior is "run a multi-stage extraction
 * pipeline before responding." 30s gives real headroom for that
 * documented behavior without hanging indefinitely on a genuinely dead
 * connection. Revisit downward once IntelligenceOS's Sprint 4 async-queue
 * work lands and this call goes back to being a fast, thin write.
 */
const DEFAULT_TIMEOUT_MS = 30000
export interface KnowledgeIngestClientConfig {
  /** Base URL of the IntelligenceOS API — same value used for cognition. */
  readonly baseUrl: string
  /** Same shared-secret used for the cognition routes. */
  readonly apiKey: string
  readonly timeoutMs?: number
}

/**
 * Mirrors `KnowledgeAssetInput` (`intelligence-os/src/types/domains.ts`)
 * exactly. Duplicated here rather than imported — BrandOS does not (and
 * per the platform split, must not) depend on IntelligenceOS's internal
 * package; this is the wire shape both sides have agreed to, the same way
 * `CognitionContext` is a separately-owned contract type, not a shared
 * import.
 */
export interface KnowledgeAssetIngestInput {
  readonly ownerType: 'user' | 'project' | 'workspace'
  readonly userId?: string | null
  readonly projectId?: string | null
  readonly workspaceId?: string | null
  readonly assetType: 'playbook' | 'framework' | 'methodology' | 'template' | 'reference' | 'visual_asset'
  readonly title: string
  readonly sourceFileRef?: string | null
}

export class KnowledgeIngestClient {
  constructor(private readonly config: KnowledgeIngestClientConfig) {}

  /**
   * Fire-and-forget from the caller's point of view — a failure here must
   * never fail the asset upload it followed. Callers should `.catch()` and
   * log, not `await` inline in the request path if upload latency matters
   * (see apps/web/app/api/assets/route.ts for the intended calling
   * convention: called after the upload response's DB write has already
   * succeeded, not blocking it).
   *
   * @param existingAssetId  Cognitive Platform Evolution Program, EM-2.2/
   *   EM-2.6. When supplied, updates that IntelligenceOS knowledge asset in
   *   place (upsert by id) instead of creating a new one on every call —
   *   see IntelligenceOS's `ingestKnowledgeAsset()` docblock for why this
   *   was previously impossible even though the underlying persistence
   *   already upserted by id. BrandOS should pass the `assetId` returned
   *   from a prior successful call for the same `brand_assets` row (see
   *   `brand_assets.intelligence_asset_id`), and omit it only for the
   *   first ingest of a given asset.
   *
   *   G-14 (Architecture Verification Report, P1) — retries are only
   *   applied when `existingAssetId` is supplied. IntelligenceOS's
   *   `ingestKnowledgeAsset()` upserts by id in that case, making a retry
   *   safe even if an earlier attempt actually succeeded server-side and
   *   only the response was lost. A FIRST ingest (no `existingAssetId`)
   *   has no such guarantee — retrying an ambiguous failure (e.g. a
   *   timeout where the request may have already succeeded) risks
   *   creating a duplicate KnowledgeAsset row, which is worse than the
   *   status quo of a single clean failure. A durable fix (a
   *   request-level idempotency key IntelligenceOS could de-dupe on) is
   *   "durable delivery guarantee" territory — explicitly out of scope
   *   for this finding's narrow slice (see retryPolicy.ts's header).
   */
  async ingestKnowledgeAsset(
    asset: KnowledgeAssetIngestInput,
    rawContent?: string,
    existingAssetId?: string,
  ): Promise<{ assetId: string }> {
    const attempt = () => this._attempt(asset, rawContent, existingAssetId)
    return existingAssetId
      ? withRetry(attempt, KNOWLEDGE_INGEST_RETRY_OPTIONS)
      : attempt()
  }

  private async _attempt(
    asset: KnowledgeAssetIngestInput,
    rawContent: string | undefined,
    existingAssetId: string | undefined,
  ): Promise<{ assetId: string }> {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )

    try {
      const res = await fetch(`${this.config.baseUrl}/v1/knowledge/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ asset, rawContent, existingAssetId }),
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(`IntelligenceOS API POST /v1/knowledge/ingest returned ${res.status}`)
      }

      return (await res.json()) as { assetId: string }
    } finally {
      clearTimeout(timeout)
    }
  }
}
