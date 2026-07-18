// app/api/feedback/route.ts - Fixed: uses requireUser, adds input validation, adds runtime
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { recordArtifactFeedback } from '@brandos/control-plane-layer'

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

    // EM-3.2 (Cognitive Platform Evolution Program, Milestone 3 — Feedback
    // Capture Forwarding): this used to write only to the local `feedback`
    // table — a direct, high-value satisfaction/quality signal captured
    // and never forwarded anywhere (see the audit's §3.2 table). Forward
    // it now, in addition to the local write (not instead of — the local
    // table may still serve BrandOS-side UI/analytics needs).
    //
    // This local `signal` vocabulary (useful/generic/off_tone/excellent/
    // needs_work) is a satisfaction rating, not an accept/edit/reject
    // ACTION — it doesn't map cleanly onto FeedbackEventType's
    // accepted/edited/rejected/deployed vocabulary (which describes what
    // happened to the artifact, not how the user rated it). Mapping it to
    // 'explicit_feedback' with the rating/note in explicitReason preserves
    // its actual meaning instead of forcing a false equivalence (e.g.
    // 'excellent' is not the same claim as 'accepted').
    //
    // artifactType: this route only has campaignId to work with — the
    // campaigns table has no artifact-type column to look up a more
    // specific value, so 'campaign' is the most accurate value available
    // at this call site, not a placeholder.
    void recordArtifactFeedback({
      userId: user.id,
      artifactId: campaignId,
      artifactType: 'campaign',
      eventType: 'explicit_feedback',
      explicitReason: note ? `${signal}: ${note}` : signal,
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[feedback/route]', error)
    return NextResponse.json({ error: error?.message || 'Failed to save feedback' }, { status: 500 })
  }
}


