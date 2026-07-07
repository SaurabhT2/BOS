/**
 * app/api/v2/governance/policy/route.ts
 *
 * SINGLE API for all governance and policy configuration.
 * Replaces /api/control-plane/policy/route.ts (was unguarded!)
 * Absorbs /api/admin/settings?section=controlPlane (safety/approval fields)
 *
 * Security fix: now requires admin auth (previous policy route had none).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import {
  PolicyConfigSchema,
  DEFAULT_POLICY_CONFIG,
  validatePolicyPatch,
  validateModelGovernanceConsistency,
} from '@brandos/control-plane-layer'
import { SupabaseAdminSettingsService } from '@brandos/control-plane-layer'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  const snapshot = await SupabaseAdminSettingsService.load()
  const raw = (snapshot as any)?.governance ?? DEFAULT_POLICY_CONFIG

  const result = PolicyConfigSchema.safeParse(raw)
  const config = result.success ? result.data : DEFAULT_POLICY_CONFIG

  return NextResponse.json({ ok: true, data: config })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  try {
    const body = await req.json()
    const patch = body.data ?? body

    // Structural validation
    const validation = validatePolicyPatch(patch)
    if (!validation.valid) {
      return NextResponse.json({
        ok: false, error: 'Validation failed', errors: validation.errors,
      }, { status: 400 })
    }

    // Business rule: cloudProvidersOnly XOR localModelsOnly
    if (patch.modelGovernance) {
      const consistency = validateModelGovernanceConsistency(patch.modelGovernance)
      if (!consistency.valid) {
        return NextResponse.json({
          ok: false, error: 'Governance conflict', errors: consistency.errors,
        }, { status: 400 })
      }
    }

    // Load current, merge
    const snapshot = await SupabaseAdminSettingsService.load()
    const current = PolicyConfigSchema.safeParse((snapshot as any)?.governance)
    const existing = current.success ? current.data : DEFAULT_POLICY_CONFIG

    const merged = PolicyConfigSchema.parse({
      ...existing,
      ...patch,
      modelGovernance: { ...existing.modelGovernance, ...(patch.modelGovernance ?? {}) },
      scoreThresholds: { ...existing.scoreThresholds, ...(patch.scoreThresholds ?? {}) },
      approvalGates:   { ...existing.approvalGates,   ...(patch.approvalGates ?? {}) },
      quality:         { ...existing.quality,          ...(patch.quality ?? {}) },
      updatedAt:       new Date().toISOString(),
      updatedBy:       auth.userId ?? 'unknown',
    })

    const saved = await SupabaseAdminSettingsService.save('governance', merged)
    if (!saved) {
      return NextResponse.json({ ok: false, error: 'Failed to persist settings' }, { status: 500 })
    }

    console.info(`[GovernancePolicy] saved by user=${auth.userId}`)
    return NextResponse.json({ ok: true, data: merged })
  } catch (err) {
    console.error('[GovernancePolicy] save error', err)
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  const reset = {
    ...DEFAULT_POLICY_CONFIG,
    updatedAt: new Date().toISOString(),
    updatedBy: auth.userId ?? 'unknown',
  }

  await SupabaseAdminSettingsService.save('governance', reset)
  console.info(`[GovernancePolicy] reset by user=${auth.userId}`)
  return NextResponse.json({ ok: true, data: reset })
}


