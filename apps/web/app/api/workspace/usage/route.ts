/**
 * apps/web — /api/workspace/usage
 *
 * P2 — Returns current usage metrics vs resolved tier limits for the
 * authenticated workspace. Used by the settings/billing page and any
 * upgrade-gate component that needs to show quota meters.
 *
 * GET — Returns:
 *   plan              — current workspace plan
 *   generations       — { used, limit } (null limit = unlimited)
 *   storage           — { usedMb, limitMb } (null limitMb = unlimited)
 *   uploads           — { used, limit } (null limit = unlimited)
 *   canWriteSettings  — boolean (tier capability)
 *   allowedArtifacts  — string[] (artifact types allowed for this tier)
 *
 * AUTHENTICATION: requireUser() — workspaceId always from session.
 * All counts are workspace-scoped and resolved server-side.
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import {
  getTotalAssetStorageForWorkspace,
  countMonthlyUploadsForWorkspace,
} from '@brandos/auth'
import {
  resolveWorkspaceSettings,
  resolveTierLimits,
} from '@brandos/control-plane-layer'

export async function GET(_req: NextRequest) {
  const { workspaceId, supabase, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Resolve settings + tier limits
    const settings   = await resolveWorkspaceSettings(workspaceId)
    const tierLimits = resolveTierLimits(settings.plan, settings)

    // Current calendar month start (UTC) for generation count
    const now        = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      .toISOString()

    // Fetch all three usage metrics in parallel
    const [genResult, storageResult, uploadResult] = await Promise.all([
      supabase
        .from('campaigns')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .gte('created_at', monthStart),
      getTotalAssetStorageForWorkspace(workspaceId),
      countMonthlyUploadsForWorkspace(workspaceId),
    ])

    const generationsUsed = genResult.count    ?? 0
    const storageBytesUsed = storageResult.data ?? 0
    const uploadsUsed      = uploadResult.data  ?? 0

    return NextResponse.json({
      plan: settings.plan,

      generations: {
        used:  generationsUsed,
        limit: tierLimits.monthlyGenerations,          // null = unlimited
        percentUsed: tierLimits.monthlyGenerations
          ? Math.round((generationsUsed / tierLimits.monthlyGenerations) * 100)
          : null,
      },

      storage: {
        usedBytes: storageBytesUsed,
        usedMb:    parseFloat((storageBytesUsed / (1024 * 1024)).toFixed(2)),
        limitMb:   tierLimits.assetStorageMb,           // null = unlimited
        percentUsed: tierLimits.assetStorageMb
          ? Math.round((storageBytesUsed / (tierLimits.assetStorageMb * 1024 * 1024)) * 100)
          : null,
      },

      uploads: {
        used:  uploadsUsed,
        limit: tierLimits.monthlyUploadCount,           // null = unlimited
        percentUsed: tierLimits.monthlyUploadCount
          ? Math.round((uploadsUsed / tierLimits.monthlyUploadCount) * 100)
          : null,
      },

      capabilities: {
        canWriteSettings:      tierLimits.workspaceSettingsEnabled,
        canOverrideGovernance: tierLimits.governanceOverrideEnabled,
        allowedArtifactTypes:  tierLimits.allowedArtifactTypes,
        repairAttempts:        tierLimits.repairAttempts,
        richnessRetryEnabled:  tierLimits.richnessRetryEnabled,
      },
    })
  } catch (err: any) {
    console.error('[GET /api/workspace/usage]', err)
    return NextResponse.json({ error: err?.message ?? 'Failed to fetch usage' }, { status: 500 })
  }
}
