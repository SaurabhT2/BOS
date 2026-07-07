/**
 * @brandos/auth — authService.test.ts
 *
 * Unit tests for authService.ts.
 *
 * STRATEGY:
 *   authService.ts is a thin wrapper around the Supabase client. We test it by
 *   mocking the supabase module so that no real network calls are made.
 *   Each test verifies:
 *     1. The correct Supabase method is called with the correct arguments
 *     2. The return value is correctly mapped to { user|session|error }
 *     3. Edge cases (null user, error response) are handled gracefully
 *
 * MOCKING APPROACH:
 *   We mock '../auth/supabaseClient' so all functions in authService receive
 *   a mock supabase object. This keeps tests fast and deterministic.
 *
 * L5 FIX: vi.mock factories are hoisted above const declarations by vitest's
 * transform. Use vi.hoisted() to declare mock functions so they are available
 * inside the factory at hoist time.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Declare mock fns via vi.hoisted() so they are available inside vi.mock ───
const {
  mockSignUp,
  mockSignInWithPassword,
  mockSignInWithOAuth,
  mockSignInWithOtp,
  mockResetPasswordForEmail,
  mockUpdateUser,
  mockSignOut,
  mockGetSession,
  mockOnAuthStateChange,
  mockFrom,
  mockRpc,
} = vi.hoisted(() => ({
  mockSignUp:                 vi.fn(),
  mockSignInWithPassword:     vi.fn(),
  mockSignInWithOAuth:        vi.fn(),
  mockSignInWithOtp:          vi.fn(),
  mockResetPasswordForEmail:  vi.fn(),
  mockUpdateUser:             vi.fn(),
  mockSignOut:                vi.fn(),
  mockGetSession:             vi.fn(),
  mockOnAuthStateChange:      vi.fn(),
  mockFrom:                   vi.fn(),
  mockRpc:                    vi.fn(),
}));

vi.mock('../auth/supabaseClient', () => ({
  supabase: {
    auth: {
      signUp:                   mockSignUp,
      signInWithPassword:       mockSignInWithPassword,
      signInWithOAuth:          mockSignInWithOAuth,
      signInWithOtp:            mockSignInWithOtp,
      resetPasswordForEmail:    mockResetPasswordForEmail,
      updateUser:               mockUpdateUser,
      signOut:                  mockSignOut,
      getSession:               mockGetSession,
      onAuthStateChange:        mockOnAuthStateChange,
    },
    from: mockFrom,
    rpc:  mockRpc,
  },
}));

// ── Mock config to avoid env var requirements ─────────────────────────────────
vi.mock('../config', () => ({
  authConfig: {
    appUrl: 'https://test.brandos.co',
    redirects: {
      afterLogin:    '/workspace',
      afterLogout:   '/',
      afterConfirm:  '/auth/confirmed',
      oauthCallback: '/auth/callback',
    },
  },
}));

// ── Import under test AFTER mocks are established ────────────────────────────
import {
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  signInWithMagicLink,
  sendPasswordReset,
  updatePassword,
  signOut,
  getSession,
  getCurrentUser,
  onAuthStateChange,
  authService,
} from '../auth/authService';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A minimal Supabase user shape for test fixtures */
const mockSupabaseUser = {
  id:             'user-uuid-123',
  email:          'test@example.com',
  created_at:     '2024-01-01T00:00:00.000Z',
  user_metadata:  { full_name: 'Test User', avatar_url: 'https://example.com/avatar.png' },
};

/** A minimal profile row from public.users */
const mockProfile = {
  name:       'Profile Name',
  avatar_url: 'https://example.com/profile.png',
  plan:       'premium',
};

beforeEach(() => {
  vi.clearAllMocks();

  // Default: from('users').select().eq().single() returns the mock profile
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
      }),
    }),
  });

  // P2 FIX: Default mockGetSession so signUpWithEmail/signInWithEmail tests don't crash.
  // signUpWithEmail/signInWithEmail both call getCurrentUser() on success, which calls
  // supabase.auth.getSession(). Without this default, destructuring the undefined return
  // throws "Cannot destructure property 'data' of undefined".
  // The default returns a session containing mockSupabaseUser (the happy path).
  mockGetSession.mockResolvedValue({
    data: { session: { user: mockSupabaseUser } },
    error: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// signUpWithEmail
// ─────────────────────────────────────────────────────────────────────────────

describe('signUpWithEmail', () => {
  it('returns a mapped AuthUser on success', async () => {
    mockSignUp.mockResolvedValue({
      data:  { user: mockSupabaseUser },
      error: null,
    });

    const { user, error } = await signUpWithEmail({
      email:    'test@example.com',
      password: 'password123',
      name:     'Test User',
    });

    expect(error).toBeNull();
    expect(user).not.toBeNull();
    expect(user?.id).toBe('user-uuid-123');
    expect(user?.email).toBe('test@example.com');
    // signUpWithEmail calls getCurrentUser() which fetches the public.users profile row.
    // The name comes from the profile (mockProfile.name = 'Profile Name'), not user_metadata.
    // P2 FIX: updated from 'Test User' (user_metadata) to 'Profile Name' (profile row).
    expect(user?.name).toBe('Profile Name');
    expect(user?.plan).toBe('premium'); // P2 FIX: profile row has plan:'premium', not 'free'
  });

  it('returns error string on Supabase failure', async () => {
    mockSignUp.mockResolvedValue({
      data:  { user: null },
      error: { message: 'User already registered' },
    });

    const { user, error } = await signUpWithEmail({
      email:    'existing@example.com',
      password: 'pass',
    });

    expect(user).toBeNull();
    expect(error).toBe('User already registered');
  });

  it('returns error when Supabase returns no user and no error', async () => {
    mockSignUp.mockResolvedValue({ data: { user: null }, error: null });

    const { user, error } = await signUpWithEmail({
      email:    'test@example.com',
      password: 'pass',
    });

    expect(user).toBeNull();
    expect(error).toBe('Signup failed — no user returned.');
  });

  it('calls signUp with correct emailRedirectTo', async () => {
    mockSignUp.mockResolvedValue({ data: { user: mockSupabaseUser }, error: null });

    await signUpWithEmail({ email: 'a@b.com', password: 'pass', name: 'Alice' });

    expect(mockSignUp).toHaveBeenCalledWith({
      email:    'a@b.com',
      password: 'pass',
      options: {
        data:            { full_name: 'Alice' },
        emailRedirectTo: 'https://test.brandos.co/auth/confirmed',
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// signInWithEmail
// ─────────────────────────────────────────────────────────────────────────────

describe('signInWithEmail', () => {
  it('returns mapped AuthUser on success', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data:  { user: mockSupabaseUser },
      error: null,
    });

    const { user, error } = await signInWithEmail({
      email:    'test@example.com',
      password: 'password123',
    });

    expect(error).toBeNull();
    expect(user?.id).toBe('user-uuid-123');
  });

  it('returns error string on bad credentials', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data:  { user: null },
      error: { message: 'Invalid login credentials' },
    });

    const { user, error } = await signInWithEmail({
      email:    'test@example.com',
      password: 'wrong',
    });

    expect(user).toBeNull();
    expect(error).toBe('Invalid login credentials');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// signInWithGoogle
// ─────────────────────────────────────────────────────────────────────────────

describe('signInWithGoogle', () => {
  it('returns { error: null } on success (redirect initiated)', async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: null });

    const { error } = await signInWithGoogle();
    expect(error).toBeNull();
  });

  it('returns error string when OAuth initiation fails', async () => {
    mockSignInWithOAuth.mockResolvedValue({
      error: { message: 'OAuth provider not enabled' },
    });

    const { error } = await signInWithGoogle();
    expect(error).toBe('OAuth provider not enabled');
  });

  it('calls signInWithOAuth with correct redirect URL', async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: null });

    await signInWithGoogle();

    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options:  { redirectTo: 'https://test.brandos.co/auth/callback' },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// signInWithMagicLink
// ─────────────────────────────────────────────────────────────────────────────

describe('signInWithMagicLink', () => {
  it('returns { error: null } when OTP email is sent', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });

    const { error } = await signInWithMagicLink('test@example.com');
    expect(error).toBeNull();
  });

  it('returns error when rate limited', async () => {
    mockSignInWithOtp.mockResolvedValue({
      error: { message: 'Email rate limit exceeded' },
    });

    const { error } = await signInWithMagicLink('test@example.com');
    expect(error).toBe('Email rate limit exceeded');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sendPasswordReset
// ─────────────────────────────────────────────────────────────────────────────

describe('sendPasswordReset', () => {
  it('returns { error: null } on success', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: null });

    const { error } = await sendPasswordReset('test@example.com');
    expect(error).toBeNull();
  });

  it('calls resetPasswordForEmail with correct redirect URL', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: null });

    await sendPasswordReset('test@example.com');

    expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
      'test@example.com',
      { redirectTo: 'https://test.brandos.co/auth/reset-password' }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updatePassword
// ─────────────────────────────────────────────────────────────────────────────

describe('updatePassword', () => {
  it('returns { error: null } on success', async () => {
    mockUpdateUser.mockResolvedValue({ error: null });

    const { error } = await updatePassword('newSecurePassword123');
    expect(error).toBeNull();
  });

  it('returns error when called without a session', async () => {
    mockUpdateUser.mockResolvedValue({
      error: { message: 'Auth session missing!' },
    });

    const { error } = await updatePassword('newpass');
    expect(error).toBe('Auth session missing!');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// signOut
// ─────────────────────────────────────────────────────────────────────────────

describe('signOut', () => {
  it('returns { error: null } on success', async () => {
    mockSignOut.mockResolvedValue({ error: null });

    const { error } = await signOut();
    expect(error).toBeNull();
  });

  it('returns error string if sign out fails', async () => {
    mockSignOut.mockResolvedValue({ error: { message: 'Network error' } });

    const { error } = await signOut();
    expect(error).toBe('Network error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSession
// ─────────────────────────────────────────────────────────────────────────────

describe('getSession', () => {
  it('returns a mapped AuthSession when a session exists', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token:  'jwt-token',
          refresh_token: 'refresh-token',
          expires_at:    9999999999,
          user:          mockSupabaseUser,
        },
      },
      error: null,
    });

    const { session, error } = await getSession();

    expect(error).toBeNull();
    expect(session).not.toBeNull();
    expect(session?.access_token).toBe('jwt-token');
    expect(session?.user.id).toBe('user-uuid-123');
  });

  it('returns { session: null, error: null } when no session exists', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    const { session, error } = await getSession();

    expect(session).toBeNull();
    expect(error).toBeNull();
  });

  it('SIGNUP-TRIGGER RACE: retries the profile lookup and succeeds once the row appears', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token:  'jwt-token',
          refresh_token: 'refresh-token',
          expires_at:    9999999999,
          user:          mockSupabaseUser,
        },
      },
      error: null,
    });

    const single = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: mockProfile, error: null });

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single }),
      }),
    });

    const { session, error } = await getSession({ delayMs: 0 });

    expect(single).toHaveBeenCalledTimes(2);
    expect(error).toBeNull();
    expect(session?.user.id).toBe('user-uuid-123');
  });

  it('gives up and returns an error after retries are exhausted', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token:  'jwt-token',
          refresh_token: 'refresh-token',
          expires_at:    9999999999,
          user:          mockSupabaseUser,
        },
      },
      error: null,
    });

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });

    // retries: 0 — give-up path, kept fast/deterministic.
    const { session, error } = await getSession({ retries: 0 });

    expect(session).toBeNull();
    expect(error).toBe('User profile not found.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getCurrentUser
// ─────────────────────────────────────────────────────────────────────────────

describe('getCurrentUser', () => {
  it('returns null user when no session exists', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    const { user, error } = await getCurrentUser();

    expect(user).toBeNull();
    expect(error).toBeNull();
  });

  it('returns AuthUser with profile data merged in when session and profile exist', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: mockSupabaseUser } },
      error: null,
    });
    // mockFrom is already set up in beforeEach to return mockProfile

    const { user, error } = await getCurrentUser();

    expect(error).toBeNull();
    expect(user?.id).toBe('user-uuid-123');
    expect(user?.name).toBe('Profile Name');     // From public.users profile
    expect(user?.plan).toBe('premium');           // From public.users profile
    expect(user?.avatarUrl).toBe('https://example.com/profile.png');
  });

  it('returns null user when profile query returns null (no user_metadata fallback)', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: mockSupabaseUser } },
      error: null,
    });
    // Override: profile query returns null data
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });

    // retries: 0 — this test exercises the give-up path (profile genuinely
    // never appears), not the signup-trigger-race retry path. Real retries
    // use a short delay between attempts (see PROFILE_LOOKUP_RETRY_DELAY_MS);
    // passing 0 here keeps this test fast and deterministic.
    const { user, error } = await getCurrentUser({ retries: 0 });

    // P2 FIX: Implementation returns { user: null } when profile is missing —
    // it does NOT fall back to user_metadata. The profile row (with workspaceId,
    // isPlatformAdmin) is required for a valid AuthUser; there is no partial fallback.
    // The signup DB trigger creates the profile in the same transaction as auth.users;
    // getCurrentUser() retries a few times by default to cover that race (see
    // PROFILE_LOOKUP_RETRIES) before concluding the profile truly doesn't exist.
    expect(user).toBeNull();
    expect(error).toBe('User profile not found.');
  });

  it('handles invalid plan value in profile by defaulting to free', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: mockSupabaseUser } },
      error: null,
    });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { ...mockProfile, plan: 'invalid_plan_value' },
            error: null,
          }),
        }),
      }),
    });

    const { user } = await getCurrentUser();
    expect(user?.plan).toBe('free');
  });

  it('SIGNUP-TRIGGER RACE: retries the profile lookup and succeeds once the row appears', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: mockSupabaseUser } },
      error: null,
    });

    // Simulate the DB trigger landing on the 3rd attempt: first two lookups
    // come back empty (row not committed yet), the third returns the profile.
    const single = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: mockProfile, error: null });

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single }),
      }),
    });

    // delayMs: 0 keeps the test fast while still exercising the real retry
    // loop (retries default to 3, which covers the 3-attempt scenario above).
    const { user, error } = await getCurrentUser({ delayMs: 0 });

    expect(single).toHaveBeenCalledTimes(3);
    expect(error).toBeNull();
    expect(user?.id).toBe('user-uuid-123');
    expect(user?.name).toBe('Profile Name');
  });

  it('ONBOARDING REGRESSION FIX: sets sessionExistsButProfileMissing=true when a real session has no profile row after the full retry budget', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: mockSupabaseUser } },
      error: null,
    });
    // Profile row never appears across the full retry budget — simulates the
    // signup-trigger genuinely outlasting PROFILE_LOOKUP_RETRIES, the worst
    // case this fix targets (e.g. cold Postgres connection on first sign-in).
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });

    const result = await getCurrentUser({ retries: 0 });

    expect(result.user).toBeNull();
    expect(result.sessionExistsButProfileMissing).toBe(true);
  });

  it('ONBOARDING REGRESSION FIX: leaves sessionExistsButProfileMissing unset when there is no session at all (real logout)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    const result = await getCurrentUser();

    // Must stay falsy here — this discriminator exists specifically so
    // AuthProvider can tell "brand-new signup, profile row pending" apart
    // from "genuinely logged out". If this were ever true on a real
    // no-session case, AuthProvider's bounded re-check would incorrectly
    // delay resolving a legitimate logout.
    expect(result.user).toBeNull();
    expect(result.sessionExistsButProfileMissing).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onAuthStateChange
// ─────────────────────────────────────────────────────────────────────────────

describe('onAuthStateChange', () => {
  it('calls callback with null when session is null', () => {
    const callback = vi.fn();
    const mockUnsubscribe = vi.fn();

    mockOnAuthStateChange.mockImplementation((cb: (event: string, session: null) => void) => {
      // Immediately invoke the callback with a null session
      cb('SIGNED_OUT', null);
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
    });

    const unsubscribe = onAuthStateChange(callback);

    expect(callback).toHaveBeenCalledWith(null);
    expect(typeof unsubscribe).toBe('function');
  });

  it('returns an unsubscribe function that calls subscription.unsubscribe()', () => {
    const mockUnsubscribe = vi.fn();
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: mockUnsubscribe } },
    });

    const unsubscribe = onAuthStateChange(vi.fn());
    unsubscribe();

    expect(mockUnsubscribe).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// authService namespace
// ─────────────────────────────────────────────────────────────────────────────

describe('authService namespace export', () => {
  it('exposes all auth functions as named properties', () => {
    expect(typeof authService.signUpWithEmail).toBe('function');
    expect(typeof authService.signInWithEmail).toBe('function');
    expect(typeof authService.signInWithGoogle).toBe('function');
    expect(typeof authService.signInWithMagicLink).toBe('function');
    expect(typeof authService.sendPasswordReset).toBe('function');
    expect(typeof authService.updatePassword).toBe('function');
    expect(typeof authService.signOut).toBe('function');
    expect(typeof authService.getSession).toBe('function');
    expect(typeof authService.getCurrentUser).toBe('function');
    expect(typeof authService.onAuthStateChange).toBe('function');
  });
});


