/**
 * BrandOS Enterprise Control Plane — All Modules
 * Single barrel export for all new enterprise features.
 *
 * PHASE 3 CLEANUP (3.2): BrandMemoryService and globalBrandMemory removed from
 * this barrel. Import from @brandos/brand-intelligence directly:
 *   import { BrandMemoryService, globalBrandMemory } from '@brandos/brand-intelligence'
 */

// Policy
export { PolicyAdminService, globalPolicyAdminService } from './policy/service'

// Score History
export { ScoreHistoryService, globalScoreHistory } from './scoring/history'

// Webhooks
export { WebhookService, globalWebhookService } from './webhooks/service'



// Prompt Library
export { PromptLibraryService, globalPromptLibrary } from './prompt-library/service'

// Enterprise Telemetry
export { EnterpriseTelemetryEngine, globalEnterpriseTelemetry } from './telemetry/enterprise'

// Shared Types — CPL-internal enterprise types (BrandMemory types removed; import from @brandos/contracts)
export type {
  ScoreHistoryEntry,
  ScoreAggregation,
  WebhookConfig,
  WebhookDelivery,
  WebhookEvent,
  Experiment,
  ExperimentVariant,
  VariantConfig,
  VariantStats,
  PromptLibraryEntry,
} from './shared/types'


