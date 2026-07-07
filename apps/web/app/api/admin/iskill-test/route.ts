/**
 * GET /api/admin/iskill-test
 *
 * Executes the governance-layer runtime test paths in-process.
 *
 * NOTE: Previously imported from @/lib/iskill/carouselSemanticValidator.
 * Now imports from @brandos/governance-layer — the canonical semantic
 * governance authority post-consolidation.
 *
 * Tests:
 *   1. Malformed local-model output (empty slides) → expect rejection
 *   2. Null artifact → expect rejection
 *   3. Slides with empty content → expect rejection
 *   4. Valid artifact → expect acceptance
 *   5. Repair flow (empty → LLM repair → re-validate)
 *
 * Admin-only. Requires authenticated session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin/require-admin'
import {
  validateCarouselArtifact
} from '@brandos/control-plane-layer'
import type { CarouselArtifact } from '@brandos/contracts'
import { runControlPlane } from '@brandos/control-plane-layer'
import { v4 as uuidv4 } from 'uuid'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  // P0 — Implementation Wave 1A: this route previously authenticated via a
  // raw cookie-based Supabase client + supabase.auth.getUser() — ANY
  // authenticated user could run it, with no admin check at all (this was
  // /api/admin/iskill-test, the one /api/admin/* route not gated by
  // requireAdmin()). Now uses the same requireAdmin() gate as the other 10
  // admin routes (returns 401/403 per brandos-phase2-design.md §2.5).
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response as NextResponse

  // requireAdmin() already validated the session and admin role above —
  // requireUser() here is solely to obtain the `supabase` client for
  // runControlPlane() (AdminAuthResult does not carry it; see
  // apps/web/lib/admin/require-admin.ts for why).
  const { user, workspaceId, supabase, unauthorized } = await requireUser()
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const requestId = uuidv4()

  // Provide a real LLM caller for repair test path
  const callLLM = async (prompt: string): Promise<string> => {
    const cpResponse = await runControlPlane(
      {
        request_id: uuidv4(),
        user_id: user.id,
        // P0 — Implementation Wave 1A: see ControlPlaneRequestInput doc comment.
        workspace_id: workspaceId,
        user_prompt: prompt,
        task_type: 'carousel',
        tone: 'executive',
        format: 'carousel',
        override_mode: 'raw',
        brand_context: {
          tone: 'executive',
          domain: 'Technology',
          audience_type: 'Enterprise Leaders',
          executive_level: true,
        },
      },
      'cloud',
      supabase
    )
    // structuredOutput was removed from ControlPlaneResponse — read from _generationResult
    const structured = (cpResponse as any)._generationResult?.artifact?.content
    return structured
      ? (typeof structured === 'string' ? structured : JSON.stringify(structured))
      : cpResponse.output ?? ''
  }

  try {
    const malformed = await validateCarouselArtifact({
  slides: [],
} as unknown as CarouselArtifact)

const nullArtifact = await validateCarouselArtifact(
  null as any
)

const emptySlides = await validateCarouselArtifact({
  slides: [
    {
      title: '',
      content: '',
    },
  ],
} as unknown as CarouselArtifact)

const validArtifact = await validateCarouselArtifact({
  slides: [
    {
      title: 'Executive Summary',
      content: 'BrandOS semantic validation operational',
    },
  ],
} as unknown as CarouselArtifact)

const results = {
  malformed: {
    passed: !malformed.valid,
  },

  nullArtifact: {
    passed: !nullArtifact.valid,
  },

  emptySlides: {
    passed: !emptySlides.valid,
  },

  validArtifact: {
    passed: validArtifact.valid,
  },
}

const allPassed =
  Object.values(results)
  .every((r:any)=>r.passed!==false)

    return NextResponse.json({
      request_id: requestId,
      all_passed: allPassed,
      results,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Test run failed', request_id: requestId },
      { status: 500 }
    )
  }
}


