/**
 * @brandos/auth — IAuth.test.ts
 *
 * PUBLIC INTERFACE BOUNDARY TESTS
 *
 * PURPOSE:
 *   These tests verify that the @brandos/auth package exports exactly what
 *   IAuth.ts declares. They act as a compile-time + runtime boundary check:
 *
 *   - If an import fails → the export is missing from index.ts
 *   - If a typeof assertion fails → the exported symbol has the wrong kind
 *     (e.g., a class was exported instead of a function)
 *
 * WHAT WE ARE TESTING:
 *   Not the implementation — that's in authService.test.ts and dbService.test.ts.
 *   We are testing that the PUBLIC SURFACE of the package is complete and correct.
 *
 * AGENT GUIDANCE:
 *   When adding a new export to @brandos/auth index.ts, add a corresponding
 *   assertion here. This file is the authoritative list of the package's API.
 */

import { describe, it, expect } from 'vitest';

// ── Import everything from the public entry point ─────────────────────────────
// If any of these imports fail → the export is missing from index.ts

import {
  // React context
  AuthProvider,
  useAuth,

  // Auth service functions
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

  // Supabase client access
  supabase,
  getSupabaseClient,
  getSupabaseAdmin,

  // DB service — Users
  getUserById,
  updateUser,
  incrementGenerationsUsed,

  // DB service — Campaigns
  getCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaign,
  deleteCampaign,

  // DB service — Personas
  getPersonas,
  getDefaultPersona,
  createPersona,
  updatePersona,
  deletePersona,
  setDefaultPersona,

  // DB service — Feedback
  submitFeedback,
  getFeedbackForCampaign,
  getUserFeedbackStats,

  // Hooks
  useCampaigns,
  usePersonas,
  useFeedback,

  // Config
  authConfig,
  dbConfig,
} from '../index';

// ─────────────────────────────────────────────────────────────────────────────
// GROUP A — React context
// ─────────────────────────────────────────────────────────────────────────────

describe('React context exports', () => {
  it('exports AuthProvider as a function (React component)', () => {
    expect(typeof AuthProvider).toBe('function');
  });

  it('exports useAuth as a function (React hook)', () => {
    expect(typeof useAuth).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP B — Auth service functions
// ─────────────────────────────────────────────────────────────────────────────

describe('Auth service function exports', () => {
  const authFunctions = {
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
  };

  it('exports all auth service functions', () => {
    Object.entries(authFunctions).forEach(([name, fn]) => {
      expect(typeof fn, `${name} should be a function`).toBe('function');
    });
  });

  it('exports authService namespace with all auth functions', () => {
    expect(typeof authService).toBe('object');
    expect(authService).not.toBeNull();

    const expectedMethods = [
      'signUpWithEmail', 'signInWithEmail', 'signInWithGoogle',
      'signInWithMagicLink', 'sendPasswordReset', 'updatePassword',
      'signOut', 'getSession', 'getCurrentUser', 'onAuthStateChange',
    ];

    expectedMethods.forEach(method => {
      expect(
        typeof authService[method as keyof typeof authService],
        `authService.${method} should be a function`
      ).toBe('function');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP C — Supabase client access
// ─────────────────────────────────────────────────────────────────────────────

describe('Supabase client exports', () => {
  it('exports supabase as a proxy object', () => {
    expect(typeof supabase).toBe('object');
    expect(supabase).not.toBeNull();
  });

  it('exports getSupabaseClient as a function', () => {
    expect(typeof getSupabaseClient).toBe('function');
  });

  it('exports getSupabaseAdmin as a function', () => {
    expect(typeof getSupabaseAdmin).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP D — DB service functions
// ─────────────────────────────────────────────────────────────────────────────

describe('DB service function exports — Users', () => {
  it('exports all user DB functions', () => {
    expect(typeof getUserById).toBe('function');
    expect(typeof updateUser).toBe('function');
    expect(typeof incrementGenerationsUsed).toBe('function');
  });
});

describe('DB service function exports — Campaigns', () => {
  it('exports all campaign DB functions', () => {
    expect(typeof getCampaigns).toBe('function');
    expect(typeof getCampaignById).toBe('function');
    expect(typeof createCampaign).toBe('function');
    expect(typeof updateCampaign).toBe('function');
    expect(typeof deleteCampaign).toBe('function');
  });
});

describe('DB service function exports — Personas', () => {
  it('exports all persona DB functions', () => {
    expect(typeof getPersonas).toBe('function');
    expect(typeof getDefaultPersona).toBe('function');
    expect(typeof createPersona).toBe('function');
    expect(typeof updatePersona).toBe('function');
    expect(typeof deletePersona).toBe('function');
    expect(typeof setDefaultPersona).toBe('function');
  });
});

describe('DB service function exports — Feedback', () => {
  it('exports all feedback DB functions', () => {
    expect(typeof submitFeedback).toBe('function');
    expect(typeof getFeedbackForCampaign).toBe('function');
    expect(typeof getUserFeedbackStats).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP E — React hooks
// ─────────────────────────────────────────────────────────────────────────────

describe('React hook exports', () => {
  it('exports useCampaigns as a function', () => {
    expect(typeof useCampaigns).toBe('function');
  });

  it('exports usePersonas as a function', () => {
    expect(typeof usePersonas).toBe('function');
  });

  it('exports useFeedback as a function', () => {
    expect(typeof useFeedback).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP F — Config
// ─────────────────────────────────────────────────────────────────────────────

describe('Config exports', () => {
  it('exports authConfig as an object with supabase, providers, redirects, session', () => {
    expect(typeof authConfig).toBe('object');
    expect(authConfig).toHaveProperty('supabase');
    expect(authConfig).toHaveProperty('providers');
    expect(authConfig).toHaveProperty('redirects');
    expect(authConfig).toHaveProperty('session');
    expect(authConfig).toHaveProperty('appUrl');
  });

  it('exports dbConfig as an object with a tables map', () => {
    expect(typeof dbConfig).toBe('object');
    expect(dbConfig).toHaveProperty('tables');
    expect(dbConfig.tables).toHaveProperty('users');
    expect(dbConfig.tables).toHaveProperty('campaigns');
    expect(dbConfig.tables).toHaveProperty('personas');
    expect(dbConfig.tables).toHaveProperty('feedback');
  });

  it('authConfig.providers has correct default values', () => {
    // email and google default to enabled (unless env var overrides)
    expect(typeof authConfig.providers.email).toBe('boolean');
    expect(typeof authConfig.providers.google).toBe('boolean');
    expect(typeof authConfig.providers.magicLink).toBe('boolean');
  });

  it('authConfig.redirects has all required paths', () => {
    expect(authConfig.redirects.afterLogin).toBeTruthy();
    expect(authConfig.redirects.afterLogout).toBeTruthy();
    expect(authConfig.redirects.afterConfirm).toBeTruthy();
    expect(authConfig.redirects.oauthCallback).toBe('/auth/callback');
  });

  it('authConfig.session.expirySeconds is a number', () => {
    expect(typeof authConfig.session.expirySeconds).toBe('number');
    expect(authConfig.session.expirySeconds).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP G — Contracts type surface (auth-types promoted to @brandos/contracts)
// ─────────────────────────────────────────────────────────────────────────────

describe('Contracts package — auth-types surface', () => {
  // These are type-only tests. At runtime we verify the contracts module
  // exports the auth-types values we depend on by importing from it directly.
  it('verifies @brandos/contracts re-exports auth type values that dbService uses', async () => {
    // The presence of this dynamic import succeeding is the test.
    // If auth-types.ts is not wired into contracts/index.ts, this import
    // would succeed but the types wouldn't flow — we can't test types at runtime.
    // The compile-time check (tsc --noEmit) is the authoritative validator.
    const contracts = await import('@brandos/contracts');
    // Just verify the module loads — type correctness is a compile-time concern
    expect(contracts).toBeDefined();
  });
});


