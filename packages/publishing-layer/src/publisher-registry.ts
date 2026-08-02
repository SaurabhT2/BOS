// ============================================================
// packages/publishing-layer/src/publisher-registry.ts
//
// §7: "Every destination is a plugin, not a branch." Mirrors
// governance-layer/src/GovernancePluginRegistry.ts's registry pattern —
// module-level, idempotent registration, dispatch by key, no branching on
// destination identity anywhere outside this file plus the individual
// Publisher implementations in publishers/.
//
// DESIGN:
//   - Instantiable class (not a bare module-level singleton) so tests can
//     construct an isolated registry per test rather than sharing mutable
//     global state — the one deliberate deviation from
//     GovernancePluginRegistry's singleton-export pattern, chosen because
//     publishing-layer's own test suite needs registry isolation between
//     cases (share-link + download registered fresh per test) in a way
//     governance-layer's bootstrap-once-at-startup usage does not.
//   - A convenience `createDefaultPublisherRegistry()` factory registers
//     the two Publishers this engagement implements (§13: "Share Link ...
//     is the architecturally-recommended starting Publisher" plus
//     Download, "arguably not even a distinct destination"). Application
//     wiring is free to construct its own registry and register
//     additional Publishers later without touching this file (§7's whole
//     point).
// ============================================================

import type { Publisher, PublishRequest, PublishOutcome, RevokeRequest, RevokeOutcome } from './publisher-contract'

export class PublisherNotFoundError extends Error {
  constructor(readonly publisherId: string) {
    super(`No Publisher registered for id '${publisherId}'.`)
    this.name = 'PublisherNotFoundError'
  }
}

export class PublisherRegistry {
  private readonly publishers = new Map<string, Publisher>()

  /** Idempotent — later registration for the same id overwrites (mirrors GovernancePluginRegistry). */
  register(publisher: Publisher): void {
    this.publishers.set(publisher.id, publisher)
  }

  resolve(publisherId: string): Publisher | null {
    return this.publishers.get(publisherId) ?? null
  }

  has(publisherId: string): boolean {
    return this.publishers.has(publisherId)
  }

  list(): readonly string[] {
    return [...this.publishers.keys()]
  }

  /** Dispatch a publish request to the correct Publisher — throws PublisherNotFoundError, never silently no-ops. */
  async publish(publisherId: string, request: PublishRequest): Promise<PublishOutcome> {
    const publisher = this.resolve(publisherId)
    if (!publisher) throw new PublisherNotFoundError(publisherId)
    return publisher.publish(request)
  }

  async revoke(publisherId: string, request: RevokeRequest): Promise<RevokeOutcome> {
    const publisher = this.resolve(publisherId)
    if (!publisher) throw new PublisherNotFoundError(publisherId)
    return publisher.revoke(request)
  }
}
