export const runtime = 'nodejs'

/**
 * /api/control-plane/brand-memory
 *
 * Cleanup Sprint 2: replaced 3× direct BI calls with CPL proxy functions.
 * apps/web must not import @brandos/brand-intelligence directly.
 *
 * - GET  → getBrandMemory()       (CPL proxy → BI runtime.getMemory)
 * - POST → recordBrandMemoryObservation() (CPL proxy → BI runtime.recordArtifactObservation)
 * - PATCH → reviewBrandMemorySignal()     (CPL proxy → BI runtime.review)
 *
 * P0 — WORKSPACE FOUNDATION (Implementation Wave 1A):
 *   This route previously had NO authentication check (despite
 *   apps/web/lib/IWebApp.ts documenting `authRequired: true` for this path —
 *   that drift is now resolved) and accepted a client-supplied `workspace_id`
 *   on every method, defaulting to the literal 'default' when absent.
 *   Concretely, this meant: (1) any unauthenticated caller could read or
 *   write brand-memory signals for ANY workspace by supplying its
 *   workspace_id (or for the shared 'default' workspace by supplying none),
 *   and (2) the 'default' literal is exactly the workspace-scoping
 *   anti-pattern this initiative removes elsewhere (see IdentityContributor
 *   fix in packages/output-control-layer).
 *
 *   FIXED: every method now calls requireUser() and uses the AUTHENTICATED
 *   USER'S OWN workspaceId (from public.users.workspace_id via requireUser())
 *   for all BI calls. A client-supplied `workspace_id` field/param, if
 *   present, is IGNORED — a user can only ever read/write their own
 *   workspace's brand memory through this route. There is no
 *   "Platform Admin can specify any workspace_id" override in P0 — Platform
 *   Admin cross-workspace visibility (§2.5, "all workspace visibility") is
 *   not implemented by this route; if/when it is, it should be a SEPARATE
 *   admin-gated route (requireAdmin()), not an optional override on this
 *   user-facing one.
 */

import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import {
  getBrandMemory,
  recordBrandMemoryObservation,
  reviewBrandMemorySignal,
} from '@brandos/control-plane-layer'

export async function GET(req: Request) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const classification = searchParams.get('classification') as 'A' | 'B' | 'C' | null
  try {
    const memory = await getBrandMemory(workspaceId, classification ?? undefined)
    return NextResponse.json(memory)
  } catch (err) {
    // PLATFORM SPLIT / KNOWN GAP: getBrandMemory() has no equivalent under
    // the CognitionProvider contract — see
    // packages/cognition-contract/README.md, "Known contract gaps", item 1.
    // Returns 501 rather than letting the exception surface as a raw 500,
    // so this page's caller can distinguish "not implemented yet" from a
    // real server error once a product decision is made.
    return NextResponse.json(
      { error: 'not_implemented', message: (err as Error).message },
      { status: 501 }
    )
  }
}

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

export async function PATCH(req: Request) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as {
      entry_id?: string
      approved?: boolean
      reviewed_by?: string
    }
    await reviewBrandMemorySignal(
      workspaceId,
      body.entry_id ?? '',
      body.approved ?? false,
      body.reviewed_by ?? 'unknown',
    )
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
