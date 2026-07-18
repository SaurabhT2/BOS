/**
 * @platform/cognition-contract
 *
 * Public entry point. Re-exports the entire cross-platform vocabulary
 * between BrandOS and IntelligenceOS. See CognitionContext.ts and
 * CognitionProvider.ts for the governing documentation — this file adds
 * nothing of its own.
 */

export type {
  CognitionConfidence,
  VoiceProfile,
  IdentityContribution,
  VisualIdentityProjection,
  CognitionProvenance,
  CognitionKnowledgeSection,
  CognitionReasoningSection,
  CognitionPositioningSection,
  CognitionContext,
  CognitionRequest,
  ObservationInput,
  CognitionSummary,
  CognitionHealth,
} from './CognitionContext'

export { COGNITION_CONTRACT_VERSION } from './CognitionContext'

export type { CognitionProvider } from './CognitionProvider'
export { createDegradedCognitionContext } from './CognitionProvider'
