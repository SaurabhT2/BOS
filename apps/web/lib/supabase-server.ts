/**
 * apps/web — Supabase server-side client
 * Next.js-specific: reads cookies from request context.
 * This file stays in apps/web because it depends on next/headers.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cs: any[]) {
          try { cs.forEach(({ name, value, options }: any) => cookieStore.set(name, value, options)); } catch {}
        },
      },
    }
  );
}

export interface RequireUserResult {
  user: any;
  /**
   * FK → workspaces.id, NOT NULL. Resolved from public.users.workspace_id —
   * see @brandos/auth's getCurrentUser()/USER_PROFILE_SELECT for the
   * equivalent client-side mapping. Every route that writes a
   * workspace-scoped row (campaigns, personas, feedback, brand_assets) or
   * calls a CPL brand-memory proxy MUST use this value, not `user.id`.
   *
   * P0 — Implementation Wave 1A: workspaceId is no longer a synonym for
   * user.id. It is a real FK resolved once per request here.
   */
  workspaceId: string;
  /**
   * Platform-wide administrator flag, resolved from
   * public.users.is_platform_admin. Most routes do not need this — it is
   * provided for routes that have their own (non-requireAdmin) admin checks.
   * See apps/web/lib/admin/require-admin.ts for the dedicated admin gate.
   */
  isPlatformAdmin: boolean;
  supabase: any;
  unauthorized: null;
}

export interface RequireUserUnauthorized {
  user: null;
  workspaceId: null;
  isPlatformAdmin: null;
  supabase: null;
  unauthorized: true;
}

/**
 * Require an authenticated user with a resolved workspace. Call without
 * arguments from route handlers.
 *
 * Returns { user, workspaceId, isPlatformAdmin, supabase, unauthorized: null }
 * on success. Returns { user: null, workspaceId: null, isPlatformAdmin: null,
 * supabase: null, unauthorized: true } if:
 *   - There is no active session, OR
 *   - The public.users profile row for this user does not exist yet.
 *
 * P0 — WORKSPACE FOUNDATION (Implementation Wave 1A): the second condition
 * is intentional. workspaceId has no fallback value (unlike `user.id`, it
 * cannot be derived from the JWT alone) — every workspace-scoped write
 * (campaigns, personas, feedback, brand_assets, brand-memory) requires a
 * real workspaces.id. Under the clean target architecture, the signup
 * trigger creates public.users + workspaces + workspace_settings in one
 * transaction, so a session without a profile row should be rare and
 * transient (the brief window between auth.users insert and the trigger
 * completing). Treating it as unauthorized — rather than returning a route
 * with `user` set but `workspaceId` missing/undefined — keeps every caller's
 * destructured shape uniform and prevents a class of "workspaceId is
 * undefined" bugs at every one of requireUser()'s 13 call sites.
 *
 * SIGNUP-TRIGGER RACE: the DB-side trigger that creates public.users +
 * workspaces + workspace_settings runs asynchronously after auth.users
 * insert. The very first request after signup — typically the redirect
 * from /auth/callback straight to /workspace — can land before that
 * trigger commits. Previously this returned `unauthorized: true`
 * immediately, with no retry: every route built on requireUser() (and the
 * client code reacting to its 401s, e.g. the workspace page's onboarding
 * check) treated that as either "logged out" or a swallowed network
 * error, so the onboarding redirect for brand-new users could silently
 * never fire. The retry below covers that brief, well-understood window;
 * it is not a general substitute for fixing slow triggers.
 */
const PROFILE_LOOKUP_RETRIES = 3;
const PROFILE_LOOKUP_RETRY_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function requireUser(): Promise<RequireUserResult | RequireUserUnauthorized> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    // No session at all — not the signup-trigger race. Don't retry.
    return { user: null, workspaceId: null, isPlatformAdmin: null, supabase: null, unauthorized: true };
  }

  let profile: { workspace_id: string; is_platform_admin: boolean } | null = null;
  let profileError: unknown = null;

  for (let attempt = 0; attempt <= PROFILE_LOOKUP_RETRIES; attempt++) {
    const { data, error: err } = await supabase
      .from('users')
      .select('workspace_id, is_platform_admin')
      .eq('id', user.id)
      .single();

    profile = data;
    profileError = err;

    if (data && !err) break;
    if (attempt < PROFILE_LOOKUP_RETRIES) await sleep(PROFILE_LOOKUP_RETRY_DELAY_MS);
  }

  if (profileError || !profile) {
    return { user: null, workspaceId: null, isPlatformAdmin: null, supabase: null, unauthorized: true };
  }

  return {
    user,
    workspaceId: profile.workspace_id as string,
    isPlatformAdmin: profile.is_platform_admin as boolean,
    supabase,
    unauthorized: null,
  };
}


