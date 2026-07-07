/**
 * apps/web — Auth re-export
 *
 * Thin shell: all auth logic lives in @brandos/auth.
 * Cleanup Sprint 2 (WS1): removed intermediate presentation-layer hop.
 * Previously imported from @brandos/presentation-layer; now direct.
 */
export { authService, getSupabaseClient, getSupabaseAdmin, supabase } from '@brandos/auth';
export type { AuthUser, AuthSession } from '@brandos/auth';
