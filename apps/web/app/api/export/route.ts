// app/api/export/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { trackServer } from '@/lib/server-analytics'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { user, workspaceId, supabase, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { sourceContent, sourceFormat, channels } = body

    if (!sourceContent || !channels?.length) {
      return NextResponse.json({ error: 'Missing sourceContent or channels' }, { status: 400 })
    }

    // ✅ Fixed: load style from Supabase persona instead of UserStyle.json
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

    const userStyle = persona.visual_style ?? {
      semantic_profile: { primary_domain: persona.domain, tone_fingerprint: [persona.tone] },
      preferences: { tone: persona.tone, engineMode: 'free' },
    }

    const { runExportAgent } = await import('../../../lib/agents/exportAgent')
    const result = await runExportAgent({ sourceContent, sourceFormat, userStyle, channels })

    // Persist export as a campaign record
    const { data: campaign } = await supabase
      .from('campaigns')
      .insert({
        user_id: user.id,
        workspace_id: workspaceId,
        title: `Export — ${channels.join(', ')} — ${new Date().toLocaleDateString()}`,
        topic: sourceContent.slice(0, 120),
        format: `export_${channels[0]}` as any,
        status: 'generated',
        content: result as any,
        persona_id: persona.id,
      })
      .select()
      .single()

    trackServer(user.id, 'export_completed', {
      channels,
      campaign_id: campaign?.id ?? null,
    })

    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    console.error('[export/route]', error)
    return NextResponse.json({ error: error?.message || 'Export failed' }, { status: 500 })
  }
}


