// app/api/transform/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { user, workspaceId, supabase, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { mode, sourceText: bodySourceText } = body

    if (!mode) {
      return NextResponse.json({ error: 'Missing mode' }, { status: 400 })
    }

    // ✅ Fixed: load persona from Supabase instead of UserStyle.json
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
        semantic_profile: { primary_domain: persona.domain, tone_fingerprint: [persona.tone] },
        preferences: { tone: persona.tone, engineMode: 'free' },
      }),
      // P0 — Implementation Wave 1A: _workspace_id is required by
      // transformAgent.ts's resolveBrandContext() — see its doc comment.
      _workspace_id: workspaceId,
    }

    // sourceText comes from the request body (caller provides content to transform)
    const sourceText = bodySourceText || (userStyle as any)?._meta?.raw_text_sample || ''
    const sourceFilename = body.sourceFilename || 'your document'

    const { runTransformAgent } = await import('../../../lib/agents/transformAgent')
    const result = await runTransformAgent({ mode, sourceText, userStyle, sourceFilename })

    // Persist transform as campaign record
    await supabase
      .from('campaigns')
      .insert({
        user_id: user.id,
        workspace_id: workspaceId,
        title: result.title || `Transform — ${mode} — ${new Date().toLocaleDateString()}`,
        topic: sourceText.slice(0, 120),
        format: `transform_${mode}` as any,
        status: 'generated',
        content: result as any,
        persona_id: persona.id,
      })
      .select()
      .single()

    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    console.error('[transform/route]', error)
    return NextResponse.json({ error: error?.message || 'Transform failed' }, { status: 500 })
  }
}


