/**
 * app/api/v2/artifact/queue/route.ts
 *
 * Live render queue — returns active/recent render jobs.
 * Future: upgrade to SSE streaming endpoint for real-time updates.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  // TODO: Wire to actual render queue service
  // For now: return empty (previously was hardcoded fake data in page component)
  return NextResponse.json({ ok: true, jobs: [] })
}


