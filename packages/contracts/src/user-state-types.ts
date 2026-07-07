// ============================================================
// @brandos/contracts — src/user-state-types.ts
//
// USER LIFECYCLE STATE — computed, versioned projection.
//
// ARCHITECTURAL ROLE:
//   This is the single canonical shape for "what stage of the product
//   lifecycle is this user in." It is a PROJECTION, not a persisted
//   entity — the only durable field it depends on is
//   UserRow.onboarding_completed_at (see auth-types.ts). Everything else
//   is derived on read from existing rows (profile, workspace,
//   workspace_settings, personas).
//
//   Computed in @brandos/auth (see src/lifecycle/computeUserLifecycleState.ts).
//   Consumed by AuthProvider (packages/auth) and, transitively, by any
//   app/route that reads useAuth().userLifecycleState.
//
// WHAT DOES NOT BELONG HERE (enforce this on every future change):
//   - Raw identity (id, email, name, avatarUrl) — stays on AuthUser.
//   - Entitlement/tier (plan, quotas, feature access) — a separate,
//     sibling model. See packages/control-plane-layer/src/workspace/
//     tier-resolver.ts, which already resolves workspace.plan → limits
//     independently of this type. Do NOT add plan/tier fields here.
//   - Provider infrastructure state (API keys, OAuth, health) — unrelated.
//   - Business data content (actual campaigns/personas/assets) — this
//     type answers "does a persona exist," never "what does it contain."
//   - UI/routing decisions — this is a fact, not a policy. "stage is
//     'needs_onboarding'" is this type's job; "therefore redirect to
//     /workspace/onboarding" is the consumer's job.
//
// VERSIONING: bump `version` on any shape change to this type. Consumers
// that ever cache a UserLifecycleState across a deploy boundary should
// branch on `version` rather than assume the shape is stable.
// ============================================================

/**
 * Linear lifecycle stages, plus explicit transient and terminal-until-
 * recovered error branches.
 *
 * Flow (happy path):
 *   anonymous → authenticating → profile_pending → workspace_initializing
 *   → needs_onboarding → onboarded → operational
 *
 * Error branches (terminal until recovered, never silently treated as a
 * generic auth error or a logged-out state):
 *   profile_pending        → profile_init_failed   (retry budget exhausted)
 *   workspace_initializing → workspace_init_failed (signup trigger failed)
 *
 * `onboarded` vs `operational`:
 *   These are deliberately NOT the same stage. `onboarded` means the
 *   durable `onboarding_completed_at` field is set — nothing more. A user
 *   who explicitly skips onboarding (no persona created) lands here, and
 *   stays here: skip is a supported, permanent product path, not a
 *   transient state waiting for a persona to appear. `operational` means
 *   the durable field is set AND at least one persona exists. This
 *   preserves the current "Skip Onboarding" behavior exactly.
 *
 * Tier/plan (Explorer/Professional/Executive) is NOT a rung on this
 * ladder — it is read alongside this state by consumers that need it
 * (via workspace.plan / tier-resolver.ts), never nested inside it.
 */
export type UserLifecycleStage =
  | 'anonymous'
  | 'authenticating'
  | 'profile_pending'
  | 'profile_init_failed'
  | 'workspace_initializing'
  | 'workspace_init_failed'
  | 'needs_onboarding'
  | 'onboarded'
  | 'operational';

/**
 * Raw readiness facts the stage was computed from.
 *
 * Exposed for UI nuance only (e.g. distinguishing "onboarded via skip, no
 * persona yet" from "onboarded via the full flow" when deciding whether to
 * still show a persona-creation prompt). Consumers must NEVER use these to
 * re-derive `stage` themselves — that would recreate exactly the scattered,
 * ad hoc inference this type exists to eliminate. Read `stage`; treat
 * `facts` as diagnostic context.
 */
export interface UserLifecycleFacts {
  hasSession: boolean;
  profileResolved: boolean;
  workspaceResolved: boolean;
  workspaceSettingsSeeded: boolean;
  hasPersona: boolean;
  /** ISO timestamp, or null if onboarding has not been completed/skipped. */
  onboardingCompletedAt: string | null;
}

/**
 * Populated only when `stage` is one of the `*_failed` terminal branches.
 * Lets a consumer route to a recovery/support surface instead of a silent
 * "signed out" state — this is today's mis-filed State 6, now typed.
 */
export interface UserLifecycleError {
  code: 'profile_init_failed' | 'workspace_init_failed';
  message: string;
}

/**
 * Immutable snapshot of a user's lifecycle stage at a point in time.
 * Each computation produces a new snapshot — nothing mutates one in place.
 */
export interface UserLifecycleState {
  /** Bump on any shape change. */
  version: 1;
  stage: UserLifecycleStage;
  facts: UserLifecycleFacts;
  error?: UserLifecycleError;
  /** ISO timestamp of computation — for cache-freshness debugging only, not a TTL. */
  computedAt: string;
}
