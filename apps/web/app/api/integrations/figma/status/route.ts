/**
 * GET /api/integrations/figma/status
 *
 * Priority 5 — Figma Export. Unlike Canva, there is no OAuth connection
 * to report on here — the Figma handoff flow has no account-linking step
 * (the plugin runs already-authenticated as whoever is using Figma; it
 * never needs a BrandOS-side credential). This route exists so the
 * Settings → Integrations UI (built generically over both providers in
 * Priority 4) has something to call; it always reports `configured: true`
 * and `connected: true` once this route exists, since "configured" here
 * just means "the handoff endpoint is live," which it now is.
 */

import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'

export const runtime = 'nodejs'

export async function GET() {
  const { unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json({
    configured: true,
    connected: true,
    connected_at: null,
    expires_at: null,
    scopes: [],
    note: 'Figma export uses a plugin handoff, not an account connection. Install the BrandOS Figma Plugin to use it — no connect step needed here.',
  })
}
