/**
 * @brandos/auth — dbService.test.ts
 *
 * Unit tests for dbService.ts.
 *
 * STRATEGY:
 *   dbService.ts calls supabase.from(table).select/insert/update/delete/rpc.
 *   We mock the supabase module and verify:
 *     1. The correct table and method chain is called
 *     2. Results are correctly mapped to { data, error }
 *     3. Edge cases (null result, Supabase error, PGRST116) are handled
 *
 * MOCK STRUCTURE:
 *   Supabase uses a chainable query builder. We mock it as a series of
 *   functions that each return an object with the next method in the chain.
 *   The terminal function (single, resolvedValue) returns the test fixture.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Declare mock fns via vi.hoisted() so they are available inside vi.mock ───
// L5 FIX: vi.mock factories are hoisted above const declarations; vi.hoisted()
// ensures these functions exist at hoist time.
const {
  mockSingle,
  mockSelect,
  mockInsert,
  mockUpdate,
  mockDelete,
  mockEq,
  mockOrder,
  mockRange,
  mockRpc,
  mockFrom,
  queryBuilder,
} = vi.hoisted(() => {
  const mockSingle  = vi.fn();
  const mockSelect  = vi.fn();
  const mockInsert  = vi.fn();
  const mockUpdate  = vi.fn();
  const mockDelete  = vi.fn();
  const mockEq      = vi.fn();
  const mockOrder   = vi.fn();
  const mockRange   = vi.fn();
  const mockRpc     = vi.fn();

  // Each method returns `this` (the builder) so chains can continue
  const queryBuilder: Record<string, (...args: unknown[]) => unknown> = {
    select:  (..._args: unknown[]) => { mockSelect(..._args); return queryBuilder; },
    insert:  (..._args: unknown[]) => { mockInsert(..._args); return queryBuilder; },
    update:  (..._args: unknown[]) => { mockUpdate(..._args); return queryBuilder; },
    delete:  ()                    => { mockDelete();         return queryBuilder; },
    eq:      (..._args: unknown[]) => { mockEq(..._args);     return queryBuilder; },
    order:   (..._args: unknown[]) => { mockOrder(..._args);  return queryBuilder; },
    range:   (..._args: unknown[]) => { mockRange(..._args);  return queryBuilder; },
    single:  ()                    => mockSingle(),
  };

  const mockFrom = vi.fn(() => queryBuilder);

  return { mockSingle, mockSelect, mockInsert, mockUpdate, mockDelete, mockEq, mockOrder, mockRange, mockRpc, mockFrom, queryBuilder };
});

vi.mock('../auth/supabaseClient', () => ({
  supabase: {
    from: mockFrom,
    rpc:  mockRpc,
  },
  // P2-3 FIX: getDefaultPersona() calls getSupabaseAdmin() — add it to the mock.
  // The admin client needs the same mockFrom chain so DB queries resolve correctly.
  getSupabaseAdmin: () => ({
    from: mockFrom,
  }),
}));

vi.mock('../config', () => ({
  dbConfig: {
    tables: {
      users:        'users',
      campaigns:    'campaigns',
      personas:     'personas',
      feedback:     'feedback',
      brand_assets: 'brand_assets',
    },
  },
}));

// ── Import under test ─────────────────────────────────────────────────────────

import {
  getUserById,
  updateUser,
  incrementGenerationsUsed,
  getCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  getPersonas,
  getDefaultPersona,
  createPersona,
  updatePersona,
  deletePersona,
  setDefaultPersona,
  submitFeedback,
  getFeedbackForCampaign,
  getUserFeedbackStats,
  resolveDocumentIndexStatus,
  recordAssetIntelligenceSync,
} from '../db/dbService';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const mockUserRow = {
  id:                'user-123',
  email:             'test@example.com',
  name:              'Test User',
  avatar_url:        null,
  plan:              'free' as const,
  generations_used:  0,
  created_at:        '2024-01-01T00:00:00Z',
  updated_at:        '2024-01-01T00:00:00Z',
};

const mockCampaignRow = {
  id:              'campaign-123',
  user_id:         'user-123',
  title:           'My Campaign',
  topic:           'Leadership',
  format:          'carousel' as const,
  status:          'draft' as const,
  content:         {},
  qa_score_before: null,
  qa_score_after:  null,
  persona_id:      null,
  created_at:      '2024-01-01T00:00:00Z',
  updated_at:      '2024-01-01T00:00:00Z',
};

const mockPersonaRow = {
  id:           'persona-123',
  user_id:      'user-123',
  name:         'My Persona',
  tone:         'executive' as const,
  domain:       'SaaS',
  audience:     'CTOs',
  key_themes:   ['AI', 'leadership'],
  visual_style: {},
  is_default:   true,
  created_at:   '2024-01-01T00:00:00Z',
  updated_at:   '2024-01-01T00:00:00Z',
};

const mockFeedbackRow = {
  id:          'feedback-123',
  user_id:     'user-123',
  campaign_id: 'campaign-123',
  signal:      'useful' as const,
  note:        null,
  created_at:  '2024-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reset mock to return queryBuilder on every call
  mockFrom.mockReturnValue(queryBuilder);
});

// ═════════════════════════════════════════════════════════════════════════════
// USERS
// ═════════════════════════════════════════════════════════════════════════════

describe('getUserById', () => {
  it('returns data on success', async () => {
    mockSingle.mockResolvedValue({ data: mockUserRow, error: null });

    const { data, error } = await getUserById('user-123');

    expect(error).toBeNull();
    expect(data?.id).toBe('user-123');
    expect(mockFrom).toHaveBeenCalledWith('users');
  });

  it('returns { data: null, error: message } on Supabase error', async () => {
    mockSingle.mockResolvedValue({
      data:  null,
      error: { message: 'no rows returned' },
    });

    const { data, error } = await getUserById('nonexistent');

    expect(data).toBeNull();
    expect(error).toBe('no rows returned');
  });
});

describe('updateUser', () => {
  it('returns updated user row on success', async () => {
    const updated = { ...mockUserRow, name: 'New Name' };
    mockSingle.mockResolvedValue({ data: updated, error: null });

    const { data, error } = await updateUser('user-123', { name: 'New Name' });

    expect(error).toBeNull();
    expect(data?.name).toBe('New Name');
  });
});

describe('incrementGenerationsUsed', () => {
  it('calls rpc with correct arguments', async () => {
    mockRpc.mockResolvedValue({ data: mockUserRow, error: null });

    const { data, error } = await incrementGenerationsUsed('user-123');

    expect(error).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('increment_generations_used', {
      user_id: 'user-123',
    });
  });

  it('returns error when RPC is not found', async () => {
    mockRpc.mockResolvedValue({
      data:  null,
      error: { message: 'function not found' },
    });

    const { data, error } = await incrementGenerationsUsed('user-123');

    expect(data).toBeNull();
    expect(error).toBe('function not found');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CAMPAIGNS
// ═════════════════════════════════════════════════════════════════════════════

describe('getCampaigns', () => {
  it('returns list of campaigns', async () => {
    // For list queries, Supabase returns { data, error, count } without .single()
    mockFrom.mockReturnValue({
      ...queryBuilder,
      select:  vi.fn().mockReturnThis(),
      eq:      vi.fn().mockReturnThis(),
      order:   vi.fn().mockReturnThis(),
      range:   vi.fn().mockResolvedValue({
        data:  [mockCampaignRow],
        error: null,
        count: 1,
      }),
    });

    const { data, error, count } = await getCampaigns('user-123');

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('campaign-123');
    expect(count).toBe(1);
  });

  it('returns empty array for user with no campaigns', async () => {
    mockFrom.mockReturnValue({
      ...queryBuilder,
      select:  vi.fn().mockReturnThis(),
      eq:      vi.fn().mockReturnThis(),
      order:   vi.fn().mockReturnThis(),
      range:   vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    });

    const { data, error, count } = await getCampaigns('user-123');

    expect(data).toEqual([]);
    expect(count).toBe(0);
    expect(error).toBeNull();
  });
});

describe('createCampaign', () => {
  it('returns created campaign on success', async () => {
    mockSingle.mockResolvedValue({ data: mockCampaignRow, error: null });

    const newCampaign = {
      user_id:         'user-123',
      title:           'My Campaign',
      topic:           'Leadership',
      format:          'carousel' as const,
      status:          'draft' as const,
      content:         {},
      qa_score_before: null,
      qa_score_after:  null,
      persona_id:      null,
    };

    const { data, error } = await createCampaign(newCampaign);

    expect(error).toBeNull();
    expect(data?.id).toBe('campaign-123');
  });
});

describe('deleteCampaign', () => {
  it('returns { error: null } on success', async () => {
    // delete() chain ends with awaiting the builder, not .single()
    mockFrom.mockReturnValue({
      ...queryBuilder,
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    const { error } = await deleteCampaign('campaign-123');
    expect(error).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PERSONAS
// ═════════════════════════════════════════════════════════════════════════════

describe('getDefaultPersona', () => {
  it('returns null without error when no default exists (PGRST116)', async () => {
    mockSingle.mockResolvedValue({
      data:  null,
      error: { message: 'no rows returned', code: 'PGRST116' },
    });

    const { data, error } = await getDefaultPersona('user-123');

    expect(data).toBeNull();
    expect(error).toBeNull(); // PGRST116 is treated as "no default", not an error
  });

  it('returns the default persona when one exists', async () => {
    mockSingle.mockResolvedValue({ data: mockPersonaRow, error: null });

    const { data, error } = await getDefaultPersona('user-123');

    expect(error).toBeNull();
    expect(data?.is_default).toBe(true);
    expect(data?.id).toBe('persona-123');
  });
});

describe('setDefaultPersona', () => {
  it('calls update twice: unset all, then set target', async () => {
    const mockUnsetUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    const mockSetUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    let callCount = 0;
    mockFrom.mockImplementation(() => ({
      update: callCount++ === 0 ? mockUnsetUpdate : mockSetUpdate,
    }));

    const { error } = await setDefaultPersona('user-123', 'persona-123');

    expect(error).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('personas');
  });

  it('returns error immediately if unset step fails', async () => {
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
      }),
    });

    const { error } = await setDefaultPersona('user-123', 'persona-123');
    expect(error).toBe('DB error');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FEEDBACK
// ═════════════════════════════════════════════════════════════════════════════

describe('submitFeedback', () => {
  it('inserts feedback and returns the row', async () => {
    mockSingle.mockResolvedValue({ data: mockFeedbackRow, error: null });

    const { data, error } = await submitFeedback({
      user_id:     'user-123',
      campaign_id: 'campaign-123',
      signal:      'useful',
      note:        null,
    });

    expect(error).toBeNull();
    expect(data?.signal).toBe('useful');
    expect(mockFrom).toHaveBeenCalledWith('feedback');
  });
});

describe('getUserFeedbackStats', () => {
  it('aggregates signal counts correctly', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [
            { signal: 'useful' },
            { signal: 'useful' },
            { signal: 'generic' },
            { signal: 'useful' },
          ],
          error: null,
        }),
      }),
    });

    const { data, error } = await getUserFeedbackStats('user-123');

    expect(error).toBeNull();
    expect(data?.['useful']).toBe(3);
    expect(data?.['generic']).toBe(1);
    expect(data?.['off_tone']).toBeUndefined();
  });

  it('returns empty object when user has no feedback', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });

    const { data, error } = await getUserFeedbackStats('user-123');

    expect(data).toEqual({});
    expect(error).toBeNull();
  });

  it('returns { data: null, error } on DB failure', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data:  null,
          error: { message: 'Connection error' },
        }),
      }),
    });

    const { data, error } = await getUserFeedbackStats('user-123');

    expect(data).toBeNull();
    expect(error).toBe('Connection error');
  });
});

// ── G-25 (Architecture Verification Report, P1) ────────────────────────────
// resolveDocumentIndexStatus() is the pure decision function behind the
// upload route's honest-status fix: 'indexed' must only be reachable when
// IntelligenceOS-side extraction genuinely completed or there was nothing to
// wait for; a failed/timed-out attempt must produce a distinct status, never
// a false 'indexed'. Pure function — no Supabase mocking needed.
describe('resolveDocumentIndexStatus', () => {
  it("returns 'indexed' when the ingest attempt succeeded", () => {
    expect(resolveDocumentIndexStatus('succeeded')).toBe('indexed');
  });

  it("returns 'indexed' when IntelligenceOS is not configured for this deployment", () => {
    expect(resolveDocumentIndexStatus('not_configured')).toBe('indexed');
  });

  it("returns 'indexing_pending' (never 'indexed') when the ingest attempt failed or timed out", () => {
    expect(resolveDocumentIndexStatus('failed')).toBe('indexing_pending');
    expect(resolveDocumentIndexStatus('failed')).not.toBe('indexed');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// KNOWLEDGE CONTRIBUTION (2026-07-23)
// ═════════════════════════════════════════════════════════════════════════════

describe('recordAssetIntelligenceSync', () => {
  it('writes intelligence_asset_id only when contribution is not supplied (back-compat call shape)', async () => {
    mockSingle.mockResolvedValue({ data: { id: 'asset-1', intelligence_asset_id: 'kia-1' }, error: null });

    const { error } = await recordAssetIntelligenceSync('asset-1', 'ws-1', 'kia-1');

    expect(error).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('brand_assets');
    const updatePayload = mockUpdate.mock.calls[0][0];
    expect(updatePayload.intelligence_asset_id).toBe('kia-1');
    expect(updatePayload).not.toHaveProperty('knowledge_contribution');
  });

  it('writes knowledge_contribution alongside intelligence_asset_id in the same update when supplied', async () => {
    mockSingle.mockResolvedValue({ data: { id: 'asset-1' }, error: null });
    const contribution = { score: 64, isDuplicate: false, termCount: 30 };

    const { error } = await recordAssetIntelligenceSync('asset-1', 'ws-1', 'kia-1', contribution);

    expect(error).toBeNull();
    const updatePayload = mockUpdate.mock.calls[0][0];
    expect(updatePayload.intelligence_asset_id).toBe('kia-1');
    expect(updatePayload.knowledge_contribution).toEqual(contribution);
    // A single .update() call, not a second round trip.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('writes knowledge_contribution: null when contribution is explicitly null (contribution scoring failed non-fatally)', async () => {
    mockSingle.mockResolvedValue({ data: { id: 'asset-1' }, error: null });

    await recordAssetIntelligenceSync('asset-1', 'ws-1', 'kia-1', null);

    const updatePayload = mockUpdate.mock.calls[0][0];
    expect(updatePayload.knowledge_contribution).toBeNull();
  });

  it('scopes the update to both assetId and workspaceId (workspace isolation)', async () => {
    mockSingle.mockResolvedValue({ data: { id: 'asset-1' }, error: null });

    await recordAssetIntelligenceSync('asset-1', 'ws-1', 'kia-1');

    expect(mockEq).toHaveBeenCalledWith('id', 'asset-1');
    expect(mockEq).toHaveBeenCalledWith('workspace_id', 'ws-1');
  });

  it("returns 'Asset not found' on PGRST116", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'no rows' } });

    const { data, error } = await recordAssetIntelligenceSync('missing', 'ws-1', 'kia-1');

    expect(data).toBeNull();
    expect(error).toBe('Asset not found');
  });
});



