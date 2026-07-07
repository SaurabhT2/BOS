/**
 * apps/web/app/api/internal/runtime-verify/provider/route.ts
 *
 * GET /api/internal/runtime-verify/provider
 *
 * Verify: provider resolution, provider selection, provider propagation.
 *
 * Query params:
 *   ?force=<id>   — force a specific provider for the live probe
 *
 * No business logic here — delegates to verifyProvider().
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRuntimeVerifySecret } from '@/lib/internal/require-runtime-verify-secret'
import { verifyProvider } from '@/lib/internal/runtime-verify-service'
import { classifyTransientError, statusForTransientError } from '@/lib/internal/runtime-verify-errors'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = requireRuntimeVerifySecret(req)
  if (!auth.ok) return auth.response

  const forceProvider = req.nextUrl.searchParams.get('force') ?? undefined

  try {
    const result = await verifyProvider({ forceProvider })
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
