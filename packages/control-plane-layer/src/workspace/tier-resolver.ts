/**
 * @brandos/control-plane-layer — workspace/tier-resolver.ts
 *
 * P2 — Explorer / Professional / Executive Tiering
 *
 * Single source of truth for tier-based capability defaults.
 * Resolves workspace.plan → concrete limits, applying workspace_settings
 * overrides on top for Executive workspaces (and limited overrides for
 * Professional).
 *
 * AUTHORITY: workspace.plan (from workspaces table) — never user.plan.
 *
 * RESOLUTION ORDER:
 *   1. workspace_settings[key]  → if not null (Executive custom / Professional override)
 *   2. TIER_DEFAULTS[plan][key] → always present (Explorer / Professional / Executive base)
 *
 * FAIL-SAFE: All tier resolution fails open. If workspace.plan is unknown or
 * any lookup fails, Professional defaults are used (generous, never blocks
 * legitimate users due to a resolver bug).
 *
 * ARCHITECTURE NOTE: This module lives inside CPL's workspace/ directory
 * rather than in a separate @brandos/tier-config package. The design doc
 * allows both options — the single-package approach avoids an additional
 * build step while keeping the same public API. If the tier config grows
 * significantly, extraction to a standalone package is straightforward.
 */

import type { WorkspacePlan } from '@brandos/contracts'
import type { ResolvedWorkspaceSettings } from './settings-resolver'

// ─── Tier Defaults ────────────────────────────────────────────────────────────

/**
 * TierDefaults — the full capability set for a single plan tier.
 * All values represent "out of the box" limits before any workspace-level
 * override is applied.
 */
export interface TierDefaults {
  /** Monthly generation limit (number of campaigns). null = unlimited. */
  monthlyGenerations: number | null
  /** Asset storage limit in MB. null = unlimited. */
  assetStorageMb: number | null
  /** Monthly asset upload count limit. null = unlimited. */
  monthlyUploadCount: number | null
  /** Maximum governance repair attempts per artifact. */
  repairAttempts: number
  /** Whether richness-retry (re-generation on low richness score) is enabled. */
  richnessRetryEnabled: boolean
  /** Artifact types allowed for this tier. */
  allowedArtifactTypes: ReadonlyArray<string>
  /** Whether workspace settings overrides are permitted (governance threshold, provider, mode). */
  workspaceSettingsEnabled: boolean
  /** Whether governance score threshold override is permitted. */
  governanceOverrideEnabled: boolean
  /** Maximum configurable repair attempts (Executive only). */
  maxConfigurableRepairAttempts: number
}

/**
 * TIER_DEFAULTS — canonical tier limit table.
 *
 * Matches the P2 design specification exactly:
 *   Explorer: 25 gen/mo, 100 MB, 10 uploads/mo, carousel+post only, 1 repair
 *   Professional: 200 gen/mo, 2 GB, 100 uploads/mo, all types, 3 repairs
 *   Executive: 2000 gen/mo (default), 20 GB (default), unlimited uploads, all types, configurable
 */
export const TIER_DEFAULTS: Record<WorkspacePlan, TierDefaults> = {
  explorer: {
    monthlyGenerations:          25,
    assetStorageMb:              100,        // 100 MB
    monthlyUploadCount:          10,
    repairAttempts:              1,          // reduced to limit LLM spend on free tier
    richnessRetryEnabled:        false,
    allowedArtifactTypes:        ['carousel', 'post'],
    workspaceSettingsEnabled:    false,
    governanceOverrideEnabled:   false,
    maxConfigurableRepairAttempts: 1,
  },
  professional: {
    monthlyGenerations:          200,
    assetStorageMb:              2048,       // 2 GB
    monthlyUploadCount:          100,
    repairAttempts:              3,          // platform default
    richnessRetryEnabled:        true,
    allowedArtifactTypes:        ['carousel', 'deck', 'report', 'post'],
    workspaceSettingsEnabled:    true,
    governanceOverrideEnabled:   true,
    maxConfigurableRepairAttempts: 3,
  },
  executive: {
    monthlyGenerations:          2000,       // default; overridable via workspace_settings
    assetStorageMb:              20480,      // 20 GB default; overridable
    monthlyUploadCount:          null,       // unlimited
    repairAttempts:              3,          // default; configurable 1–5
    richnessRetryEnabled:        true,
    allowedArtifactTypes:        ['carousel', 'deck', 'report', 'post'],
    workspaceSettingsEnabled:    true,
    governanceOverrideEnabled:   true,
    maxConfigurableRepairAttempts: 5,
  },
}

// ─── Resolved Tier Limits ─────────────────────────────────────────────────────

/**
 * ResolvedTierLimits — the fully resolved capability set for a workspace.
 * Combines TIER_DEFAULTS with any workspace_settings overrides.
 * All consumers use this shape; never read TIER_DEFAULTS directly at call sites.
 */
export interface ResolvedTierLimits extends TierDefaults {
  /** The plan this resolution is based on. */
  plan: WorkspacePlan
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

/**
 * resolveTierLimits — apply workspace_settings overrides on top of tier defaults.
 *
 * Called by limits-checker.ts and artifact-pipeline.ts. Accepts the workspace
 * plan + the already-resolved ResolvedWorkspaceSettings (which contains the
 * workspace_settings overlay).
 *
 * @param plan - workspace.plan from the workspaces table.
 * @param settings - Resolved workspace settings (from resolveWorkspaceSettings).
 *   Executive workspaces may have custom generation/storage limits set by a
 *   platform admin via workspace_settings.
 */
export function resolveTierLimits(
  plan: WorkspacePlan | string,
  settings: ResolvedWorkspaceSettings,
): ResolvedTierLimits {
  // Normalise unknown plan values to 'professional' (generous default).
  const safePlan: WorkspacePlan =
    plan === 'explorer' || plan === 'professional' || plan === 'executive'
      ? plan
      : 'professional'

  const defaults = TIER_DEFAULTS[safePlan]

  // Apply workspace_settings overrides.
  // For Executive: monthly_generation_limit and asset_storage_limit_mb
  //   from workspace_settings take precedence over the tier default.
  // For Explorer/Professional: workspace_settings.monthly_generation_limit is
  //   honoured if set by a platform admin (custom limit), but asset_storage_limit_mb
  //   is tier-capped (you cannot give an Explorer workspace more than 100 MB via
  //   workspace_settings — that would bypass the tier model).
  const monthlyGenerations: number | null =
    settings.monthly_generation_limit !== null
      ? settings.monthly_generation_limit   // workspace admin override (all tiers)
      : defaults.monthlyGenerations

  const assetStorageMb: number | null =
    safePlan === 'executive'
      ? settings.asset_storage_limit_mb     // Executive: fully overridable
      : defaults.assetStorageMb             // Explorer/Professional: tier-fixed

  return {
    ...defaults,
    plan:              safePlan,
    monthlyGenerations,
    assetStorageMb,
  }
}

// ─── Artifact Type Gate ───────────────────────────────────────────────────────

/**
 * isArtifactTypeAllowed — check whether a given task/artifact type is permitted
 * for the resolved tier.
 *
 * @param taskType - The task type from the generation request
 *   ('carousel' | 'deck' | 'report' | 'post' | 'campaign').
 * @param limits - Resolved tier limits for the current workspace.
 */
export function isArtifactTypeAllowed(
  taskType: string,
  limits: ResolvedTierLimits,
): boolean {
  // 'campaign' and 'post' are treated equivalently.
  const normalised = taskType === 'campaign' ? 'post' : taskType
  return limits.allowedArtifactTypes.includes(normalised)
}

// ─── Structured Error Payload ─────────────────────────────────────────────────

/**
 * TierGateError — the structured error shape returned when a tier gate blocks
 * a request. Routes serialize this as the response body.
 */
export interface TierGateError {
  /** Machine-readable error code */
  code: 'TIER_GATE'
  /** Human-readable reason */
  reason: string
  /** The plan required to unlock this feature */
  tierRequired: WorkspacePlan
  /** The workspace's current plan */
  currentPlan: WorkspacePlan
  /** Upgrade CTA hint for the UI */
  upgradeCta: string
}

/**
 * buildArtifactTypeGateError — construct the structured error for artifact type
 * gates. Returns a payload that routes can serialize directly as a 403 body.
 */
export function buildArtifactTypeGateError(
  taskType: string,
  currentPlan: WorkspacePlan,
): TierGateError {
  const planLabel: Record<WorkspacePlan, string> = {
    explorer:     'Explorer',
    professional: 'Professional',
    executive:    'Executive',
  }
  return {
    code:        'TIER_GATE',
    reason:      `${taskType.charAt(0).toUpperCase()}${taskType.slice(1)} generation requires Professional or above.`,
    tierRequired: 'professional',
    currentPlan,
    upgradeCta:  `Upgrade to Professional to unlock Deck, Report, and all artifact types.`,
  }
}

/**
 * buildGenerationLimitError — construct the structured error for generation
 * quota gates.
 */
export function buildGenerationLimitError(
  used: number,
  limit: number,
  currentPlan: WorkspacePlan,
): TierGateError {
  const isExplorer = currentPlan === 'explorer'
  return {
    code:        'TIER_GATE',
    reason:      `Monthly generation limit reached (${used}/${limit}). Resets on the 1st of next month.`,
    tierRequired: isExplorer ? 'professional' : 'executive',
    currentPlan,
    upgradeCta:  isExplorer
      ? `Upgrade to Professional for 200 generations per month.`
      : `Contact us to increase your Executive workspace limit.`,
  }
}

/**
 * buildStorageLimitError — construct the structured error for asset storage
 * quota gates.
 */
export function buildStorageLimitError(
  usedMb: number,
  limitMb: number,
  currentPlan: WorkspacePlan,
): TierGateError {
  const isExplorer = currentPlan === 'explorer'
  return {
    code:        'TIER_GATE',
    reason:      `Asset storage limit reached (${usedMb.toFixed(1)}/${limitMb} MB).`,
    tierRequired: isExplorer ? 'professional' : 'executive',
    currentPlan,
    upgradeCta:  isExplorer
      ? `Upgrade to Professional for 2 GB of asset storage.`
      : `Contact us to increase your Executive storage limit.`,
  }
}

/**
 * buildUploadCountLimitError — construct the structured error for monthly
 * upload count gates.
 */
export function buildUploadCountLimitError(
  used: number,
  limit: number,
  currentPlan: WorkspacePlan,
): TierGateError {
  const isExplorer = currentPlan === 'explorer'
  return {
    code:        'TIER_GATE',
    reason:      `Monthly upload limit reached (${used}/${limit} uploads). Resets on the 1st of next month.`,
    tierRequired: isExplorer ? 'professional' : 'executive',
    currentPlan,
    upgradeCta:  isExplorer
      ? `Upgrade to Professional for 100 uploads per month.`
      : `Contact us to increase your Executive upload limit.`,
  }
}
