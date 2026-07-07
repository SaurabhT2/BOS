/**
 * @brandos/control-plane-layer — workspace/limits-checker.ts
 *
 * P2 — Explorer / Professional / Executive Tiering.
 *
 * Extends the P0 monthly_generation_limit check with full tier-aware enforcement:
 *
 *   1. Monthly generation limit (tier default + workspace_settings override)
 *   2. Artifact type gate (deck/report blocked on Explorer)
 *
 * FAIL-SAFE: All checks fail open on DB errors — a counting failure should
 * not block generation. Race conditions on the count are acceptable at P2
 * scale (low concurrent load). A Postgres RPC with row-level locking is
 * the correct solution for high-concurrency P3+ environments.
 *
 * Called by run-control-plane.ts BEFORE invoking CPLOrchestrator.orchestrate().
 */

import type { ResolvedWorkspaceSettings } from './settings-resolver'
import {
  resolveTierLimits,
  isArtifactTypeAllowed,
  buildGenerationLimitError,
  buildArtifactTypeGateError,
  type TierGateError,
} from './tier-resolver'

export interface LimitsCheckResult {
  allowed: boolean
  /**
   * Number of generations used this month (calendar month, UTC).
   * Always set, even when allowed=true, so callers can expose usage to the UI.
   */
  used: number
  /** The effective monthly generation limit. null = no limit. */
  limit: number | null
  /** Human-readable reason for denial. Only set when allowed=false. */
  reason?: string
  /**
   * P2 — Structured tier gate error. Set when allowed=false and the denial
   * is due to a tier restriction (not a generic limit). Routes use this to
   * return a rich 403/429 payload with upgrade CTAs.
   */
  tierGate?: TierGateError
  /**
   * P2 — The artifact type that was blocked. Set when tierGate is present
   * and the block reason is artifact type gating.
   */
  blockedArtifactType?: string
}

/**
 * Check whether a workspace is within its monthly generation limit
 * and whether the requested artifact type is permitted for the tier.
 *
 * @param workspaceId - FK → workspaces.id (resolved by requireUser()).
 * @param settings - Resolved workspace settings (from resolveWorkspaceSettings).
 * @param supabase - Supabase client (server-side, from requireUser()).
 * @param taskType - Optional task type for artifact-type gating.
 *   If not provided, only the generation count limit is checked.
 */
export async function checkWorkspaceLimits(
  workspaceId: string,
  settings: ResolvedWorkspaceSettings,
  supabase: any,
  taskType?: string,
): Promise<LimitsCheckResult> {
  const tierLimits = resolveTierLimits(settings.plan, settings)

  // ── 1. Artifact type gate ──────────────────────────────────────────────────
  // Check before counting — no point querying the DB if the artifact type is
  // blocked regardless of usage.
  if (taskType && !isArtifactTypeAllowed(taskType, tierLimits)) {
    const gateError = buildArtifactTypeGateError(taskType, settings.plan)
    return {
      allowed:             false,
      used:                0,
      limit:               tierLimits.monthlyGenerations,
      reason:              gateError.reason,
      tierGate:            gateError,
      blockedArtifactType: taskType,
    }
  }

  // ── 2. Monthly generation limit ────────────────────────────────────────────
  const limit = tierLimits.monthlyGenerations

  // No limit at this tier → always allowed
  if (limit === null) {
    return { allowed: true, used: 0, limit: null }
  }

  // Count campaigns for this workspace in the current calendar month (UTC)
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()

  const { count, error } = await supabase
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .gte('created_at', monthStart)

  if (error) {
    // Fail open — counting failure should not block generation.
    console.error('[checkWorkspaceLimits] Count query failed:', error.message)
    return { allowed: true, used: 0, limit }
  }

  const used = count ?? 0

  if (used >= limit) {
    const gateError = buildGenerationLimitError(used, limit, settings.plan)
    return {
      allowed:  false,
      used,
      limit,
      reason:   gateError.reason,
      tierGate: gateError,
    }
  }

  return { allowed: true, used, limit }
}
