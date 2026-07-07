/**
 * apps/web/app/api/internal/runtime-verify/governance/route.ts
 *
 * POST /api/internal/runtime-verify/governance
 *
 * Verify: governance execution, repair execution, threshold evaluation.
 *
 * Side-effecting (runs a clean + an adversarial generation against the live
 * AI runtime + governance pipeline), hence POST rather than GET.
 *
 * Body (all optional):
 *   {
 *     "topic":            string,  // expected-to-pass generation prompt
 *     "adversarialTopic": string,  // expected-to-trigger-repair prompt
 *     "workspaceId":       string,
 *     "userId":            string,
 *     "forceProvider":     string
 *   }
 *
 * No business logic here — delegates to verifyGovernance().
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRuntimeVerifySecret } from '@/lib/internal/require-runtime-verify-secret'
import { verifyGovernance } from '@/lib/internal/runtime-verify-service'
import { readOptionalJsonBody } from '@/lib/internal/read-optional-json-body'
import { classifyTransientError, statusForTransientError } from '@/lib/internal/runtime-verify-errors'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const auth = requireRuntimeVerifySecret(req)
  if (!auth.ok) return auth.response

  const body = await readOptionalJsonBody(req)

  try {
    const result = await verifyGovernance({
      topic: body.topic,
      adversarialTopic: body.adversarialTopic,
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
