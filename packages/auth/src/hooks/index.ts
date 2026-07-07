'use client';
// ============================================================
// @brandos/auth — src/hooks/index.ts
//
// REACT HOOKS — DB OPERATIONS WITH LOADING/ERROR STATE
//
// ARCHITECTURAL ROLE:
//   These hooks are the primary interface between React UI components and the
//   database layer. They wrap dbService.ts functions with React state management
//   (loading, error, optimistic updates) and automatically scope queries to the
//   currently authenticated user via useAuth().
//
// ALL HOOKS REQUIRE:
//   - A parent <AuthProvider> in the tree (for useAuth())
//   - 'use client' — these hooks use useState/useEffect and cannot run on the server
//
// OPTIMISTIC UPDATE PATTERN:
//   create/update/remove operations update local state immediately on success
//   without waiting for a re-fetch. This gives instant UI feedback. If the
//   operation fails, the error is returned and the caller can roll back.
//
// AGENT GUIDANCE:
//   - Never call dbService functions directly in components — use these hooks.
//   - `refresh` is provided for forced re-fetches (e.g., after a server-side
//     generation completes and the campaign content should be re-read).
//   - Hooks do NOT auto-refresh on window focus or interval — this is intentional
//     to avoid unnecessary reads. Use `refresh` explicitly when needed.
//
// IMPLEMENTS: UseCampaignsReturn, UsePersonasReturn, UseFeedbackReturn
//             from src/IAuth.ts
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  getCampaigns, createCampaign, updateCampaign, deleteCampaign,
  getPersonas, createPersona, updatePersona, deletePersona, setDefaultPersona,
  submitFeedback, getUserFeedbackStats,
} from '../db/dbService';
import type {
  CampaignRow,
  PersonaRow,
  FeedbackRow,
  NewCampaign,
  NewPersona,
  NewFeedback,
  DbResult,
  DbListResult,
} from '@brandos/contracts';

// ═════════════════════════════════════════════════════════════════════════════
// useCampaigns
//
// Manages the list of campaigns for the currently authenticated user.
// Provides CRUD operations with optimistic local state updates.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Hook for managing the authenticated user's campaigns.
 *
 * AUTO-FETCHES on mount when user is available. Re-fetches when user changes
 * (e.g., account switch). Does NOT re-fetch on every render.
 *
 * OPTIMISTIC UPDATES:
 *   - create: prepends to local list on success
 *   - update: replaces the updated item in-place on success
 *   - remove: filters out the deleted item on success
 *   None of these trigger a full re-fetch — call refresh() explicitly if needed.
 *
 * @param limit — max campaigns per page (default 20). Passed to getCampaigns().
 */
export function useCampaigns(limit = 20) {
  const { user }                          = useAuth();
  const [campaigns, setCampaigns]         = useState<CampaignRow[]>([]);
  const [isLoading, setIsLoading]         = useState<boolean>(false);
  const [error, setError]                 = useState<string | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!user) return; // Not authenticated — skip fetch
    setIsLoading(true);
    setError(null);
    const { data, error: fetchError } = await getCampaigns(user.id, limit);
    setCampaigns(data);
    setError(fetchError);
    setIsLoading(false);
  }, [user, limit]);

  useEffect(() => { load(); }, [load]);

  // ── Create ──────────────────────────────────────────────────────────────
  /**
   * Create a new campaign scoped to the current user's workspace.
   * user_id and workspace_id are injected automatically — do not pass them.
   * On success: prepends to the local campaigns list (newest first).
   *
   * P0 — Implementation Wave 1A: workspace_id is sourced from
   * user.workspaceId (AuthUser.workspaceId, NOT NULL).
   */
  const create = useCallback(async (
    campaign: Omit<NewCampaign, 'user_id' | 'workspace_id'>
  ): Promise<DbResult<CampaignRow>> => {
    if (!user) return { data: null, error: 'Not authenticated' };
    const result = await createCampaign({ ...campaign, user_id: user.id, workspace_id: user.workspaceId });
    if (result.data) {
      setCampaigns(prev => [result.data!, ...prev]);
    }
    return result;
  }, [user]);

  // ── Update ──────────────────────────────────────────────────────────────
  /**
   * Update a campaign by ID.
   * On success: replaces the matching item in the local list in-place.
   * The updated_at timestamp is set automatically by dbService.
   * workspace_id is excluded — immutable post-creation in P0.
   */
  const update = useCallback(async (
    id: string,
    updates: Partial<Omit<CampaignRow, 'id' | 'user_id' | 'workspace_id' | 'created_at'>>
  ): Promise<DbResult<CampaignRow>> => {
    const result = await updateCampaign(id, updates);
    if (result.data) {
      setCampaigns(prev => prev.map(c => c.id === id ? result.data! : c));
    }
    return result;
  }, []);

  // ── Remove ──────────────────────────────────────────────────────────────
  /**
   * Hard-delete a campaign by ID.
   * On success: removes the item from the local list immediately.
   * IRREVERSIBLE — see dbService.deleteCampaign for edge cases.
   */
  const remove = useCallback(async (
    id: string
  ): Promise<{ error: string | null }> => {
    const result = await deleteCampaign(id);
    if (!result.error) {
      setCampaigns(prev => prev.filter(c => c.id !== id));
    }
    return result;
  }, []);

  return {
    campaigns,
    isLoading,
    error,
    /** Force a full re-fetch from the server */
    refresh: load,
    create,
    update,
    remove,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// usePersonas
//
// Manages the list of personas for the currently authenticated user.
// Tracks the default persona and provides a setDefault action.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Hook for managing the authenticated user's personas.
 *
 * The defaultPersona is derived from the local list (persona.is_default === true).
 * It updates optimistically when setDefault() is called — no re-fetch needed.
 *
 * EDGE CASE — no personas: personas=[], defaultPersona=null.
 *   The UI should show a persona creation prompt in this state.
 *
 * EDGE CASE — no default set: personas has items but none is is_default=true.
 *   defaultPersona will be null. This can happen if setDefaultPersona() failed
 *   mid-operation. The UI should prompt the user to pick a default.
 */
export function usePersonas() {
  const { user }                        = useAuth();
  const [personas, setPersonas]         = useState<PersonaRow[]>([]);
  const [isLoading, setIsLoading]       = useState<boolean>(false);
  const [error, setError]               = useState<string | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    const { data, error: fetchError } = await getPersonas(user.id);
    setPersonas(data);
    setError(fetchError);
    setIsLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // ── Create ──────────────────────────────────────────────────────────────
  /**
   * Create a new persona for the current user's workspace.
   * user_id and workspace_id are injected automatically — see
   * useCampaigns.create for the same pattern.
   * On success: appends to the local list (newest last — personas are ordered
   * by is_default DESC, created_at ASC in getPersonas; local list mirrors this).
   */
  const create = useCallback(async (
    persona: Omit<NewPersona, 'user_id' | 'workspace_id'>
  ): Promise<DbResult<PersonaRow>> => {
    if (!user) return { data: null, error: 'Not authenticated' };
    const result = await createPersona({ ...persona, user_id: user.id, workspace_id: user.workspaceId });
    if (result.data) {
      setPersonas(prev => [...prev, result.data!]);
    }
    return result;
  }, [user]);

  // ── Update ──────────────────────────────────────────────────────────────
  /**
   * Update a persona by ID.
   * On success: replaces the matching item in-place.
   * Do NOT update is_default via this function — use setDefault() instead.
   * workspace_id is excluded — immutable post-creation in P0.
   */
  const update = useCallback(async (
    id: string,
    updates: Partial<Omit<PersonaRow, 'id' | 'user_id' | 'workspace_id' | 'created_at'>>
  ): Promise<DbResult<PersonaRow>> => {
    const result = await updatePersona(id, updates);
    if (result.data) {
      setPersonas(prev => prev.map(p => p.id === id ? result.data! : p));
    }
    return result;
  }, []);

  // ── Remove ──────────────────────────────────────────────────────────────
  /**
   * Hard-delete a persona by ID.
   * On success: removes from local list.
   *
   * CALLER RESPONSIBILITY: If the deleted persona was the default, the caller
   * should call setDefault() on another persona (or show the "create persona"
   * prompt if none remain). This hook does not auto-reassign the default.
   */
  const remove = useCallback(async (
    id: string
  ): Promise<{ error: string | null }> => {
    const result = await deletePersona(id);
    if (!result.error) {
      setPersonas(prev => prev.filter(p => p.id !== id));
    }
    return result;
  }, []);

  // ── Set Default ─────────────────────────────────────────────────────────
  /**
   * Set a persona as the user's default.
   *
   * OPTIMISTIC UPDATE: Updates is_default flags in local state immediately
   * (sets all to false, then the target to true). If the DB call fails,
   * the local state is left in the optimistic state — call refresh() to
   * resync from the server on error.
   *
   * EDGE CASE: If user is null, returns early with an error string.
   */
  const setDefault = useCallback(async (
    personaId: string
  ): Promise<{ error: string | null }> => {
    if (!user) return { error: 'Not authenticated' };
    const result = await setDefaultPersona(user.id, personaId);
    if (!result.error) {
      // Optimistically update all is_default flags in local state
      setPersonas(prev => prev.map(p => ({ ...p, is_default: p.id === personaId })));
    }
    return result;
  }, [user]);

  // Derived: the current default persona (null if none set)
  const defaultPersona = personas.find(p => p.is_default) ?? null;

  return {
    personas,
    defaultPersona,
    isLoading,
    error,
    refresh: load,
    create,
    update,
    remove,
    setDefault,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// useFeedback
//
// Manages feedback submission and aggregated stats for the current user.
// Used by the feedback UI and by the identity layer indirectly via stats.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Hook for submitting feedback and loading aggregated feedback stats.
 *
 * stats shape: { useful: 12, generic: 3, off_tone: 1 }
 * Empty object ({}) means no feedback has been submitted yet.
 *
 * OPTIMISTIC UPDATE on submit:
 *   Increments the signal count in local stats immediately after a successful
 *   submitFeedback() call — no re-fetch required for the count to update in UI.
 */
export function useFeedback() {
  const { user }                      = useAuth();
  const [stats, setStats]             = useState<Record<string, number>>({});
  const [isLoading, setIsLoading]     = useState<boolean>(false);
  const [error, setError]             = useState<string | null>(null);

  // ── Load stats ──────────────────────────────────────────────────────────
  const loadStats = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    const { data, error: fetchError } = await getUserFeedbackStats(user.id);
    setStats(data ?? {});
    setError(fetchError);
    setIsLoading(false);
  }, [user]);

  useEffect(() => { loadStats(); }, [loadStats]);

  // ── Submit ──────────────────────────────────────────────────────────────
  /**
   * Submit a feedback signal for a campaign.
   * user_id is injected automatically from the auth context.
   *
   * On success: optimistically increments the signal count in local stats.
   * This avoids a round-trip re-fetch for the common case of a single signal.
   *
   * EDGE CASE: If the DB insert fails, the error is returned and local stats
   * are NOT updated. The stats remain consistent with the server state.
   */
  const submit = useCallback(async (
    feedback: Omit<NewFeedback, 'user_id'>
  ): Promise<DbResult<FeedbackRow>> => {
    if (!user) return { data: null, error: 'Not authenticated' };
    const result = await submitFeedback({ ...feedback, user_id: user.id });
    if (result.data) {
      // Optimistic update: increment the submitted signal's count
      setStats(prev => ({
        ...prev,
        [feedback.signal]: (prev[feedback.signal] ?? 0) + 1,
      }));
    }
    return result;
  }, [user]);

  return {
    stats,
    isLoading,
    error,
    submit,
    refreshStats: loadStats,
  };
}


