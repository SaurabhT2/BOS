// ============================================================
// packages/publishing-layer/src/publishers/share-link-publisher.ts
//
// §7: "Share Link — the simplest possible 'destination': a durable,
// revocable public URL pointing at a rendered output. Likely the first
// Publisher built, since it requires no external API integration at all
// and exercises the full lifecycle/Publication/audit model end to end."
// §13 names this the architecturally-recommended starting Publisher.
//
// RESOLUTION IS DELIBERATELY NOT IMPLEMENTED HERE:
//   This Publisher's job (per the Publisher contract, §7 design principle
//   4) is to produce a durable `destinationReference` (a token) and
//   record whether that token has been revoked — nothing more. The
//   public-facing "GET /share/:token → serve the file" HTTP route that
//   *resolves* a token back to bytes is application-layer (would live in
//   apps/web), needs a decision about auth/rate-limiting/analytics that
//   §13 leaves open, and is exactly the kind of HTTP-surface work §9
//   marks as "interfaces only, no implementation" for this engagement.
//   The resolution route's whole job at that point is mechanical: look up
//   the Publication by destinationReference, refuse if `revoked`, then
//   call RenderedOutputStore.getSignedUrl() on the matching
//   ArtifactVersion's renderedOutputs entry — no new design surface, just
//   wiring, once the missing product/auth decisions are made.
// ============================================================

import type {
  Publisher,
  PublishRequest,
  PublishOutcome,
  RevokeRequest,
  RevokeOutcome,
} from '../publisher-contract'

export interface ShareLinkDestinationConfig {
  /** Optional: how long a resolved signed URL should live once someone follows the share link. Defaults applied by the resolution route (out of scope here), not by this Publisher. */
  readonly signedUrlTtlSeconds?: number
}

function generateToken(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

export class ShareLinkPublisher implements Publisher {
  readonly id = 'share-link'
  readonly displayName = 'Share Link'

  async publish(request: PublishRequest): Promise<PublishOutcome> {
    // No external call — the whole point of this Publisher (§7). The
    // token is the durable destination reference; the caller
    // (publishing-service.ts) persists it on the Publication record.
    const token = generateToken()
    return {
      kind: 'success',
      destinationReference: token,
      detail: {
        format: request.renderedOutput.format,
        storageKey: request.renderedOutput.storageKey,
      },
    }
  }

  async revoke(_request: RevokeRequest): Promise<RevokeOutcome> {
    // A share link has no remote side to retract (unlike a LinkedIn post
    // or an ESP send) — revocation is entirely local: the caller marks
    // the Publication row `revoked = true`, and a future resolution route
    // checks that flag before ever calling getSignedUrl(). Reporting
    // success here (not 'unsupported') is deliberate: for THIS
    // destination, "revoke" genuinely is fully achievable, just not via
    // an API call — see the module header.
    return { kind: 'success' }
  }

  validateDestinationConfig(config: Readonly<Record<string, unknown>>): { valid: boolean; errors: readonly string[] } {
    const errors: string[] = []
    if ('signedUrlTtlSeconds' in config) {
      const ttl = config.signedUrlTtlSeconds
      if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0) {
        errors.push('signedUrlTtlSeconds must be a positive number when provided')
      }
    }
    return { valid: errors.length === 0, errors }
  }
}
