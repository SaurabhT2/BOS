/**
 * apps/web/app/api/internal/runtime-verify/model/route.ts
 *
 * GET /api/internal/runtime-verify/model
 *
 * Verify: configured model, selected model, runtime model propagation.
 *
 * Query params:
 *   ?force=<id>   — force a specific provider for the live probe (so model
 *                   propagation can be checked per-provider, not just the
 *                   currently-active one)
 *
 * No business logic here — delegates to verifyModel().
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRuntimeVerifySecret } from '@/lib/internal/require-runtime-verify-secret'
import { verifyModel } from '@/lib/internal/runtime-verify-service'
import { classifyTransientError, statusForTransientError } from '@/lib/internal/runtime-verify-errors'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = requireRuntimeVerifySecret(req)
  if (!auth.ok) return auth.response

  const forceProvider = req.nextUrl.searchParams.get('force') ?? undefined

  try {
    const result = await verifyModel({ forceProvider })
    return NextResponse.json(result, { status: result.ok ? 200 : 502 })
  } catch (err) {
    const classification = classifyTransientError(err)
    return NextResponse.json(
      {
        ok: false,
        errorKind: classification.kind,
        error: classification.message,
        retryable: classification.retryable,
        retryAfterSeconds: classification.retryAfterSeconds,
        circuitResetMs: classification.circuitResetMs,
      },
      { status: statusForTransientError(classification.kind) }
    )
  }
}
