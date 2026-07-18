// ============================================================
// @brandos/auth — src/db/dbService.ts
//
// DATABASE OPERATIONS — CRUD for all BrandOS Supabase tables
//
// ARCHITECTURAL ROLE:
//   Pure async functions. No React state. No side effects beyond Supabase.
//   All functions return { data, error } — never throw.
//   Uses the anon client (RLS enforced) — never the admin client.
//
// IMPLEMENTS: IUserOperations, ICampaignOperations, IPersonaOperations,
//             IFeedbackOperations from src/IAuth.ts
//
// ROW LEVEL SECURITY:
//   All operations go through the anon client, so Supabase RLS policies apply.
//   The policies on each table require auth.uid() == user_id (or id for users).
//   If you add a new table, add RLS policies before using dbService functions.
//
// ERROR CONVENTION:
//   error is always a human-readable string (Supabase error message).
//   Never expose raw Supabase error objects to callers — map them here.
//   Return { data: null, error: 'message' } on failure.
//   Return { data: T, error: null } on success.
//
// AGENT GUIDANCE:
//   - The `T` shorthand for table names (const T = dbConfig.tables) prevents
//     hardcoded string literals — always use T.tableName.
//   - updated_at is always set to new Date().toISOString() on every update.
//     Do NOT let callers pass updated_at — it would create inconsistency.
//   - The `count: 'exact'` option on list queries adds a COUNT(*) to the
//     Supabase request. Only use it when the caller needs pagination metadata.
// ============================================================

import { supabase, getSupabaseAdmin } from '../auth/supabaseClient';
import { dbConfig } from '../config';
import type {
  UserRow,
  CampaignRow,
  PersonaRow,
  FeedbackRow,
  NewCampaign,
  NewPersona,
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
} from '@brandos/contracts';
import type { AssetListOptions, AssetUpdateFields } from '../IAuth';
import type {
  WorkspaceApiKeyRow,
  NewWorkspaceApiKey,
  WorkspaceProviderUsageRow,
  NewWorkspaceProviderUsage,
  WorkspaceProviderHealthRow,
  WorkspaceOAuthConnectionRow,
  NewWorkspaceOAuthConnection,
  FigmaHandoffTokenRow,
  NewFigmaHandoffToken,
} from '@brandos/contracts';

// Convenience alias — avoids hardcoded table name strings throughout this file
const T = dbConfig.tables;

// ═════════════════════════════════════════════════════════════════════════════
// USERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Fetch a full user profile row by auth UUID.
 *
 * EDGE CASE: Returns { data: null, error: null } (not an error) in the brief
 * window between account creation and the DB trigger completing the public.users
 * insert. The trigger is async — callers should handle null data gracefully.
 */
export async function getUserById(userId: string): Promise<DbResult<UserRow>> {
  const { data, error } = await supabase
    .from(T.users)
    .select('*')
    .eq('id', userId)
    .single();

  return { data: data ?? null, error: error?.message ?? null };
}

/**
 * Update mutable profile fields for a user.
 *
 * IMMUTABLE FIELDS: id, email, created_at. Supabase will reject attempts
 * to update them via RLS, but we exclude them from the type to prevent
 * accidental inclusion.
 *
 * EDGE CASE: plan upgrades via this function are not access-controlled —
 * any authenticated user can technically call updateUser with plan='enterprise'.
 * If plan is monetized, route plan changes through the admin API instead.
 */
export async function updateUser(
  userId: string,
  updates: Partial<Pick<UserRow, 'name' | 'avatar_url' | 'plan'>>
): Promise<DbResult<UserRow>> {
  const { data, error } = await supabase
    .from(T.users)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single();

  return { data: data ?? null, error: error?.message ?? null };
}

/**
 * Mark onboarding as complete (or explicitly skipped) for a user.
 *
 * This is the ONLY writer of `UserRow.onboarding_completed_at` — the
 * durable, server-side replacement for the old client-side
 * `localStorage['brandos_onboarding_complete']` flag. Called from both the
 * "finish the flow" and the "skip onboarding" paths in
 * `/workspace/onboarding` — skipping does not require a persona to exist
 * (see `computeUserLifecycleState`'s `onboarded` vs `operational` split).
 *
 * IDEMPOTENT: calling this more than once simply overwrites the timestamp
 * with a later one. Callers do not need to check whether it's already set.
 */
export async function completeOnboarding(userId: string): Promise<DbResult<UserRow>> {
  const { data, error } = await supabase
    .from(T.users)
    .update({
      onboarding_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select()
    .single();

  return { data: data ?? null, error: error?.message ?? null };
}

/**
 * Atomically increment the user's generation counter.
 *
 * Uses a Postgres RPC (`increment_generations_used`) to prevent race conditions
 * when multiple concurrent generation requests hit this function simultaneously
 * (e.g., user opens two tabs and triggers generation in both).
 *
 * EDGE CASE: If the RPC function doesn't exist in Supabase (not yet migrated),
 * this returns an error. The generation pipeline should treat this as non-fatal —
 * generation proceeds but the counter is not updated.
 *
 * SQL for the RPC (run in Supabase SQL editor):
 *   CREATE OR REPLACE FUNCTION increment_generations_used(user_id uuid)
 *   RETURNS users AS $$
 *     UPDATE users
 *     SET generations_used = generations_used + 1,
 *         updated_at = now()
 *     WHERE id = user_id
 *     RETURNING *;
 *   $$ LANGUAGE sql SECURITY DEFINER;
 */
export async function incrementGenerationsUsed(userId: string): Promise<DbResult<UserRow>> {
  const { data, error } = await supabase.rpc('increment_generations_used', {
    user_id: userId,
  });
  return { data: data ?? null, error: error?.message ?? null };
}

// ═════════════════════════════════════════════════════════════════════════════
// CAMPAIGNS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * List campaigns for a user, newest first.
 *
 * Supports cursor-based-style pagination via limit + offset.
 * count is returned for building pagination UI (total record count).
 *
 * PERFORMANCE: count: 'exact' adds COUNT(*) overhead. For infinite scroll
 * UIs that don't show total counts, consider removing it for faster queries.
 *
 * EDGE CASE: Returns { data: [], count: 0, error: null } for new users.
 * This is NOT an error — it means the user has no campaigns yet.
 */
export async function getCampaigns(
  userId: string,
  limit  = 20,
  offset = 0
): Promise<DbListResult<CampaignRow>> {
  const { data, error, count } = await supabase
    .from(T.campaigns)
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  return { data: data ?? [], error: error?.message ?? null, count: count ?? null };
}

/**
 * Fetch a single campaign by its ID.
 *
 * EDGE CASE: RLS requires the authenticated user to own this campaign.
 * If a user tries to access another user's campaign, Supabase returns a
 * "no rows found" error (Supabase hides unauthorized rows, not a 403).
 * This is by design — do not distinguish "not found" from "not authorized".
 */
export async function getCampaignById(campaignId: string): Promise<DbResult<CampaignRow>> {
  const { data, error } = await supabase
    .from(T.campaigns)
    .select('*')
    .eq('id', campaignId)
    .single();

  return { data: data ?? null, error: error?.message ?? null };
}

/**
 * Insert a new campaign record.
 *
 * The `content` field should be initialized to {} for new drafts.
 * The generation pipeline will populate it via updateCampaign() after
 * the AI output is compiled into an ArtifactV2.
 *
 * EDGE CASE: If persona_id is provided, the referenced persona must belong
 * to the same user_id. There is no FK enforcement at the DB level currently —
 * validate this in the business layer before calling createCampaign.
 */
export async function createCampaign(campaign: NewCampaign): Promise<DbResult<CampaignRow>> {
  const { data, error } = await supabase
    .from(T.campaigns)
    .insert(campaign)
    .select()
    .single();

  return { data: data ?? null, error: error?.message ?? null };
}

/**
 * Update mutable campaign fields.
 *
 * Immutable fields (id, user_id, workspace_id, created_at) are excluded from
 * the type. workspace_id is immutable post-creation in P0 (no ownership
 * transfer between workspaces). updated_at is always overwritten here — do
 * NOT pass it in `updates`.
 *
 * COMMON USE CASES:
 *   - After generation: update content, status='generated', qa_score_before/after
 *   - After export: update status='exported'
 *   - Title rename: update title
 */
export async function updateCampaign(
  campaignId: string,
  updates: Partial<Omit<CampaignRow, 'id' | 'user_id' | 'workspace_id' | 'created_at'>>
): Promise<DbResult<CampaignRow>> {
  const { data, error } = await supabase
    .from(T.campaigns)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .select()
    .single();

  return { data: data ?? null, error: error?.message ?? null };
}

/**
 * Hard-delete a campaign and its associated content.
 *
 * IRREVERSIBLE. The full ArtifactV2 JSON in the `content` field is deleted.
 * Consider setting status='draft' as a soft-delete alternative for recoverable UX.
 *
 * EDGE CASE: Associated feedback rows that reference this campaign via
 * campaign_id FK will be orphaned (or cascade-deleted, depending on the
 * Supabase schema FK constraint). Verify your FK settings before using this.
 */
export async function deleteCampaign(campaignId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from(T.campaigns)
    .delete()
    .eq('id', campaignId);

  return { error: error?.message ?? null };
}

// ═════════════════════════════════════════════════════════════════════════════
// PERSONAS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * List all personas for a user.
 *
 * ORDER: default persona first (is_default DESC), then by created_at ASC.
 * This ensures the default persona is always the first item in the list,
 * which is what the UI expects (and what the generation pipeline uses as
 * the fallback when no persona is explicitly selected).
 *
 * EDGE CASE: A user with no personas gets { data: [], count: 0, error: null }.
 * The UI should prompt them to create a persona before generating.
 */
export async function getPersonas(userId: string): Promise<DbListResult<PersonaRow>> {
  const { data, error, count } = await supabase
    .from(T.personas)
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  return { data: data ?? [], error: error?.message ?? null, count: count ?? null };
}

/**
 * Get the user's current default persona.
 *
 * Uses .single() — expects exactly one row where is_default=true.
 *
 * EDGE CASE: Returns { data: null, error: null } if NO persona has is_default=true.
 *   This can happen if:
 *   1. The user has no personas at all (new user)
 *   2. setDefaultPersona() step 1 succeeded but step 2 failed (left 0 defaults)
 *   3. The last persona was deleted without reassigning the default
 *   Callers must handle null data as a valid "no default" state.
 *
 * EDGE CASE: If 2+ personas have is_default=true (data corruption), .single()
 *   returns an error "multiple rows returned". This would indicate a bug in
 *   setDefaultPersona() — investigate the two-step update atomicity.
 */
/**
 * BUGFIX: previously read via the bare `supabase` singleton — see getAsset()
 * in this file for the full explanation of why that client cannot see rows
 * from a server-side route handler (no session → auth.uid() is NULL → any
 * RLS SELECT policy gated on it silently returns zero rows). This caused the
 * same "row exists but reads as not-found" failure mode on personas as it
 * did on brand_assets. Switched to getSupabaseAdmin() for consistency with
 * every write function in this file.
 */
export async function getDefaultPersona(userId: string): Promise<DbResult<PersonaRow>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.personas)
    .select('*')
    .eq('user_id', userId)
    .eq('is_default', true)
    .single();

  // Supabase returns PGRST116 "no rows" when .single() finds nothing — treat as null, not error
  if (error?.code === 'PGRST116') return { data: null, error: null };
  return { data: data ?? null, error: error?.message ?? null };
}

/**
 * Insert a new persona for a user.
 *
 * INVARIANT: If this is the user's first persona, it should be set as default.
 * The caller (usePersonas hook or the setup flow) is responsible for setting
 * is_default=true when creating the first persona. This function does not
 * auto-default — it inserts exactly what is passed.
 */
export async function createPersona(persona: NewPersona): Promise<DbResult<PersonaRow>> {
  const { data, error } = await supabase
    .from(T.personas)
    .insert(persona)
    .select()
    .single();

  return { data: data ?? null, error: error?.message ?? null };
}

/**
 * Set a specific persona as the user's default.
 *
 * TWO-STEP UPDATE (non-atomic):
 *   Step 1: SET is_default=false WHERE user_id = userId
 *   Step 2: SET is_default=true  WHERE id = personaId AND user_id = userId
 *
 * ATOMICITY CONCERN:
 *   If step 1 succeeds but step 2 fails, the user is left with NO default persona.
 *   If step 2 fails, the error is returned — the caller should re-fetch and inform
 *   the user. The getDefaultPersona() function handles the "no default" case gracefully.
 *
 *   TODO: Replace with a Postgres RPC for true atomicity:
 *   CREATE OR REPLACE FUNCTION set_default_persona(p_user_id uuid, p_persona_id uuid)
 *   RETURNS void AS $$
 *   BEGIN
 *     UPDATE personas SET is_default = false WHERE user_id = p_user_id;
 *     UPDATE personas SET is_default = true  WHERE id = p_persona_id AND user_id = p_user_id;
 *   END;
 *   $$ LANGUAGE plpgsql SECURITY DEFINER;
 */
export async function setDefaultPersona(
  userId: string,
  personaId: string
): Promise<{ error: string | null }> {
  // Step 1: Unset all existing defaults for this user
  const { error: unsetError } = await supabase
    .from(T.personas)
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (unsetError) return { error: unsetError.message };

  // Step 2: Set the target persona as default
  const { error: setError } = await supabase
    .from(T.personas)
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', personaId)
    .eq('user_id', userId); // Safety: prevent cross-user default setting

  return { error: setError?.message ?? null };
}

/**
 * Update mutable persona fields.
 *
 * Immutable fields (id, user_id, workspace_id, created_at) are excluded from
 * the type. workspace_id is immutable post-creation in P0. updated_at is
 * always overwritten here.
 *
 * EDGE CASE: If you update is_default=true directly via updatePersona()
 * without unsetting other defaults first, you'll end up with 2+ default personas.
 * Use setDefaultPersona() for default management — never updatePersona() for that.
 */
/**
 * BUGFIX: previously wrote via the bare `supabase` singleton. Same root
 * cause as getAsset()/getDefaultPersona() above — without a session, this
 * client cannot satisfy auth.uid()-gated RLS, so the update would silently
 * affect zero rows. Switched to getSupabaseAdmin() for consistency with
 * createAsset/updateAsset/archiveAsset/updateAssetStatus/updateAssetVlmResult.
 */
export async function updatePersona(
  personaId: string,
  updates: Partial<Omit<PersonaRow, 'id' | 'user_id' | 'workspace_id' | 'created_at'>>
): Promise<DbResult<PersonaRow>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.personas)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', personaId)
    .select()
    .single();

  return { data: data ?? null, error: error?.message ?? null };
}

/**
 * Hard-delete a persona.
 *
 * EDGE CASE: Deleting the default persona leaves the user with no default.
 * The caller (usePersonas hook) should:
 *   1. If other personas exist → call setDefaultPersona() on the next one
 *   2. If no personas remain → show the "create your first persona" prompt
 *
 * EDGE CASE: Campaigns that reference this persona_id via FK retain the
 * reference but the persona record is gone. The UI should degrade gracefully
 * (e.g., show "persona deleted" instead of fetching the persona name).
 */
export async function deletePersona(personaId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from(T.personas)
    .delete()
    .eq('id', personaId);

  return { error: error?.message ?? null };
}

// ═════════════════════════════════════════════════════════════════════════════
// FEEDBACK
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Insert a single feedback signal for a campaign.
 *
 * Multiple signals per campaign are allowed — each is a separate row.
 * The identity layer aggregates all signals for a user to tune persona output.
 *
 * EDGE CASE: Duplicate signals (same user_id, campaign_id, signal) are allowed
 * at the DB level (no unique constraint). The identity layer's aggregation
 * naturally handles duplicates by treating them as frequency reinforcement.
 */
export async function submitFeedback(feedback: NewFeedback): Promise<DbResult<FeedbackRow>> {
  const { data, error } = await supabase
    .from(T.feedback)
    .insert(feedback)
    .select()
    .single();

  return { data: data ?? null, error: error?.message ?? null };
}

/**
 * Get all feedback rows for a campaign.
 * Ordered newest first to show the most recent feedback at the top.
 */
export async function getFeedbackForCampaign(
  campaignId: string
): Promise<DbListResult<FeedbackRow>> {
  const { data, error, count } = await supabase
    .from(T.feedback)
    .select('*', { count: 'exact' })
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });

  return { data: data ?? [], error: error?.message ?? null, count: count ?? null };
}

/**
 * Aggregate feedback signals for a user into a frequency map.
 *
 * Returns an object like: { useful: 12, generic: 3, off_tone: 1 }
 * Used by the identity layer to weight signal importance in persona tuning.
 *
 * EDGE CASE: Returns { data: {}, error: null } for users with no feedback.
 * An empty object means "no signal" — do not interpret it as an error.
 *
 * PERFORMANCE: This scans all feedback rows for a user (no limit).
 * For users with thousands of feedback rows, consider a DB-side aggregation
 * via a Supabase function instead of client-side reduce.
 *
 * TODO: Replace client-side reduce with a Postgres RPC for better performance:
 *   SELECT signal, COUNT(*) FROM feedback WHERE user_id = p_user_id GROUP BY signal;
 */
export async function getUserFeedbackStats(userId: string): Promise<
  DbResult<Record<string, number>>
> {
  const { data, error } = await supabase
    .from(T.feedback)
    .select('signal')
    .eq('user_id', userId);

  if (error || !data) return { data: null, error: error?.message ?? null };

  // Client-side aggregation: count occurrences of each signal value
  const stats = (data as Array<{ signal: string }>).reduce<Record<string, number>>(
    (acc, row) => {
      acc[row.signal] = (acc[row.signal] ?? 0) + 1;
      return acc;
    },
    {}
  );

  return { data: stats, error: null };
}
// ═════════════════════════════════════════════════════════════════════════════
// PERSONA PROFILE UPDATES (Fix G1)
// Moved from @brandos/brand-intelligence/BrandIntelligenceRuntime.updatePersonaProfile()
// Persona persistence belongs in @brandos/auth, not in the cognitive runtime.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Update (or create) the user's default brand persona from memory page fields.
 *
 * Upserts the is_default=true persona for the given userId.
 * If no default persona exists, creates one with the provided fields.
 *
 * OWNERSHIP: Auth package owns all persona persistence (IPersonaOperations).
 * Brand Intelligence must NOT write to the personas table directly.
 *
 * P0 — Implementation Wave 1A: workspaceId is required (PersonaRow.workspace_id
 * is NOT NULL). It is only used on the INSERT path (new default persona) —
 * on UPDATE, workspace_id is left unchanged since a persona's workspace is
 * immutable in P0.
 *
 * @param userId - Auth UUID of the user.
 * @param workspaceId - FK → workspaces.id. Used only when creating a new
 *   default persona row.
 * @param fields - Partial set of brand persona fields (tone, audience, etc.).
 * @returns The upserted PersonaRow or an error string.
 */
export async function updatePersonaProfile(
  userId: string,
  workspaceId: string,
  fields: {
    tone?: string;
    audience?: string;
    industry?: string;
    positioning?: string;
    keywords?: string;
  }
): Promise<DbResult<PersonaRow>> {
  const { data: existing, error: lookupError } = await supabase
    .from(T.personas)
    .select('id')
    .eq('user_id', userId)
    .eq('is_default', true)
    .single();

  if (lookupError && lookupError.code !== 'PGRST116') {
    // PGRST116 = "no rows returned" — not an error for upsert
    return { data: null, error: lookupError.message };
  }

  if (existing?.id) {
    // UPDATE path — workspace_id is immutable, do not include it.
    const personaUpdate = {
      tone:         fields.tone ?? 'executive',
      domain:       fields.industry ?? null,
      audience:     fields.audience ?? null,
      key_themes:   fields.positioning
        ? fields.positioning.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [],
      visual_style: fields.keywords ? { keywords: fields.keywords } : {},
      updated_at:   new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from(T.personas)
      .update(personaUpdate)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) return { data: null, error: error.message };
    return { data: data as PersonaRow, error: null };
  }

  // INSERT path — workspace_id is required on NewPersona.
  const personaInsert: NewPersona = {
    user_id:      userId,
    workspace_id: workspaceId,
    name:         'Default Brand Persona',
    tone:         (fields.tone ?? 'executive') as PersonaRow['tone'],
    domain:       fields.industry ?? null,
    audience:     fields.audience ?? null,
    key_themes:   fields.positioning
      ? fields.positioning.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [],
    visual_style: fields.keywords ? { keywords: fields.keywords } : {},
    is_default:   true,
  };

  const { data, error } = await supabase
    .from(T.personas)
    .insert(personaInsert)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as PersonaRow, error: null };
}


// ─────────────────────────────────────────────────────────────────────────────
// GROUP C2 — WORKSPACE DB OPERATIONS (P0 — Implementation Wave 1A)
// Implements IWorkspaceOperations from IAuth.ts.
// See that interface for full doc comments on each function.
// ─────────────────────────────────────────────────────────────────────────────

export async function getWorkspaceById(
  workspaceId: string
): Promise<DbResult<WorkspaceRow>> {
  const { data, error } = await supabase
    .from(T.workspaces)
    .select('*')
    .eq('id', workspaceId)
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as WorkspaceRow, error: null };
}

export async function getWorkspaceByOwnerId(
  userId: string
): Promise<DbResult<WorkspaceRow>> {
  const { data, error } = await supabase
    .from(T.workspaces)
    .select('*')
    .eq('owner_id', userId)
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as WorkspaceRow, error: null };
}

export async function createWorkspace(
  workspace: NewWorkspace
): Promise<DbResult<WorkspaceRow>> {
  const { data, error } = await supabase
    .from(T.workspaces)
    .insert(workspace)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as WorkspaceRow, error: null };
}

export async function updateWorkspace(
  workspaceId: string,
  updates: Partial<Pick<WorkspaceRow, 'name' | 'slug' | 'plan'>>
): Promise<DbResult<WorkspaceRow>> {
  const { data, error } = await supabase
    .from(T.workspaces)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', workspaceId)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as WorkspaceRow, error: null };
}

export async function getWorkspaceSettings(
  workspaceId: string
): Promise<DbResult<WorkspaceSettingsRow>> {
  const { data, error } = await supabase
    .from(T.workspace_settings)
    .select('*')
    .eq('workspace_id', workspaceId)
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as WorkspaceSettingsRow, error: null };
}

export async function getOrCreateWorkspaceSettings(
  workspaceId: string,
  seed?: NewWorkspaceSettings
): Promise<DbResult<WorkspaceSettingsRow>> {
  // Try to fetch existing row first (idempotent)
  const { data: existing, error: fetchError } = await supabase
    .from(T.workspace_settings)
    .select('*')
    .eq('workspace_id', workspaceId)
    .single();

  // PGRST116 = row not found — expected on first call, not an error
  if (fetchError && fetchError.code !== 'PGRST116') {
    return { data: null, error: fetchError.message };
  }
  if (existing) {
    // Already exists — seed is ignored (we never overwrite existing settings)
    return { data: existing as WorkspaceSettingsRow, error: null };
  }

  // Create with seed (or all-null defaults if no seed provided)
  const newSettings: WorkspaceSettingsRow = {
    workspace_id:             workspaceId,
    preferred_provider:       seed?.preferred_provider       ?? null,
    runtime_mode:             seed?.runtime_mode             ?? null,
    governance_score_threshold: seed?.governance_score_threshold ?? null,
    monthly_generation_limit: seed?.monthly_generation_limit ?? null,
    asset_storage_limit_mb:   seed?.asset_storage_limit_mb   ?? null,
    updated_at:               new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(T.workspace_settings)
    .insert(newSettings)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as WorkspaceSettingsRow, error: null };
}

export async function updateWorkspaceSettings(
  workspaceId: string,
  updates: Partial<Omit<WorkspaceSettingsRow, 'workspace_id' | 'updated_at'>>
): Promise<DbResult<WorkspaceSettingsRow>> {
  const { data, error } = await supabase
    .from(T.workspace_settings)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as WorkspaceSettingsRow, error: null };
}

// ═════════════════════════════════════════════════════════════════════════════
// BRAND ASSETS (P1 — Asset Vault Evolution)
// Implements IAssetOperations from IAuth.ts
//
// ALL queries are workspace-scoped. workspaceId always comes from
// requireUser() in the calling route handler — never from client input.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * List assets for a workspace, with optional filtering and pagination.
 * Excludes archived assets by default (status != 'archived').
 *
 * EDGE CASE: Returns { data: [], count: 0, error: null } for workspaces with
 * no assets. Not an error condition.
 */
export async function listAssets(
  workspaceId: string,
  opts: AssetListOptions = {}
): Promise<DbListResult<BrandAssetRow>> {
  const {
    limit = 50,
    offset = 0,
    status,
    mimeCategory = 'all',
    tag,
    sortBy = 'created_at',
    sortDir = 'desc',
  } = opts;

  // Uses admin client — see getAsset() below for why the anon singleton
  // cannot be used for server-side reads on this table. Workspace isolation
  // is enforced explicitly via .eq('workspace_id', workspaceId), so this
  // does not widen access — it just makes the read actually return rows.
  let query = getSupabaseAdmin()
    .from(T.brand_assets)
    .select('*', { count: 'exact' })
    .eq('workspace_id', workspaceId);

  // Status filter
  if (status) {
    if (Array.isArray(status)) {
      query = query.in('status', status);
    } else {
      query = query.eq('status', status);
    }
  } else {
    // Default: exclude archived
    query = query.neq('status', 'archived');
  }

  // MIME category filter
  if (mimeCategory === 'image') {
    query = query.like('mime_type', 'image/%');
  } else if (mimeCategory === 'document') {
    query = query.not('mime_type', 'like', 'image/%');
  }

  // Tag filter (array contains)
  if (tag) {
    query = query.contains('tags', [tag]);
  }

  // Sorting
  query = query.order(sortBy, { ascending: sortDir === 'asc' });

  // Pagination
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  return { data: (data as BrandAssetRow[]) ?? [], error: error?.message ?? null, count: count ?? null };
}

/**
 * Fetch a single asset by ID, scoped to a workspace.
 * Returns null (not error) if the asset does not exist or belongs to a
 * different workspace — prevents cross-workspace enumeration.
 *
 * BUGFIX (post-upload 404s): this previously read via the bare `supabase`
 * singleton, which is a `createBrowserClient` instance with no cookie
 * adapter (see getSupabaseClient() in supabaseClient.ts). Called from a
 * Node.js route handler, it carries no session — auth.uid() is NULL for
 * every request — so any RLS SELECT policy gated on auth.uid() silently
 * returns zero rows. The PGRST116 → {data:null,error:null} mapping below
 * then makes that indistinguishable from "asset doesn't exist," which is
 * exactly the 404 the analyze and download routes were returning for
 * assets that had just been created successfully one request earlier.
 * Every write function in this file (createAsset, updateAsset,
 * archiveAsset, updateAssetStatus, updateAssetVlmResult) already uses
 * getSupabaseAdmin() for this reason — this brings the read in line with
 * the writes. Workspace isolation is unaffected: it's enforced explicitly
 * via .eq('workspace_id', workspaceId), not via RLS.
 */
export async function getAsset(
  assetId: string,
  workspaceId: string
): Promise<DbResult<BrandAssetRow>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.brand_assets)
    .select('*')
    .eq('id', assetId)
    .eq('workspace_id', workspaceId)  // CRITICAL: workspace isolation
    .single();

  if (error?.code === 'PGRST116') return { data: null, error: null };
  if (error) return { data: null, error: error.message };
  return { data: data as BrandAssetRow, error: null };
}

/**
 * Insert a new brand_assets row.
 * All fields must be supplied by the caller (upload route).
 * storage_path must follow the P1 convention:
 *   `${workspace_id}/${asset_id}/${sanitized_original_filename}`
 */
export async function createAsset(
  asset: NewBrandAsset
): Promise<DbResult<BrandAssetRow>> {
  // Uses admin client — auth.uid() is NULL in server-side route handlers
  // when using the anon singleton. Workspace ownership is already verified
  // by requireUser() in the calling route before this function is reached.
  const { data, error } = await getSupabaseAdmin()
    .from(T.brand_assets)
    .insert(asset)
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as BrandAssetRow, error: null };
}

/**
 * Update user-editable fields (name, tags) on an asset.
 * Scoped to workspaceId — only updates if the asset belongs to this workspace.
 * updated_at is set automatically.
 */
export async function updateAsset(
  assetId: string,
  workspaceId: string,
  updates: AssetUpdateFields
): Promise<DbResult<BrandAssetRow>> {
  // Uses admin client — see createAsset() comment.
  const { data, error } = await getSupabaseAdmin()
    .from(T.brand_assets)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', assetId)
    .eq('workspace_id', workspaceId)  // CRITICAL: workspace isolation
    .select()
    .single();

  if (error?.code === 'PGRST116') return { data: null, error: 'Asset not found' };
  if (error) return { data: null, error: error.message };
  return { data: data as BrandAssetRow, error: null };
}

/**
 * Soft-archive an asset.
 * Sets status='archived', archived_at=now().
 * Storage object is NOT deleted.
 * Scoped to workspaceId.
 */
export async function archiveAsset(
  assetId: string,
  workspaceId: string
): Promise<DbResult<BrandAssetRow>> {
  // Uses admin client — see createAsset() comment.
  const { data, error } = await getSupabaseAdmin()
    .from(T.brand_assets)
    .update({
      status: 'archived' as BrandAssetStatus,
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', assetId)
    .eq('workspace_id', workspaceId)  // CRITICAL: workspace isolation
    .select()
    .single();

  if (error?.code === 'PGRST116') return { data: null, error: 'Asset not found' };
  if (error) return { data: null, error: error.message };
  return { data: data as BrandAssetRow, error: null };
}

/**
 * Update the lifecycle status of an asset.
 * Used by analyze and reindex routes. Scoped to workspaceId.
 *
 * Valid transitions:
 *   uploading  → processing (upload complete, analysis queued)
 *   processing → indexed   (VLM analysis succeeded)
 *   processing → failed    (VLM analysis failed)
 *   failed     → processing (reindex triggered)
 */
export async function updateAssetStatus(
  assetId: string,
  workspaceId: string,
  status: BrandAssetStatus
): Promise<DbResult<BrandAssetRow>> {
  // Uses admin client — see createAsset() comment.
  const { data, error } = await getSupabaseAdmin()
    .from(T.brand_assets)
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', assetId)
    .eq('workspace_id', workspaceId)  // CRITICAL: workspace isolation
    .select()
    .single();

  if (error?.code === 'PGRST116') return { data: null, error: 'Asset not found' };
  if (error) return { data: null, error: error.message };
  return { data: data as BrandAssetRow, error: null };
}

/**
 * Write VLM analysis result and transition status to 'indexed'.
 * Called by POST /api/assets/:id/analyze on successful VLM completion.
 * Scoped to workspaceId.
 */
export async function updateAssetVlmResult(
  assetId: string,
  workspaceId: string,
  vlmAnalysis: Record<string, unknown>
): Promise<DbResult<BrandAssetRow>> {
  // Uses admin client — see createAsset() comment.
  const { data, error } = await getSupabaseAdmin()
    .from(T.brand_assets)
    .update({
      vlm_analysis: vlmAnalysis,
      status: 'indexed' as BrandAssetStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', assetId)
    .eq('workspace_id', workspaceId)  // CRITICAL: workspace isolation
    .select()
    .single();

  if (error?.code === 'PGRST116') return { data: null, error: 'Asset not found' };
  if (error) return { data: null, error: error.message };
  return { data: data as BrandAssetRow, error: null };
}

/**
 * Cognitive Platform Evolution Program, EM-2.6 (Ingestion Correlation &
 * Confirmation). Records the IntelligenceOS knowledge-asset id returned by
 * a successful `POST /v1/knowledge/ingest` call. Deliberately NOT folded
 * into `AssetUpdateFields`/`updateAsset()` — that type is scoped to
 * "fields a user may update via PATCH /api/assets/:id" (see IAuth.ts), and
 * this is a system-internal correlation write, not a user edit. Mirrors
 * updateAssetStatus()'s shape. Scoped to workspaceId, same as every other
 * asset write in this file.
 */
export async function recordAssetIntelligenceSync(
  assetId: string,
  workspaceId: string,
  intelligenceAssetId: string
): Promise<DbResult<BrandAssetRow>> {
  // Uses admin client — see createAsset() comment.
  const { data, error } = await getSupabaseAdmin()
    .from(T.brand_assets)
    .update({ intelligence_asset_id: intelligenceAssetId, updated_at: new Date().toISOString() })
    .eq('id', assetId)
    .eq('workspace_id', workspaceId)  // CRITICAL: workspace isolation
    .select()
    .single();

  if (error?.code === 'PGRST116') return { data: null, error: 'Asset not found' };
  if (error) return { data: null, error: error.message };
  return { data: data as BrandAssetRow, error: null };
}

/**
 * Return total storage bytes consumed by all non-archived assets in a workspace.
 * Pre-wired for P2 storage quota enforcement.
 * Returns 0 for workspaces with no assets (not an error).
 *
 * Uses admin client — see getAsset() for why the anon singleton cannot be
 * used for server-side reads here. Without this, the quota gate in the
 * upload route always read 0 bytes used, silently disabling enforcement
 * regardless of actual usage.
 */
export async function getTotalAssetStorageForWorkspace(
  workspaceId: string
): Promise<DbResult<number>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.brand_assets)
    .select('size_bytes')
    .eq('workspace_id', workspaceId)
    .neq('status', 'archived');

  if (error) return { data: null, error: error.message };

  const total = (data as Array<{ size_bytes: number }>).reduce(
    (sum, row) => sum + (row.size_bytes ?? 0),
    0
  );
  return { data: total, error: null };
}
/**
 * Count the number of brand_assets uploaded by a workspace in the current
 * calendar month (UTC). Used by P2 upload-count enforcement.
 *
 * Excludes archived assets (archived assets don't count against the monthly
 * upload budget — the upload already happened, archiving is a lifecycle state).
 * This intentionally counts ALL non-archived uploads, not just "successful" ones.
 *
 * WORKSPACE ISOLATION: workspaceId is always from requireUser() — never from
 * a client request parameter.
 *
 * Returns 0 for workspaces with no uploads this month (not an error).
 *
 * Uses admin client — see getAsset() for why the anon singleton cannot be
 * used for server-side reads here. Without this, the quota gate in the
 * upload route always read 0 uploads this month, silently disabling
 * enforcement regardless of actual usage.
 */
export async function countMonthlyUploadsForWorkspace(
  workspaceId: string
): Promise<DbResult<number>> {
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()

  const { count, error } = await getSupabaseAdmin()
    .from(T.brand_assets)
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .gte('created_at', monthStart)

  if (error) return { data: null, error: error.message }
  return { data: count ?? 0, error: null }
}

// ═════════════════════════════════════════════════════════════════════════════
// GROUP I — WORKSPACE PROVIDER OPERATIONS (P3 — BYOK, Usage, Health)
//
// All three tables (workspace_api_keys, workspace_provider_usage,
// workspace_provider_health) are written exclusively via the admin client
// (service-role key) because these functions run server-side inside Next.js
// API route handlers and CPL — auth.uid() is NULL in that context.
// Workspace isolation is enforced by the workspaceId parameter, which always
// comes from requireUser() in the calling route.
//
// F4 REQUIREMENT: listWorkspaceApiKeys() does ONE query for the full workspace.
// The credentials service (resolver.ts) calls this — not getWorkspaceApiKey()
// per provider — to avoid N round-trips on the generation hot path.
// ═════════════════════════════════════════════════════════════════════════════

// ─── workspace_api_keys ───────────────────────────────────────────────────────

/**
 * Fetch ALL active (non-revoked) API key rows for a workspace.
 *
 * F4 REQUIREMENT: one query, not one per provider.
 * The credentials service (getProviderKeyMap) calls this and builds the
 * provider→plaintextKey map in memory from the result.
 */
export async function listWorkspaceApiKeys(
  workspaceId: string
): Promise<DbListResult<WorkspaceApiKeyRow>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.workspace_api_keys)
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .is('revoked_at', null)

  if (error) return { data: [], error: error.message, count: null }
  return { data: (data ?? []) as WorkspaceApiKeyRow[], error: null, count: data?.length ?? 0 }
}

/**
 * Fetch the single active API key row for one (workspace, provider) pair.
 * Returns { data: null, error: null } when no active row exists (not an error).
 */
export async function getWorkspaceApiKey(
  workspaceId: string,
  provider:    string
): Promise<DbResult<WorkspaceApiKeyRow>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.workspace_api_keys)
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .eq('is_active', true)
    .is('revoked_at', null)
    .single()

  if (error?.code === 'PGRST116') return { data: null, error: null }
  if (error) return { data: null, error: error.message }
  return { data: data as WorkspaceApiKeyRow, error: null }
}

/**
 * Upsert an API key row.
 * ON CONFLICT (workspace_id, provider) replaces the existing row atomically.
 * For rotation (where rotated_at must also be set), use rotateWorkspaceApiKey().
 */
export async function upsertWorkspaceApiKey(
  row: NewWorkspaceApiKey
): Promise<DbResult<WorkspaceApiKeyRow>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.workspace_api_keys)
    .upsert(row, { onConflict: 'workspace_id,provider' })
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as WorkspaceApiKeyRow, error: null }
}

/**
 * Rotate an existing key in-place.
 * Replaces ciphertext fields and sets rotated_at=now().
 * Returns error if no active row exists for (workspaceId, provider).
 */
export async function rotateWorkspaceApiKey(
  workspaceId: string,
  provider:    string,
  fields: {
    encrypted_key: string;
    iv:            string;
    auth_tag:      string;
    key_hint:      string;
  }
): Promise<DbResult<WorkspaceApiKeyRow>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.workspace_api_keys)
    .update({
      ...fields,
      rotated_at:   new Date().toISOString(),
      validated_at: null,   // requires re-validation after rotation
    })
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .eq('is_active', true)
    .is('revoked_at', null)
    .select()
    .single()

  if (error?.code === 'PGRST116') return { data: null, error: 'No active key found for this provider' }
  if (error) return { data: null, error: error.message }
  return { data: data as WorkspaceApiKeyRow, error: null }
}

/**
 * Soft-revoke a provider key.
 * Sets is_active=false, revoked_at=now(). Does not hard-delete.
 */
export async function revokeWorkspaceApiKey(
  workspaceId: string,
  provider:    string
): Promise<DbResult<WorkspaceApiKeyRow>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.workspace_api_keys)
    .update({
      is_active:  false,
      revoked_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .eq('is_active', true)
    .select()
    .single()

  if (error?.code === 'PGRST116') return { data: null, error: 'No active key found for this provider' }
  if (error) return { data: null, error: error.message }
  return { data: data as WorkspaceApiKeyRow, error: null }
}

/**
 * Mark a key as successfully validated.
 * Sets validated_at to the provided ISO timestamp.
 */
export async function markWorkspaceApiKeyValidated(
  workspaceId: string,
  provider:    string,
  validatedAt: string
): Promise<DbResult<WorkspaceApiKeyRow>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.workspace_api_keys)
    .update({ validated_at: validatedAt })
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .eq('is_active', true)
    .select()
    .single()

  if (error?.code === 'PGRST116') return { data: null, error: 'No active key found for this provider' }
  if (error) return { data: null, error: error.message }
  return { data: data as WorkspaceApiKeyRow, error: null }
}

// ─── workspace_oauth_connections (Priority 4/5 — Canva/Figma export) ─────────

/**
 * Fetch the single active OAuth connection row for one (workspace, provider) pair.
 * Returns { data: null, error: null } when no active row exists (not an error).
 */
export async function getWorkspaceOAuthConnection(
  workspaceId: string,
  provider:    string
): Promise<DbResult<WorkspaceOAuthConnectionRow>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.workspace_oauth_connections)
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .eq('is_active', true)
    .is('revoked_at', null)
    .single()

  if (error?.code === 'PGRST116') return { data: null, error: null }
  if (error) return { data: null, error: error.message }
  return { data: data as WorkspaceOAuthConnectionRow, error: null }
}

/**
 * Upsert an OAuth connection row (initial connect, or re-connect after revoke).
 * ON CONFLICT (workspace_id, provider) WHERE is_active=true replaces the
 * existing row atomically — mirrors upsertWorkspaceApiKey()'s convention.
 */
export async function upsertWorkspaceOAuthConnection(
  row: NewWorkspaceOAuthConnection
): Promise<DbResult<WorkspaceOAuthConnectionRow>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.workspace_oauth_connections)
    .upsert(row, { onConflict: 'workspace_id,provider' })
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as WorkspaceOAuthConnectionRow, error: null }
}

/**
 * Update the access token (and optionally refresh token) in place after a
 * token-refresh exchange. Sets refreshed_at=now(). Returns error if no
 * active connection exists for (workspaceId, provider).
 */
export async function refreshWorkspaceOAuthConnection(
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
): Promise<DbResult<WorkspaceOAuthConnectionRow>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.workspace_oauth_connections)
    .update({
      ...fields,
      refreshed_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .eq('is_active', true)
    .is('revoked_at', null)
    .select()
    .single()

  if (error?.code === 'PGRST116') return { data: null, error: 'No active connection found for this provider' }
  if (error) return { data: null, error: error.message }
  return { data: data as WorkspaceOAuthConnectionRow, error: null }
}

/**
 * Soft-revoke an OAuth connection (disconnect).
 * Sets is_active=false, revoked_at=now(). Does not hard-delete.
 */
export async function revokeWorkspaceOAuthConnection(
  workspaceId: string,
  provider:    string
): Promise<DbResult<WorkspaceOAuthConnectionRow>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.workspace_oauth_connections)
    .update({
      is_active:  false,
      revoked_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .eq('is_active', true)
    .select()
    .single()

  if (error?.code === 'PGRST116') return { data: null, error: 'No active connection found for this provider' }
  if (error) return { data: null, error: error.message }
  return { data: data as WorkspaceOAuthConnectionRow, error: null }
}

// ─── figma_handoff_tokens (Priority 5 — Figma Export plugin handoff) ────────

/**
 * Create a new handoff token. Called server-side when the user clicks
 * "Export to Figma" — snapshots the artifact at that moment so the plugin
 * fetches exactly what the user clicked export on, even if they keep
 * editing in BrandOS afterward.
 */
export async function createFigmaHandoffToken(
  row: NewFigmaHandoffToken
): Promise<DbResult<FigmaHandoffTokenRow>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.figma_handoff_tokens)
    .insert(row)
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as FigmaHandoffTokenRow, error: null }
}

/**
 * Atomically fetch-and-consume a handoff token. Uses an UPDATE ... WHERE
 * consumed_at IS NULL AND expires_at > now() ... RETURNING pattern (single
 * round trip) so two concurrent fetches of the same token cannot both
 * succeed — the second one's WHERE clause simply matches zero rows.
 */
export async function consumeFigmaHandoffToken(
  token: string
): Promise<DbResult<FigmaHandoffTokenRow>> {
  const nowIso = new Date().toISOString()

  const { data, error } = await getSupabaseAdmin()
    .from(T.figma_handoff_tokens)
    .update({ consumed_at: nowIso })
    .eq('token', token)
    .is('consumed_at', null)
    .gt('expires_at', nowIso)
    .select()
    .single()

  if (error?.code === 'PGRST116') {
    return { data: null, error: 'Handoff token not found, already used, or expired.' }
  }
  if (error) return { data: null, error: error.message }
  return { data: data as FigmaHandoffTokenRow, error: null }
}

// ─── workspace_provider_usage ─────────────────────────────────────────────────

/**
 * Append one usage row.
 * Fire-and-forget — never awaited on the generation hot path.
 */
export async function recordProviderUsage(
  row: NewWorkspaceProviderUsage
): Promise<DbResult<WorkspaceProviderUsageRow>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.workspace_provider_usage)
    .insert(row)
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as WorkspaceProviderUsageRow, error: null }
}

/**
 * Aggregate usage summary by provider for a workspace.
 * Returns one entry per provider with total request count and summed tokens.
 * Used by GET /api/workspace/providers/usage (W7).
 */
export async function getWorkspaceProviderUsageSummary(
  workspaceId: string
): Promise<DbResult<Array<{ provider: string; request_count: number; total_tokens: number | null }>>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.workspace_provider_usage)
    .select('provider, total_tokens')
    .eq('workspace_id', workspaceId)

  if (error) return { data: null, error: error.message }

  // Aggregate in memory — avoids a GROUP BY RPC
  const map = new Map<string, { request_count: number; total_tokens: number | null }>()
  for (const row of (data ?? []) as Array<{ provider: string; total_tokens: number | null }>) {
    const existing = map.get(row.provider) ?? { request_count: 0, total_tokens: null }
    map.set(row.provider, {
      request_count: existing.request_count + 1,
      total_tokens:
        row.total_tokens != null
          ? (existing.total_tokens ?? 0) + row.total_tokens
          : existing.total_tokens,
    })
  }

  const summary = [...map.entries()].map(([provider, stats]) => ({
    provider,
    ...stats,
  }))
  return { data: summary, error: null }
}

// ─── workspace_provider_health ────────────────────────────────────────────────

/**
 * Upsert the health snapshot for one (workspace, provider) pair.
 * outcome='success' → last_success_at=now()
 * outcome='failure' → last_failure_at=now(), failure_count++
 * updated_at is always now().
 */
export async function upsertWorkspaceProviderHealth(
  workspaceId: string,
  provider:    string,
  outcome:     'success' | 'failure'
): Promise<DbResult<WorkspaceProviderHealthRow>> {
  const now = new Date().toISOString()

  // Fetch existing row to compute new failure_count atomically in-process.
  // This is acceptable: fire-and-forget writes are not ACID-critical.
  const { data: existing } = await getSupabaseAdmin()
    .from(T.workspace_provider_health)
    .select('failure_count')
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .single()

  const currentFailureCount = (existing as { failure_count: number } | null)?.failure_count ?? 0

  const upsertRow = {
    workspace_id:     workspaceId,
    provider,
    last_success_at:  outcome === 'success' ? now : undefined,
    last_failure_at:  outcome === 'failure' ? now : undefined,
    failure_count:    outcome === 'failure' ? currentFailureCount + 1 : currentFailureCount,
    updated_at:       now,
  }

  const { data, error } = await getSupabaseAdmin()
    .from(T.workspace_provider_health)
    .upsert(upsertRow, { onConflict: 'workspace_id,provider' })
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as WorkspaceProviderHealthRow, error: null }
}

/**
 * Fetch all health rows for a workspace.
 * Used by GET /api/workspace/providers/usage (W7).
 */
export async function listWorkspaceProviderHealth(
  workspaceId: string
): Promise<DbListResult<WorkspaceProviderHealthRow>> {
  const { data, error } = await getSupabaseAdmin()
    .from(T.workspace_provider_health)
    .select('*')
    .eq('workspace_id', workspaceId)

  if (error) return { data: [], error: error.message, count: null }
  return { data: (data ?? []) as WorkspaceProviderHealthRow[], error: null, count: data?.length ?? 0 }
}
