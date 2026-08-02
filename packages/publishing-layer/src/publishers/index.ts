// ============================================================
// packages/publishing-layer/src/publishers/index.ts
//
// Barrel for the two Publisher implementations this engagement ships,
// plus a convenience factory that registers both into a fresh
// PublisherRegistry. Application wiring is free to construct its own
// registry and add more Publishers later (§7) without touching this file.
// ============================================================

import { PublisherRegistry } from '../publisher-registry'
import { ShareLinkPublisher } from './share-link-publisher'
import { DownloadPublisher } from './download-publisher'

export { ShareLinkPublisher, type ShareLinkDestinationConfig } from './share-link-publisher'
export { DownloadPublisher } from './download-publisher'

export function createDefaultPublisherRegistry(): PublisherRegistry {
  const registry = new PublisherRegistry()
  registry.register(new ShareLinkPublisher())
  registry.register(new DownloadPublisher())
  return registry
}
