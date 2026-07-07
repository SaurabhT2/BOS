/**
 * BrandOS — Enterprise Telemetry Hub
 *
 * GOVERNANCE MIGRATION:
 *   Webhook score trigger thresholds (previously hardcoded 90 / 65) are now
 *   sourced from @brandos/governance-config.WEBHOOK_SCORE_TRIGGERS so they
 *   are auditable, co-located with all other policy constants, and patchable
 *   without a code change.
 */

import type { TelemetryRecord } from '../shared/types'
import { globalWebhookService }    from '../webhooks/service'
import { globalScoreHistory }       from '../scoring/history'
import { globalPromptLibrary }      from '../prompt-library/service'
import { WEBHOOK_SCORE_TRIGGERS }   from '@brandos/governance-config'

export interface EnterpriseTelemetryRecord extends TelemetryRecord {
  workspace_id?: string | undefined
  experiment_id?: string | undefined
  experiment_variant_id?: string | undefined
  prompt_library_id?: string | undefined
  prompt_reused: boolean
  webhook_triggered: boolean
  brand_memory_learned: boolean
  policy_config_id?: string | undefined
}

export class EnterpriseTelemetryEngine {
  async emitEnterprise(record: EnterpriseTelemetryRecord): Promise<void> {

    // 1. Score history
    if (record.workspace_id) {
      globalScoreHistory.record({
        request_id:        record.request_id,
        user_id:           record.user_id,
        workspace_id:      record.workspace_id,
        task_type:         record.task_type,
        model_id:          record.model_id,
        provider:          record.provider,
        score:             record.final_score,
        initial_score:     record.initial_score,
        retries:           record.total_retries,
        latency_ms:        record.latency_ms,
        approved:          null,
        tokens_used:       record.tokens_used,
        cost_usd:          record.cost_estimate_usd,
        timestamp:         record.timestamp,
        experiment_id:     record.experiment_id,
        prompt_library_id: record.prompt_library_id,
      })
    }

    // 2. Prompt library usage tracking
    if (record.prompt_library_id && record.prompt_reused) {
      globalPromptLibrary.recordUsage(record.prompt_library_id, record.final_score, 78)
    }

    // 3. Webhook delivery
    // Thresholds sourced from governance-config.WEBHOOK_SCORE_TRIGGERS
    if (record.workspace_id) {
      const workspaceId = record.workspace_id

      if (record.final_score >= WEBHOOK_SCORE_TRIGGERS.highScoreThreshold) {
        await globalWebhookService.emit(workspaceId, 'score.high', {
          request_id: record.request_id,
          score:      record.final_score,
          model:      record.model_id,
          task_type:  record.task_type,
        })
      } else if (record.final_score < WEBHOOK_SCORE_TRIGGERS.lowScoreThreshold) {
        await globalWebhookService.emit(workspaceId, 'score.low', {
          request_id: record.request_id,
          score:      record.final_score,
          model:      record.model_id,
        })
      }

      if (record.failure_reasons.length > 0) {
        await globalWebhookService.emit(workspaceId, 'generation.failed', {
          request_id: record.request_id,
          reasons:    record.failure_reasons,
        })
      } else {
        await globalWebhookService.emit(workspaceId, 'generation.completed', {
          request_id:     record.request_id,
          score:          record.final_score,
          model:          record.model_id,
          task_type:      record.task_type,
          latency_ms:     record.latency_ms,
          cost_usd:       record.cost_estimate_usd,
          experiment_id:  record.experiment_id,
          prompt_reused:  record.prompt_reused,
        })
      }

      if (record.policy_violations.length > 0) {
        await globalWebhookService.emit(workspaceId, 'policy.violation', {
          request_id: record.request_id,
          violations: record.policy_violations,
        })
      }
    }
  }
}

export const globalEnterpriseTelemetry = new EnterpriseTelemetryEngine()


