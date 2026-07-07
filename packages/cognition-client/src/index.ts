/**
 * @brandos/cognition-client — src/index.ts
 *
 * PUBLIC API — the only file consumers should import from.
 *
 * @brandos/cognition-client is the adapter boundary the architecture
 * requires: the ONLY BrandOS package that imports
 * @platform/cognition-contract's CognitionProvider and holds a concrete
 * implementation. Every other BrandOS package must receive an
 * already-resolved CognitionContext value — passed to it by
 * control-plane-layer — rather than importing this package or the
 * contract directly.
 */

export { HttpCognitionProvider } from './HttpCognitionProvider'
export type { HttpCognitionProviderConfig } from './HttpCognitionProvider'

export { DegradedCognitionProvider } from './DegradedCognitionProvider'

export {
  initCognitionClient,
  setGlobalCognitionClient,
  getGlobalCognitionClient,
  _resetGlobalCognitionClientForTests,
} from './global-client'

// Milestone 3, Phase 1 (Knowledge API) — deliberately separate from the
// CognitionProvider exports above; see KnowledgeIngestClient.ts's header
// for why.
export { KnowledgeIngestClient } from './KnowledgeIngestClient'
export type {
  KnowledgeIngestClientConfig,
  KnowledgeAssetIngestInput,
} from './KnowledgeIngestClient'
export {
  initKnowledgeIngestClient,
  getGlobalKnowledgeIngestClient,
  _resetGlobalKnowledgeIngestClientForTests,
} from './global-knowledge-client'

// Re-exported for convenience so consumers migrating off
// @brandos/brand-intelligence don't need a second import for types they
// already had a name for (IBrandCognitionContext -> CognitionContext, etc).
export type {
  CognitionContext,
  CognitionConfidence,
  VoiceProfile,
  IdentityContribution,
  VisualIdentityProjection,
  CognitionProvenance,
  CognitionRequest,
  ObservationInput,
  CognitionSummary,
  CognitionHealth,
  CognitionReviewDecision,
  CognitionProvider,
} from '@platform/cognition-contract'
export { createDegradedCognitionContext } from '@platform/cognition-contract'
