// ============================================================
// @brandos/auth — src/auth/authService.ts
//
// ALL SUPABASE AUTH OPERATIONS
//
// ARCHITECTURAL ROLE:
//   Pure functions — no state, no React, no side effects beyond Supabase calls.
//   All functions return { data?, error } — never throw.
//   The AuthProvider React context calls these functions and manages state.
//
// AGENT GUIDANCE:
//   - mapToAuthUser() is the SINGLE mapping point from Supabase user → AuthUser.
//     If the AuthUser shape changes in @brandos/contracts, update here only.
//   - All functions are also exported via the `authService` namespace object
//     for callers that prefer the namespaced API (e.g. server-side code).
//   - onAuthStateChange returns an unsubscribe function — always call it on
//     component unmount to prevent memory leaks and stale callbacks.
//
// IMPLEMENTS: IAuthOperations from src/IAuth.ts
// ============================================================

import { supabase } from './supabaseClient';
import { authConfig } from '../config';
import type { AuthUser, LoginCredentials, SignupCredentials, AuthSession, ProfileRetryOptions } from '@brandos/contracts';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';

// ── Helper: map Supabase user + optional profile → AuthUser ──────────────
//
// This is the canonical mapping function. Priority order for each field:
//   name:      public.users.name → user_metadata.full_name → null
//   avatarUrl: public.users.avatar_url → user_metadata.avatar_url → null
//   plan:      public.users.plan → 'free' (safe default for new users)
//
// The `profile` parameter comes from a direct query on public.users.
// It may be null/undefined when:
//   1. The trigger that creates the public.users row hasn't fired yet
//      (race condition on signup — the auth event fires before the trigger).
//   2. The profile query failed (network error, RLS block).
// In both cases we fall back to user_metadata, which Supabase populates
// from the OAuth provider (for Google) or the signup options.data field.

interface UserProfile {
  name: string | null;
  avatar_url: string | null;
  plan: string | null;
  workspace_id: string;
  is_platform_admin: boolean;
}

/**
 * Map a Supabase auth user + public.users profile row to an AuthUser.
 *
 * `profile` is REQUIRED (not optional) — workspaceId and isPlatformAdmin
 * have no fallback source (they are not present in JWT user_metadata), so
 * every call site must have a real public.users row before calling this.
 * All four call sites (signUpWithEmail/signInWithEmail via getCurrentUser,
 * getCurrentUser, getSession, onAuthStateChange) fetch the profile first —
 * see those functions for how they handle the "row not found yet" case.
 */
function mapToAuthUser(supabaseUser: User, profile: UserProfile): AuthUser {
  return {
    id:        supabaseUser.id,
    email:     supabaseUser.email ?? '',
    name:      profile.name ?? (supabaseUser.user_metadata?.['full_name'] as string | undefined) ?? null,
    avatarUrl: profile.avatar_url ?? (supabaseUser.user_metadata?.['avatar_url'] as string | undefined) ?? null,
    // Cast through unknown to satisfy the UserPlan union — Supabase returns string.
    // EDGE CASE: If an invalid plan value is in the DB, this defaults to 'free'.
    plan:      ((['free', 'premium', 'enterprise'].includes(profile.plan ?? ''))
                  ? profile.plan
                  : 'free') as AuthUser['plan'],
    workspaceId:     profile.workspace_id,
    isPlatformAdmin: profile.is_platform_admin,
    createdAt: supabaseUser.created_at,
  };
}

const USER_PROFILE_SELECT = 'name, avatar_url, plan, workspace_id, is_platform_admin';

// ─────────────────────────────────────────────────────────────────────────────
// SIGNUP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new user account with email + password.
 *
 * EDGE CASE — email confirmation flow:
 *   If Supabase is configured to require email confirmation (default in hosted
 *   projects), signUp() returns a user with an unconfirmed email but a null
 *   session. The user must click the confirmation link before they can sign in.
 *   The AuthProvider handles the subsequent SIGNED_IN event automatically.
 *
 * EDGE CASE — duplicate email:
 *   Supabase returns a user object (not an error) for duplicate emails when
 *   email confirmation is ON, to prevent email enumeration attacks.
 *   The duplicate user will not receive a confirmation email though.
 */
export async function signUpWithEmail({ email, password, name }: SignupCredentials): Promise<{
  user: AuthUser | null;
  error: string | null;
}> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // full_name is stored in user_metadata — synced to public.users by the DB trigger
      data: { full_name: name },
      emailRedirectTo: `${authConfig.appUrl}${authConfig.redirects.afterConfirm}`,
    },
  });

  if (error) return { user: null, error: error.message };
  if (!data.user) return { user: null, error: 'Signup failed — no user returned.' };

  // mapToAuthUser requires a public.users profile row (workspaceId,
  // isPlatformAdmin have no fallback). The signup trigger creates that row
  // — and its workspace — in the same transaction as auth.users, so
  // getCurrentUser() can resolve the full AuthUser immediately when a
  // session was issued (email confirmation OFF). If email confirmation is
  // ON, data.session is null and getCurrentUser() correctly returns
  // { user: null, error: null } — the UI should show "check your email".
  return await getCurrentUser();
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGN IN — Email + Password
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sign in with email + password.
 * On success, Supabase writes the session to cookies (via createBrowserClient).
 * The onAuthStateChange listener in AuthProvider fires with the new session.
 *
 * EDGE CASE — unconfirmed email:
 *   Supabase returns "Email not confirmed" error if the user hasn't clicked
 *   the confirmation link. Bubble this error to the UI — do not auto-resend.
 */
export async function signInWithEmail({ email, password }: LoginCredentials): Promise<{
  user: AuthUser | null;
  error: string | null;
}> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { user: null, error: error.message };
  if (!data.user) return { user: null, error: 'Login failed — no user returned.' };

  // See signUpWithEmail — mapToAuthUser requires the full profile row.
  return await getCurrentUser();
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGN IN — Google OAuth
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initiate Google OAuth sign-in.
 *
 * This call REDIRECTS the browser — it never returns a user directly.
 * After Google authenticates the user, it redirects to /auth/callback
 * with a `code` query parameter. The GET handler in callback-route.ts
 * exchanges that code for a Supabase session.
 *
 * EDGE CASE: error is non-null only if the Supabase OAuth initiation fails
 * (bad client ID, provider disabled in Supabase dashboard, network error).
 * Google-side errors (wrong password, account blocked) land on /auth/callback
 * as error query params — handle those separately.
 *
 * PREREQUISITE: The redirect URL (`${appUrl}/auth/callback`) MUST be added
 * to the Supabase project's "Redirect URLs" allowlist in Auth → URL Configuration.
 */
export async function signInWithGoogle(): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${authConfig.appUrl}${authConfig.redirects.oauthCallback}`,
    },
  });

  return { error: error?.message ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGN IN — Magic Link (passwordless OTP)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a one-time-password (OTP) magic link to the given email.
 *
 * The user clicks the link → Supabase validates the OTP → redirects to
 * authConfig.redirects.afterConfirm → AuthProvider's onAuthStateChange fires.
 *
 * EDGE CASE: Returns { error: null } even for unknown emails (prevents
 * email enumeration — same protection as sendPasswordReset).
 *
 * RATE LIMITING: Supabase rate-limits OTP sends per email per minute.
 * The error "Email rate limit exceeded" should be caught and shown to the user.
 */
export async function signInWithMagicLink(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${authConfig.appUrl}${authConfig.redirects.afterConfirm}`,
    },
  });

  return { error: error?.message ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a password reset email.
 *
 * EDGE CASE: Supabase returns success even for non-existent emails (prevents
 * email enumeration). Do not tell the user whether the email exists.
 *
 * EDGE CASE: The reset link expires after 1 hour by default (Supabase setting).
 * After clicking, the user lands with a recovery session — they MUST call
 * updatePassword() within that session window.
 */
export async function sendPasswordReset(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${authConfig.appUrl}/auth/reset-password`,
  });

  return { error: error?.message ?? null };
}

/**
 * Update the current user's password.
 *
 * REQUIRES: An active recovery session (set by clicking the reset link) OR
 * a regular authenticated session (for "change password while logged in" flow).
 *
 * EDGE CASE: "Auth session missing" error means this was called without
 * a valid session context. Redirect the user to the login page.
 *
 * EDGE CASE: Supabase enforces password strength rules configured in the
 * Auth → Password settings panel. Weak passwords return a validation error.
 */
export async function updatePassword(newPassword: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  return { error: error?.message ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGN OUT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sign out the current user.
 *
 * This invalidates the session on Supabase's side AND clears the local
 * session cookie (createBrowserClient handles the cookie deletion).
 *
 * EDGE CASE: If the network is offline, the local cookie is still cleared
 * but the server-side session may linger until it expires. This is acceptable
 * — the JWT's expiry is the security boundary, not the server-side session record.
 *
 * NOTE: The AuthProvider.logout() wrapper calls signOut() then sets user to null
 * and redirects. Do not call window.location.href here — keep this pure.
 */
export async function signOut(): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signOut();
  return { error: error?.message ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION / USER RETRIEVAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SIGNUP-TRIGGER RACE (shared by getSession and getCurrentUser below): the
 * DB trigger that creates a user's public.users row (plus workspaces +
 * workspace_settings) runs asynchronously after auth.users insert. The
 * very first profile lookup after signup can land just before that
 * trigger commits. Both functions below retry the profile lookup a few
 * times over a short window to cover that gap, rather than treating a
 * momentarily-missing row as a permanently logged-out user.
 *
 * Retry count/delay are parameters (not hardcoded) so callers — and
 * tests exercising the "profile never appears" path — can override them
 * (e.g. { retries: 0 } or { delayMs: 0 }) instead of waiting on real
 * timers. Production code paths don't need to pass these; the defaults
 * below apply. The ProfileRetryOptions shape lives in @brandos/contracts
 * (not declared locally) so IAuth.ts can reference it without importing
 * from this implementation file.
 */
const PROFILE_LOOKUP_RETRIES = 3;
const PROFILE_LOOKUP_RETRY_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get the current raw Supabase session.
 *
 * Use this in server-side route handlers that need the raw JWT.
 * For React components, use useAuth().user instead.
 *
 * EDGE CASE: Returns { session: null, error: null } when there is no active
 * session (user is logged out). This is NOT an error condition.
 *
 * Like getCurrentUser(), this fetches the public.users profile row before
 * calling mapToAuthUser() — workspaceId and isPlatformAdmin have no JWT
 * fallback. If the profile row is not yet present (signup-trigger race),
 * this retries a few times (see PROFILE_LOOKUP_RETRIES above) before
 * returning { session: null, error: 'User profile not found.' } rather
 * than a session with a fabricated/empty workspaceId.
 */
export async function getSession(
  options: ProfileRetryOptions = {}
): Promise<{
  session: AuthSession | null;
  error: string | null;
}> {
  const retries = options.retries ?? PROFILE_LOOKUP_RETRIES;
  const delayMs = options.delayMs ?? PROFILE_LOOKUP_RETRY_DELAY_MS;

  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) return { session: null, error: error?.message ?? null };

  let profile: UserProfile | null = null;
  let profileError: { message: string } | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { data, error: err } = await supabase
      .from('users')
      .select(USER_PROFILE_SELECT)
      .eq('id', session.user.id)
      .single();

    profile = data as UserProfile | null;
    profileError = err;

    if (data && !err) break;
    if (attempt < retries) await sleep(delayMs);
  }

  if (profileError || !profile) {
    return { session: null, error: profileError?.message ?? 'User profile not found.' };
  }

  // Map Supabase Session to our AuthSession shape
  const authSession: AuthSession = {
    access_token:  session.access_token,
    refresh_token: session.refresh_token,
    expires_at:    session.expires_at,
    user:          mapToAuthUser(session.user, profile as UserProfile),
  };

  return { session: authSession, error: null };
}

/**
 * Get the current user with their public profile merged in.
 *
 * Makes 2 Supabase calls:
 *   1. getSession() — reads the auth cookie to get the raw session
 *   2. .from('users').select() — fetches name/avatar/plan from public.users
 *
 * The profile query may return null if:
 *   - The DB trigger that creates the row hasn't fired yet (signup race)
 *   - RLS is blocking the read (should not happen with anon key + own row)
 * In these cases, mapToAuthUser falls back to user_metadata.
 *
 * PERFORMANCE: This function is called once on mount by AuthProvider.
 * It is NOT called on every render — the AuthProvider caches the result
 * in React state. Don't call this in tight loops.
 *
 * SIGNUP-TRIGGER RACE: because this only runs once on mount and the
 * result is cached for the rest of the session, losing this race used to
 * leave `useAuth().user` stuck at `null` until a manual page refresh —
 * silently breaking every client flow keyed on the logged-in user
 * (including the post-signup onboarding redirect). The retry loop below
 * (PROFILE_LOOKUP_RETRIES, declared above getSession) covers the brief
 * window between auth.users insert and the trigger completing
 * public.users/workspaces/workspace_settings; it is not a substitute for
 * fixing a slow trigger.
 */
export async function getCurrentUser(
  options: ProfileRetryOptions = {}
): Promise<{
  user: AuthUser | null;
  error: string | null;
  /**
   * ONBOARDING REGRESSION FIX: true when a valid Supabase session/JWT exists
   * but the public.users profile row still wasn't found after the full retry
   * budget (signup-trigger race outlasted PROFILE_LOOKUP_RETRIES). false/
   * undefined for every other case, including a genuine "no session at all"
   * (real sign-out) — those return early above and never reach the profile
   * lookup, so this field is never set on that path.
   *
   * This is additive and optional — existing callers that destructure only
   * `{ user, error }` are unaffected. AuthProvider uses this to schedule one
   * bounded re-check rather than permanently latching the user out when the
   * only thing that happened was a slow DB trigger on a brand-new sign-in.
   */
  sessionExistsButProfileMissing?: boolean;
}> {
  const retries = options.retries ?? PROFILE_LOOKUP_RETRIES;
  const delayMs = options.delayMs ?? PROFILE_LOOKUP_RETRY_DELAY_MS;

  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !session?.user) {
    // No session at all — this is a real "not logged in", not the signup race.
    return { user: null, error: sessionError?.message ?? null };
  }

  const supabaseUser = session.user;

  // Fetch the extended profile from public.users
  // EDGE CASE: .single() returns an error if 0 rows found — treat as "not ready yet"
  // rather than passing a null profile to mapToAuthUser (workspaceId has no
  // fallback). The signup trigger creates this row + its workspace in the
  // same transaction as auth.users; the retry loop below covers the brief
  // window before that transaction lands.
  let profile: UserProfile | null = null;
  let profileError: { message: string } | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { data, error } = await supabase
      .from('users')
      .select(USER_PROFILE_SELECT)
      .eq('id', supabaseUser.id)
      .single();

    profile = data as UserProfile | null;
    profileError = error;

    if (data && !error) break;
    if (attempt < retries) await sleep(delayMs);
  }

  if (profileError || !profile) {
    // Session is real; only the profile row is missing. Signal this distinctly
    // from "no session" so AuthProvider can retry once more instead of
    // permanently treating a brand-new signup as logged out.
    return {
      user:  null,
      error: profileError?.message ?? 'User profile not found.',
      sessionExistsButProfileMissing: true,
    };
  }

  return {
    user:  mapToAuthUser(supabaseUser, profile as UserProfile),
    error: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH STATE LISTENER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Subscribe to Supabase auth state changes.
 *
 * The callback fires on:
 *   SIGNED_IN     → user signed in (any method)
 *   SIGNED_OUT    → user signed out or session expired
 *   TOKEN_REFRESHED → JWT was refreshed automatically
 *   PASSWORD_RECOVERY → user clicked a password reset link (recovery session)
 *   USER_UPDATED  → user metadata was updated
 *
 * For SIGNED_IN events, we re-fetch the full profile (getCurrentUser) so that
 * name, avatar, and plan are always fresh — not just what's in the JWT.
 *
 * EDGE CASE: This fires once immediately with the current session state on mount.
 * The AuthProvider relies on this initial fire to populate state after a page refresh.
 *
 * MEMORY LEAK: Always call the returned unsubscribe function on component unmount.
 * Multiple active subscriptions accumulate — each fires the callback independently.
 *
 * SIGNUP-TRIGGER RACE (onboarding regression fix): this callback's profile
 * lookup previously made a single .single() call with no retry, while
 * getSession()/getCurrentUser() (used by AuthProvider's init() path) retry
 * PROFILE_LOOKUP_RETRIES times over PROFILE_LOOKUP_RETRY_DELAY_MS each. Both
 * paths race to resolve AuthProvider's initial state (see resolveInitial() in
 * AuthProvider.tsx) — whichever calls back first wins. Because this path had
 * zero retries, it was structurally faster to FAIL than init()'s path was to
 * SUCCEED, so for a genuinely brand-new sign-in (profile row not yet created
 * by the DB trigger), this callback would reliably win the race with a false
 * `null` even when init()'s retry would have eventually found the row. That
 * latched the user into a permanent unauthenticated state for the rest of the
 * session — no later event re-fires SIGNED_IN once the trigger completes —
 * which is why deleting all users and signing in fresh skipped onboarding
 * entirely and showed "Signed out" instead of the real user.
 *
 * This now retries with the same budget as getSession()/getCurrentUser().
 * setTimeout-based sleep() does not call any Supabase client method, so it
 * does not touch the GoTrueClient lock described below and is safe to await
 * inside this callback.
 */
export function onAuthStateChange(callback: (user: AuthUser | null) => void): () => void {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    async (_event: AuthChangeEvent, session: Session | null) => {
      if (!session?.user) {
        callback(null);
        return;
      }

      // FIX: Do NOT call getCurrentUser() (which calls getSession()) here.
      //
      // Root cause: supabase.auth.getSession() calls _acquireLock() internally.
      // onAuthStateChange callbacks are invoked by _notifyAllSubscribers(), which
      // is itself called while the GoTrueClient's lock is already held.
      // Calling getSession() from inside the callback queues in pendingInLock,
      // which only drains AFTER the lock-holder finishes — but the lock-holder
      // is waiting for this async callback to complete first. This is a deadlock:
      // getSession() never resolves → callback never returns → lock never releases
      // → setUser() never called → isLoading stays true permanently.
      //
      // Fix: use the `session` argument Supabase already passed to the callback.
      // It contains the current user — no additional getSession() call needed.
      // We fetch the public.users profile directly (not via getCurrentUser) to
      // get name/avatar/plan without touching the lock.
      const supabaseUser = session.user;

      // Fetch profile from public.users directly — does NOT touch the auth lock.
      // Retries PROFILE_LOOKUP_RETRIES times (same budget as getSession() /
      // getCurrentUser() above) to cover the signup-trigger race rather than
      // racing this faster, single-shot path against their retrying one.
      // .from()/.select()/.single() are plain PostgREST calls — only
      // supabase.auth.* methods touch the GoTrueClient lock, so retrying the
      // profile query here is safe.
      let profile: UserProfile | null = null;
      let profileError: { message: string } | null = null;

      for (let attempt = 0; attempt <= PROFILE_LOOKUP_RETRIES; attempt++) {
        const { data, error } = await supabase
          .from('users')
          .select(USER_PROFILE_SELECT)
          .eq('id', supabaseUser.id)
          .single();

        profile = data as UserProfile | null;
        profileError = error;

        if (data && !error) break;
        if (attempt < PROFILE_LOOKUP_RETRIES) await sleep(PROFILE_LOOKUP_RETRY_DELAY_MS);
      }

      // EDGE CASE: if the row still isn't there after the full retry budget
      // (signup-trigger race genuinely outlasted our wait), call back with
      // null rather than constructing an AuthUser with a missing workspaceId.
      if (profileError || !profile) {
        callback(null);
        return;
      }

      const user: AuthUser = mapToAuthUser(supabaseUser, profile as UserProfile);

      callback(user);
    }
  );

  return () => subscription.unsubscribe();
}

// ─────────────────────────────────────────────────────────────────────────────
// NAMESPACE EXPORT
// Provides a convenient object API for server-side code that can't use
// named imports (e.g. dynamically constructed service objects).
// ─────────────────────────────────────────────────────────────────────────────

export const authService = {
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  signInWithMagicLink,
  sendPasswordReset,
  updatePassword,
  signOut,
  getSession,
  getCurrentUser,
  onAuthStateChange,
} as const;


