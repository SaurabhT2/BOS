// ============================================================
// @brandos/auth — src/index.ts
//
// PUBLIC API BARREL
//
// ARCHITECTURAL ROLE:
//   This is the single entry point for all consumers of @brandos/auth.
//   Everything exported here is part of the public interface defined in IAuth.ts.
//   Do NOT import from internal sub-modules (e.g. './auth/authService' directly)
//   from outside this package — always import from '@brandos/auth'.
//
// DEPENDENCY GRAPH:
//   @brandos/contracts → @brandos/auth → presentation-layer
//
// USAGE:
//   import { AuthProvider, useAuth, getCampaigns } from '@brandos/auth'
//   import type { AuthUser, CampaignRow } from '@brandos/auth'
//
// AGENT GUIDANCE:
//   When adding a new exported symbol:
//     1. Implement it in the appropriate src/* module
//     2. Declare its signature in src/IAuth.ts (interface boundary)
//     3. Export it from here
//   This three-step process ensures no silent API drift.
// ============================================================

// ── React Context (client-side only) ──────────────────────────────────────
export { AuthProvider, useAuth }        from './auth/AuthProvider';

// ── Auth Service Functions ─────────────────────────────────────────────────
export {
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  signInWithMagicLink,
  signOut,
  sendPasswordReset,
  updatePassword,
  getCurrentUser,
  getSession,
  onAuthStateChange,
  authService,
}                                       from './auth/authService';

// ── Supabase Client Access ─────────────────────────────────────────────────
export { supabase, getSupabaseClient, getSupabaseAdmin } from './auth/supabaseClient';

// ── DB Service Functions ───────────────────────────────────────────────────
export {
  // Users
  getUserById,
  updateUser,
  incrementGenerationsUsed,
  completeOnboarding,
  // Workspaces — P0 (Implementation Wave 1A)
  getWorkspaceById,
  getWorkspaceByOwnerId,
  createWorkspace,
  updateWorkspace,
  getWorkspaceSettings,
  getOrCreateWorkspaceSettings,
  updateWorkspaceSettings,
  // Campaigns
  getCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  // Personas
  getPersonas,
  getDefaultPersona,
  createPersona,
  updatePersona,
  deletePersona,
  setDefaultPersona,
  updatePersonaProfile,
  // Feedback
  submitFeedback,
  getFeedbackForCampaign,
  getUserFeedbackStats,
  // Brand Assets — P1 (Asset Vault Evolution)
  listAssets,
  getAsset,
  createAsset,
  updateAsset,
  archiveAsset,
  updateAssetStatus,
  updateAssetVlmResult,
  recordAssetIntelligenceSync,
  getTotalAssetStorageForWorkspace,
  countMonthlyUploadsForWorkspace,
  // Provider Credentials — P3 (BYOK)
  listWorkspaceApiKeys,
  getWorkspaceApiKey,
  upsertWorkspaceApiKey,
  rotateWorkspaceApiKey,
  revokeWorkspaceApiKey,
  markWorkspaceApiKeyValidated,
  // Provider Usage & Health — P3 (Observability)
  recordProviderUsage,
  getWorkspaceProviderUsageSummary,
  upsertWorkspaceProviderHealth,
  listWorkspaceProviderHealth,
  // OAuth Connections — Priority 4/5 (Canva/Figma export)
  getWorkspaceOAuthConnection,
  upsertWorkspaceOAuthConnection,
  refreshWorkspaceOAuthConnection,
  revokeWorkspaceOAuthConnection,
  // Figma Handoff Tokens — Priority 5 (Figma Export plugin handoff)
  createFigmaHandoffToken,
  consumeFigmaHandoffToken,
}                                       from './db/dbService';

// ── React Hooks (client-side only) ────────────────────────────────────────
export { useCampaigns, usePersonas, useFeedback } from './hooks/index';

// ── User Lifecycle State (computed lifecycle projection) ──────────────────
export { computeUserLifecycleState } from './lifecycle/index';

// ── Config ────────────────────────────────────────────────────────────────
export { authConfig, dbConfig }         from './config';

// ── Public Interface Boundary (for type-checking dependents) ──────────────
export type {
  IAuth,
  ISupabaseClients,
  IAuthOperations,
  IUserOperations,
  ICampaignOperations,
  IPersonaOperations,
  IFeedbackOperations,
  // P1 — Asset Vault Evolution
  IAssetOperations,
  AssetListOptions,
  AssetUpdateFields,
  UseCampaignsReturn,
  UsePersonasReturn,
  UseFeedbackReturn,
  // P3 — BYOK & Provider Observability
  IProviderCredentialOperations,
  IProviderUsageOperations,
  IProviderHealthOperations,
}                                       from './IAuth';

// ── Types (all sourced from @brandos/contracts via types/index.ts) ─────────
export type {
  // Auth primitives
  AuthUser,
  AuthState,
  AuthSession,
  AuthProvider as AuthProviderType, // Alias to avoid collision with AuthProvider component
  UserPlan,
  LoginCredentials,
  SignupCredentials,
  // DB rows
  UserRow,
  CampaignRow,
  PersonaRow,
  FeedbackRow,
  NewCampaign,
  NewPersona,
  NewFeedback,
  CampaignFormat,
  CampaignStatus,
  PersonaTone,
  FeedbackSignal,
  // Result wrappers
  DbResult,
  DbListResult,
  TableName,
}                                       from './types';

// ── P1 — Asset Vault types (pass-through from @brandos/contracts) ──────────
export type {
  BrandAssetRow,
  BrandAssetStatus,
  NewBrandAsset,
} from '@brandos/contracts';

// ── P3 — BYOK & Provider Observability types (pass-through from @brandos/contracts) ──
export type {
  WorkspaceApiKeyRow,
  NewWorkspaceApiKey,
  WorkspaceProviderUsageRow,
  NewWorkspaceProviderUsage,
  WorkspaceProviderHealthRow,
} from '@brandos/contracts';



