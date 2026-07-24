/**
 * @brandos/contracts — auth-types.ts
 *
 * ARCHITECTURAL ROLE:
 *   Canonical auth and user identity types shared across the BrandOS monorepo.
 *   Promoted from @brandos/auth so that dependent layers (control-plane-layer,
 *   presentation-layer) can import user/session shapes WITHOUT importing the
 *   entire auth package (which pulls in Supabase SSR, React, Next.js).
 *
 * RULES FOR THIS FILE:
 *   1. Zero imports from any @brandos/* package (intra-package imports from
 *      sibling files in @brandos/contracts, e.g. ./user-state-types, are fine).
 *   2. Zero runtime dependencies — pure TypeScript interfaces and type aliases.
 *   3. All DB row shapes here are the canonical source of truth.
 *      The @brandos/auth package IMPORTS from here; it does not redefine them.
 *   4. Never add Supabase-specific types here. Keep this layer-agnostic.
 *
 * CONSUMERS:
 *   - @brandos/auth           — implements these types against Supabase
 *   - control-plane-layer     — reads AuthUser from ContributorContext
 *   - presentation-layer      — renders AuthState via useAuth()
 *   - generation-contract.ts  — ContributorContext carries AuthUser
 *
 * AGENT GUIDANCE:
 *   When adding a new field to the `users` Supabase table, update UserRow here
 *   first, then update the dbService.ts mapping in @brandos/auth. Do NOT update
 *   presentation-layer types directly — they must derive from here.
 */

import type { UserLifecycleState } from './user-state-types';

// ─────────────────────────────────────────────────────────────────────────────
// AUTH PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which authentication provider was used for the current session.
 * 'email'      — email + password (Supabase Auth built-in)
 * 'google'     — Google OAuth 2.0 via Supabase
 * 'magic_link' — passwordless OTP sent to email
 */
export type AuthProviderKind = 'email' | 'google' | 'magic_link';

/**
 * Subscription tier for a BrandOS user.
 * Controls access to generation limits, providers, and features.
 * EDGE CASE: 'enterprise' users bypass per-request generation limits
 * (they have workspace-level quotas managed by the admin panel).
 */
export type UserPlan = 'free' | 'premium' | 'enterprise';

/**
 * Canonical, resolved user object — the safe public surface of a Supabase user.
 *
 * This is what flows through React context (AuthState.user) and into the
 * ContributorContext for generation. It intentionally omits raw Supabase
 * fields (identities, app_metadata) that should never leave the auth layer.
 *
 * MAPPING: Derived from supabase.auth.user + public.users profile row.
 *   - id, email, createdAt come from auth.users
 *   - name, avatarUrl, plan, workspaceId, isPlatformAdmin come from
 *     public.users (fallback: user_metadata for name/avatarUrl only)
 *
 * P0 — WORKSPACE FOUNDATION (Implementation Wave 1A):
 *   workspaceId and isPlatformAdmin are read directly from
 *   public.users.workspace_id / public.users.is_platform_admin, both of
 *   which are NOT NULL / defaulted. No fallback chain is needed — every
 *   public.users row has both fields from the moment it is created (the
 *   signup trigger creates the workspace in the same transaction).
 */
export interface AuthUser {
  /** Supabase auth UUID — stable primary key across all BrandOS tables */
  id: string;
  /** Verified email address */
  email: string;
  /**
   * Display name.
   * Priority: public.users.name → user_metadata.full_name → null
   * null means the user has not set a name; the UI should prompt them.
   */
  name: string | null;
  /**
   * Avatar image URL.
   * Priority: public.users.avatar_url → user_metadata.avatar_url → null
   */
  avatarUrl: string | null;
  /** Active subscription plan — read from public.users.plan */
  plan: UserPlan;
  /**
   * FK → workspaces.id. The user's workspace.
   * Source: public.users.workspace_id (NOT NULL).
   */
  workspaceId: string;
  /**
   * Platform-wide administrator flag.
   * Source: public.users.is_platform_admin (defaults to false).
   */
  isPlatformAdmin: boolean;
  /** ISO 8601 timestamp from auth.users.created_at */
  createdAt: string;
}

/**
 * Auth context state shape — the full React context value's state slice.
 *
 * isLoading is true during:
 *   1. Initial mount (before Supabase session resolves)
 *   2. Any auth action (login, logout, signup) is in-flight
 *
 * EDGE CASE: After a hard page refresh with an active session,
 * isLoading=true for ~100–300 ms while createBrowserClient reads the
 * cookie and hydrates the session. Components that guard behind
 * `if (isLoading) return <Spinner />` will flash during this window.
 */
export interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  /** Derived: true iff user !== null. Never trust this without checking isLoading. */
  isAuthenticated: boolean;
  /** Human-readable error from the last failed auth operation, or null. */
  error: string | null;
  /**
   * Computed lifecycle projection — see UserLifecycleState in
   * user-state-types.ts. `null` until the first computation resolves
   * (starts null even after `user` is set — it is filled in by a
   * follow-up async step in AuthProvider, never blocking the existing
   * isLoading/init race). Consumers that need "is this user ready to use
   * the product" should read `userLifecycleState.stage`, never re-derive
   * it from `user` + ad hoc localStorage/DB checks.
   */
  userLifecycleState: UserLifecycleState | null;
}

/**
 * Session token envelope — mirrors the Supabase Session shape.
 * Used when you need raw token access (e.g. server-side API calls).
 *
 * IMPORTANT: Never pass this object to client-side components.
 * It is for server-side route handlers and middleware only.
 * The access_token is a signed JWT; do not log it.
 */
export interface AuthSession {
  access_token: string;
  refresh_token: string;
  /** Unix epoch seconds at which the access_token expires */
  expires_at?: number;
  /** The resolved user at the time of session creation */
  user: AuthUser;
}

/**
 * Optional override for the bounded retry getSession()/getCurrentUser() run
 * against the public.users profile lookup, to cover the signup-trigger
 * race (the DB trigger creating a new user's profile row — plus their
 * workspace and workspace_settings — runs asynchronously after auth.users
 * insert, and the very first lookup after signup can land just before it
 * commits).
 *
 * Both fields are optional; production callers normally omit this
 * entirely and get the implementation's default retry count/delay. Pass
 * `{ retries: 0 }` or `{ delayMs: 0 }` (e.g. from tests exercising the
 * give-up path) to skip or speed up the retry loop.
 */
export interface ProfileRetryOptions {
  retries?: number;
  delayMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH ACTION PAYLOADS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Credentials for email + password login.
 * Validated by Supabase; we do not validate password strength here
 * (that is enforced during signup via Supabase Auth policies).
 */
export interface LoginCredentials {
  email: string;
  password: string;
}

/**
 * Credentials for new account creation.
 * name is optional — users can set it after signup via their profile.
 * EDGE CASE: If signup succeeds but email confirmation is required
 * (authConfig.providers.email = true + Supabase email confirm ON),
 * user will be non-null but session will be null until email is confirmed.
 */
export interface SignupCredentials extends LoginCredentials {
  name?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB ROW TYPES — canonical shapes for BrandOS Supabase tables
//
// These match the Supabase schema exactly. Column names use snake_case
// to match PostgreSQL conventions. The auth package maps them to camelCase
// AuthUser where needed.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * public.users table row.
 *
 * This table extends Supabase auth.users with BrandOS-specific profile data.
 * Inserted by a Supabase trigger (`on_auth_user_created`) when a new user signs up.
 *
 * EDGE CASE: The trigger may fail silently in local dev if Supabase realtime
 * is not running. Always check for null when reading profile fields.
 *
 * P0 — WORKSPACE FOUNDATION (Implementation Wave 1A):
 *   Every user belongs to exactly one workspace (`workspace_id`, NOT NULL).
 *   The signup trigger creates a workspace for the new user in the same
 *   transaction that creates this row (see
 *   YYYYMMDD_05_workspace_signup_trigger.sql) — there is no "user without a
 *   workspace" state to handle anywhere in the codebase.
 */
export interface UserRow {
  /** FK → auth.users.id (UUID). Never changes for a user. */
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  plan: UserPlan;
  /**
   * Cumulative count of AI generations this user has made.
   * Incremented atomically via Postgres RPC `increment_generations_used`.
   * NEVER increment this client-side — race conditions will corrupt the count.
   */
  generations_used: number;
  /**
   * FK → workspaces.id, NOT NULL. The user's workspace.
   *
   * Created atomically with this row by the signup trigger — every user row
   * has had a workspace since the moment it was created. Treat this as
   * always-present; do not write null-checking branches for it.
   */
  workspace_id: string;
  /**
   * Platform-wide administrator flag. Defaults to `false`.
   *
   * `requireAdmin()` in apps/web checks this field — see
   * lib/admin/require-admin.ts. To grant platform-admin access, set this to
   * `true` via a one-time admin SQL update — there is no UI for this in P0
   * (Platform Admin bootstrapping is out of scope).
   */
  is_platform_admin: boolean;
  /**
   * Durable server-side record of onboarding completion. `null` until the
   * user finishes (or explicitly skips) the `/workspace/onboarding` flow;
   * set to the completion timestamp at that point via
   * `completeOnboarding()`.
   *
   * This is the single authoritative onboarding signal — see
   * `UserLifecycleState` in `user-state-types.ts`. It intentionally
   * replaces the old client-side `localStorage['brandos_onboarding_complete']`
   * flag as the source of truth; it is set on both the "complete" and the
   * "skip" path (skipping does not require a persona to exist — see
   * `computeUserLifecycleState`'s `onboarded` vs `operational` distinction).
   */
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Format discriminator for a campaign artifact.
 * Maps to InvocationType in @brandos/contracts airuntime-types.ts.
 * AGENT NOTE: When adding a new format, also add the corresponding
 * InvocationType in contracts/src/airuntime-types.ts.
 */
export type CampaignFormat = 'carousel' | 'linkedin_post' | 'article' | 'email' | 'twitter';

/**
 * Lifecycle state of a campaign.
 * 'draft'     → topic set, not yet generated
 * 'generated' → AI output stored in content field
 * 'exported'  → downloaded or published by the user
 * 'paid'      → a payment-gated export was completed (enterprise feature)
 */
export type CampaignStatus = 'draft' | 'generated' | 'exported' | 'paid';

/**
 * public.campaigns table row.
 *
 * The `content` field stores the full ArtifactV2 JSON output from the generation
 * pipeline. It is typed as Record<string, unknown> here to avoid importing
 * ArtifactV2 from artifact-v2.ts (which would create a large transitive dependency).
 * The control-plane-layer casts this to ArtifactV2 at read time.
 *
 * QA scores: populated by the control plane governance layer.
 *   qa_score_before → raw LLM output richness score (0–100)
 *   qa_score_after  → score after governance repair cycle
 * Both are null until the campaign reaches 'generated' status.
 */
export interface CampaignRow {
  id: string;
  user_id: string;
  /**
   * FK → workspaces.id, NOT NULL. The workspace this campaign belongs to.
   * Always set at insert time by the generation routes (resolved from
   * `users.workspace_id` — see @brandos/control-plane-layer's
   * `resolveWorkspaceContext()`, A.3).
   */
  workspace_id: string;
  title: string;
  topic: string;
  format: CampaignFormat;
  status: CampaignStatus;
  /**
   * Stores the generation output for this campaign. Two possible shapes:
   *
   * 1. **Structured artifact** (carousel, deck, report, newsletter):
   *    A full ArtifactV2 JSON object with `$schema: "artifact-json@2.0"` and
   *    an `artifact_type` discriminator. Use `isArtifactV2(content)` to narrow
   *    safely before casting to `ArtifactV2`.
   *
   * 2. **Unstructured format** (linkedin_post, article, email, twitter):
   *    `{ format, title, content: string, metadata, control_plane, engine_badge }`.
   *    No `$schema` field. `extractSourceText()` in @brandos/control-plane-layer
   *    handles both shapes correctly.
   *
   * AGENT GUIDANCE: Do NOT unconditionally cast `content` to `ArtifactV2`.
   * Check `isArtifactV2(content)` first — or check for `$schema` === 'artifact-json@2.0'.
   */
  content: Record<string, unknown>;
  /** Control Plane richness score before governance repair (null until generated) */
  qa_score_before: number | null;
  /** Control Plane richness score after governance repair (null until generated) */
  qa_score_after: number | null;
  /** FK → personas.id — the persona used for generation. null for default persona. */
  persona_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Omit server-managed fields when inserting a new campaign */
export type NewCampaign = Omit<CampaignRow, 'id' | 'created_at' | 'updated_at'>;

/**
 * Tone vocabulary for a persona.
 * Maps to the `tone` field injected into the generation prompt via
 * IPersonaContribution.tone in generation-contract.ts.
 */
export type PersonaTone = 'executive' | 'bold' | 'educational' | 'founder';

/**
 * public.personas table row.
 *
 * A persona encapsulates a brand voice configuration.
 * Each user can have multiple personas; exactly one is `is_default`.
 *
 * `visual_style` stores a subset of VisualIdentitySnapshot from contracts/identity-types.ts.
 * Typed as Record<string, unknown> here to avoid the transitive import.
 *
 * INVARIANT: Only one persona per user may have is_default=true.
 * The setDefaultPersona() function in dbService.ts enforces this with a
 * two-step update (unset all → set one). If this two-step is interrupted,
 * 0 or 2 personas may be default — callers should defensively handle this
 * by taking the first is_default=true record.
 */
export interface PersonaRow {
  id: string;
  user_id: string;
  /**
   * FK → workspaces.id, NOT NULL. The workspace this persona belongs to.
   * See CampaignRow.workspace_id.
   */
  workspace_id: string;
  name: string;
  tone: PersonaTone;
  /** Industry domain for the persona (e.g., 'fintech', 'SaaS', 'healthcare') */
  domain: string | null;
  /** Target audience description (e.g., 'Series A founders', 'enterprise CTOs') */
  audience: string | null;
  /** Recurring content themes (e.g., ['AI', 'leadership', 'product strategy']) */
  key_themes: string[];
  /** Visual style JSON — subset of VisualIdentitySnapshot */
  visual_style: Record<string, unknown>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  /**
   * Cognitive Platform Evolution Program, EM-1.2/EM-1.4. IntelligenceOS
   * knowledge-asset id from the most recent successful
   * `POST /v1/workspace-configuration` sync. Null until first synced.
   * Nullable/optional here (rather than required) so existing code that
   * constructs a PersonaRow-shaped object without these fields (tests,
   * older call sites) does not need to change to keep compiling — see
   * supabase/migrations/20260715120000_persona_intelligence_os_sync.sql.
   */
  intelligence_asset_id?: string | null;
  /** Timestamp of the most recent successful sync above. Null/undefined = never synced or stale. */
  synced_to_intelligence_os_at?: string | null;
}

/** Omit server-managed fields when inserting a new persona */
export type NewPersona = Omit<PersonaRow, 'id' | 'created_at' | 'updated_at'>;

/**
 * User feedback signal vocabulary.
 * Signals are fed back into the identity layer to adjust persona preferences.
 *
 * 'useful'      → positive reinforcement — content matched expectations
 * 'generic'     → content was too generic (identity confidence may be low)
 * 'off_tone'    → content missed the persona tone (signals tone mismatch)
 * 'too_shallow' → content lacked depth (triggers richness threshold increase)
 * 'too_long'    → content was too verbose (adjusts preferredLength signal)
 */
export type FeedbackSignal = 'useful' | 'generic' | 'off_tone' | 'too_shallow' | 'too_long';

/**
 * public.feedback table row.
 *
 * Links a feedback signal to a specific campaign. Aggregated by
 * getUserFeedbackStats() to compute per-signal frequency distributions
 * for identity layer learning.
 */
export interface FeedbackRow {
  id: string;
  user_id: string;
  campaign_id: string;
  signal: FeedbackSignal;
  /** Optional free-text annotation — not used in automated learning */
  note: string | null;
  created_at: string;
}

/** Omit server-managed fields when inserting new feedback */
export type NewFeedback = Omit<FeedbackRow, 'id' | 'created_at'>;

// ─────────────────────────────────────────────────────────────────────────────
// WORKSPACE — P0 PLATFORM FOUNDATION (Implementation Wave 1A)
//
// Introduced as part of the P0 Workspace Isolation & Platform Boundaries
// initiative (see brandos-phase2-design.md §2 for the approved design).
//
// `workspaceId` was, pre-P0, a string scoping key threaded through
// @brandos/brand-intelligence, @brandos/control-plane-layer's types, and the
// brand-cognition V2 contracts, but resolved at runtime to `user.id`, the
// literal `'default'`, or ad-hoc agent-session literals (`'planner'`,
// `'transform'`, `'manual'`). These three row types make `workspaceId` a real
// foreign key: every workspace-scoped resource (campaigns, personas, brand
// assets, brand-memory signals) now points at a `workspaces.id` UUID.
//
// SCOPE NOTE: P0 implements single-owner workspaces only.
// `workspace_members` (multi-user collaboration, role column) is part of the
// approved P0 *data model* design (§2.3) but is explicitly deferred to a
// later phase — it is NOT implemented here and has no corresponding row type
// in this file. Do not add member-management code paths against a
// `workspace_members` table; it does not exist yet.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Workspace plan/tier identifier.
 *
 * P0 does not enforce any tier-specific behavior — this column exists so the
 * workspace row has a stable home for the value before P2 tiering activates
 * enforcement. New workspaces default to 'explorer'.
 *
 * AGENT GUIDANCE: Do not branch on this value in P0 code. It is a passive
 * data field until P2 (Explorer/Professional/Executive tiering) lands.
 */
export type WorkspacePlan = 'explorer' | 'professional' | 'executive';

/**
 * public.workspaces table row.
 *
 * A Workspace is a first-class platform boundary: the owner of all
 * workspace-scoped resources (campaigns, personas, brand assets, brand-memory
 * signals) and the attachment point for workspace-level settings (see
 * WorkspaceSettingsRow), isolation, and (in later phases) tiering/BYOK.
 *
 * P0 SCOPE: single-owner workspaces only. `owner_id` is the sole authority —
 * there is no membership model yet (see file header note).
 *
 * CREATION: Every user row is created together with exactly one workspace
 * row, in the same transaction, by the signup trigger
 * (YYYYMMDD_05_workspace_signup_trigger.sql). `name` defaults to the user's
 * email; `plan` defaults to 'explorer'.
 */
export interface WorkspaceRow {
  /** Primary key (UUID). Generated via `gen_random_uuid()`. */
  id: string;
  /** Display name — defaults to the owner's email at creation time. */
  name: string;
  /**
   * URL-safe identifier, unique across all workspaces.
   * Not currently surfaced in any route — reserved for future
   * workspace-scoped URL patterns (e.g. multi-workspace switching).
   */
  slug: string;
  /** FK → users.id. The workspace creator. ON DELETE CASCADE. */
  owner_id: string;
  /** Mirrors the tier model — see WorkspacePlan. Defaults to 'explorer'. */
  plan: WorkspacePlan;
  created_at: string;
  updated_at: string;
}

/** Omit server-managed fields when inserting a new workspace */
export type NewWorkspace = Omit<WorkspaceRow, 'id' | 'created_at' | 'updated_at'>;

/**
 * public.workspace_settings table row.
 *
 * One row per workspace (1:1, `workspace_id` is the primary key). Implements
 * the middle layer of the three-level settings hierarchy:
 *
 *   Platform Defaults (governance-config / runtime-config)
 *        ↓
 *   Global Admin Settings (AdminSettingsService — pre-existing)
 *        ↓
 *   Workspace Settings (this table — NEW in P0)
 *
 * RESOLUTION RULE: every nullable field here means "inherit from the layer
 * above". A non-null value overrides the global admin setting for this
 * workspace only. See @brandos/control-plane-layer's
 * `src/workspace/settings-resolver.ts` (A.3) for the resolution algorithm.
 *
 * A row is created (all fields null except `workspace_id`) in the same
 * transaction as the workspace itself, so every workspace always has a
 * `workspace_settings` row — callers never need to handle "row missing".
 *
 * P0 enforcement scope: only `monthly_generation_limit` is read by the
 * generation pipeline (`checkWorkspaceLimits()`, A.3) — the remaining
 * fields are accepted, persisted, and resolvable via
 * GET /api/workspace/settings, but are NOT yet wired into the runtime,
 * governance, or asset-storage pipelines. That wiring is P1/P2 scope
 * (asset_storage_limit_mb → Asset Vault storage checks; the AI-runtime and
 * governance overrides → P2 tier-aware generation).
 *
 * AGENT GUIDANCE: when adding a new overridable setting, add the nullable
 * column here FIRST, then wire its resolution into settings-resolver.ts.
 * Never make a field here non-nullable — every field is an *override*, and
 * "no override" must always be representable.
 */
export interface WorkspaceSettingsRow {
  /** FK → workspaces.id. Primary key (1:1 with WorkspaceRow). */
  workspace_id: string;
  /**
   * AI provider priority override. null = inherit global admin setting.
   * NOT YET WIRED into ai-runtime-layer (P1/P2 — see settings-resolver.ts).
   */
  preferred_provider: string | null;
  /**
   * Runtime mode override ('local' | 'cloud'). null = inherit global admin
   * setting. NOT YET WIRED into callWithMode() routing (P2 — Explorer is
   * cloud-only by tier policy, but P0 does not enforce this).
   */
  runtime_mode: string | null;
  /**
   * Governance score threshold override. null = inherit
   * AdminSettingsService.getGovernancePolicy().scoreThresholds.
   * NOT YET WIRED into the carousel/deck/report richness-threshold lookup
   * (P2 — Professional+ override window).
   */
  governance_score_threshold: number | null;
  /**
   * Monthly generation limit. null = no workspace-level override (tier
   * default applies once P2 tiering activates; until then, null means
   * "unlimited" from checkWorkspaceLimits()'s perspective).
   *
   * THIS IS THE ONE FIELD P0 ACTUALLY ENFORCES — see
   * checkWorkspaceLimits() in @brandos/control-plane-layer
   * (src/workspace/limits-checker.ts).
   */
  monthly_generation_limit: number | null;
  /**
   * Asset storage limit in MB. null = no override.
   * NOT YET WIRED — Asset Vault storage enforcement is P1 scope.
   */
  asset_storage_limit_mb: number | null;
  updated_at: string;
}

/**
 * For inserting a new workspace_settings row (one per workspace, all nullable
 * fields null = pure inheritance). `workspace_id` is required (it is the PK,
 * not a server-managed field), so this is a `Partial` over the override
 * fields rather than an `Omit`-from-row type like the other `New*` aliases.
 */
export type NewWorkspaceSettings = Pick<WorkspaceSettingsRow, 'workspace_id'> &
  Partial<Omit<WorkspaceSettingsRow, 'workspace_id' | 'updated_at'>>;

/**
 * Lifecycle status for a brand asset.
 *
 * 'uploading'         → file transfer in progress (transient — set by the
 *                       upload handler before the storage write completes)
 * 'processing'        → uploaded, awaiting/undergoing VLM analysis (images)
 *                       or awaiting IntelligenceOS knowledge extraction
 *                       (documents, briefly, before the extraction attempt
 *                       resolves)
 * 'indexing_pending'  → G-25 (Architecture Verification Report, P1). A
 *                       document's IntelligenceOS knowledge-extraction
 *                       attempt did not complete successfully (error or
 *                       timeout). Distinct from 'indexed' specifically so
 *                       the user-visible status never claims IntelligenceOS-
 *                       side completion that did not actually happen —
 *                       previously this case was silently reported as
 *                       'indexed'. Re-running POST /api/assets/:id/analyze
 *                       retries the ingestion attempt.
 * 'indexed'           → for images: VLM analysis complete (or skipped);
 *                       for documents: the IntelligenceOS knowledge-
 *                       extraction attempt genuinely completed successfully
 *                       (or IntelligenceOS is not configured for this
 *                       deployment, in which case there is nothing to wait
 *                       for). Asset is usable either way.
 * 'failed'            → VLM analysis failed; eligible for retry via reindex
 * 'archived'          → soft-deleted (AD-4) — hidden from standard users,
 *                       restorable by a platform admin only
 */
export type BrandAssetStatus = 'uploading' | 'processing' | 'indexing_pending' | 'indexed' | 'failed' | 'archived';

/**
 * public.brand_assets table row.
 *
 * Canonical row type for `public.brand_assets`.
 *
 * P0 established workspace isolation (workspace_id, status, vlm_analysis).
 * P1 (Asset Vault Evolution) completes the schema with the full set of
 * fields required for the Asset Vault CRUD surface:
 *   name, original_filename, mime_type, size_bytes, storage_path
 *
 * P1 SCOPE: all fields are now read/written by asset routes in
 * apps/web/app/api/assets/. The `IAssetOperations` interface in
 * @brandos/auth owns all CRUD against this table.
 *
 * STORAGE PATH CONVENTION (P1):
 *   `${workspace_id}/${asset_id}/${sanitized_original_filename}`
 *   Previous convention was `${user_id}/${timestamp}-${filename}` (P0/pre-P1).
 *   New uploads use the workspace-scoped convention.
 *   Existing uploads are migrated via scripts/migrate-asset-paths.ts.
 */
export interface BrandAssetRow {
  id: string;

  /**
   * FK → workspaces.id, NOT NULL.
   * Every asset belongs to a workspace. Resolved from `users.workspace_id`
   * at upload time by requireUser() — never trusted from the client.
   */
  workspace_id: string;

  /**
   * FK → users.id. The user who uploaded this asset.
   * Retained for audit and user-scoped queries.
   */
  user_id: string;

  /**
   * Display name — user-editable via PATCH /api/assets/:id.
   * Defaults to `original_filename` at creation time.
   */
  name: string;

  /**
   * The original filename as supplied by the browser at upload time.
   * Immutable post-creation. Used to restore the original name if the user
   * renames and wants to revert.
   */
  original_filename: string;

  /**
   * MIME type from the upload Content-Type header.
   * Used for type-based filtering and icon selection in the UI.
   * Examples: 'image/png', 'application/pdf', 'image/webp'
   */
  mime_type: string;

  /**
   * File size in bytes.
   * Used for storage quota enforcement (workspace_settings.asset_storage_limit_mb)
   * and display in the asset list.
   */
  size_bytes: number;

  /**
   * Supabase Storage object path within the `brand-assets` bucket.
   * P1 convention: `${workspace_id}/${asset_id}/${sanitized_original_filename}`
   * UNIQUE constraint — each asset occupies one slot in storage.
   * NULL only during the brief window between row INSERT and storage upload
   * completion (transitional state; status = 'uploading' during this window).
   */
  storage_path: string | null;

  /**
   * Asset lifecycle status.
   * See BrandAssetStatus for the full state machine and valid transitions.
   */
  status: BrandAssetStatus;

  /**
   * Metadata blob — populated at upload time.
   * Shape depends on mime_type:
   *   images: { width?: number, height?: number }
   *   PDFs:   { pages?: number }
   *   video:  { duration_seconds?: number }
   *   other:  {}
   */
  metadata: Record<string, unknown>;

  /**
   * VLM analysis output — populated by POST /api/assets/:id/analyze.
   * Shape: { description, colors, typography, mood, confidence, recommendations }
   * null until analysis is run.
   */
  vlm_analysis: Record<string, unknown> | null;

  /**
   * User-defined tags for search and organization.
   * Free-text array. Editable via PATCH /api/assets/:id.
   */
  tags: string[];

  /**
   * How many campaigns reference this asset.
   * Incremented by the generation pipeline when an asset is used.
   * Pre-wired for P2 asset analytics — not yet incremented in P1.
   */
  usage_count: number;

  created_at: string;
  updated_at: string;

  /**
   * Soft-delete timestamp. NULL = active asset.
   * Set to now() by DELETE /api/assets/:id (archive action).
   * Archived assets have status = 'archived' and are hidden from standard
   * list queries. Restorable by a platform admin via POST /api/assets/:id/restore
   * (Phase B — not implemented in P1).
   */
  archived_at: string | null;

  /**
   * Cognitive Platform Evolution Program, EM-2.6 (Ingestion Correlation &
   * Confirmation). IntelligenceOS knowledge-asset id from the most recent
   * successful `POST /v1/knowledge/ingest` call for this asset — null
   * until ingested (or if ingestion was skipped/failed; ingestion is
   * best-effort, see `apps/web/app/api/assets/route.ts`). Passed back as
   * `existingAssetId` on re-ingestion (e.g. from the Analyze action) so
   * IntelligenceOS updates the same knowledge asset instead of creating a
   * duplicate every time a user re-analyzes the same file.
   */
  intelligence_asset_id?: string | null;

  /**
   * Knowledge Lifecycle Completion (2026-07-23). The `contribution` field
   * IntelligenceOS's `POST /v1/knowledge/ingest` response returns
   * (`ContributionSummary` — see `@brandos/cognition-client`'s
   * `KnowledgeIngestClient`), copied here verbatim so the Library UI can
   * render "how much did this document add" without a round-trip to
   * IntelligenceOS on every page load. Null until ingested, if ingestion
   * was skipped/failed, or for images (contribution scoring is specific
   * to the Knowledge Pipeline's text-extraction path — VLM analysis for
   * images has its own `confidence` field on `vlm_analysis`, a different
   * concept). Shape: `{ score, isDuplicate, duplicateAssetId,
   * noveltyRatio, corroborationScore, termCount, frameworkCount,
   * patternCount, reasons }`.
   */
  knowledge_contribution?: Record<string, unknown> | null;
}

/**
 * Payload for inserting a new brand_assets row.
 * Omits server-managed fields (id, created_at, updated_at).
 * storage_path may be set to null initially (populated after storage upload).
 */
export type NewBrandAsset = Omit<BrandAssetRow, 'created_at' | 'updated_at'>;

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC DB RESULT WRAPPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard single-record result envelope.
 * All dbService functions return this shape — never throw on DB errors.
 *
 * PATTERN: Always check error before using data.
 *   const { data, error } = await getUserById(id);
 *   if (error) { ... handle ... }
 *   // data is guaranteed non-null here
 */
export interface DbResult<T> {
  data: T | null;
  error: string | null;
}

/**
 * Standard list result envelope.
 * count is the total record count for pagination (from Supabase `count: 'exact'`).
 * count is null if the query did not request a count (use sparingly — it adds overhead).
 */
export interface DbListResult<T> {
  data: T[];
  error: string | null;
  count: number | null;
}

/**
 * BrandOS Supabase table name literal union.
 * Update this when adding new tables to keep type-safe table references
 * in dbService.ts and audit tooling.
 *
 * P0 — WORKSPACE FOUNDATION:
 *   'workspaces' and 'workspace_settings' are new tables (see WorkspaceRow,
 *   WorkspaceSettingsRow above). 'brand_assets' is promoted from an
 *   out-of-band table reference (it existed in the live schema and was
 *   written to by /api/vlm-analyze, but was absent from this union and had
 *   no canonical row type — see BrandAssetRow above and
 *   ARCHITECTURE_DRIFT_REPORT.md's Data Model Discovery section).
 *
 *   'workspace_members' is intentionally NOT included — it is part of the
 *   approved P0 data-model design (§2.3) but deferred to a later phase and
 *   does not exist as a table yet. Do not add it here until the
 *   corresponding migration and row type are introduced.
 *
 *   'cp_telemetry' remains in this union for historical/type-level
 *   completeness even though it has zero read/write call sites — removing
 *   it is out of scope for this change.
 *
 * P3 — BYOK & PROVIDER OBSERVABILITY:
 *   'workspace_api_keys'       — encrypted per-workspace provider credentials
 *   'workspace_provider_usage' — fire-and-forget generation telemetry (replaces cp_telemetry)
 *   'workspace_provider_health'— per-(workspace, provider) health snapshot
 */
export type TableName =
  | 'users'
  | 'campaigns'
  | 'personas'
  | 'feedback'
  | 'cp_telemetry'
  | 'workspaces'
  | 'workspace_settings'
  | 'brand_assets'
  // P3 — BYOK & Provider Observability
  | 'workspace_api_keys'
  | 'workspace_provider_usage'
  | 'workspace_provider_health';

// ─────────────────────────────────────────────────────────────────────────────
// P3 — BYOK & PROVIDER OBSERVABILITY
//
// Row types for the three new workspace-scoped provider tables introduced in P3.
// These are the canonical source of truth for the schema — the @brandos/auth
// package imports from here and maps them to/from Supabase.
//
// ENCRYPTION: workspace_api_keys.encrypted_key / iv / auth_tag carry the
// AES-256-GCM output split into three base64 columns. Decryption is owned
// exclusively by @brandos/runtime-config/credentials/resolver.ts — no other
// layer ever calls the decrypt path.
//
// PROVIDER VALIDATION: provider column values are validated at the application
// layer (W7 POST route, credential resolver) against CLOUD_PROVIDER_IDS from
// @brandos/contracts. Not a SQL CHECK enum so registering a new provider never
// requires a migration.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * public.workspace_api_keys table row.
 *
 * Stores an encrypted API key for one cloud provider per workspace.
 * The UNIQUE constraint on (workspace_id, provider) means there is at most
 * one active row per provider per workspace at any time.
 *
 * SOFT DELETE: revocation sets is_active=false and revoked_at=now().
 * Hard deletes only happen via CASCADE when the workspace is deleted.
 *
 * NEVER read encrypted_key, iv, or auth_tag outside of the credentials
 * service (packages/runtime-config/src/credentials/resolver.ts). Route
 * responses must never include these three fields.
 */
export interface WorkspaceApiKeyRow {
  id:            string;
  workspace_id:  string;
  /** Cloud provider ID (e.g. 'anthropic', 'openai'). Validated against CLOUD_PROVIDER_IDS. */
  provider:      string;
  /** Last 4 chars of the original key — safe to display in UI. */
  key_hint:      string;
  /** base64-encoded AES-256-GCM ciphertext. NEVER include in API responses. */
  encrypted_key: string;
  /** base64-encoded 12-byte GCM nonce. NEVER include in API responses. */
  iv:            string;
  /** base64-encoded 16-byte GCM authentication tag. NEVER include in API responses. */
  auth_tag:      string;
  is_active:     boolean;
  validated_at:  string | null;   // ISO 8601 or null (never validated)
  created_by:    string | null;   // FK → users.id
  created_at:    string;
  rotated_at:    string | null;   // set when key is rotated in-place
  revoked_at:    string | null;   // soft-delete timestamp
}

/**
 * Payload for inserting a new workspace_api_keys row.
 * id and created_at are server-managed.
 */
export type NewWorkspaceApiKey = Omit<WorkspaceApiKeyRow, 'id' | 'created_at'>;

/**
 * public.workspace_oauth_connections table row.
 *
 * Priority 4/5 (Canva Export / Figma Export) — OAuth connection storage.
 * Distinct from WorkspaceApiKeyRow (P3/BYOK) because OAuth tokens have a
 * structurally different shape: an access token, an optional refresh
 * token, an expiry, and granted scopes — not a single opaque secret
 * string. Reuses the SAME encryption primitive (encryptKey/decryptKey),
 * applied separately to the access and refresh token, since each has its
 * own IV/auth tag (AES-256-GCM requires a unique IV per encryption).
 *
 * The UNIQUE constraint on (workspace_id, provider) WHERE is_active=true
 * means there is at most one active connection per provider per workspace.
 *
 * NEVER read encrypted_access_token / access_token_iv / access_token_auth_tag
 * or their refresh_token counterparts outside the OAuth callback/refresh
 * routes and the export-time token resolver. Route responses (e.g. GET
 * /api/integrations/canva/status) must never include these fields.
 */
export interface WorkspaceOAuthConnectionRow {
  id:                      string;
  workspace_id:            string;
  /** OAuth provider ID (e.g. 'canva', 'figma'). */
  provider:                string;
  /** base64-encoded AES-256-GCM ciphertext. NEVER include in API responses. */
  encrypted_access_token:  string;
  access_token_iv:         string;
  access_token_auth_tag:   string;
  /** Null for providers/grants that don't issue a refresh token. */
  encrypted_refresh_token: string | null;
  refresh_token_iv:        string | null;
  refresh_token_auth_tag:  string | null;
  scopes:                  string[];
  /** ISO 8601 access token expiry, or null if non-expiring/unknown. */
  expires_at:              string | null;
  /** e.g. Canva display name/email — safe to show in the settings UI. */
  external_account_label:  string | null;
  is_active:                boolean;
  connected_by:            string | null;   // FK → users.id
  connected_at:            string;
  refreshed_at:            string | null;   // set whenever the access token is refreshed
  revoked_at:              string | null;   // soft-delete timestamp
  created_at:              string;
}

/**
 * Payload for inserting a new workspace_oauth_connections row.
 * id and created_at are server-managed.
 */
export type NewWorkspaceOAuthConnection = Omit<WorkspaceOAuthConnectionRow, 'id' | 'created_at'>;

/**
 * public.figma_handoff_tokens table row.
 *
 * Priority 5 (Figma Export) — ephemeral, single-use handoff token. Unlike
 * WorkspaceOAuthConnectionRow, this is NOT an OAuth credential: it exists
 * because Figma's REST API has no design-creation endpoint, so export
 * happens via a Figma Plugin (running inside the user's own Figma
 * session) calling back to BrandOS with this opaque token to fetch the
 * artifact it should render. The token itself IS the auth (possession-
 * based, like a short-lived signed URL) since the plugin sandbox has no
 * access to BrandOS's session cookies.
 */
export interface FigmaHandoffTokenRow {
  token:         string;     // opaque random string, primary key
  workspace_id:  string;
  artifact_type: string;     // 'carousel' | 'deck' | 'report'
  artifact:      Record<string, unknown>;  // full ArtifactV2 snapshot
  created_by:    string | null;
  consumed_at:   string | null;
  expires_at:    string;
  created_at:    string;
}

/**
 * Payload for inserting a new figma_handoff_tokens row.
 * created_at is server-managed.
 */
export type NewFigmaHandoffToken = Omit<FigmaHandoffTokenRow, 'created_at'>;

/**
 * public.workspace_provider_usage table row.
 *
 * Append-only usage log written as fire-and-forget telemetry per generation call.
 *
 * token/cost fields are nullable: LLMResponse does not currently expose these
 * values (Finding F6). They remain null until TelemetrySnapshot.token_estimate
 * is surfaced on LLMResponse in a future workstream. Per directive: "do not
 * invent pricing tables."
 */
export interface WorkspaceProviderUsageRow {
  id:                 string;
  workspace_id:       string;
  provider:           string;
  model_id:           string | null;
  request_id:         string | null;
  prompt_tokens:      number | null;     // null until token surfacing work (F6)
  completion_tokens:  number | null;     // null until token surfacing work (F6)
  total_tokens:       number | null;     // null until token surfacing work (F6)
  estimated_cost_usd: number | null;     // null per directive
  created_at:         string;
}

/** Payload for inserting a workspace_provider_usage row. */
export type NewWorkspaceProviderUsage = Omit<WorkspaceProviderUsageRow, 'id' | 'created_at'>;

/**
 * public.workspace_provider_health table row.
 *
 * One row per (workspace_id, provider) pair — upserted, not appended.
 * Tracks last success/failure timestamps and cumulative failure count for
 * a workspace's use of a specific provider.
 *
 * Distinct from the dormant platform-wide brandos_provider_health table
 * (which has zero read/write call sites) — this is workspace-scoped.
 */
export interface WorkspaceProviderHealthRow {
  id:               string;
  workspace_id:     string;
  provider:         string;
  last_success_at:  string | null;
  last_failure_at:  string | null;
  failure_count:    number;
  last_validated_at: string | null;
  updated_at:       string;
}


