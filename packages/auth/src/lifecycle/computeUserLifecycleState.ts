// ============================================================
// @brandos/auth — src/lifecycle/computeUserLifecycleState.ts
//
// USER LIFECYCLE STATE — computation.
//
// ARCHITECTURAL ROLE:
//   Pure(-ish) composition of existing dbService reads. Introduces NO new
//   Supabase queries beyond what @brandos/auth already exposes —
//   getUserById, getWorkspaceByOwnerId, getWorkspaceSettings, and
//   getPersonas are all pre-existing exported functions (see IAuth.ts's
//   IUserOperations / IWorkspaceOperations / IPersonaOperations). This
//   function's only job is composing their results into one typed,
//   versioned UserLifecycleState — see @brandos/contracts's
//   user-state-types.ts for the full shape and the "what does NOT belong
//   here" boundary list.
//
// WHO OWNS THE SIGNUP-TRIGGER RETRY BUDGET:
//   Not this function. It is a single-pass read — it does not sleep or
//   retry. The transient window between auth.users insert and the
//   public.users/workspaces/workspace_settings trigger completing is
//   already handled by the retry loops in authService.ts's
//   getCurrentUser()/getSession() (and, separately, apps/web's
//   requireUser()) — those already-existing call sites decide when it's
//   safe to call this function with a real userId. Calling this with a
//   userId whose profile row hasn't landed yet is a normal, expected
//   input (it resolves to 'profile_pending'), not an error.
//
// CALL PATTERN:
//   computeUserLifecycleState(null)      → 'anonymous' (no Supabase calls)
//   computeUserLifecycleState(userId)    → resolves the full chain below
// ============================================================

import { getUserById } from '../db/dbService';
import { getWorkspaceByOwnerId, getWorkspaceSettings } from '../db/dbService';
import { getPersonas } from '../db/dbService';
import type { UserLifecycleState, UserLifecycleFacts } from '@brandos/contracts';

function snapshot(
  stage: UserLifecycleState['stage'],
  facts: UserLifecycleFacts,
  error?: UserLifecycleState['error']
): UserLifecycleState {
  return {
    version: 1,
    stage,
    facts,
    ...(error ? { error } : {}),
    computedAt: new Date().toISOString(),
  };
}

const EMPTY_FACTS: UserLifecycleFacts = {
  hasSession: false,
  profileResolved: false,
  workspaceResolved: false,
  workspaceSettingsSeeded: false,
  hasPersona: false,
  onboardingCompletedAt: null,
};

/**
 * Compute the current UserLifecycleState for a given user.
 *
 * `userId === null` means "no session" and short-circuits to `anonymous`
 * without touching Supabase — callers that already know there's no
 * session (e.g. AuthProvider after a real sign-out) should pass `null`
 * rather than an empty string.
 */
export async function computeUserLifecycleState(
  userId: string | null
): Promise<UserLifecycleState> {
  if (!userId) {
    return snapshot('anonymous', EMPTY_FACTS);
  }

  // ── Step 1: profile row ──────────────────────────────────────────────
  const { data: profile, error: profileError } = await getUserById(userId);

  if (profileError || !profile) {
    // A single missing-row read is the normal, expected shape of the
    // signup-trigger race (see module header) — the caller's own retry
    // budget (authService.ts / requireUser()) decides how long to wait
    // before calling this again. From this function's point of view,
    // "not found yet" and "genuinely failed" look the same on a single
    // read; it reports the transient stage, never the terminal one,
    // because it has no retry-exhaustion signal of its own to act on.
    return snapshot('profile_pending', {
      ...EMPTY_FACTS,
      hasSession: true,
    });
  }

  const factsAfterProfile: UserLifecycleFacts = {
    ...EMPTY_FACTS,
    hasSession: true,
    profileResolved: true,
    onboardingCompletedAt: profile.onboarding_completed_at ?? null,
  };

  // ── Step 2: workspace row ────────────────────────────────────────────
  const { data: workspace, error: workspaceError } = await getWorkspaceByOwnerId(userId);

  if (workspaceError || !workspace) {
    // Under the P0 invariant (every user owns exactly one workspace,
    // created atomically at signup — see UserRow.workspace_id docs) a
    // missing workspace row means the signup trigger itself failed, not
    // a transient race. This is today's mis-filed "State 6" — a generic
    // auth/loading error — now a first-class, typed terminal branch.
    return snapshot(
      'workspace_init_failed',
      factsAfterProfile,
      {
        code: 'workspace_init_failed',
        message: workspaceError ?? 'No workspace found for this user.',
      }
    );
  }

  const factsAfterWorkspace: UserLifecycleFacts = {
    ...factsAfterProfile,
    workspaceResolved: true,
  };

  // ── Step 3: workspace_settings row ───────────────────────────────────
  const { data: settings } = await getWorkspaceSettings(workspace.id);

  if (!settings) {
    // Missing settings row lags the workspace row by, at most, the same
    // signup-trigger transaction — treated as still-initializing, not
    // failed. (getOrCreateWorkspaceSettings() could self-heal this, but
    // this function is a pure read and does not perform writes.)
    return snapshot('workspace_initializing', factsAfterWorkspace);
  }

  const factsAfterSettings: UserLifecycleFacts = {
    ...factsAfterWorkspace,
    workspaceSettingsSeeded: true,
  };

  // ── Step 4: persona existence ────────────────────────────────────────
  const { data: personas } = await getPersonas(userId);
  const hasPersona = (personas ?? []).length > 0;

  const finalFacts: UserLifecycleFacts = {
    ...factsAfterSettings,
    hasPersona,
  };

  // ── Stage resolution ──────────────────────────────────────────────────
  // onboarding_completed_at is the SOLE gate for needs_onboarding →
  // onboarded. Persona existence does not block this transition — it
  // only distinguishes onboarded (skip path allowed, per current
  // "Skip Onboarding" product behavior) from operational (full steady
  // state). See user-state-types.ts's UserLifecycleStage doc comment.
  if (!finalFacts.onboardingCompletedAt) {
    return snapshot('needs_onboarding', finalFacts);
  }

  if (!hasPersona) {
    return snapshot('onboarded', finalFacts);
  }

  return snapshot('operational', finalFacts);
}
