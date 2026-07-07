/**
 * apps/web/lib/admin/require-admin.ts
 *
 * Next.js implementation of the admin auth guard.
 * Moved here from @brandos/control-plane-layer to keep the package
 * framework-agnostic (no `next` dependency in the library).
 *
 * Import this in apps/web API routes:
 *   import { requireAdmin } from '@/lib/admin/require-admin'
 *
 * P0 — WORKSPACE FOUNDATION (Implementation Wave 1A):
 *   Implements brandos-phase2-design.md §2.5 "Admin model" / Platform Admin
 *   enforcement:
 *     1. Call requireUser() (session check — also resolves workspaceId).
 *     2. Inspect requireUser()'s isPlatformAdmin (sourced from
 *        public.users.is_platform_admin).
 *     3. Return `ok: false` (403) if false.
 *
 *   PRIOR BEHAVIOR (now corrected): this function checked only for a valid
 *   Supabase session and returned `{ ok: true, userId }` for ANY
 *   authenticated user — i.e. authentication was treated as authorization.
 *   All 11 routes that call requireAdmin() (8 under /api/admin/*, 3 under
 *   /api/v2/*) were affected. There is no feature flag — this check is
 *   unconditional (clean-architecture target: pre-launch, no rollout
 *   compatibility layer needed). See MIGRATION_GUIDE.md for the one-time
 *   `is_platform_admin = true` seed required for intended platform admins
 *   BEFORE this lands, or every admin route 403s for everyone.
 *
 *   `req: NextRequest` is retained in the signature for backward
 *   compatibility with all 11 existing call sites — it is no longer used
 *   directly (requireUser() reads cookies via next/headers ambiently,
 *   which works identically in route handlers).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase-server';
import type { AdminAuthCheck } from '@brandos/control-plane-layer';

export type { AdminAuthResult, AdminAuthDenied, AdminAuthCheck } from '@brandos/control-plane-layer';

export async function requireAdmin(_req: NextRequest): Promise<AdminAuthCheck> {
  const { user, workspaceId, isPlatformAdmin, unauthorized } = await requireUser();

  if (unauthorized) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'Unauthorized — authentication required' },
        { status: 401 }
      ),
    };
  }

  if (!isPlatformAdmin) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'Forbidden — platform admin access required' },
        { status: 403 }
      ),
    };
  }

  return { ok: true, userId: user.id, workspaceId };
}


