export const runtime = 'nodejs'

// P0 — Implementation Wave 1A: added requireUser() auth gate and session-scoped
// workspaceId (was unauthenticated with ?? 'default' fallback — see
// control-plane/brand-memory/route.ts doc comment for the same pattern).
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { globalExperimentService } from '@brandos/control-plane-layer'
import type { Experiment } from '@brandos/control-plane-layer'

export async function GET(req: Request) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const stats = searchParams.get('stats') === 'true'

  if (id) {
    const exp = globalExperimentService.getExperiment(id)
    if (!exp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (stats) {
      const expStats = globalExperimentService.getStats(id)
      const winner = globalExperimentService.recommendWinner(id)
      return NextResponse.json({ experiment: exp, stats: Object.fromEntries(expStats), winner })
    }
    return NextResponse.json(exp)
  }

  return NextResponse.json(globalExperimentService.listExperiments(workspaceId))
}

export async function POST(req: Request) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as Omit<Experiment, 'id' | 'created_at' | 'total_samples'>
    // Force workspace_id to the authenticated user's workspace
    const exp = globalExperimentService.createExperiment({ ...body, workspace_id: workspaceId })
    return NextResponse.json(exp)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}

export async function PATCH(req: Request) {
  const { unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as { id: string; action?: string; [key: string]: unknown }
    if (body.action === 'start') {
      const started = globalExperimentService.startExperiment(body.id)
      return NextResponse.json(started ?? { error: 'Not found' })
    }
    if (body.action === 'stop') {
      const stopped = globalExperimentService.stopExperiment(body.id)
      return NextResponse.json(stopped ?? { error: 'Not found' })
    }
    const updated = globalExperimentService.updateExperiment(body.id, body as Partial<Experiment>)
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(updated)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}


