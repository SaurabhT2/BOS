/**
 * apps/web/lib/internal/require-runtime-verify-secret.ts
 *
 * Auth guard for `/api/internal/runtime-verify/*`.
 *
 * RUNTIME VERIFICATION V2 — AUTH MODEL:
 *   The V1 verifier (scripts/platform-runtime-verify.ps1) impersonated a
 *   browser session: it expected `Authorization: Bearer <token>` and a
 *   manually-extracted Supabase cookie/workspace id. That never matched the
 *   real runtime (Supabase SSR is cookie-based, and protected routes never
 *   read an Authorization header), so the verifier could not authenticate
 *   even with a valid JWT, and the workflow required opening a browser,
 *   pulling cookies from DevTools, and copying them into env vars by hand
 *   for every run.
 *
 *   V2 replaces session impersonation with a dedicated shared secret. The
 *   verifier (local, CI, or production smoke-test) sends
 *   `x-runtime-verify-secret: <BRANDOS_RUNTIME_VERIFY_SECRET>` and this guard
 *   compares it against the server's configured value. No cookies, no user
 *   session, no browser — the secret is a deploy-time config value (set once
 *   alongside the other CI secrets), not something extracted per run.
 *
 *   This guard is intentionally NOT requireUser()/requireAdmin() — internal
 *   verification routes are server-to-server and must work with zero
 *   Supabase session, which is the entire point of the V2 redesign.
 *
 * Import this in apps/web API routes:
 *   import { requireRuntimeVerifySecret } from '@/lib/internal/require-runtime-verify-secret'
 */

import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

export const RUNTIME_VERIFY_SECRET_HEADER = 'x-runtime-verify-secret'
export const RUNTIME_VERIFY_SECRET_ENV_VAR = 'BRANDOS_RUNTIME_VERIFY_SECRET'

export interface RuntimeVerifyAuthOk {
  ok: true
}

export interface RuntimeVerifyAuthDenied {
  ok: false
  response: NextResponse
}

export type RuntimeVerifyAuthCheck = RuntimeVerifyAuthOk | RuntimeVerifyAuthDenied

/**
 * requireRuntimeVerifySecret — validates the `x-runtime-verify-secret` header
 * against `process.env.BRANDOS_RUNTIME_VERIFY_SECRET`.
 *
 * Returns `{ ok: false, response }` for every failure mode, mirroring the
 * `requireAdmin()` / `AdminAuthCheck` shape used elsewhere in apps/web so
 * route handlers can `return denied.response` uniformly:
 *   - 503 when the server has no secret configured at all (misconfigured
 *     deployment — distinct from "caller didn't send one", so CI can tell
 *     the difference between "I forgot the header" and "ops forgot to set
 *     the secret").
 *   - 401 when the header is missing or does not match.
 *
 * Comparison uses a constant-time check (`crypto.timingSafeEqual`) so the
 * guard does not leak secret length/prefix information via response timing.
 */
export function requireRuntimeVerifySecret(req: NextRequest): RuntimeVerifyAuthCheck {
  const configured = process.env[RUNTIME_VERIFY_SECRET_ENV_VAR]

  if (!configured) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: `Runtime verification is not configured on this deployment — ${RUNTIME_VERIFY_SECRET_ENV_VAR} is not set.`,
        },
        { status: 503 }
      ),
    }
  }

  const provided = req.headers.get(RUNTIME_VERIFY_SECRET_HEADER)

  if (!provided || !secretsMatch(provided, configured)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: `Unauthorized — missing or invalid ${RUNTIME_VERIFY_SECRET_HEADER} header.`,
        },
        { status: 401 }
      ),
    }
  }

  return { ok: true }
}

/** Constant-time secret comparison. Equal-length buffers required by timingSafeEqual. */
function secretsMatch(provided: string, configured: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(configured)
  if (a.length !== b.length) {
    // Still run a same-shaped comparison so callers can't distinguish a
    // length mismatch from a content mismatch by timing.
    timingSafeEqual(Buffer.from(a.toString('hex').padEnd(64, '0')), Buffer.from(a.toString('hex').padEnd(64, '0')))
    return false
  }
  return timingSafeEqual(a, b)
}
