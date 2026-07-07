/**
 * @brandos/control-plane-layer — src/shared/types.ts
 *
 * SHIM SECTION REMOVED — CPL v3.0.0 (Phase 3.1)
 *
 * All deprecated type re-exports (BrandMemoryEntry, BrandMemoryConfig, BrandVoice,
 * SemanticIdentity, VisualIdentity, BrandSignalType, BrandSignalStatus,
 * PromptPersonalizationContext, VisualPersonalizationContext, TaskType) have been
 * removed. Import from @brandos/contracts directly.
 *
 * RETAINED: CPL-internal enterprise types that are not yet promoted to contracts.
 * These types are defined here because they are CPL-internal concerns.
 *
 * @deprecated shim portion since 2026-05-27 — CPL L5 refactor. Removed 2026-06-08 — Phase 3.
 */

// ─── Enterprise types (CPL-local — not yet promoted to @brandos/contracts) ────

export interface ScoreHistoryEntry {
  id: string
  request_id: string
  user_id: string
  workspace_id?: string
  task_type: string
  model_id: string
  provider: string
  score: number
  initial_score?: number
  retries: number
  latency_ms: number
  approved: boolean | null
  tokens_used?: number
  cost_usd?: number
  timestamp: string
  experiment_id?: string
  prompt_library_id?: string
}

export interface ScoreAggregation {
  period: string
  avg_score: number
  min_score: number
  max_score: number
  total_requests: number
  avg_retries: number
  avg_latency_ms: number
  approval_rate: number
  by_task: Record<string, { avg: number; count: number }>
  by_model: Record<string, { avg: number; count: number }>
}

export type WebhookEvent =
  | 'score.high'
  | 'score.low'
  | 'generation.completed'
  | 'generation.failed'
  | 'policy.violation'
  | 'brand_memory.learned'

export interface WebhookConfig {
  id: string
  workspace_id: string
  url: string
  secret: string
  events: WebhookEvent[]
  active: boolean
  retry_limit: number
  headers: Record<string, string>
  created_at: string
  failure_count: number
}

export interface WebhookDelivery {
  id: string
  webhook_id: string
  event: WebhookEvent
  payload: Record<string, unknown>
  status: 'pending' | 'delivered' | 'failed' | 'retrying'
  attempts: number
  last_attempt_at: string
  created_at: string
  response_status?: number
  error?: string
}

export interface VariantConfig {
  model_id: string
  provider?: string
  temperature?: number
  system_prompt_override?: string
  tags?: string[]
}

export interface VariantStats {
  variant_id: string
  samples: number
  avg_score: number
  p50_score?: number
  p90_score?: number
  win_rate?: number
}

export interface ExperimentVariant {
  id: string
  name: string
  config: VariantConfig
  weight: number
}

export interface Experiment {
  id: string
  workspace_id: string
  name: string
  description?: string
  task_type: string
  status: 'draft' | 'running' | 'paused' | 'completed'
  variants: ExperimentVariant[]
  total_samples: number
  created_at: string
  started_at?: string
  ended_at?: string
}

export interface PromptLibraryEntry {
  id: string
  workspace_id: string
  title: string
  description: string
  prompt_text: string
  system_context?: string
  task_type: string
  tags: string[]
  score_achieved: number
  is_recommended: boolean
  usage_count: number
  success_rate: number
  version: number
  parent_id?: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface TelemetryRecord {
  request_id: string
  user_id: string
  task_type: string
  model_id: string
  provider: string
  final_score: number
  initial_score: number
  total_retries: number
  latency_ms: number
  tokens_used?: number
  cost_estimate_usd?: number
  timestamp: string
  failure_reasons: string[]
  policy_violations: string[]
}
