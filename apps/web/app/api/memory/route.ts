import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { getBrandSummary } from '@brandos/control-plane-layer'
import { updatePersonaProfile } from '@brandos/auth'

export const runtime = 'nodejs'

// GET — load default persona brand summary + campaign stats
// Cleanup Sprint 2: removed getGlobalBrandIntelligenceRuntime — now via CPL proxy.
export async function GET(_req: NextRequest) {
  const { user, workspaceId, supabase, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { data: persona } = await supabase
      .from('personas')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_default', true)
      .single()

    let biSummary: {
      preferred_tone: string | null
      audience: string | null
      industry: string | null
      positioning: string | null
      keywords: string | null
    } = {
      preferred_tone: null,
      audience: null,
      industry: null,
      positioning: null,
      keywords: null,
    }

    if (persona) {
      try {
        // P0 — Implementation Wave 1A: workspaceId is now a real FK
        // (resolved by requireUser() from public.users.workspace_id),
        // not user.id. Pre-P0 this was `workspaceId: user.id`.
        const brandSummary = await getBrandSummary({
          workspaceId,
          personaId: persona.id,
        })
        biSummary = {
          preferred_tone: brandSummary.preferredTone ?? null,
          audience: brandSummary.audience ?? null,
          industry: brandSummary.industry ?? null,
          positioning: brandSummary.positioning ?? null,
          keywords: brandSummary.keywords ?? null,
        }
      } catch {
        biSummary = {
          preferred_tone: persona?.tone ?? null,
          audience: persona?.audience ?? null,
          industry: persona?.domain ?? null,
          positioning: persona?.key_themes?.join(', ') ?? null,
          keywords: (persona?.visual_style as any)?.keywords ?? null,
        }
      }
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('generations_used, plan')
      .eq('id', user.id)
      .single()

    const { count: campaignCount } = await supabase
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    const { data: formatRows } = await supabase
      .from('campaigns')
      .select('format')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    let preferred_format: string | null = null
    if (formatRows?.length) {
      const counts: Record<string, number> = {}
      formatRows.forEach(r => { counts[r.format] = (counts[r.format] || 0) + 1 })
      preferred_format = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    }

    const memory = {
      ...biSummary,
      persona_id: persona?.id ?? null,
      total_generations: userRow?.generations_used ?? 0,
      total_copies: campaignCount ?? 0,
      preferred_format,
    }

    return NextResponse.json({ success: true, memory })
  } catch (error: any) {
    console.error('[memory/GET]', error)
    return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 })
  }
}

// POST — upsert default persona from profile form
// Fix G1: Delegates to @brandos/auth updatePersonaProfile() — auth owns persona writes.
export async function POST(req: NextRequest) {
  const { user, workspaceId, supabase, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { event } = body

    if (!event?.payload) {
      return NextResponse.json({ error: 'Missing event payload' }, { status: 400 })
    }

    const { tone, audience, industry, positioning, keywords } = event.payload

    try {
      const result = await updatePersonaProfile(user.id, workspaceId, { tone, audience, industry, positioning, keywords })
      if (result.error) throw new Error(result.error)
      return NextResponse.json({ success: true, persona: result.data })
    } catch {
      const { data: existing } = await supabase
        .from('personas')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .single()

      // P0 — Implementation Wave 1A: workspace_id is only set on INSERT
      // (new default persona). It is omitted from the UPDATE branch below
      // since PersonaRow.workspace_id is immutable after creation.
      const personaInsertData = {
        user_id: user.id,
        workspace_id: workspaceId,
        name: 'Default Brand Persona',
        tone: tone || 'executive',
        domain: industry || null,
        audience: audience || null,
        key_themes: positioning
          ? positioning.split(',').map((s: string) => s.trim()).filter(Boolean)
          : [],
        visual_style: keywords ? { keywords } : {},
        is_default: true,
      }

      let result
      if (existing?.id) {
        const { workspace_id: _omit, ...personaUpdateData } = personaInsertData
        result = await supabase
          .from('personas').update({ ...personaUpdateData, updated_at: new Date().toISOString() }).eq('id', existing.id).select().single()
      } else {
        result = await supabase
          .from('personas').insert(personaInsertData).select().single()
      }

      if (result.error) {
        return NextResponse.json({ error: result.error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, persona: result.data })
    }
  } catch (error: any) {
    console.error('[memory/POST]', error)
    return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 })
  }
}
