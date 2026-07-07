/**
 * apps/web/app/api/internal/runtime-verify/brand-memory/route.ts
 *
 * POST /api/internal/runtime-verify/brand-memory
 *
 * Verify: Brand Memory OFF path, Brand Memory ON path, identity
 * contribution generation, style projection generation, semantic identity
 * propagation.
 *
 * Side-effecting (runs two real generations against the live AI runtime),
 * hence POST rather than GET.
 *
 * Body (all optional — sensible defaults are used when omitted):
 *   {
 *     "topic":       string,   // prompt to generate from
 *     "workspaceId": string,   // verify a specific workspace instead of the fixture
 *     "userId":      string,   // required alongside workspaceId
 *     "forceProvider": string
 *   }
 *
 * No business logic here — delegates to verifyBrandMemory().
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRuntimeVerifySecret } from '@/lib/internal/require-runtime-verify-secret'
import { verifyBrandMemory } from '@/lib/internal/runtime-verify-service'
import { readOptionalJsonBody } from '@/lib/internal/read-optional-json-body'
import { classifyTransientError, statusForTransientError } from '@/lib/internal/runtime-verify-errors'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const auth = requireRuntimeVerifySecret(req)
  if (!auth.ok) return auth.response

  const body = await readOptionalJsonBody(req)

  try {
    const result = await verifyBrandMemory({
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
