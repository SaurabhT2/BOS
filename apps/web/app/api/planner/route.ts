// app/api/planner/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { user, workspaceId, supabase, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { tone = 'executive' } = body

    const { data: persona, error: personaError } = await supabase
      .from('personas')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_default', true)
      .single()

    if (personaError || !persona) {
      return NextResponse.json(
        { error: 'No brand persona found. Run style analysis first.' },
        { status: 404 }
      )
    }

    const userStyle = {
      ...(persona.visual_style ?? {
        semantic_profile: { primary_domain: persona.domain, tone_fingerprint: [tone] },
        preferences: { tone, engineMode: 'free' },
      }),
      // Pass user_id and workspace_id so planner agent can forward to control plane.
      // P0 — Implementation Wave 1A: workspace_id is now required by
      // runControlPlane — previously plannerAgent.ts derived a "workspaceId"
      // from _user_id with a 'planner' string fallback (the exact
      // workspaceId≡userId conflation P0 removes). _workspace_id is the
      // real FK, resolved by requireUser().
      _user_id: user.id,
      _workspace_id: workspaceId,
    }

    const { data: recentCampaigns } = await supabase
      .from('campaigns')
      .select('title, topic')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5)

    const recentOutputs = (recentCampaigns ?? []).map((c: any) => c.title || c.topic || '')

    const { runPlannerAgent } = await import('../../../lib/agents/plannerAgent')
    // Pass supabase so control plane can use it for DB-backed settings
    const result = await runPlannerAgent(userStyle, tone, recentOutputs, supabase)

    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    console.error('[planner/route]', error)
    return NextResponse.json({ error: error?.message || 'Planner failed' }, { status: 500 })
  }
}


