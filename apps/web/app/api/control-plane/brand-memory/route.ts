export const runtime = 'nodejs'

/**
 * /api/control-plane/brand-memory
 *
 * Option B (cognition-consumer split): this route now proxies ONLY
 * CognitionProvider.observe() — reporting a scored generation outcome to
 * IntelligenceOS. BrandOS no longer reads raw brand-memory signals or
 * passes through human review decisions on them; both belonged to
 * IntelligenceOS's raw-signal review workflow, which does not exist on the
 * BrandOS side of the CognitionProvider contract.
 *
 * Removed in this change:
 *   - GET   (previously getBrandMemory() — raw signal listing; had no
 *     CognitionProvider equivalent by design and always returned 501)
 *   - PATCH (previously reviewBrandMemorySignal() — CognitionProvider.review()
 *     passthrough; review() no longer exists on the BrandOS-local contract)
 *
 * - POST → recordBrandMemoryObservation() (CPL proxy → CognitionProvider.observe())
 *
 * P0 — WORKSPACE FOUNDATION (Implementation Wave 1A):
 *   This route previously had NO authentication check (despite
 *   apps/web/lib/IWebApp.ts documenting `authRequired: true` for this path —
 *   that drift is now resolved) and accepted a client-supplied `workspace_id`
 *   on every method, defaulting to the literal 'default' when absent.
 *
 *   FIXED: every method calls requireUser() and uses the AUTHENTICATED
 *   USER'S OWN workspaceId (from public.users.workspace_id via requireUser())
 *   for all calls. A client-supplied `workspace_id` field/param, if present,
 *   is IGNORED — a user can only ever report observations for their own
 *   workspace through this route.
 */

import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { recordBrandMemoryObservation } from '@brandos/control-plane-layer'

export async function POST(req: Request) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as {
      request_id?: string
      output_text?: string
      score?: number
      topic?: string
    }
    await recordBrandMemoryObservation({
      workspaceId,
      requestId:     body.request_id ?? 'manual',
      artifactText:  body.output_text ?? '',
      artifactScore: body.score ?? 0,
      artifactType:  'manual',
      topic:         body.topic ?? 'general',
      wasRepaired:   false,
      observedAt:    new Date().toISOString(),
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
