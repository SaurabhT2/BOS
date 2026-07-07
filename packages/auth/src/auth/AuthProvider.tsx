'use client';
// ============================================================
// @brandos/auth — src/auth/AuthProvider.tsx
//
// REACT AUTH CONTEXT — SESSION STATE + ACTIONS
//
// FIX (2026-06-01): isLoading stuck permanently on slow/offline Supabase.
//
// Root causes:
//   1. init() calls getCurrentUser() → getSession() with NO timeout.
//      If Supabase is unreachable, getSession() hangs indefinitely, so
//      isLoading stays true forever and the app shows "Loading..." permanently.
//   2. onAuthStateChange fires immediately on mount with the cached session.
//      If that callback resolves BEFORE init() does, init() then overwrites
//      it with a stale null — causing a flicker or wrong auth state.
//
// Fix:
//   - Race init() against a 4-second deadline via Promise.race.
//     On timeout: fall back to unauthenticated (isLoading=false, user=null).
//     This is safe — middleware already guards /workspace server-side.
//   - Use a `resolved` flag so only the FIRST of {init, onAuthStateChange}
//     to complete sets the initial user. Subsequent events still update state
//     normally (sign-in / sign-out / token refresh).
//   - Init errors are caught and treated as logged-out (never hang).
// ============================================================

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import {
  signInWithEmail,
  signInWithGoogle,
  signInWithMagicLink,
  signUpWithEmail,
  signOut,
  onAuthStateChange,
  getCurrentUser,
  sendPasswordReset,
  updatePassword,
} from './authService';
import { authConfig } from '../config';
import { computeUserLifecycleState } from '../lifecycle/computeUserLifecycleState';
import type { AuthUser, AuthState, LoginCredentials, SignupCredentials, UserLifecycleState } from '@brandos/contracts';

// ── How long to wait for the initial Supabase session check ──
// If getSession() + profile DB fetch has not responded in this time, we treat
// the user as unauthenticated and let the app render. Middleware protects /workspace.
//
// VERCEL COLD-START: supabase.auth.getSession() + public.users profile fetch
// can total 4-8s on Vercel cold starts (Supabase DB in different region,
// cold Postgres connection). 4000ms was too aggressive — it raced against
// the profile DB fetch and resolved null before the real user arrived,
// causing the nav to show "User" instead of the real email and the
// Intelligence tab to hang on "Loading profile…" indefinitely.
//
// 10000ms gives sufficient headroom for cold starts while still unblocking
// the app if Supabase is genuinely unreachable.
const INIT_TIMEOUT_MS = 10_000;

// ── Context shape ─────────────────────────────────────────────────────────────

interface AuthContextValue extends AuthState {
  loginWithEmail:     (creds: LoginCredentials)  => Promise<{ error: string | null }>;
  loginWithGoogle:    ()                          => Promise<{ error: string | null }>;
  loginWithMagicLink: (email: string)            => Promise<{ error: string | null }>;
  signup:             (creds: SignupCredentials)  => Promise<{ error: string | null }>;
  logout:             ()                          => Promise<void>;
  resetPassword:      (email: string)            => Promise<{ error: string | null }>;
  changePassword:     (password: string)         => Promise<{ error: string | null }>;
  clearError:         ()                          => void;
  /**
   * Explicitly recompute userLifecycleState now, rather than waiting for
   * a userId change to trigger it. Needed after any write that changes
   * an input to the lifecycle computation but doesn't itself change
   * which user is signed in — currently just completeOnboarding(). See
   * the ONBOARDING-BOUNCE FIX comment above this function's definition
   * for the full rationale. Always `await` this before navigating to a
   * route whose access depends on the new stage.
   */
  refreshUserLifecycleState: () => Promise<void>;
}

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Provider Props ────────────────────────────────────────────────────────────

interface AuthProviderProps {
  children?: ReactNode;
  onReady?: (user: AuthUser | null) => void;
}

// ── Provider Component ────────────────────────────────────────────────────────

export function AuthProvider({ children, onReady }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    user:               null,
    isLoading:          true,
    isAuthenticated:    false,
    error:              null,
    userLifecycleState: null,
  });

  // ── State setters (internal helpers) ─────────────────────────────────────

  const setUser = useCallback((user: AuthUser | null) => {
    setState(prev => {
      const idChanged = (prev.user?.id ?? null) !== (user?.id ?? null);
      return {
        user,
        isLoading:          false,
        isAuthenticated:    user !== null,
        error:              null,
        // Only reset to null when the user's identity actually changed
        // (sign-in, sign-out, or switching accounts). The lifecycle
        // recompute effect below is keyed on userId, so it only re-fires
        // when userId changes — nulling this out unconditionally on
        // EVERY setUser call (including ongoing events like a token
        // refresh, where the id is unchanged) would null it with no
        // recompute ever scheduled to replace it, permanently sticking
        // the app in "identity unresolved" after the first token
        // refresh. Preserving the prior value across a same-id call is
        // what keeps it correct.
        userLifecycleState: idChanged ? null : prev.userLifecycleState,
      };
    });
  }, []);

  const setError = useCallback((error: string) => {
    setState(prev => ({ ...prev, isLoading: false, error }));
  }, []);

  // ── Initial auth resolution + subscription ────────────────────────────────

  useEffect(() => {
    let mounted = true;

    // FIX: Only the first resolution (init OR onAuthStateChange) sets the
    // initial user. Subsequent events update state normally.
    let initialResolved = false;

    const resolveInitial = (user: AuthUser | null) => {
      if (!mounted || initialResolved) return;
      initialResolved = true;
      setUser(user);
      onReady?.(user);
    };

    // Timeout promise — resolves with null after INIT_TIMEOUT_MS.
    // Prevents Supabase network hangs from locking the app in "Loading..." forever.
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), INIT_TIMEOUT_MS);
    });

    // ONBOARDING REGRESSION FIX: how long to wait before the one bounded
    // re-check below, and how large a retry budget to give that re-check.
    // Kept short — this only needs to cover the tail of the signup-trigger
    // race that PROFILE_LOOKUP_RETRIES (in authService.ts, ~750ms) already
    // mostly covers. This is a single extra attempt, not an open-ended poll.
    const RECHECK_DELAY_MS = 1_500;

    // Init: fetch current session, race against timeout.
    const init = async () => {
      try {
        const result = await Promise.race([
          getCurrentUser(),
          timeoutPromise.then(() => ({ user: null, error: null, sessionExistsButProfileMissing: false })),
        ]);

        // ONBOARDING REGRESSION FIX: a valid session existed but the
        // public.users row genuinely hadn't committed yet even after
        // getCurrentUser()'s own retry budget (signup-trigger race on a
        // brand-new sign-in, worst case with a cold Postgres connection).
        // Previously this latched `null` in immediately via resolveInitial(),
        // which is indistinguishable from a real logout — the workspace
        // page's onboarding check (gated on a successful, non-401
        // /api/persona response) silently swallowed the resulting 401 as a
        // network error and never redirected, and the nav showed
        // "Signed out" for a user who was, in fact, signed in.
        //
        // Fix: don't resolve yet. Wait RECHECK_DELAY_MS — by which point the
        // trigger has had meaningfully more total time to commit — and try
        // getCurrentUser() exactly once more. This is bounded (one extra
        // attempt, not a poll loop) and scoped narrowly: it only fires when
        // the signal explicitly says "session is real, profile is the only
        // thing missing", never for an actual signed-out state.
        if (result.sessionExistsButProfileMissing && !result.user) {
          await new Promise(resolve => setTimeout(resolve, RECHECK_DELAY_MS));
          if (!mounted || initialResolved) return; // a real auth event already won the race
          const retryResult = await getCurrentUser();
          resolveInitial(retryResult.user ?? null);
          return;
        }

        // result is AuthUser | null — either real user or timeout/logged-out null
        resolveInitial(result.user ?? null);
      } catch {
        // getSession error — treat as logged out, never hang
        resolveInitial(null);
      }
    };

    void init();

    // Subscribe to ongoing auth events.
    // FIX: onAuthStateChange fires immediately with the cached session on mount.
    // This races with init() — whichever resolves first wins via resolveInitial().
    // Subsequent events (sign-in, sign-out, token refresh) always update state.
    const unsubscribe = onAuthStateChange((user) => {
      if (!mounted) return;
      if (!initialResolved) {
        // First event wins the initial resolution race
        resolveInitial(user);
      } else {
        // Ongoing auth change (sign-in/out, token refresh) — always update
        setUser(user);
        onReady?.(user);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── User lifecycle state ──────────────────────────────────────────────────
  //
  // Computed as a follow-up async step whenever the resolved user's id
  // changes — deliberately NOT part of the init()/resolveInitial() race
  // above, so it can never reintroduce the "Intelligence tab hangs" /
  // permanent-loading bug that race was built to fix. `userLifecycleState`
  // starts `null` (see setUser) and is filled in here without blocking
  // `isLoading`, which is already `false` by the time this effect fires.
  //
  // `computeUserLifecycleState(null)` for a signed-out user resolves
  // immediately to `{ stage: 'anonymous', ... }` with no Supabase calls.
  const userId = state.user?.id ?? null;

  // Shared by both the automatic (userId-change) recompute below and the
  // explicit refreshUserLifecycleState() action — one application path,
  // so "how a new result gets applied to state" is defined in exactly
  // one place regardless of what triggered the recompute.
  const applyLifecycleResult = useCallback((id: string | null, result: UserLifecycleState) => {
    setState(prev => {
      // Guard against a stale resolution racing a newer user-id change
      // (e.g. sign-out fired while a signed-in user's computation was
      // still in flight) — only apply if the id this was computed for
      // still matches the current user.
      if ((prev.user?.id ?? null) !== id) return prev;
      return { ...prev, userLifecycleState: result };
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    computeUserLifecycleState(userId).then((result) => {
      if (cancelled) return;
      applyLifecycleResult(userId, result);
    });

    return () => { cancelled = true; };
  }, [userId, applyLifecycleResult]);

  // ONBOARDING-BOUNCE FIX: computeUserLifecycleState() reads
  // onboarding_completed_at, but the only writer of that column
  // (completeOnboarding(), called directly from the onboarding page via
  // @brandos/auth's dbService) doesn't go through AuthProvider — so the
  // cached userLifecycleState in this context has no way to learn the
  // write happened. Without an explicit refresh, a user who just
  // finished onboarding and navigated to e.g. /workspace/create would
  // hit that route's layout gate with the STALE pre-completion
  // 'needs_onboarding' stage still in context, and get redirected right
  // back to /workspace/onboarding.
  //
  // This does not add a second computation path — computeUserLifecycleState
  // is still called from exactly this one place in @brandos/auth, exactly
  // as it is above. It only lets a caller that just changed the
  // underlying data ask for a recompute on demand, instead of waiting for
  // a userId change that will never come. Callers should `await` this
  // before navigating to a route whose access depends on the new stage.
  const refreshUserLifecycleState = useCallback(async () => {
    const id = state.user?.id ?? null;
    const result = await computeUserLifecycleState(id);
    applyLifecycleResult(id, result);
  }, [state.user?.id, applyLifecycleResult]);

  // ── Auth actions ──────────────────────────────────────────────────────────

  const loginWithEmail = useCallback(async (creds: LoginCredentials) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    const { error } = await signInWithEmail(creds);
    if (error) setError(error);
    return { error };
  }, [setError]);

  const loginWithGoogle = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    const { error } = await signInWithGoogle();
    if (error) setError(error);
    return { error };
  }, [setError]);

  const loginWithMagicLink = useCallback(async (email: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    const { error } = await signInWithMagicLink(email);
    setState(prev => ({ ...prev, isLoading: false }));
    if (error) setError(error);
    return { error };
  }, [setError]);

  const signup = useCallback(async (creds: SignupCredentials) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    const { error } = await signUpWithEmail(creds);
    if (error) setError(error);
    else setState(prev => ({ ...prev, isLoading: false }));
    return { error };
  }, [setError]);

  const logout = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true }));
    await signOut();
    setUser(null);
    if (typeof window !== 'undefined') {
      window.location.href = authConfig.redirects.afterLogout;
    }
  }, [setUser]);

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await sendPasswordReset(email);
    if (error) setError(error);
    return { error };
  }, [setError]);

  const changePassword = useCallback(async (password: string) => {
    const { error } = await updatePassword(password);
    if (error) setError(error);
    return { error };
  }, [setError]);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  // ── Context value ─────────────────────────────────────────────────────────

  const value: AuthContextValue = {
    ...state,
    loginWithEmail,
    loginWithGoogle,
    loginWithMagicLink,
    signup,
    logout,
    resetPassword,
    changePassword,
    clearError,
    refreshUserLifecycleState,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Consumer Hook ─────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error(
      '[brandos-auth] useAuth() must be used inside <AuthProvider>. ' +
      'Wrap your app root or layout.tsx with <AuthProvider>. ' +
      'See: packages/auth/src/auth/AuthProvider.tsx'
    );
  }
  return ctx;
}


