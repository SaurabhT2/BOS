/**
 * apps/web/app/api/internal/runtime-verify/semantic/route.ts
 *
 * POST /api/internal/runtime-verify/semantic
 *
 * §7 Semantic Verification — runs after Persistence (§5) in the
 * verification pipeline; verifies that a generated artifact is
 * SEMANTICALLY correct, not merely that execution succeeded. Inspects the
 * actual generated artifact and runtime metadata rather than relying
 * solely on HTTP responses.
 *
 * Verifies: topic preservation, Brand Memory ON/OFF correctness (and that
 * it doesn't replace the topic), persona injection, audience resolution,
 * identity contribution, artifact schema conformance, governance score
 * recording + pass/fail, persistence metadata fidelity, RuntimeTrace
 * completeness, and provider/model correctness. See
 * runtime-verify-service.ts's verifySemantic() doc comment for the
 * canary-injection methodology and its honest limitations.
 *
 * Side-effecting (runs two real generations + a real persistence
 * write/read-back/cleanup), hence POST rather than GET.
 *
 * Body (all optional):
 *   {
 *     "topic":       string,
 *     "workspaceId": string,
 *     "userId":      string,
 *     "forceProvider": string
 *   }
 *
 * No business logic here — delegates to verifySemantic().
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRuntimeVerifySecret } from '@/lib/internal/require-runtime-verify-secret'
import { verifySemantic } from '@/lib/internal/runtime-verify-service'
import { readOptionalJsonBody } from '@/lib/internal/read-optional-json-body'
import { classifyTransientError, statusForTransientError } from '@/lib/internal/runtime-verify-errors'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const auth = requireRuntimeVerifySecret(req)
  if (!auth.ok) return auth.response

  const body = await readOptionalJsonBody(req)

  try {
    const result = await verifySemantic({
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
