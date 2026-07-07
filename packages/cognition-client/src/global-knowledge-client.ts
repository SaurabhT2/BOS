/**
 * @brandos/cognition-client — src/global-knowledge-client.ts
 *
 * Process-scoped singleton for KnowledgeIngestClient. Same defense-in-depth
 * pattern as global-client.ts (globalThis store, survives webpack chunk
 * splits in Next.js) — deliberately mirrored rather than merged into that
 * file, since the two clients are independent (see KnowledgeIngestClient.ts's
 * header for why they're separate).
 */

import { KnowledgeIngestClient, type KnowledgeIngestClientConfig } from './KnowledgeIngestClient'

declare global {
  // eslint-disable-next-line no-var
  var __BRANDOS_KNOWLEDGE_INGEST_CLIENT__: KnowledgeIngestClient | null | undefined
}

function _get(): KnowledgeIngestClient | null {
  return globalThis.__BRANDOS_KNOWLEDGE_INGEST_CLIENT__ ?? null
}

function _set(client: KnowledgeIngestClient): void {
  globalThis.__BRANDOS_KNOWLEDGE_INGEST_CLIENT__ = client
}

export function initKnowledgeIngestClient(config: KnowledgeIngestClientConfig): void {
  if (_get()) {
    console.warn('[cognition-client] initKnowledgeIngestClient called more than once — ignoring')
    return
  }
  _set(new KnowledgeIngestClient(config))
  console.info('[cognition-client] Knowledge ingest client initialized')
}

/**
 * Unlike getGlobalCognitionClient(), returns null instead of throwing when
 * not configured. Knowledge ingestion is best-effort orchestration
 * (see KnowledgeIngestClient.ingestKnowledgeAsset's docblock) — a workspace
 * running without INTELLIGENCE_OS_API_URL configured should degrade to
 * "asset upload works, ingestion is skipped," not fail uploads outright,
 * matching how initCognitionClient's absence already degrades resolve
 * (DegradedCognitionProvider) rather than crashing BrandOS.
 */
export function getGlobalKnowledgeIngestClient(): KnowledgeIngestClient | null {
  return _get()
}

/** Only for tests. Never call in production. */
export function _resetGlobalKnowledgeIngestClientForTests(): void {
  globalThis.__BRANDOS_KNOWLEDGE_INGEST_CLIENT__ = null
}
