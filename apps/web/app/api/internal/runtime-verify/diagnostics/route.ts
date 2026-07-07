/**
 * apps/web/app/api/internal/runtime-verify/diagnostics/route.ts
 *
 * GET /api/internal/runtime-verify/diagnostics
 *
 * Cheap, read-mostly combined snapshot. Returns a RuntimeTrace shaped per
 * the Runtime Verification V2 spec's example:
 *   { provider, model, brandMemoryApplied, identityVersion,
 *     governanceScore, artifactPersisted }
 * (governanceScore / artifactPersisted are intentionally absent here — this
 * endpoint never runs governance or persists anything; use /governance and
 * /persistence for those. They stay undefined rather than a misleading 0
 * per the RuntimeTrace contract's design invariant.)
 *
 * Query params:
 *   ?force=<id>   — force a specific provider for the underlying live probe
 *
 * No business logic here — delegates to verifyDiagnostics().
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRuntimeVerifySecret } from '@/lib/internal/require-runtime-verify-secret'
import { verifyDiagnostics } from '@/lib/internal/runtime-verify-service'
import { classifyTransientError, statusForTransientError } from '@/lib/internal/runtime-verify-errors'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = requireRuntimeVerifySecret(req)
  if (!auth.ok) return auth.response

  const forceProvider = req.nextUrl.searchParams.get('force') ?? undefined

  try {
    const result = await verifyDiagnostics({ forceProvider })
    return NextResponse.json(result, { status: result.healthy ? 200 : 502 })
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
