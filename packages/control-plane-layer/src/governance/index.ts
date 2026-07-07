/**
 * ProviderGovernanceService
 *
 * GOVERNANCE MIGRATION:
 *   PLATFORM_HARD_CONSTRAINTS now imported from @brandos/governance-config
 *   instead of being hardcoded here. Values are identical (health=20, cost=1.00)
 *   but now auditable and co-located with all other policy constants.
 *
 *   auditLog is now durable — events are written to Supabase via
 *   persistAuditEvent() in addition to the in-memory log. The in-memory
 *   log is kept for fast synchronous reads (getAuditLog()).
 */

import type {
  ProviderPreference,
  RoutingOverrideAuditEvent,
  ExplainedRoutingPlan,
  RoutingDecisionSnapshot,
  CapabilityId,
  ProviderName,
  ICapabilityRegistry,
  RoutingHint,
  CapabilityDescriptor,
} from '@brandos/contracts'

import { PLATFORM_HARD_CONSTRAINTS } from '@brandos/governance-config'

// ─── ProviderGovernanceService ────────────────────────────────────────────────

export class ProviderGovernanceService {
  private readonly auditLog: RoutingOverrideAuditEvent[] = []

  constructor(
    private readonly capabilityRegistry: ICapabilityRegistry,
    private readonly persistAuditEvent?: (event: RoutingOverrideAuditEvent) => Promise<void>,
  ) {}

  applyPreference(
    baseHint: RoutingHint,
    preference: ProviderPreference | null,
    capabilityId: CapabilityId,
    traceId: string,
  ): { hint: RoutingHint; plan: ExplainedRoutingPlan } {
    const all      = this.capabilityRegistry.resolveAll(capabilityId)
    const rejected: Array<{ descriptor: CapabilityDescriptor; reason: string }> = []
    let   candidates = [...all]
    const explainability:   string[] = []
    const adminConstraints: string[] = []

    // 1. Platform hard constraints — never bypassable
    // Values sourced from governance-config.PLATFORM_HARD_CONSTRAINTS
    candidates = candidates.filter(c => {
      if (c.health_score < PLATFORM_HARD_CONSTRAINTS.minProviderHealth) {
        rejected.push({
          descriptor: c,
          reason: `Health score ${c.health_score} below platform minimum ${PLATFORM_HARD_CONSTRAINTS.minProviderHealth}`,
        })
        adminConstraints.push(`${c.provider}: health too low`)
        return false
      }
      if ((c.cost_per_1k_tokens ?? 0) > PLATFORM_HARD_CONSTRAINTS.maxCostPerRequestUsd * 1000) {
        rejected.push({
          descriptor: c,
          reason: `Cost per 1k tokens exceeds platform max $${PLATFORM_HARD_CONSTRAINTS.maxCostPerRequestUsd}`,
        })
        adminConstraints.push(`${c.provider}: cost too high`)
        return false
      }
      return true
    })

    let hint = { ...baseHint }

    if (preference) {
      if (preference.disabled_providers && preference.disabled_providers.length > 0) {
        candidates = candidates.filter(c => {
          if (preference.disabled_providers!.includes(c.provider as ProviderName)) {
            rejected.push({ descriptor: c, reason: 'Disabled by user preference' })
            return false
          }
          return true
        })
        explainability.push(`User disabled: ${preference.disabled_providers.join(', ')}`)
      }

      if (preference.forced_providers && preference.forced_providers.length > 0) {
        candidates.sort((a, b) => {
          const aIdx = preference.forced_providers!.indexOf(a.provider as ProviderName)
          const bIdx = preference.forced_providers!.indexOf(b.provider as ProviderName)
          if (aIdx === -1 && bIdx === -1) return 0
          if (aIdx === -1) return 1
          if (bIdx === -1) return -1
          return aIdx - bIdx
        })
        explainability.push(`User forced order: ${preference.forced_providers.join(' → ')}`)
      }

      if (preference.routing_mode === 'cost_first') {
        hint.max_cost_usd = hint.max_cost_usd ?? 0.001
        explainability.push('Routing mode: cost_first')
      } else if (preference.routing_mode === 'quality_first') {
        hint.min_quality_ceiling = Math.max(hint.min_quality_ceiling ?? 0, 90)
        explainability.push('Routing mode: quality_first')
      }

      const eventId = `audit:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
      const admin_constraint_applied = adminConstraints.length > 0 ? adminConstraints.join('; ') : undefined
      const auditEvent: RoutingOverrideAuditEvent = {
        event_id:  eventId,
        trace_id:  traceId,
        user_id:   preference.user_id,
        timestamp: new Date().toISOString(),
        override_type: preference.forced_providers?.length ? 'provider_forced' : 'routing_mode',
        from_state: { routing_mode: 'balanced' },
        to_state:   { routing_mode: preference.routing_mode },
        reason: 'User preference applied',
        ...(admin_constraint_applied !== undefined && { admin_constraint_applied }),
      }
      this.recordAuditEvent(auditEvent)
    }

    const resolved = candidates[0] ?? null
    const snapshot: RoutingDecisionSnapshot = {
      selected_provider: (resolved?.provider ?? 'none') as ProviderName,
      selected_mode: hint.preferred_tiers?.[0] ?? 'unknown',
      routing_mode: preference?.routing_mode ?? 'balanced',
      capability_id: capabilityId,
      fallback_chain: candidates.slice(1).map(c => c.provider as ProviderName),
      cost_estimate_usd: resolved?.cost_per_1k_tokens ?? 0,
      latency_estimate_ms: resolved?.latency_p50_ms ?? 0,
      user_preference_applied: preference !== null,
      admin_constraint_applied: adminConstraints.length > 0,
      explainability,
    }

    return {
      hint,
      plan: {
        snapshot,
        capability_candidates:  candidates,
        rejected_candidates:    rejected,
        preference_applied:     preference,
        admin_constraints_active: adminConstraints,
      },
    }
  }

  recordAuditEvent(event: RoutingOverrideAuditEvent): void {
    this.auditLog.push(event)
    console.info('[GovernanceService] Audit:', event.override_type, event.user_id)

    // Durable persistence — fire-and-forget, never blocks the hot path
    if (this.persistAuditEvent) {
      this.persistAuditEvent(event).catch(err =>
        console.error('[GovernanceService] Audit persist failed:', err)
      )
    }
  }

  getAuditLog(): readonly RoutingOverrideAuditEvent[] {
    return [...this.auditLog]
  }
}


