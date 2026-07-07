/**
 * apps/web/app/api/internal/runtime-verify/ping/route.ts
 *
 * GET /api/internal/runtime-verify/ping
 *
 * §0 Verifier Health Check target. Cheap, no-generation reachability +
 * config check: confirms the secret is configured correctly and that the
 * runtime-verify surface is mounted, before the verifier spends any tokens
 * on real checks.
 *
 * Protected by x-runtime-verify-secret like every other route under
 * /api/internal/runtime-verify/*. No business logic here — delegates to
 * pingRuntimeVerify().
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRuntimeVerifySecret } from '@/lib/internal/require-runtime-verify-secret'
import { pingRuntimeVerify } from '@/lib/internal/runtime-verify-service'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = requireRuntimeVerifySecret(req)
  if (!auth.ok) return auth.response

  return NextResponse.json(pingRuntimeVerify())
}
