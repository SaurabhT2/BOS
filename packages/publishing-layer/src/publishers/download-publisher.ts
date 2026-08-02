// ============================================================
// packages/publishing-layer/src/publishers/download-publisher.ts
//
// §7: "Download — arguably not even a distinct 'destination' so much as
// the absence of one; worth naming explicitly so the model doesn't force
// every rendered artifact through a Destination it doesn't need."
// ============================================================

import type {
  Publisher,
  PublishRequest,
  PublishOutcome,
  RevokeRequest,
  RevokeOutcome,
} from '../publisher-contract'

export class DownloadPublisher implements Publisher {
  readonly id = 'download'
  readonly displayName = 'Direct Download'

  async publish(request: PublishRequest): Promise<PublishOutcome> {
    // Nothing to distribute — the rendered output already exists in
    // storage (RenderedOutputRef.storageKey). "Publishing" to Download
    // just records the fact that this version's output is available for
    // direct download, using the storage key itself as the destination's
    // own reference (there is no other identifier a "download" produces).
    return {
      kind: 'success',
      destinationReference: request.renderedOutput.storageKey,
      detail: { format: request.renderedOutput.format },
    }
  }

  async revoke(_request: RevokeRequest): Promise<RevokeOutcome> {
    // No remote side-effect exists to undo — see the Publisher contract's
    // revoke() doc comment. The caller still marks the Publication
    // revoked locally; this Publisher has nothing further to do.
    return { kind: 'unsupported' }
  }

  validateDestinationConfig(_config: Readonly<Record<string, unknown>>): { valid: boolean; errors: readonly string[] } {
    // Download takes no configuration — always valid.
    return { valid: true, errors: [] }
  }
}
