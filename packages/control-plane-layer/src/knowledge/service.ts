/**
 * @brandos/control-plane-layer — knowledge/service.ts
 *
 * Milestone 3, Phase 1 (Knowledge API).
 *
 * CPL proxy for knowledge ingestion — the same role
 * `brand-memory/service.ts` plays for cognition observation. Exists
 * because `packages/cognition-client/src/global-knowledge-client.ts`'s
 * header states the same routing rule brand-memory/service.ts enforces:
 * apps/web must not import @brandos/cognition-client directly, it must go
 * through CPL. Without this file, apps/web/app/api/assets/route.ts would
 * have no permitted way to reach `POST /v1/knowledge/ingest`.
 */

import {
  getGlobalKnowledgeIngestClient,
  type KnowledgeAssetIngestInput,
} from '@brandos/cognition-client'

/**
 * ingestWorkspaceKnowledgeAsset — hand off an uploaded asset to
 * IntelligenceOS for extraction.
 * Proxy for: KnowledgeIngestClient.ingestKnowledgeAsset()
 *
 * Best-effort, matching KnowledgeIngestClient's own contract: if the
 * client was never initialized (INTELLIGENCE_OS_API_URL/KEY not set —
 * same env vars cognition uses) this resolves to `null` instead of
 * throwing, so an environment running without IntelligenceOS configured
 * still uploads assets successfully; it simply skips knowledge
 * extraction, the same way resolveCognitionContext degrades instead of
 * failing generation.
 *
 * Callers should treat this as fire-and-forget after their own
 * asset-creation write has already succeeded — never block the upload
 * response on it, and never let a failure here fail the upload. See
 * apps/web/app/api/assets/route.ts for the intended calling convention.
 */
export async function ingestWorkspaceKnowledgeAsset(
  asset: KnowledgeAssetIngestInput,
  rawContent?: string,
): Promise<{ assetId: string } | null> {
  const client = getGlobalKnowledgeIngestClient()
  if (!client) return null
  return client.ingestKnowledgeAsset(asset, rawContent)
}
