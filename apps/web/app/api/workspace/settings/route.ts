/**
 * apps/web — /api/workspace/settings
 *
 * P0 — Implementation Wave 1A (A.4): Workspace settings management.
 * P2 — Tier-aware write guard: Explorer workspaces may not write governance
 *       overrides. Professional/Executive may write all permitted fields.
 *
 * GET   — Return the RESOLVED workspace settings (three-level hierarchy)
 *         plus the raw WorkspaceSettingsRow (override layer only).
 *
 * PATCH — Update one or more workspace setting overrides.
 *         Passing `null` for a field clears the override (reverts to
 *         inheriting from Global Admin / platform default).
 *         P2: Explorer workspaces receive 403 on any PATCH attempt.
 *
 * AUTHENTICATION: requireUser() — workspace_id always from session.
 * OWNERSHIP: A user can only modify their own workspace's settings.
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from '@brandos/auth'
import {
  resolveWorkspaceSettings,
  resolveTierLimits,
} from '@brandos/control-plane-layer'

// ─── GET /api/workspace/settings ─────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [resolved, rawResult] = await Promise.all([
    resolveWorkspaceSettings(workspaceId),
    getWorkspaceSettings(workspaceId),
  ])

  const tierLimits = resolveTierLimits(resolved.plan, resolved)

  return NextResponse.json({
    resolved,
    overrides: rawResult.data ?? null,
    // P2: tell the UI whether this tier can write settings overrides
    canWriteSettings: tierLimits.workspaceSettingsEnabled,
    plan: resolved.plan,
  })
}

// ─── PATCH /api/workspace/settings ───────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // P2: Resolve tier before any write — Explorer cannot write settings overrides
  const resolved   = await resolveWorkspaceSettings(workspaceId)
  const tierLimits = resolveTierLimits(resolved.plan, resolved)

  if (!tierLimits.workspaceSettingsEnabled) {
    return NextResponse.json(
      {
        error: 'Workspace settings overrides require Professional or above.',
        code:  'TIER_GATE',
        tierRequired: 'professional',
        currentPlan:  resolved.plan,
        upgradeCta:   'Upgrade to Professional to customise governance thresholds and provider settings.',
      },
      { status: 403 }
    )
  }

  const body = await req.json().catch(() => ({}))

  // Only accept known override fields; reject anything else silently
  const {
    preferred_provider,
    runtime_mode,
    governance_score_threshold,
    monthly_generation_limit,
    asset_storage_limit_mb,
  } = body

  const updates: Record<string, unknown> = {}
  if ('preferred_provider'         in body) updates.preferred_provider         = preferred_provider         ?? null
  if ('runtime_mode'               in body) updates.runtime_mode               = runtime_mode               ?? null
  if ('governance_score_threshold' in body) updates.governance_score_threshold = governance_score_threshold ?? null
  if ('monthly_generation_limit'   in body) updates.monthly_generation_limit   = monthly_generation_limit   ?? null
  if ('asset_storage_limit_mb'     in body) updates.asset_storage_limit_mb     = asset_storage_limit_mb     ?? null

  // Professional workspaces can write governance/provider overrides but
  // NOT storage/generation limits (those are tier-fixed for Professional).
  // Only Executive workspaces may override generation + storage limits.
  if (!tierLimits.governanceOverrideEnabled || resolved.plan !== 'executive') {
    delete updates.monthly_generation_limit
    delete updates.asset_storage_limit_mb
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data, error } = await updateWorkspaceSettings(workspaceId, updates as any)
  if (error || !data) {
    return NextResponse.json({ error: error ?? 'Update failed' }, { status: 500 })
  }

  const freshResolved = await resolveWorkspaceSettings(workspaceId)
  return NextResponse.json({ resolved: freshResolved, overrides: data })
}
