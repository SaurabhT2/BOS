// ============================================================
// @brandos/auth — src/types/index.ts
//
// ARCHITECTURAL ROLE:
//   Single re-export barrel for all types consumed within this package.
//
//   All canonical type definitions now live in @brandos/contracts/auth-types.ts.
//   This file re-exports them so internal modules can import from '../types'
//   without knowing about the contracts package path, and so that external
//   consumers who previously imported from '@brandos/auth' types continue
//   to receive the correct shapes.
//
// AGENT GUIDANCE:
//   - Do NOT define new types here. Add them to @brandos/contracts/auth-types.ts.
//   - Do NOT import Supabase or React types here — this file is type-only.
//   - The AuthProvider type alias (re-exported as AuthProviderKind) preserves
//     backward compat for callers that used `AuthProvider` as a type name
//     before it conflicted with the React component export.
// ============================================================

// ── Re-export all canonical types from the contracts package ──────────────
export type {
  // Auth primitives
  AuthProviderKind,
  UserPlan,
  AuthUser,
  AuthState,
  AuthSession,
  LoginCredentials,
  SignupCredentials,

  // DB row types
  UserRow,
  CampaignFormat,
  CampaignStatus,
  CampaignRow,
  NewCampaign,
  PersonaTone,
  PersonaRow,
  NewPersona,
  FeedbackSignal,
  FeedbackRow,
  NewFeedback,

  // Result wrappers
  DbResult,
  DbListResult,
  TableName,
} from '@brandos/contracts';

// ── Backward-compatibility alias ──────────────────────────────────────────
// The original src/types/index.ts exported `AuthProvider` as a type alias
// for the provider kind union. After the AuthProvider React component was
// introduced, this name collided. The canonical name is now AuthProviderKind
// in @brandos/contracts. This alias preserves imports in any code that
// still uses `import type { AuthProvider } from '@brandos/auth'`.
//
// DEPRECATION: New code should use AuthProviderKind from '@brandos/contracts'.
// This alias will be removed once all call sites are migrated.
export type { AuthProviderKind as AuthProvider } from '@brandos/contracts';


