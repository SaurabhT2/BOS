// ============================================================
// packages/publishing-layer/src/publisher-contract.ts
//
// §7 Publisher Registry: "Mirrors the Renderer Registry's own
// architecture deliberately — a proven pattern from this same codebase,
// not a new invention." Compare directly against
// packages/composition-layer/src/renderer-contract.ts — the shapes below
// are intentionally structured the same way, one layer up the stack:
//   Renderer<TOutput>.render(CompositionDocument, RenderOptions) → TOutput
//   Publisher.publish(PublishRequest, DestinationConfig) → PublishOutcome
//
// A Publisher never touches CompositionDocument, never re-renders, and
// never makes a lifecycle/approval decision (§7 design principle 4/§2.4).
// It receives bytes + metadata and returns a durable outcome — full stop.
// ============================================================

import type {
  Actor,
  ArtifactVersionId,
  DestinationId,
  RenderedOutputRef,
} from './types'

/**
 * What a Publisher is handed to act on. Deliberately does NOT include the
 * ArtifactVersion's `source` (governed ArtifactV2/CompositionDocument
 * lineage) — a Publisher gets bytes and metadata only (§2 Principle 4).
 */
export interface PublishRequest {
  readonly artifactVersionId: ArtifactVersionId
  readonly destinationId: DestinationId
  readonly renderedOutput: RenderedOutputRef
  readonly requestedBy: Actor
  /** Publisher-specific configuration from the Destination record (opaque to Publishing-core — §4). */
  readonly destinationConfig: Readonly<Record<string, unknown>>
}

export type PublishOutcome =
  | {
      readonly kind: 'success'
      /** The destination's own reference back — a share-link token, a LinkedIn post id, an ESP send id (§4). */
      readonly destinationReference: string
      readonly detail?: Readonly<Record<string, unknown>>
    }
  | {
      readonly kind: 'failure'
      readonly reason: string
      /** True if a retry might succeed (rate limit, transient network error) vs. false for a permanent rejection (invalid config, revoked auth). */
      readonly retryable: boolean
      readonly detail?: Readonly<Record<string, unknown>>
    }

export interface RevokeRequest {
  readonly destinationReference: string
  readonly destinationConfig: Readonly<Record<string, unknown>>
  readonly requestedBy: Actor
  readonly reason?: string
}

export type RevokeOutcome =
  | { readonly kind: 'success'; readonly detail?: Readonly<Record<string, unknown>> }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'failure'; readonly reason: string }

/**
 * Publisher — the contract every destination plugin implements (§7).
 * Conceptually parallel to composition-layer's `Renderer<T>`.
 */
export interface Publisher {
  readonly id: string
  readonly displayName: string

  /** Attempt distribution. Never throws for expected failure modes — returns a failure outcome instead (mirrors DistributionJob's retry/failure shape, §4). */
  publish(request: PublishRequest): Promise<PublishOutcome>

  /**
   * Attempt to roll back a prior successful publish where the destination
   * supports it (§8 "Rollback"). Publishers that cannot roll back (e.g. a
   * Download "destination" with no remote side-effect to undo) return
   * `{ kind: 'unsupported' }` rather than a failure — the caller
   * (publishing-service.ts) still records the Publication as revoked
   * locally and emits the PublishEvent either way; only the
   * destination-side retraction is genuinely optional.
   */
  revoke(request: RevokeRequest): Promise<RevokeOutcome>

  /**
   * Validate a Destination's `config` shape before it is persisted. Kept
   * on the Publisher (not Publishing-core) because only the Publisher
   * knows what its own config should look like (§7).
   */
  validateDestinationConfig(config: Readonly<Record<string, unknown>>): { valid: boolean; errors: readonly string[] }
}
