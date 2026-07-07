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

const DEFAULT_TIMEOUT_MS = 5000

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
  readonly assetType: 'playbook' | 'framework' | 'methodology' | 'template' | 'reference'
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
   */
  async ingestKnowledgeAsset(
    asset: KnowledgeAssetIngestInput,
    rawContent?: string,
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
        body: JSON.stringify({ asset, rawContent }),
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
