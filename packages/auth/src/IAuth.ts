// ============================================================
// @brandos/auth — IAuth.ts
//
// PUBLIC INTERFACE BOUNDARY FILE
//
// PURPOSE:
//   This file is the strict, documented, agent-readable boundary for
//   the @brandos/auth package. It defines the IAuth interface that
//   codifies every capability this package exposes to dependent layers.
//
//   Think of this file as the "contract between @brandos/auth and the world".
//   If a method is not in IAuth, it is considered internal and subject to
//   change without notice. If a method IS in IAuth, its signature is frozen
//   and cannot change without a version bump.
//
// RULES FOR THIS FILE:
//   1. Only re-export types from @brandos/contracts — never define them here.
//   2. Never import Supabase types directly — use the abstracted shapes.
//   3. Every method group corresponds to one functional sub-domain.
//   4. @deprecated markers here cause IDE warnings for callers immediately.
//   5. All return types must use DbResult<T> or DbListResult<T> wrappers
//      (never throw, never return raw Supabase responses).
//
// CONSUMERS:
//   Import from '@brandos/auth' (index.ts), NOT from this file directly.
//   This file exists for documentation, agent context, and boundary auditing.
//
// AGENT GUIDANCE:
//   When adding a new exported function to @brandos/auth, declare its
//   signature here first, then implement in the appropriate module.
//   This prevents silent API drift between the implementation and the
//   contract that dependent layers expect.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AuthUser,
  AuthSession,
  ProfileRetryOptions,
  AuthState,
  LoginCredentials,
  SignupCredentials,
  UserRow,
  CampaignRow,
  NewCampaign,
  PersonaRow,
  NewPersona,
  FeedbackRow,
  NewFeedback,
  DbResult,
  DbListResult,
  // P0 — Workspace Foundation (Implementation Wave 1A)
  WorkspaceRow,
  NewWorkspace,
  WorkspaceSettingsRow,
  NewWorkspaceSettings,
  // P1 — Asset Vault Evolution
  BrandAssetRow,
  BrandAssetStatus,
  NewBrandAsset,
  // P3 — BYOK & Provider Observability
  WorkspaceApiKeyRow,
  NewWorkspaceApiKey,
  WorkspaceProviderUsageRow,
  NewWorkspaceProviderUsage,
  WorkspaceProviderHealthRow,
  // Priority 4/5 — OAuth-based export integrations (Canva, Figma)
  WorkspaceOAuthConnectionRow,
  NewWorkspaceOAuthConnection,
  // Priority 5 — Figma Export: ephemeral plugin handoff tokens
  FigmaHandoffTokenRow,
  NewFigmaHandoffToken,
} from '@brandos/contracts';

// ── Re-export types so dependents can import from IAuth ───────────────────
export type {
  AuthUser,
  AuthSession,
  ProfileRetryOptions,
  AuthState,
  LoginCredentials,
  SignupCredentials,
  UserRow,
  CampaignRow,
  NewCampaign,
  PersonaRow,
  NewPersona,
  FeedbackRow,
  NewFeedback,
  DbResult,
  DbListResult,
  // P0 — Workspace Foundation (Implementation Wave 1A)
  WorkspaceRow,
  NewWorkspace,
  WorkspaceSettingsRow,
  NewWorkspaceSettings,
  // P1 — Asset Vault Evolution
  BrandAssetRow,
  BrandAssetStatus,
  NewBrandAsset,
  // P3 — BYOK & Provider Observability
  WorkspaceApiKeyRow,
  NewWorkspaceApiKey,
  WorkspaceProviderUsageRow,
  NewWorkspaceProviderUsage,
  WorkspaceProviderHealthRow,
  // Priority 4/5 — OAuth-based export integrations (Canva, Figma)
  WorkspaceOAuthConnectionRow,
  NewWorkspaceOAuthConnection,
  // Priority 5 — Figma Export: ephemeral plugin handoff tokens
  FigmaHandoffTokenRow,
  NewFigmaHandoffToken,
};

// ─────────────────────────────────────────────────────────────────────────────
// GROUP A — SUPABASE CLIENT ACCESS
//
// Single point for obtaining Supabase client instances. All code that needs
// a Supabase client should go through these functions — never construct
// a client directly. This ensures singleton behaviour (browser) and correct
// cookie-based session propagation (SSR).
// ─────────────────────────────────────────────────────────────────────────────

export interface ISupabaseClients {
  /**
   * Returns the singleton browser-side Supabase client.
   * Uses @supabase/ssr createBrowserClient so sessions are stored in cookies
   * (not localStorage), making them readable by Next.js server route handlers.
   *
   * EDGE CASE: Throws if NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY
   * are missing from the environment. This is intentional — silent failure here
   * causes auth to break in ways that are very hard to debug.
   *
   * SINGLETON: Returns the same instance on repeated calls. Safe to call
   * multiple times — no performance cost after the first call.
   */
  getSupabaseClient(): SupabaseClient;

  /**
   * Returns a server-side Supabase admin client using the service role key.
   *
   * WARNING: This client BYPASSES Row Level Security.
   * Only use in:
   *   - Next.js API route handlers (server-side only)
   *   - Server Actions
   *   - Background jobs
   * NEVER expose this client to the browser — service role key leaks are critical.
   *
   * EDGE CASE: Throws if SUPABASE_SERVICE_ROLE_KEY is missing.
   * This key must only be set in server-side .env (not NEXT_PUBLIC_).
   *
   * NOT a singleton — creates a new client each call (no session to reuse).
   */
  getSupabaseAdmin(): SupabaseClient;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP B — AUTH OPERATIONS
//
// All Supabase Auth operations. These are pure functions — they do not
// hold state. State is managed by the AuthProvider React context.
//
// ERROR HANDLING CONVENTION:
//   All functions return { error: string | null }. A non-null error is a
//   human-readable message safe to show in UI. Never throw from these.
// ─────────────────────────────────────────────────────────────────────────────

export interface IAuthOperations {
  /**
   * Create a new account with email + password.
   * On success, returns the mapped AuthUser. The user may still need to
   * verify their email before they can sign in (depends on Supabase settings).
   *
   * EDGE CASE: If Supabase email confirmation is ON, user is non-null but
   * the session will be null until the email link is clicked. The AuthProvider
   * onAuthStateChange listener handles the subsequent session hydration.
   */
  signUpWithEmail(creds: SignupCredentials): Promise<{ user: AuthUser | null; error: string | null }>;

  /**
   * Sign in with email + password.
   * On success, Supabase writes a session cookie (via createBrowserClient).
   * The AuthProvider's onAuthStateChange fires and updates React context.
   */
  signInWithEmail(creds: LoginCredentials): Promise<{ user: AuthUser | null; error: string | null }>;

  /**
   * Initiate Google OAuth sign-in.
   * This redirects the browser to Google's auth page — there is no return value.
   * After Google redirects back to /auth/callback, the callback route handler
   * in callback-route.ts exchanges the code for a session.
   *
   * EDGE CASE: error is non-null only if the OAuth redirect itself fails
   * (e.g. invalid client ID). OAuth errors from Google land on the callback
   * route as query params — handle those in callback-route.ts.
   */
  signInWithGoogle(): Promise<{ error: string | null }>;

  /**
   * Send a passwordless magic link to the given email.
   * The user clicks the link, which redirects to authConfig.redirects.afterConfirm.
   * Supabase handles the OTP validation automatically.
   */
  signInWithMagicLink(email: string): Promise<{ error: string | null }>;

  /**
   * Send a password reset email.
   * Redirects to /auth/reset-password after the user clicks the link.
   * EDGE CASE: Returns { error: null } even if the email doesn't exist —
   * this is Supabase's default behaviour to prevent email enumeration attacks.
   */
  sendPasswordReset(email: string): Promise<{ error: string | null }>;

  /**
   * Update the current user's password.
   * REQUIRES: The user must have a valid session (typically after clicking
   * a password reset link which sets a temporary recovery session).
   * EDGE CASE: Will fail with "Auth session missing" if called outside a
   * recovery session context.
   */
  updatePassword(newPassword: string): Promise<{ error: string | null }>;

  /**
   * Sign out the current user and clear the session cookie.
   * After this call, the AuthProvider's onAuthStateChange fires with null.
   */
  signOut(): Promise<{ error: string | null }>;

  /**
   * Get the current Supabase session (raw token envelope).
   * Prefer useAuth().user for React components — this is for server-side use.
   *
   * Retries the public.users profile lookup a few times by default to cover
   * the signup-trigger race (DB trigger creating the profile row can land
   * just after the session exists). Pass `options` to override the retry
   * count/delay — e.g. tests exercising the give-up path use { retries: 0 }.
   * This param is optional and additive: existing zero-arg callers are
   * unaffected.
   */
  getSession(options?: ProfileRetryOptions): Promise<{ session: AuthSession | null; error: string | null }>;

  /**
   * Get the current user with their public profile merged in.
   * Calls getSession() then queries public.users for name/avatar/plan.
   * Returns null user (not an error) when there is no active session.
   *
   * PERFORMANCE NOTE: Makes 2 Supabase calls (session + profile). Cache the
   * result in the AuthProvider — do not call this on every render.
   *
   * Retries the profile lookup a few times by default (signup-trigger
   * race — see getSession() above). This param is optional and additive.
   *
   * sessionExistsButProfileMissing (optional, additive): true only when a
   * valid session/JWT exists but the public.users row still wasn't found
   * after the full retry budget — distinguishes "brand-new signup, DB
   * trigger still running" from a genuine "not logged in". Existing callers
   * that destructure only { user, error } are unaffected.
   */
  getCurrentUser(options?: ProfileRetryOptions): Promise<{
    user: AuthUser | null;
    error: string | null;
    sessionExistsButProfileMissing?: boolean;
  }>;

  /**
   * Subscribe to Supabase auth state changes.
   * The callback fires when: sign-in, sign-out, token refresh, session recovery.
   * Returns an unsubscribe function — call it on component unmount.
   *
   * AGENT GUIDANCE: This is the authoritative auth state source. The AuthProvider
   * uses this internally. External code should use useAuth() rather than calling
   * this directly.
   */
  onAuthStateChange(callback: (user: AuthUser | null) => void): () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP C — USER DB OPERATIONS
//
// CRUD for the public.users table. Uses the anon client (respects RLS).
// ─────────────────────────────────────────────────────────────────────────────

export interface IUserOperations {
  /** Fetch a user's full profile row by their auth UUID */
  getUserById(userId: string): Promise<DbResult<UserRow>>;

  /**
   * Update mutable user profile fields.
   * Only name, avatar_url, and plan are mutable here.
   * id, email, created_at are immutable.
   * plan changes for enterprise users should go through the admin API.
   */
  updateUser(
    userId: string,
    updates: Partial<Pick<UserRow, 'name' | 'avatar_url' | 'plan'>>
  ): Promise<DbResult<UserRow>>;

  /**
   * Atomically increment the user's generation counter.
   * Uses a Postgres RPC (`increment_generations_used`) to prevent race conditions
   * when multiple tabs or requests trigger generation simultaneously.
   *
   * EDGE CASE: If the RPC is not defined in Supabase, this will return an error.
   * The generation pipeline should still proceed — this counter is advisory.
   */
  incrementGenerationsUsed(userId: string): Promise<DbResult<UserRow>>;

  /**
   * Mark onboarding complete (or explicitly skipped) — sets
   * `UserRow.onboarding_completed_at` to now.
   *
   * This is the single authoritative onboarding signal (see
   * `UserLifecycleState` in `@brandos/contracts`). It replaces the old
   * client-side `localStorage['brandos_onboarding_complete']` flag as the
   * source of truth. Called on BOTH the "finish the flow" and the
   * "skip onboarding" paths — skipping does not require a persona to
   * exist; see `computeUserLifecycleState`'s `onboarded` (field set) vs
   * `operational` (field set AND ≥1 persona) distinction in
   * `src/lifecycle/computeUserLifecycleState.ts`.
   *
   * IDEMPOTENT — safe to call more than once.
   */
  completeOnboarding(userId: string): Promise<DbResult<UserRow>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP C2 — WORKSPACE DB OPERATIONS (P0 — Implementation Wave 1A)
//
// CRUD for public.workspaces and public.workspace_settings.
//
// ARCHITECTURAL ROLE: this group owns ONLY persistence. It does not resolve
// the Global → Workspace → User settings hierarchy — that resolution
// algorithm lives in @brandos/control-plane-layer's
// src/workspace/settings-resolver.ts (A.3), which calls
// getWorkspaceSettings() here as one of its three inputs (the other two
// being AdminSettingsService.get() and per-request user overrides).
//
// OWNERSHIP MODEL (P0): single-owner. `owner_id` on WorkspaceRow is the sole
// authority. There is no workspace_members table — do not branch on
// membership anywhere that calls this interface.
//
// CREATION: getOrCreateWorkspaceSettings() and workspace creation itself are
// performed together, in one transaction, by the Postgres signup trigger
// (see YYYYMMDD_05_workspace_signup_trigger.sql). createWorkspace() below
// exists for completeness / non-signup callers but is not on the signup
// hot path.
// ─────────────────────────────────────────────────────────────────────────────

export interface IWorkspaceOperations {
  /**
   * Fetch a workspace by its id.
   *
   * Does NOT check ownership — callers (apps/web routes) must separately
   * verify `workspace.owner_id === session.user.id` (or that the caller is a
   * platform admin) before returning this to a client. This function is a
   * raw lookup, the same way getCampaignById() is.
   */
  getWorkspaceById(workspaceId: string): Promise<DbResult<WorkspaceRow>>;

  /**
   * Convenience lookup: fetch the single workspace owned by a user.
   *
   * P0 invariant: every user owns exactly one workspace (created atomically
   * at signup — see UserRow.workspace_id). This is equivalent to
   * `getWorkspaceById(user.workspace_id)` but reads through `owner_id`
   * instead, which is useful for admin tooling that has a user id but has
   * not yet loaded the user's profile row.
   *
   * EDGE CASE: returns `{ data: null, error: 'Not found' }` if no workspace
   * has `owner_id = userId`. Under the P0 invariant this should never
   * happen for a row that passed signup — if it does, the signup trigger
   * did not run and the user row is itself in an invalid state.
   */
  getWorkspaceByOwnerId(userId: string): Promise<DbResult<WorkspaceRow>>;

  /**
   * Insert a new workspace row.
   *
   * Not on the signup hot path (the signup trigger inserts workspaces
   * directly via SQL — see YYYYMMDD_05_workspace_signup_trigger.sql).
   * This exists for admin tooling / scripts that need to create a workspace
   * outside of signup. Callers are responsible for also creating the
   * corresponding workspace_settings row via
   * getOrCreateWorkspaceSettings(), since this function does not do so
   * automatically (unlike the signup trigger, which does both in one
   * transaction).
   */
  createWorkspace(workspace: NewWorkspace): Promise<DbResult<WorkspaceRow>>;

  /**
   * Update a workspace's mutable metadata fields.
   *
   * Mutable: `name`, `slug`, `plan`.
   * Immutable: `id`, `owner_id`, `created_at` (excluded via the type —
   * ownership transfer is not a P0 feature).
   *
   * `updated_at` is set automatically — do not pass it.
   */
  updateWorkspace(
    workspaceId: string,
    updates: Partial<Pick<WorkspaceRow, 'name' | 'slug' | 'plan'>>
  ): Promise<DbResult<WorkspaceRow>>;

  /**
   * Fetch the workspace_settings row for a workspace.
   *
   * INVARIANT: every workspace has exactly one workspace_settings row,
   * created in the same transaction as the workspace itself (signup trigger
   * for the common case; createWorkspace() callers must create it
   * explicitly via getOrCreateWorkspaceSettings() — see that method).
   * Callers should not need to handle "row missing" for workspaces created
   * through the normal signup path.
   */
  getWorkspaceSettings(workspaceId: string): Promise<DbResult<WorkspaceSettingsRow>>;

  /**
   * Fetch the workspace_settings row, creating it if it does not already
   * exist.
   *
   * This is the function non-signup createWorkspace() callers should use
   * immediately after createWorkspace() to establish the settings row.
   * It is idempotent: if the row already exists, it is returned unchanged
   * (the `seed` argument is ignored in that case — this function never
   * overwrites an existing row).
   *
   * @param seed - Optional initial override values for a newly-created row.
   *   `seed.workspace_id` must equal `workspaceId`. Any field omitted from
   *   `seed` (or the whole `seed` argument omitted) defaults to `null`
   *   (pure inheritance from Global Admin Settings).
   */
  getOrCreateWorkspaceSettings(
    workspaceId: string,
    seed?: NewWorkspaceSettings
  ): Promise<DbResult<WorkspaceSettingsRow>>;

  /**
   * Update one or more override fields on workspace_settings.
   *
   * Each field accepts `null` to explicitly clear an override (revert to
   * inheriting from the Global Admin Settings layer) — `null` is a
   * meaningful value here, not "field not provided". Use
   * `Partial<...>` semantics carefully: a field absent from `updates` is
   * left unchanged, whereas a field present with value `null` clears the
   * override.
   *
   * `updated_at` is set automatically — do not pass it.
   */
  updateWorkspaceSettings(
    workspaceId: string,
    updates: Partial<Omit<WorkspaceSettingsRow, 'workspace_id' | 'updated_at'>>
  ): Promise<DbResult<WorkspaceSettingsRow>>;
}


export interface ICampaignOperations {
  /**
   * List campaigns for a user, ordered by created_at DESC.
   * Supports pagination via limit/offset.
   * EDGE CASE: Returns empty array (not error) when the user has no campaigns.
   */
  getCampaigns(userId: string, limit?: number, offset?: number): Promise<DbListResult<CampaignRow>>;

  getCampaignById(campaignId: string): Promise<DbResult<CampaignRow>>;

  /**
   * Insert a new campaign record.
   * The `content` field should be set to {} initially and updated after generation.
   * EDGE CASE: RLS requires the user_id to match auth.uid(). If called server-side
   * with the admin client, RLS is bypassed — set user_id explicitly.
   */
  createCampaign(campaign: NewCampaign): Promise<DbResult<CampaignRow>>;

  /**
   * Update a campaign's mutable fields.
   * Immutable fields (id, user_id, workspace_id, created_at) are excluded
   * via the type. workspace_id immutability is a P0 decision — ownership
   * transfer between workspaces is not a P0 feature.
   * updated_at is set automatically by this function — do not pass it.
   */
  updateCampaign(
    campaignId: string,
    updates: Partial<Omit<CampaignRow, 'id' | 'user_id' | 'workspace_id' | 'created_at'>>
  ): Promise<DbResult<CampaignRow>>;

  /**
   * Hard-delete a campaign.
   * IRREVERSIBLE. The content field (full ArtifactV2 JSON) is also deleted.
   * Consider soft-delete (status = 'draft') for user-recoverable scenarios.
   */
  deleteCampaign(campaignId: string): Promise<{ error: string | null }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP E — PERSONA DB OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface IPersonaOperations {
  /**
   * List all personas for a user.
   * Ordered: default persona first, then by created_at ASC.
   * EDGE CASE: A user with no personas gets an empty array. The UI should
   * prompt them to create one before generating content.
   */
  getPersonas(userId: string): Promise<DbListResult<PersonaRow>>;

  /**
   * Get the user's current default persona.
   * Returns null if no default is set (all personas have is_default=false).
   * This should not happen in normal operation (the last persona is always set
   * as default) but may occur during migration or if the DB trigger fails.
   */
  getDefaultPersona(userId: string): Promise<DbResult<PersonaRow>>;

  createPersona(persona: NewPersona): Promise<DbResult<PersonaRow>>;

  /**
   * Update a persona's mutable fields.
   * Immutable fields (id, user_id, workspace_id, created_at) are excluded
   * via the type — see ICampaignOperations.updateCampaign for the
   * workspace_id immutability rationale.
   */
  updatePersona(
    personaId: string,
    updates: Partial<Omit<PersonaRow, 'id' | 'user_id' | 'workspace_id' | 'created_at'>>
  ): Promise<DbResult<PersonaRow>>;

  /**
   * Hard-delete a persona.
   * EDGE CASE: Deleting the default persona leaves the user with no default.
   * The caller should set another persona as default before or after deletion.
   * Campaigns that reference this persona_id will retain the FK but the
   * persona record will be gone — handle this in the UI gracefully.
   */
  deletePersona(personaId: string): Promise<{ error: string | null }>;

  /**
   * Set the given persona as the user's default.
   * ATOMICITY: This performs two Supabase calls:
   *   1. UPDATE all personas for userId SET is_default=false
   *   2. UPDATE persona WHERE id=personaId SET is_default=true
   * If step 2 fails, the user is left with NO default persona.
   * The caller should refresh the persona list on error.
   *
   * FUTURE: Replace with a Postgres RPC for true atomicity.
   */
  setDefaultPersona(userId: string, personaId: string): Promise<{ error: string | null }>;

  /**
   * Update (or create) the user\'s default brand persona from memory page fields.
   *
   * Moved from @brandos/brand-intelligence (Fix G1).
   * Persona persistence belongs in @brandos/auth, not in the cognitive runtime.
   *
   * P0 — Implementation Wave 1A: `workspaceId` is required because
   * PersonaRow.workspace_id is NOT NULL. When this function creates a NEW
   * default persona (no existing is_default=true row for userId), it sets
   * workspace_id = workspaceId on the inserted row. When updating an
   * existing row, workspace_id is left unchanged (it is immutable after
   * creation — a persona does not move between workspaces in P0).
   *
   * @param userId - Auth UUID of the user.
   * @param workspaceId - FK → workspaces.id. Caller resolves this via
   *   requireUser() (apps/web) or AuthUser.workspaceId — never derive it
   *   from userId.
   * @param fields - Partial brand persona fields to upsert.
   */
  updatePersonaProfile(
    userId: string,
    workspaceId: string,
    fields: {
      tone?: string;
      audience?: string;
      industry?: string;
      positioning?: string;
      keywords?: string;
    }
  ): Promise<DbResult<PersonaRow>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP F — FEEDBACK DB OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface IFeedbackOperations {
  /**
   * Insert a feedback record for a campaign.
   * Each signal is a distinct row — multiple signals per campaign are allowed.
   * These signals are consumed by the identity layer to adjust persona tuning.
   */
  submitFeedback(feedback: NewFeedback): Promise<DbResult<FeedbackRow>>;

  /**
   * Get all feedback for a specific campaign, ordered by created_at DESC.
   * Used by the campaign detail view to show what signals have been submitted.
   */
  getFeedbackForCampaign(campaignId: string): Promise<DbListResult<FeedbackRow>>;

  /**
   * Aggregate feedback signals for a user into a frequency distribution.
   * Returns { useful: 12, generic: 3, off_tone: 1 } shape.
   * Used by the identity layer to weight signal importance.
   *
   * EDGE CASE: Returns { data: {}, error: null } for users with no feedback.
   * Callers should treat an empty object as "no signal" (not an error).
   */
  getUserFeedbackStats(userId: string): Promise<DbResult<Record<string, number>>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP G — REACT HOOKS (client-side only)
//
// These hooks are only valid inside a React component tree wrapped by
// <AuthProvider>. They combine DB operations with React state management.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return type of the useCampaigns hook.
 * Provides campaigns list + CRUD actions + loading/error state.
 */
export interface UseCampaignsReturn {
  campaigns: CampaignRow[];
  isLoading: boolean;
  error: string | null;
  /** Re-fetch campaigns from the server */
  refresh(): Promise<void>;
  /**
   * Create a campaign scoped to the current user's workspace.
   * `user_id` and `workspace_id` are injected automatically from
   * useAuth().user (id and workspaceId respectively) — do not pass them.
   *
   * P0 — Implementation Wave 1A: workspace_id is now required on
   * NewCampaign. Components do not need to know about workspaces — this
   * hook resolves it the same way it already resolves user_id.
   */
  create(campaign: Omit<NewCampaign, 'user_id' | 'workspace_id'>): Promise<DbResult<CampaignRow>>;
  /**
   * `workspace_id` is excluded — a campaign's workspace is set at creation
   * and is immutable in P0 (ownership transfer between workspaces is not a
   * P0 feature).
   */
  update(id: string, updates: Partial<Omit<CampaignRow, 'id' | 'user_id' | 'workspace_id' | 'created_at'>>): Promise<DbResult<CampaignRow>>;
  remove(id: string): Promise<{ error: string | null }>;
}

/**
 * Return type of the usePersonas hook.
 * Provides persona list + CRUD + default management.
 */
export interface UsePersonasReturn {
  personas: PersonaRow[];
  /** The current default persona, or null if none is set */
  defaultPersona: PersonaRow | null;
  isLoading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  /**
   * `user_id` and `workspace_id` are injected automatically from
   * useAuth().user — see UseCampaignsReturn.create for the same pattern.
   */
  create(persona: Omit<NewPersona, 'user_id' | 'workspace_id'>): Promise<DbResult<PersonaRow>>;
  /** `workspace_id` is excluded — immutable post-creation, see UseCampaignsReturn.update. */
  update(id: string, updates: Partial<Omit<PersonaRow, 'id' | 'user_id' | 'workspace_id' | 'created_at'>>): Promise<DbResult<PersonaRow>>;
  remove(id: string): Promise<{ error: string | null }>;
  /** Set a persona as the user's default */
  setDefault(personaId: string): Promise<{ error: string | null }>;
}

/**
 * Return type of the useFeedback hook.
 * Provides feedback submission + stats loading.
 */
export interface UseFeedbackReturn {
  /** Aggregated signal counts for the current user */
  stats: Record<string, number>;
  isLoading: boolean;
  error: string | null;
  /** Submit a feedback signal (user_id is injected automatically) */
  submit(feedback: Omit<NewFeedback, 'user_id'>): Promise<DbResult<FeedbackRow>>;
  /** Re-fetch aggregated stats */
  refreshStats(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP H — ASSET DB OPERATIONS (P1 — Asset Vault Evolution)
//
// CRUD for public.brand_assets.
//
// OWNERSHIP: This interface owns ALL persistence for brand_assets. No other
// package writes to brand_assets directly — all reads/writes route through
// these functions.
//
// WORKSPACE ISOLATION: All queries are scoped to workspaceId. The workspaceId
// is always sourced from requireUser() in the calling route handler — never
// trusted from request body or query parameters.
//
// SOFT-DELETE MODEL: DELETE is a soft archive — it sets status='archived' and
// archived_at=now(). Hard deletes are not exposed via this interface (platform
// admin tooling only). Standard list queries filter OUT archived assets.
// ─────────────────────────────────────────────────────────────────────────────

/** Options for listAssets pagination and filtering. */
export interface AssetListOptions {
  /** Max number of results to return (default: 50) */
  limit?: number;
  /** Offset for pagination (default: 0) */
  offset?: number;
  /** Filter by status (default: excludes 'archived') */
  status?: BrandAssetStatus | BrandAssetStatus[];
  /** Filter by MIME category: 'image', 'document', or 'all' (default: 'all') */
  mimeCategory?: 'image' | 'document' | 'all';
  /** Filter by tag (assets that contain this tag) */
  tag?: string;
  /** Column to sort by (default: 'created_at') */
  sortBy?: 'created_at' | 'name' | 'size_bytes' | 'usage_count';
  /** Sort direction (default: 'desc') */
  sortDir?: 'asc' | 'desc';
}

/** Fields a user may update on an asset via PATCH /api/assets/:id */
export interface AssetUpdateFields {
  name?: string;
  tags?: string[];
}

export interface IAssetOperations {
  /**
   * List assets for a workspace.
   * By default excludes archived assets (status = 'archived').
   * Pagination via limit/offset. count is the total matching count.
   *
   * WORKSPACE ISOLATION: `workspaceId` is always from requireUser() — never
   * from a client request parameter.
   */
  listAssets(
    workspaceId: string,
    opts?: AssetListOptions
  ): Promise<DbListResult<BrandAssetRow>>;

  /**
   * Fetch a single asset by ID, scoped to a workspace.
   * Returns { data: null, error: 'Not found' } if the asset does not exist
   * OR belongs to a different workspace — callers cannot distinguish these
   * cases (this is intentional — prevents enumeration attacks).
   */
  getAsset(assetId: string, workspaceId: string): Promise<DbResult<BrandAssetRow>>;

  /**
   * Insert a new brand_assets row.
   * Called by POST /api/assets (upload flow) immediately after the storage
   * upload completes. `storage_path` and all fields must be populated by the
   * caller — this function is a thin insert wrapper.
   *
   * STORAGE PATH CONVENTION (P1):
   *   `${workspace_id}/${asset_id}/${sanitized_original_filename}`
   */
  createAsset(asset: NewBrandAsset): Promise<DbResult<BrandAssetRow>>;

  /**
   * Update user-editable asset fields (name, tags).
   * Scoped to workspaceId — will not update assets in other workspaces.
   * Immutable fields (id, workspace_id, user_id, original_filename, mime_type,
   * size_bytes, storage_path, created_at) are not accepted here.
   * `updated_at` is set automatically.
   */
  updateAsset(
    assetId: string,
    workspaceId: string,
    updates: AssetUpdateFields
  ): Promise<DbResult<BrandAssetRow>>;

  /**
   * Soft-archive an asset.
   * Sets status='archived', archived_at=now().
   * The storage object is NOT deleted — it remains in the `brand-assets` bucket.
   * Archived assets are excluded from standard listAssets() results.
   * Restoration is a platform admin operation (not in P1 scope).
   */
  archiveAsset(assetId: string, workspaceId: string): Promise<DbResult<BrandAssetRow>>;

  /**
   * Update the status of an asset.
   * Used by the analyze and reindex routes to drive the lifecycle state machine:
   *   uploading → processing (upload complete, analysis queued)
   *   processing → indexed  (VLM analysis succeeded)
   *   processing → failed   (VLM analysis failed)
   *   failed → processing   (reindex triggered)
   *
   * WORKSPACE ISOLATION: workspaceId is verified before update.
   */
  updateAssetStatus(
    assetId: string,
    workspaceId: string,
    status: BrandAssetStatus
  ): Promise<DbResult<BrandAssetRow>>;

  /**
   * Write VLM analysis result to an asset and transition status to 'indexed'.
   * Called by POST /api/assets/:id/analyze on successful analysis.
   * Sets vlm_analysis, status='indexed', updated_at=now().
   * WORKSPACE ISOLATION: workspaceId is verified before update.
   */
  updateAssetVlmResult(
    assetId: string,
    workspaceId: string,
    vlmAnalysis: Record<string, unknown>
  ): Promise<DbResult<BrandAssetRow>>;

  /**
   * Return the total storage consumed by all non-archived assets in a workspace,
   * in bytes.
   * Used by the workspace settings resolver to check against
   * asset_storage_limit_mb before allowing new uploads.
   * (Limit enforcement is P2 — this function is pre-wired here for P2 activation.)
   */
  getTotalAssetStorageForWorkspace(workspaceId: string): Promise<DbResult<number>>;

  /**
   * P2 — Count brand_assets uploaded by a workspace in the current calendar
   * month (UTC). Used for monthly upload-count enforcement.
   * Returns 0 if no uploads this month (not an error).
   */
  countMonthlyUploadsForWorkspace(workspaceId: string): Promise<DbResult<number>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP I — PROVIDER CREDENTIAL OPERATIONS (P3 — BYOK)
//
// CRUD for public.workspace_api_keys.
// All operations use the admin client (server-side only; auth.uid()=null in routes).
// Workspace isolation is enforced by the workspaceId parameter, which always
// comes from requireUser() in the calling route.
// ─────────────────────────────────────────────────────────────────────────────

export interface IProviderCredentialOperations {
  /**
   * Fetch ALL active (non-revoked) API key rows for a workspace.
   * F4 REQUIREMENT: one query, not one per provider.
   * The credentials service (getProviderKeyMap) calls this and builds the
   * provider→plaintextKey map in memory from the result.
   */
  listWorkspaceApiKeys(workspaceId: string): Promise<DbListResult<WorkspaceApiKeyRow>>;

  /**
   * Fetch the single active API key row for one (workspace, provider) pair.
   * Returns { data: null, error: null } when no active row exists (not an error).
   */
  getWorkspaceApiKey(workspaceId: string, provider: string): Promise<DbResult<WorkspaceApiKeyRow>>;

  /**
   * Upsert an API key row.
   * ON CONFLICT (workspace_id, provider) replaces the existing row atomically.
   * For rotation (where rotated_at must also be set), use rotateWorkspaceApiKey().
   */
  upsertWorkspaceApiKey(row: NewWorkspaceApiKey): Promise<DbResult<WorkspaceApiKeyRow>>;

  /**
   * Rotate an existing key in-place.
   * Replaces ciphertext fields and sets rotated_at=now().
   * Returns error if no active row exists for (workspaceId, provider).
   */
  rotateWorkspaceApiKey(
    workspaceId: string,
    provider: string,
    fields: {
      encrypted_key: string;
      iv:            string;
      auth_tag:      string;
      key_hint:      string;
    }
  ): Promise<DbResult<WorkspaceApiKeyRow>>;

  /**
   * Soft-revoke a provider key.
   * Sets is_active=false, revoked_at=now(). Does not hard-delete.
   */
  revokeWorkspaceApiKey(workspaceId: string, provider: string): Promise<DbResult<WorkspaceApiKeyRow>>;

  /**
   * Mark a key as successfully validated.
   * Sets validated_at to the provided ISO timestamp.
   */
  markWorkspaceApiKeyValidated(
    workspaceId: string,
    provider:    string,
    validatedAt: string
  ): Promise<DbResult<WorkspaceApiKeyRow>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP J — PROVIDER USAGE OPERATIONS (P3 — telemetry)
//
// Append-only usage log for workspace_provider_usage.
// Fire-and-forget on the generation hot path — never awaited.
// ─────────────────────────────────────────────────────────────────────────────

export interface IProviderUsageOperations {
  /**
   * Append one usage row.
   * Fire-and-forget — never awaited on the generation hot path.
   */
  recordProviderUsage(row: NewWorkspaceProviderUsage): Promise<DbResult<WorkspaceProviderUsageRow>>;

  /**
   * Aggregate usage summary by provider for a workspace.
   * Returns one entry per provider with total request count and summed tokens.
   * Used by GET /api/workspace/providers/usage (W7).
   */
  getWorkspaceProviderUsageSummary(
    workspaceId: string
  ): Promise<DbResult<Array<{ provider: string; request_count: number; total_tokens: number | null }>>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP K — PROVIDER HEALTH OPERATIONS (P3 — observability)
//
// CRUD for public.workspace_provider_health.
// Updated fire-and-forget after each generation outcome.
// ─────────────────────────────────────────────────────────────────────────────

export interface IProviderHealthOperations {
  /**
   * Upsert the health snapshot for one (workspace, provider) pair.
   * outcome='success' → last_success_at=now()
   * outcome='failure' → last_failure_at=now(), failure_count++
   * updated_at is always now().
   */
  upsertWorkspaceProviderHealth(
    workspaceId: string,
    provider:    string,
    outcome:     'success' | 'failure'
  ): Promise<DbResult<WorkspaceProviderHealthRow>>;

  /**
   * Fetch all health rows for a workspace.
   * Used by GET /api/workspace/providers/usage (W7).
   */
  listWorkspaceProviderHealth(workspaceId: string): Promise<DbListResult<WorkspaceProviderHealthRow>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP L — OAUTH CONNECTION OPERATIONS (Priority 4/5 — Canva/Figma export)
//
// CRUD for public.workspace_oauth_connections.
// All operations use the admin client (server-side only). Workspace
// isolation is enforced by the workspaceId parameter, which always comes
// from requireUser() in the calling route. Distinct from
// IProviderCredentialOperations (P3/BYOK): OAuth tokens have a refresh
// flow, an expiry, and granted scopes, none of which workspace_api_keys
// models. See WorkspaceOAuthConnectionRow doc comment for full rationale.
// ─────────────────────────────────────────────────────────────────────────────

export interface IOAuthConnectionOperations {
  /**
   * Fetch the single active OAuth connection row for one (workspace, provider) pair.
   * Returns { data: null, error: null } when no active row exists (not an error).
   */
  getWorkspaceOAuthConnection(
    workspaceId: string,
    provider:    string
  ): Promise<DbResult<WorkspaceOAuthConnectionRow>>;

  /**
   * Upsert an OAuth connection row (initial connect, or re-connect after revoke).
   * ON CONFLICT (workspace_id, provider) WHERE is_active=true replaces the
   * existing row atomically.
   */
  upsertWorkspaceOAuthConnection(
    row: NewWorkspaceOAuthConnection
  ): Promise<DbResult<WorkspaceOAuthConnectionRow>>;

  /**
   * Update the access token (and optionally refresh token) in place after
   * a token-refresh exchange. Sets refreshed_at=now().
   */
  refreshWorkspaceOAuthConnection(
    workspaceId: string,
    provider:    string,
    fields: {
      encrypted_access_token:  string;
      access_token_iv:         string;
      access_token_auth_tag:   string;
      encrypted_refresh_token?: string | null;
      refresh_token_iv?:        string | null;
      refresh_token_auth_tag?:  string | null;
      expires_at?:              string | null;
    }
  ): Promise<DbResult<WorkspaceOAuthConnectionRow>>;

  /**
   * Soft-revoke an OAuth connection (disconnect).
   * Sets is_active=false, revoked_at=now(). Does not hard-delete — matches
   * the soft-delete convention used by revokeWorkspaceApiKey().
   */
  revokeWorkspaceOAuthConnection(
    workspaceId: string,
    provider:    string
  ): Promise<DbResult<WorkspaceOAuthConnectionRow>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP M — FIGMA HANDOFF TOKEN OPERATIONS (Priority 5 — Figma Export)
//
// CRUD for public.figma_handoff_tokens. See FigmaHandoffTokenRow doc
// comment for why this exists (no Figma creation API; the BrandOS Figma
// Plugin calls back with this token instead of an OAuth session).
// ─────────────────────────────────────────────────────────────────────────────

export interface IFigmaHandoffOperations {
  /** Create a new handoff token (called when the user clicks "Export to Figma"). */
  createFigmaHandoffToken(
    row: NewFigmaHandoffToken
  ): Promise<DbResult<FigmaHandoffTokenRow>>;

  /**
   * Atomically fetch-and-consume a handoff token: returns the row only if
   * it exists, is unexpired, and has not already been consumed — then
   * marks it consumed in the same operation so it cannot be replayed.
   * Returns { data: null, error: <reason> } for expired/missing/already-used.
   */
  consumeFigmaHandoffToken(
    token: string
  ): Promise<DbResult<FigmaHandoffTokenRow>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL PACKAGE INTERFACE — composes all groups
//
// IAuth is the master boundary interface. Dependent layers should type-check
// their usage against this interface to ensure compatibility.
// ─────────────────────────────────────────────────────────────────────────────

export interface IAuth
  extends ISupabaseClients,
    IAuthOperations,
    IUserOperations,
    IWorkspaceOperations,
    ICampaignOperations,
    IPersonaOperations,
    IFeedbackOperations,
    IAssetOperations,
    IProviderCredentialOperations,
    IProviderUsageOperations,
    IProviderHealthOperations,
    IOAuthConnectionOperations,
    IFigmaHandoffOperations {}


