/**
 * apps/web/app/api/internal/runtime-verify/persistence/route.ts
 *
 * POST /api/internal/runtime-verify/persistence
 *
 * Verify: artifact persistence, metadata persistence (provider metadata,
 * model metadata, governance metadata).
 *
 * Side-effecting (runs a real generation and writes + reads back a
 * `campaigns` row, then cleans it up), hence POST rather than GET.
 *
 * Body (all optional):
 *   {
 *     "topic":       string,
 *     "workspaceId": string,
 *     "userId":      string,
 *     "forceProvider": string
 *   }
 *
 * No business logic here — delegates to verifyPersistence().
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRuntimeVerifySecret } from '@/lib/internal/require-runtime-verify-secret'
import { verifyPersistence } from '@/lib/internal/runtime-verify-service'
import { readOptionalJsonBody } from '@/lib/internal/read-optional-json-body'
import { classifyTransientError, statusForTransientError } from '@/lib/internal/runtime-verify-errors'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const auth = requireRuntimeVerifySecret(req)
  if (!auth.ok) return auth.response

  const body = await readOptionalJsonBody(req)

  try {
    const result = await verifyPersistence({
      topic: body.topic,
      workspaceId: body.workspaceId,
      userId: body.userId,
      forceProvider: body.forceProvider,
    })
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
