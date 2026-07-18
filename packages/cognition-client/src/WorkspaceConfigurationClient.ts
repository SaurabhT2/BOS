/**
 * @brandos/cognition-client — src/WorkspaceConfigurationClient.ts
 *
 * Cognitive Platform Evolution Program — Milestone 1 (Cognitive Ownership),
 * EM-1.2.
 *
 * A thin HTTP adapter for IntelligenceOS's `POST /v1/workspace-configuration`
 * route (ADR-003 §2.4) — the receiving end has existed since before this
 * program; this client is what was actually missing (see the Cross-
 * Repository Cognitive Integration Audit, §2.4, and this package's own
 * README's now-resolved gap #2).
 *
 * Separate client, same reasoning as KnowledgeIngestClient.ts: this is a
 * plain write endpoint for an ingestion concern (explicit configuration is
 * Knowledge, per ADR-003 §2.4), not a cognition read/observe operation, so
 * it does not belong on `CognitionProvider`.
 *
 * Same apps/web → CPL/@brandos/auth → cognition-client routing rule as the
 * other clients in this package — apps/web must not talk to IntelligenceOS
 * directly. Called from `@brandos/auth`'s persona write path (see
 * `packages/auth/src/db/dbService.ts`).
 */

const DEFAULT_TIMEOUT_MS = 5000

export interface WorkspaceConfigurationClientConfig {
  /** Base URL of the IntelligenceOS API — same value used for cognition. */
  readonly baseUrl: string
  /** Same shared-secret used for the cognition and knowledge-ingest routes. */
  readonly apiKey: string
  readonly timeoutMs?: number
}

/**
 * Mirrors `WorkspaceConfigurationInput`
 * (`intelligence-os/src/types/domains.ts`) exactly. Duplicated here rather
 * than imported, for the same reason `KnowledgeAssetIngestInput` is
 * duplicated in `KnowledgeIngestClient.ts` — this is the wire shape both
 * sides have agreed to, not a shared package import.
 */
export interface WorkspaceConfigurationSyncInput {
  readonly workspaceId: string
  readonly label?: string | null
  readonly voiceConfiguration?: {
    tone?: string
    cadence?: 'short' | 'medium' | 'long' | 'varied'
    audienceType?: string
    executiveLevel?: boolean
    domain?: string
    bannedPhrases?: string[]
    brandName?: string
    voiceDescriptor?: string
    audiencePositioning?: string
  } | null
  readonly complianceConstraints?: Record<string, unknown>[]
  readonly identityConfiguration?: {
    brandName?: string
    narrativeArcs?: string[]
    argumentationStyle?: string
    namedFrameworks?: string[]
    preferredLength?: 'short' | 'medium' | 'long'
  } | null
}

export class WorkspaceConfigurationClient {
  constructor(private readonly config: WorkspaceConfigurationClientConfig) {}

  /**
   * Called synchronously from the persona write path (see
   * `@brandos/auth`'s `updatePersona()`/`createPersona()`) so that a brand-
   * voice edit reaches IntelligenceOS in the same request cycle — unlike
   * `KnowledgeIngestClient.ingestKnowledgeAsset()`, this is NOT fire-and-
   * forget by convention, because `personas` is meant to become a write-
   * through cache of IntelligenceOS's copy (write IntelligenceOS first,
   * then the local cache — see the Cognitive Platform Evolution Program,
   * Milestone 1, architecture outcome). Callers that must not block a
   * user-facing write on this call's latency may still choose to run it
   * concurrently and log-on-failure instead; that is a caller-level
   * decision, not this client's.
   */
  async sync(input: WorkspaceConfigurationSyncInput): Promise<{ assetId: string }> {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )

    try {
      const res = await fetch(`${this.config.baseUrl}/v1/workspace-configuration`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(`IntelligenceOS API POST /v1/workspace-configuration returned ${res.status}`)
      }

      return (await res.json()) as { assetId: string }
    } finally {
      clearTimeout(timeout)
    }
  }
}
