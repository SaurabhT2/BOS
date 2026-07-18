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

// Cognitive Platform Evolution Program, Milestone 1 (Cognitive Ownership),
// EM-1.2 — deliberately separate from both CognitionProvider and
// KnowledgeIngestClient; see WorkspaceConfigurationClient.ts's header.
export { WorkspaceConfigurationClient } from './WorkspaceConfigurationClient'
export type {
  WorkspaceConfigurationClientConfig,
  WorkspaceConfigurationSyncInput,
} from './WorkspaceConfigurationClient'
export {
  initWorkspaceConfigurationClient,
  getGlobalWorkspaceConfigurationClient,
  _resetGlobalWorkspaceConfigurationClientForTests,
} from './global-workspace-configuration-client'

// Cognitive Platform Evolution Program, Milestone 3 (Experience Loop),
// EM-3.1 / EM-3.3.
export { FeedbackEventClient } from './FeedbackEventClient'
export type {
  FeedbackEventClientConfig,
  FeedbackEventInput,
  FeedbackEventType,
  EditDiffInput,
} from './FeedbackEventClient'
export {
  initFeedbackEventClient,
  getGlobalFeedbackEventClient,
  _resetGlobalFeedbackEventClientForTests,
} from './global-feedback-event-client'

export { CorrectionClient } from './CorrectionClient'
export type { CorrectionClientConfig, CorrectionInput } from './CorrectionClient'
export {
  initCorrectionClient,
  getGlobalCorrectionClient,
  _resetGlobalCorrectionClientForTests,
} from './global-correction-client'

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
  CognitionProvider,
} from '@platform/cognition-contract'
export { createDegradedCognitionContext } from '@platform/cognition-contract'
