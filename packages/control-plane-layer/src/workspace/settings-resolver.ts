/**
 * @brandos/control-plane-layer — workspace/settings-resolver.ts
 *
 * P0 — Implementation Wave 1A (A.3): resolves the three-level settings
 * hierarchy for a given workspace:
 *
 *   Platform Defaults (governance-config / runtime-config constants)
 *        ↓
 *   Global Admin Settings (AdminSettingsService — CPL-managed, persisted)
 *        ↓
 *   Workspace Settings  (WorkspaceSettingsRow — per-workspace overrides)
 *        ↓
 *   ResolvedWorkspaceSettings (merged, all fields non-null)
 *
 * RESOLUTION RULE: for each nullable WorkspaceSettingsRow field, a non-null
 * value overrides the Global Admin layer. A null value inherits from Global
 * Admin. If Global Admin also has no value for a setting, the platform
 * default (hardcoded constants below) is used. The result is always fully
 * resolved (no null fields).
 *
 * CURRENT P0 ENFORCEMENT SCOPE:
 *   Only `monthly_generation_limit` is actively enforced by the generation
 *   pipeline (see limits-checker.ts). The other fields are resolved and
 *   returned but are not yet wired into the runtime, governance, or asset
 *   pipelines — that is P1/P2 scope. See WorkspaceSettingsRow doc comments
 *   in @brandos/contracts for per-field enforcement status.
 *
 * DEPENDENCY: reads WorkspaceSettingsRow from @brandos/auth's
 * getWorkspaceSettings() (DB query per request). Callers who need
 * performance-sensitive resolution should cache this result at the
 * request/session boundary.
 */

import { getWorkspaceSettings, getWorkspaceById } from '@brandos/auth'
import type { WorkspaceSettingsRow, WorkspacePlan } from '@brandos/contracts'
import { AdminSettingsService } from '../admin/settings-service'

// ─── Platform Defaults ────────────────────────────────────────────────────────
// These are the values used when BOTH the workspace settings row AND the
// global admin settings have no override for a given field.

const PLATFORM_DEFAULTS = {
  // Phase 2 — Runtime Consolidation: changed from 'anthropic' to 'groq' to match
  // PROVIDER_REGISTRY (groq: priority_default=3, enabled_by_default=true,
  // comment: "the default routing choice for cloud generation"). The factory now
  // respects priority order (Phase 1), so this default will resolve correctly.
  preferred_provider:         'groq'      as string,
  runtime_mode:               'cloud'     as string,
  governance_score_threshold: 0.6         as number,
  /** null = no platform-level monthly cap (enforced only by workspace or tier) */
  monthly_generation_limit:   null        as number | null,
  asset_storage_limit_mb:     5120        as number,  // 5 GB
} as const

// ─── Resolved shape ───────────────────────────────────────────────────────────

export interface ResolvedWorkspaceSettings {
  /** Fully-resolved AI provider name. Never null. */
  preferred_provider: string
  /** Fully-resolved runtime mode. Never null. */
  runtime_mode: string
  /** Fully-resolved governance score threshold. Never null. */
  governance_score_threshold: number
  /**
   * Fully-resolved monthly generation limit.
   * null = no limit active (no platform default + no workspace override).
   */
  monthly_generation_limit: number | null
  /**
   * Fully-resolved asset storage limit in MB.
   * Not yet enforced in P0 — Asset Vault enforcement is P1.
   */
  asset_storage_limit_mb: number
  /**
   * True if this workspace's monthly generation limit has been overridden
   * at the workspace layer (vs. inherited from Global Admin or platform default).
   * Useful for UI to indicate "custom limit" vs "default".
   */
  has_custom_generation_limit: boolean
  /**
   * P2 — The workspace's plan tier.
   * Sourced from workspaces.plan.
   * Defaults to 'professional' if the workspace row cannot be read (fail-open).
   */
  plan: WorkspacePlan
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve the full three-level settings hierarchy for a workspace.
 *
 * @param workspaceId - FK → workspaces.id. Must be a real workspace (not a
 *   legacy user-id-as-workspace string). Callers obtain this from
 *   requireUser().workspaceId (apps/web) or GenerationRequest.workspaceId (CPL).
 *
 * @returns ResolvedWorkspaceSettings — all fields non-null (except
 *   monthly_generation_limit which may legitimately be null when no limit is
 *   configured at any layer).
 *
 * @throws if getWorkspaceSettings() fails for a reason other than "row not
 *   found" (network error, permission error, etc). "Row not found" is treated
 *   as "pure inheritance" (all null overrides) and the call succeeds, returning
 *   Global Admin → Platform Default values.
 */
export async function resolveWorkspaceSettings(
  workspaceId: string
): Promise<ResolvedWorkspaceSettings> {
  // Layer 3: Workspace overrides (may not exist if getOrCreate wasn't called
  // for this workspace yet — treated as all-null in that case)
  const wsResult = await getWorkspaceSettings(workspaceId)
  const ws: Partial<WorkspaceSettingsRow> =
    wsResult.data ?? {}

  // P2 — Fetch workspace.plan for tier resolution.
  // Fails open: if the workspace row cannot be read, 'professional' is used
  // so existing users are never accidentally locked out by a resolver error.
  const workspaceResult = await getWorkspaceById(workspaceId)
  const plan: WorkspacePlan =
    (workspaceResult.data?.plan as WorkspacePlan | undefined) ?? 'professional'

  // Layer 2: Global Admin Settings
  
  const adminRuntime = AdminSettingsService.getAIRuntime()
const adminGov = AdminSettingsService.getGovernancePolicy()

  // Resolution: workspace ?? globalAdmin ?? platformDefault
  //
  // Phase 2 — Runtime Consolidation: fixed three dead (... as any) reads that
  // always evaluated to `undefined`, silently bypassing the Global Admin layer.
  //
  // G1 fix: `(adminRuntime as any)?.defaultProvider` does not exist on
  //   AIRuntimeSettings. Replaced with the first enabled provider sorted by
  //   admin-configured priority (ascending), matching the factory ordering
  //   introduced in Phase 1.
  const adminPreferredProvider: string | undefined = [...adminRuntime.providers]
    .filter(p => p.enabled)
    .sort((a, b) => a.priority - b.priority)[0]?.id

  const preferred_provider =
    ws.preferred_provider ??
    adminPreferredProvider ??
    PLATFORM_DEFAULTS.preferred_provider

  // G2 fix: `(adminRuntime as any)?.mode` does not exist on AIRuntimeSettings.
  //   The correct field is `runtimeMode` (RuntimeMode: 'local' | 'cloud').
  const runtime_mode =
    ws.runtime_mode ??
    adminRuntime.runtimeMode ??
    PLATFORM_DEFAULTS.runtime_mode

  // G3 fix: `(adminGov as any)?.scoreThresholds?.text` — the key 'text' does not
  //   exist on ScoreThresholds. Valid keys are the TaskType literals defined in
  //   governance-config: 'chat' | 'post' | 'carousel' | 'deck' | 'report' | etc.
  //   Using 'chat' as the general-purpose threshold (lowest default = 70), with
  //   quality.scoreThreshold as a secondary admin-level fallback.
  //   The resolved value is divided by 100 to convert from the 0-100 int range
  //   used by governance-config to the 0-1 float range used at runtime.
  const adminGovThreshold: number | undefined =
    adminGov.scoreThresholds?.chat != null
      ? adminGov.scoreThresholds.chat / 100
      : adminGov.quality?.scoreThreshold != null
        ? adminGov.quality.scoreThreshold / 100
        : undefined

  const governance_score_threshold =
    ws.governance_score_threshold ??
    adminGovThreshold ??
    PLATFORM_DEFAULTS.governance_score_threshold

  const monthly_generation_limit =
    ws.monthly_generation_limit !== undefined
      ? ws.monthly_generation_limit
      : PLATFORM_DEFAULTS.monthly_generation_limit

  const asset_storage_limit_mb =
    ws.asset_storage_limit_mb ??
    PLATFORM_DEFAULTS.asset_storage_limit_mb

  return {
    preferred_provider,
    runtime_mode,
    governance_score_threshold,
    monthly_generation_limit,
    asset_storage_limit_mb,
    has_custom_generation_limit: ws.monthly_generation_limit != null,
    plan,
  }
}
