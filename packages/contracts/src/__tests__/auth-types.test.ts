/**
 * @brandos/contracts — auth-types.test.ts
 *
 * Tests for auth types structural integrity.
 *
 * Since auth-types.ts is pure TypeScript (no runtime values), these tests
 * verify the shape and required fields of the types by constructing valid
 * and invalid instances, and verify that the type file itself has no
 * @brandos/* imports.
 *
 * AGENT NOTE: If a new field is added to UserRow or CampaignRow, a
 * corresponding test must be added here to document the expected shape.
 *
 * L5 UPGRADE NOTES (2026-05-27):
 *   - AuthUser.name and AuthUser.avatarUrl are now required (nullable).
 *   - UserRow now requires avatar_url and generations_used.
 *   - CampaignFormat narrowed to DB-backed values only.
 *   - CampaignStatus narrowed to DB lifecycle values.
 *   - PersonaTone narrowed to brand-voice vocabulary.
 *   - FeedbackSignal narrowed to granular signal vocabulary.
 *   - DbResult.error is string | null (not an object).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type {
  AuthProviderKind,
  UserPlan,
  AuthUser,
  AuthState,
  LoginCredentials,
  SignupCredentials,
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
  DbResult,
  DbListResult,
  TableName,
  // P0 — Workspace Foundation (Implementation Wave 1A)
  WorkspacePlan,
  WorkspaceRow,
  NewWorkspace,
  WorkspaceSettingsRow,
  NewWorkspaceSettings,
  BrandAssetStatus,
  BrandAssetRow,
} from '../auth-types';

// ─────────────────────────────────────────────────────────────────────────────
// Structural: no @brandos/* imports in auth-types.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('auth-types.ts — source invariants', () => {
  it('has no @brandos/* imports', () => {
    const content = readFileSync(
      resolve(__dirname, '..', 'auth-types.ts'),
      'utf-8'
    );
    // Only flag actual import statements, not JSDoc comments
    const lines = content.split('\n');
    const violations = lines.filter(line => {
      const trimmed = line.trim();
      const isComment = trimmed.startsWith('//') || trimmed.startsWith('*');
      return !isComment && line.includes('@brandos/') && (line.includes('import ') || line.includes('require('));
    });
    expect(violations).toEqual([]);
  });

  it('has no runtime dependencies', () => {
    const content = readFileSync(
      resolve(__dirname, '..', 'auth-types.ts'),
      'utf-8'
    );
    // No require() or import ... from 'non-type' packages
    expect(content.includes('require(')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AuthProviderKind union
// ─────────────────────────────────────────────────────────────────────────────

describe('AuthProviderKind', () => {
  it('accepts valid provider kinds', () => {
    const kinds: AuthProviderKind[] = ['email', 'google', 'magic_link'];
    expect(kinds).toHaveLength(3);
    expect(kinds).toContain('email');
    expect(kinds).toContain('google');
    expect(kinds).toContain('magic_link');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UserPlan union
// ─────────────────────────────────────────────────────────────────────────────

describe('UserPlan', () => {
  it('accepts all plan tiers', () => {
    const plans: UserPlan[] = ['free', 'premium', 'enterprise'];
    expect(plans).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AuthUser — required fields (L5: name + avatarUrl are required, nullable)
// ─────────────────────────────────────────────────────────────────────────────

describe('AuthUser', () => {
  it('has the required fields: id, email, name, avatarUrl, plan, createdAt', () => {
    const user: AuthUser = {
  id: 'user-abc',
  email: 'test@example.com',
  name: 'Alice',
  avatarUrl: null,
  plan: 'free',
  workspaceId: 'ws-1',
  isPlatformAdmin: false,
  createdAt: new Date().toISOString(),
};
    expect(user.id).toBeTruthy();
    expect(user.email).toBeTruthy();
    expect(user.plan).toBe('free');
    expect(user.createdAt).toBeTruthy();
  });

  it('name and avatarUrl may be null (not-yet-set profile)', () => {
    const user: AuthUser = {
  id: 'user-1',
  email: 'a@b.com',
  name: null,
  avatarUrl: null,
  plan: 'premium',
  workspaceId: 'ws-1',
  isPlatformAdmin: false,
  createdAt: '',
};
    expect(user.name).toBeNull();
    expect(user.avatarUrl).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LoginCredentials / SignupCredentials
// ─────────────────────────────────────────────────────────────────────────────

describe('LoginCredentials', () => {
  it('requires email and password', () => {
    const creds: LoginCredentials = {
      email: 'user@example.com',
      password: 'secret123',
    };
    expect(creds.email).toBeTruthy();
    expect(creds.password).toBeTruthy();
  });
});

describe('SignupCredentials', () => {
  it('requires email, password, and name', () => {
    const creds: SignupCredentials = {
      email: 'new@example.com',
      password: 'secret123',
      name: 'New User',
    };
    expect(creds.name).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CampaignFormat — L5 canonical DB-backed values
// ─────────────────────────────────────────────────────────────────────────────

describe('CampaignFormat', () => {
  it('accepts all canonical campaign formats', () => {
    const formats: CampaignFormat[] = ['carousel', 'linkedin_post', 'article', 'email', 'twitter'];
    expect(formats.length).toBeGreaterThanOrEqual(3);
    expect(formats).toContain('carousel');
    expect(formats).toContain('linkedin_post');
    expect(formats).toContain('article');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CampaignStatus — L5 canonical DB lifecycle values
// ─────────────────────────────────────────────────────────────────────────────

describe('CampaignStatus', () => {
  it('accepts all canonical campaign status values', () => {
    const statuses: CampaignStatus[] = ['draft', 'generated', 'exported', 'paid'];
    expect(statuses).toContain('draft');
    expect(statuses).toContain('generated');
    expect(statuses).toContain('exported');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DbResult / DbListResult
// ─────────────────────────────────────────────────────────────────────────────

describe('DbResult', () => {
  it('represents a successful result', () => {
    const result: DbResult<UserRow> = {
      data: {
        id: 'u1',
        email: 'a@b.com',
        name: 'Alice',
        avatar_url: null,
        plan: 'free',
        generations_used: 0,
        workspace_id: 'ws-1',
        is_platform_admin: false,
        onboarding_completed_at: null,
        created_at: '',
        updated_at: '',
      },
      error: null,
    };
    expect(result.data).toBeDefined();
    expect(result.error).toBeNull();
    expect(result.data?.workspace_id).toBe('ws-1');
  });

  it('represents an error result with a string message', () => {
    const result: DbResult<UserRow> = {
      data: null,
      error: 'Not found',
    };
    expect(result.data).toBeNull();
    expect(result.error).toBe('Not found');
  });
});

describe('DbListResult', () => {
  it('represents a list of items', () => {
    const result: DbListResult<PersonaRow> = {
      data: [],
      error: null,
      count: 0,
    };
    expect(result.data).toBeInstanceOf(Array);
    expect(result.count).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TableName — expected table names present
// ─────────────────────────────────────────────────────────────────────────────

describe('TableName', () => {
  it('includes canonical BrandOS tables', () => {
    const tables: TableName[] = ['users', 'campaigns', 'personas', 'feedback'];
    expect(tables).toContain('users');
    expect(tables).toContain('campaigns');
    expect(tables).toContain('personas');
  });

  // P0 — Workspace Foundation (Implementation Wave 1A)
  it('includes the P0 workspace tables and brand_assets', () => {
    const tables: TableName[] = ['workspaces', 'workspace_settings', 'brand_assets'];
    expect(tables).toContain('workspaces');
    expect(tables).toContain('workspace_settings');
    expect(tables).toContain('brand_assets');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PersonaTone — L5 brand-voice vocabulary
// ─────────────────────────────────────────────────────────────────────────────

describe('PersonaTone', () => {
  it('accepts valid L5 persona tones', () => {
    const tones: PersonaTone[] = ['executive', 'bold', 'educational', 'founder'];
    expect(tones.length).toBeGreaterThanOrEqual(2);
    expect(tones).toContain('executive');
    expect(tones).toContain('bold');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FeedbackSignal — L5 granular signal vocabulary
// ─────────────────────────────────────────────────────────────────────────────

describe('FeedbackSignal', () => {
  it('accepts valid L5 feedback signals', () => {
    const signals: FeedbackSignal[] = ['useful', 'generic', 'off_tone', 'too_shallow', 'too_long'];
    expect(signals).toContain('useful');
    expect(signals).toContain('generic');
    expect(signals).toContain('off_tone');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0 — Workspace Foundation (Implementation Wave 1A)
//
// WorkspaceRow, WorkspaceSettingsRow, BrandAssetRow, NewWorkspace,
// NewWorkspaceSettings, WorkspacePlan, BrandAssetStatus, and the new
// workspace_id / is_platform_admin fields on UserRow / CampaignRow /
// PersonaRow. Clean target architecture: workspace_id is NOT NULL
// everywhere — there is no pre-P0 data to remain compatible with.
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkspacePlan', () => {
  it('accepts the three tier values', () => {
    const plans: WorkspacePlan[] = ['explorer', 'professional', 'executive'];
    expect(plans).toContain('explorer');
    expect(plans).toContain('professional');
    expect(plans).toContain('executive');
  });
});

describe('WorkspaceRow', () => {
  it('has the required fields: id, name, slug, owner_id, plan, timestamps', () => {
    const workspace: WorkspaceRow = {
      id: 'ws-1',
      name: 'alice@example.com',
      slug: 'alice-example-com',
      owner_id: 'u1',
      plan: 'explorer',
      created_at: '',
      updated_at: '',
    };
    expect(workspace.id).toBeTruthy();
    expect(workspace.owner_id).toBe('u1');
    expect(workspace.plan).toBe('explorer');
  });
});

describe('NewWorkspace', () => {
  it('omits id and timestamps', () => {
    const newWorkspace: NewWorkspace = {
      name: 'Bob Co',
      slug: 'bob-co',
      owner_id: 'u2',
      plan: 'explorer',
    };
    expect(newWorkspace.owner_id).toBe('u2');
    // @ts-expect-error — id is server-managed and must not be assignable
    const invalid: NewWorkspace = { ...newWorkspace, id: 'ws-2' };
    expect(invalid).toBeDefined();
  });
});

describe('WorkspaceSettingsRow', () => {
  it('represents pure inheritance — all override fields null', () => {
    const settings: WorkspaceSettingsRow = {
      workspace_id: 'ws-1',
      preferred_provider: null,
      runtime_mode: null,
      governance_score_threshold: null,
      monthly_generation_limit: null,
      asset_storage_limit_mb: null,
      updated_at: '',
    };
    expect(settings.workspace_id).toBe('ws-1');
    expect(settings.monthly_generation_limit).toBeNull();
  });

  it('represents a workspace with an enforced monthly generation limit', () => {
    const settings: WorkspaceSettingsRow = {
      workspace_id: 'ws-2',
      preferred_provider: null,
      runtime_mode: null,
      governance_score_threshold: null,
      monthly_generation_limit: 500,
      asset_storage_limit_mb: null,
      updated_at: '',
    };
    expect(settings.monthly_generation_limit).toBe(500);
  });
});

describe('NewWorkspaceSettings', () => {
  it('requires only workspace_id — override fields are optional', () => {
    const minimal: NewWorkspaceSettings = { workspace_id: 'ws-1' };
    expect(minimal.workspace_id).toBe('ws-1');

    const withOverride: NewWorkspaceSettings = {
      workspace_id: 'ws-2',
      monthly_generation_limit: 1000,
    };
    expect(withOverride.monthly_generation_limit).toBe(1000);
  });
});

describe('BrandAssetStatus', () => {
  it('accepts all lifecycle states', () => {
    const statuses: BrandAssetStatus[] = ['uploading', 'processing', 'indexed', 'failed', 'archived'];
    expect(statuses).toContain('uploading');
    expect(statuses).toContain('indexed');
    expect(statuses).toContain('archived');
  });
});

describe('BrandAssetRow', () => {
  it('has a non-null workspace_id (clean target architecture)', () => {
    const asset: BrandAssetRow = {
  id: 'asset-1',
  user_id: 'u1',
  workspace_id: 'ws-1',

  name: 'logo.png',
  original_filename: 'logo.png',
  mime_type: 'image/png',
  size_bytes: 1024,
  storage_path: 'ws-1/asset-1/logo.png',

  status: 'indexed',
  vlm_analysis: { description: 'a logo' },
  metadata: {},
  tags: [],
  usage_count: 0,
  archived_at: null,

  created_at: '',
  updated_at: '',
}
    expect(asset.workspace_id).toBe('ws-1');
    expect(asset.status).toBe('indexed');
  });
});

describe('UserRow — P0 workspace fields', () => {
  it('requires a non-null workspace_id and a defaulted is_platform_admin', () => {
    const user: UserRow = {
      id: 'u1',
      email: 'a@b.com',
      name: 'Alice',
      avatar_url: null,
      plan: 'free',
      generations_used: 0,
      workspace_id: 'ws-1',
      is_platform_admin: false,
      onboarding_completed_at: null,
      created_at: '',
      updated_at: '',
    };
    expect(user.workspace_id).toBe('ws-1');
    expect(user.is_platform_admin).toBe(false);
  });
});

describe('CampaignRow / PersonaRow — P0 workspace fields', () => {
  it('CampaignRow.workspace_id is a required string', () => {
    const campaign: CampaignRow = {
      id: 'c1',
      user_id: 'u1',
      workspace_id: 'ws-1',
      title: 'Q3 Launch',
      topic: 'AI in fintech',
      format: 'carousel',
      status: 'draft',
      content: {},
      qa_score_before: null,
      qa_score_after: null,
      persona_id: null,
      created_at: '',
      updated_at: '',
    };
    expect(campaign.workspace_id).toBe('ws-1');
  });

  it('PersonaRow.workspace_id is a required string', () => {
    const persona: PersonaRow = {
      id: 'p1',
      user_id: 'u1',
      workspace_id: 'ws-1',
      name: 'Default',
      tone: 'executive',
      domain: null,
      audience: null,
      key_themes: [],
      visual_style: {},
      is_default: true,
      created_at: '',
      updated_at: '',
    };
    expect(persona.workspace_id).toBe('ws-1');
  });

  it('NewCampaign / NewPersona require workspace_id', () => {
    const newCampaign: NewCampaign = {
      user_id: 'u1',
      workspace_id: 'ws-1',
      title: 'New',
      topic: 'topic',
      format: 'carousel',
      status: 'draft',
      content: {},
      qa_score_before: null,
      qa_score_after: null,
      persona_id: null,
    };
    expect(newCampaign.workspace_id).toBe('ws-1');

    const newPersona: NewPersona = {
      user_id: 'u1',
      workspace_id: 'ws-1',
      name: 'Default',
      tone: 'executive',
      domain: null,
      audience: null,
      key_themes: [],
      visual_style: {},
      is_default: true,
    };
    expect(newPersona.workspace_id).toBe('ws-1');
  });
});


