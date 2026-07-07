/**
 * @brandos/auth — computeUserLifecycleState.test.ts
 *
 * Unit tests for the UserState computation function.
 *
 * STRATEGY:
 *   computeUserLifecycleState() is a pure composition of existing
 *   dbService reads (getUserById, getWorkspaceByOwnerId,
 *   getWorkspaceSettings, getPersonas) — no direct Supabase access. We
 *   mock the dbService module itself rather than the Supabase client, so
 *   these tests exercise the stage-resolution logic in isolation from
 *   dbService's own (separately tested) query-building behavior.
 *
 * COVERAGE — every stage transition named in user-state-types.ts,
 * including the explicit correction from the ADR review: skip-without-
 * persona must resolve to 'onboarded', not stay stuck in
 * 'needs_onboarding' or wrongly require a persona.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetUserById, mockGetWorkspaceByOwnerId, mockGetWorkspaceSettings, mockGetPersonas } =
  vi.hoisted(() => ({
    mockGetUserById: vi.fn(),
    mockGetWorkspaceByOwnerId: vi.fn(),
    mockGetWorkspaceSettings: vi.fn(),
    mockGetPersonas: vi.fn(),
  }));

vi.mock('../db/dbService', () => ({
  getUserById: mockGetUserById,
  getWorkspaceByOwnerId: mockGetWorkspaceByOwnerId,
  getWorkspaceSettings: mockGetWorkspaceSettings,
  getPersonas: mockGetPersonas,
}));

import { computeUserLifecycleState } from '../lifecycle/computeUserLifecycleState';

const BASE_USER = {
  id: 'user-1',
  email: 'a@b.com',
  name: null,
  avatar_url: null,
  plan: 'free' as const,
  generations_used: 0,
  workspace_id: 'ws-1',
  is_platform_admin: false,
  onboarding_completed_at: null as string | null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const BASE_WORKSPACE = {
  id: 'ws-1',
  name: 'Test Workspace',
  slug: 'test-workspace',
  owner_id: 'user-1',
  plan: 'explorer' as const,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const BASE_SETTINGS = {
  workspace_id: 'ws-1',
  preferred_provider: null,
  runtime_mode: null,
  governance_score_threshold: null,
} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('computeUserLifecycleState', () => {
  it('returns anonymous with no Supabase calls when userId is null', async () => {
    const result = await computeUserLifecycleState(null);
    expect(result.stage).toBe('anonymous');
    expect(result.facts.hasSession).toBe(false);
    expect(mockGetUserById).not.toHaveBeenCalled();
  });

  it('returns profile_pending when the profile row is not found yet', async () => {
    mockGetUserById.mockResolvedValue({ data: null, error: null });

    const result = await computeUserLifecycleState('user-1');
    expect(result.stage).toBe('profile_pending');
    expect(result.facts.hasSession).toBe(true);
    expect(result.facts.profileResolved).toBe(false);
  });

  it('returns workspace_init_failed (typed, not a generic auth error) when the workspace row is missing', async () => {
    mockGetUserById.mockResolvedValue({ data: BASE_USER, error: null });
    mockGetWorkspaceByOwnerId.mockResolvedValue({ data: null, error: 'Not found' });

    const result = await computeUserLifecycleState('user-1');
    expect(result.stage).toBe('workspace_init_failed');
    expect(result.error?.code).toBe('workspace_init_failed');
    expect(result.facts.profileResolved).toBe(true);
    expect(result.facts.workspaceResolved).toBe(false);
  });

  it('returns workspace_initializing when workspace_settings has not landed yet', async () => {
    mockGetUserById.mockResolvedValue({ data: BASE_USER, error: null });
    mockGetWorkspaceByOwnerId.mockResolvedValue({ data: BASE_WORKSPACE, error: null });
    mockGetWorkspaceSettings.mockResolvedValue({ data: null, error: 'Not found' });

    const result = await computeUserLifecycleState('user-1');
    expect(result.stage).toBe('workspace_initializing');
    expect(result.facts.workspaceResolved).toBe(true);
    expect(result.facts.workspaceSettingsSeeded).toBe(false);
  });

  it('returns needs_onboarding when settings are seeded but onboarding_completed_at is null', async () => {
    mockGetUserById.mockResolvedValue({ data: BASE_USER, error: null });
    mockGetWorkspaceByOwnerId.mockResolvedValue({ data: BASE_WORKSPACE, error: null });
    mockGetWorkspaceSettings.mockResolvedValue({ data: BASE_SETTINGS, error: null });
    mockGetPersonas.mockResolvedValue({ data: [], error: null, count: 0 });

    const result = await computeUserLifecycleState('user-1');
    expect(result.stage).toBe('needs_onboarding');
    expect(result.facts.hasPersona).toBe(false);
  });

  it('returns needs_onboarding even if a persona exists, as long as onboarding has not been completed', async () => {
    // A persona created mid-flow, then a page refresh before finishing —
    // must not be misread as "done".
    mockGetUserById.mockResolvedValue({ data: BASE_USER, error: null });
    mockGetWorkspaceByOwnerId.mockResolvedValue({ data: BASE_WORKSPACE, error: null });
    mockGetWorkspaceSettings.mockResolvedValue({ data: BASE_SETTINGS, error: null });
    mockGetPersonas.mockResolvedValue({ data: [{ id: 'p1' }], error: null, count: 1 });

    const result = await computeUserLifecycleState('user-1');
    expect(result.stage).toBe('needs_onboarding');
    expect(result.facts.hasPersona).toBe(true);
  });

  it('returns onboarded (not operational, not stuck in needs_onboarding) when onboarding was skipped with no persona', async () => {
    // The exact regression flagged in Phase 1 review: skipToWorkspace()
    // sets onboarding_completed_at with zero personas created.
    mockGetUserById.mockResolvedValue({
      data: { ...BASE_USER, onboarding_completed_at: '2026-06-01T00:00:00Z' },
      error: null,
    });
    mockGetWorkspaceByOwnerId.mockResolvedValue({ data: BASE_WORKSPACE, error: null });
    mockGetWorkspaceSettings.mockResolvedValue({ data: BASE_SETTINGS, error: null });
    mockGetPersonas.mockResolvedValue({ data: [], error: null, count: 0 });

    const result = await computeUserLifecycleState('user-1');
    expect(result.stage).toBe('onboarded');
    expect(result.facts.onboardingCompletedAt).toBe('2026-06-01T00:00:00Z');
    expect(result.facts.hasPersona).toBe(false);
  });

  it('returns operational when onboarding is complete AND at least one persona exists', async () => {
    mockGetUserById.mockResolvedValue({
      data: { ...BASE_USER, onboarding_completed_at: '2026-06-01T00:00:00Z' },
      error: null,
    });
    mockGetWorkspaceByOwnerId.mockResolvedValue({ data: BASE_WORKSPACE, error: null });
    mockGetWorkspaceSettings.mockResolvedValue({ data: BASE_SETTINGS, error: null });
    mockGetPersonas.mockResolvedValue({ data: [{ id: 'p1' }], error: null, count: 1 });

    const result = await computeUserLifecycleState('user-1');
    expect(result.stage).toBe('operational');
    expect(result.facts.hasPersona).toBe(true);
  });

  it('always stamps version 1 and a computedAt timestamp', async () => {
    const result = await computeUserLifecycleState(null);
    expect(result.version).toBe(1);
    expect(typeof result.computedAt).toBe('string');
    expect(Number.isNaN(Date.parse(result.computedAt))).toBe(false);
  });
});
