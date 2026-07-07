// app/api/feedback/route.ts - Fixed: uses requireUser, adds input validation, adds runtime
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { campaignId, signal, note } = body

    if (!campaignId || !signal) {
      return NextResponse.json({ error: 'Missing campaignId or signal' }, { status: 400 })
    }

    const validSignals = ['useful', 'generic', 'off_tone', 'excellent', 'needs_work']
    if (!validSignals.includes(signal)) {
      return NextResponse.json(
        { error: `Invalid signal. Must be one of: ${validSignals.join(', ')}` },
        { status: 400 }
      )
    }

    // Verify campaign ownership — prevents spoofed campaignIds
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .eq('user_id', user.id)
      .single()

    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const { error } = await supabase.from('feedback').insert({
      user_id: user.id,
      campaign_id: campaignId,
      signal,
      note: note ?? null,
      created_at: new Date().toISOString(),
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[feedback/route]', error)
    return NextResponse.json({ error: error?.message || 'Failed to save feedback' }, { status: 500 })
  }
}


