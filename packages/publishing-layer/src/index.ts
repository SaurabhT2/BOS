// ============================================================
// @brandos/publishing-layer — Public API
//
// Publishing Foundation (Phase 10) — see PUBLISHING_ARCHITECTURE_V1.md
// and PUBLISHING_LAYER_NOTES.md (this package's own scope/limitations
// document) before extending.
//
// Single canonical entry point — all consumers import from
// '@brandos/publishing-layer', never from internal subpaths, matching
// the discipline already established by composition-layer and
// governance-layer's own index.ts files.
// ============================================================

// ─── Domain model (§4) ──────────────────────────────────────────────────────
export type {
  ArtifactId,
  ArtifactVersionId,
  ApprovalId,
  DestinationId,
  PublicationId,
  DistributionJobId,
  PublishEventId,
  WorkspaceId,
  UserId,
  ArtifactLifecycleState,
  Actor,
  Artifact,
  RenderedOutputRef,
  ArtifactVersion,
  ApprovalPurpose,
  ApprovalDecision,
  Approval,
  PublisherId,
  Destination,
  DistributionJobStatus,
  DistributionJob,
  Publication,
  PublishEventType,
  PublishEvent,
  AuditRecord,
  RetentionPolicy,
} from './types'
export { DEFAULT_RETENTION_POLICY } from './types'

// ─── Lifecycle engine (§5) ──────────────────────────────────────────────────
export {
  LifecycleError,
  deriveVersionState,
  assertActionLegal,
  assertGateAllowed,
  buildEvent,
} from './lifecycle'
export type { VersionEvidence } from './lifecycle'

// ─── Governance policy integration (§8) ─────────────────────────────────────
export {
  StaticPolicyProvider,
  DEFAULT_APPROVER_ROLES,
  evaluateApprovalGate,
  evaluatePublishGate,
} from './policy'
export type {
  PublishingPolicySnapshot,
  IPublishingPolicyProvider,
  GateEvaluation,
} from './policy'

// ─── Publisher contract + registry (§7) ─────────────────────────────────────
export type {
  PublishRequest,
  PublishOutcome,
  RevokeRequest,
  RevokeOutcome,
  Publisher,
} from './publisher-contract'
export { PublisherRegistry, PublisherNotFoundError } from './publisher-registry'

// ─── Publisher implementations ──────────────────────────────────────────────
export {
  ShareLinkPublisher,
  DownloadPublisher,
  createDefaultPublisherRegistry,
} from './publishers'
export type { ShareLinkDestinationConfig } from './publishers'

// ─── Storage abstraction (§6) ───────────────────────────────────────────────
export {
  SupabaseRenderedOutputStore,
  InMemoryRenderedOutputStore,
} from './storage'
export type { RenderedOutputStore, StoredOutput } from './storage'

// ─── Persistence abstraction (§6) ───────────────────────────────────────────
export type {
  ArtifactRepository,
  ArtifactVersionRepository,
  ApprovalRepository,
  DestinationRepository,
  DistributionJobRepository,
  PublicationRepository,
  PublishEventRepository,
  RetentionPolicyRepository,
  PublishingRepositories,
} from './repository'
export { createInMemoryPublishingRepositories } from './repository-memory'
export { createSupabasePublishingRepositories } from './repository-supabase'

// ─── Audit trail (§4, §8) ────────────────────────────────────────────────────
export { buildAuditRecord, publicationsByContentHash } from './audit'

// ─── Content hashing (§6 audit primitive) ───────────────────────────────────
export { sha256Hex, sha256HexOfJson } from './hash'

// ─── Orchestrating service facade (§11's "in-process equivalent") ──────────
export { PublishingService, PublishingServiceError } from './publishing-service'
export type { PublishingServiceDeps } from './publishing-service'
