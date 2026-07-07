// ============================================================
// @brandos/auth — src/config.ts
//
// CENTRAL CONFIGURATION
//
// All auth + DB runtime configuration is sourced from this file.
// Environment variable reads happen ONCE here — nowhere else in the
// package should read process.env directly.
//
// AGENT GUIDANCE:
//   - To add a new config option, add it here and to the relevant
//     type alias (AuthConfig / DbConfig) at the bottom of this file.
//   - All values default to safe fallbacks where possible.
//   - `as const` ensures TypeScript infers literal types throughout
//     the package — do not remove it.
//
// ENVIRONMENT VARIABLES REQUIRED:
//   Client-side (NEXT_PUBLIC_):
//     NEXT_PUBLIC_SUPABASE_URL         — Supabase project URL
//     NEXT_PUBLIC_SUPABASE_ANON_KEY    — Supabase anon (public) key
//     NEXT_PUBLIC_APP_URL              — Canonical app URL for OAuth redirects
//
//   Server-side only (never NEXT_PUBLIC_):
//     SUPABASE_SERVICE_ROLE_KEY        — Supabase service role key (bypasses RLS)
//
//   Optional feature flags:
//     AUTH_ENABLE_EMAIL                — 'false' to disable email+password auth
//     AUTH_ENABLE_GOOGLE               — 'false' to disable Google OAuth
//     AUTH_ENABLE_MAGIC_LINK           — 'true' to enable passwordless OTP
//     AUTH_REDIRECT_AFTER_LOGIN        — path to redirect after login (default: /workspace)
//     AUTH_REDIRECT_AFTER_LOGOUT       — path to redirect after logout (default: /)
//     AUTH_REDIRECT_CONFIRM            — path to redirect after email confirmation
//     AUTH_SESSION_EXPIRY              — JWT refresh interval in seconds (default: 3600)
// ============================================================

export const authConfig = {
  // ── Supabase connection ────────────────────────────────────
  supabase: {
    url:            process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey:        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // serviceRoleKey is undefined in browser bundles — only set server-side.
    // NEVER log this value or pass it to client components.
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },

  // ── Enabled Auth Providers ────────────────────────────────
  // Checked at runtime by authService — disabling a provider here prevents
  // the corresponding Supabase call from being made.
  providers: {
    email:     process.env.AUTH_ENABLE_EMAIL !== 'false',        // default: enabled
    google:    process.env.AUTH_ENABLE_GOOGLE !== 'false',       // default: enabled
    magicLink: process.env.AUTH_ENABLE_MAGIC_LINK === 'true',   // default: disabled
  },

  // ── Post-auth Redirect Paths ──────────────────────────────
  // These are APP-RELATIVE paths (not full URLs). They are combined with
  // authConfig.appUrl when building Supabase redirect URIs.
  redirects: {
    afterLogin:    process.env.AUTH_REDIRECT_AFTER_LOGIN   ?? '/workspace',
    afterLogout:   process.env.AUTH_REDIRECT_AFTER_LOGOUT  ?? '/',
    afterConfirm:  process.env.AUTH_REDIRECT_CONFIRM       ?? '/auth/confirmed',
    // oauthCallback is fixed — Supabase requires this exact route to exist in the app.
    oauthCallback: '/auth/callback',
  },

  // ── Session Configuration ──────────────────────────────────
  session: {
    // Seconds before the JWT is silently refreshed (createBrowserClient handles this).
    expirySeconds:      Number(process.env.AUTH_SESSION_EXPIRY ?? 3600),
    // Store session in cookies (true) vs memory only (false).
    // Must be true for SSR — server route handlers read the session cookie.
    persistSession:     true,
    // Detect session tokens in the URL fragment (used after email confirmation redirects).
    detectSessionInUrl: true,
  },

  // ── App URL ───────────────────────────────────────────────
  // Full URL with protocol (e.g. 'https://app.brandos.co').
  // Used as the base for OAuth redirect_to parameters sent to Supabase.
  // EDGE CASE: In development, set this to 'http://localhost:3000'. Supabase
  // must have this URL whitelisted in the Auth → URL configuration panel.
  appUrl: process.env.NEXT_PUBLIC_APP_URL!,
} as const;

// ── Database Table Names ──────────────────────────────────────
// If you rename a Supabase table, change it here ONLY.
// All dbService.ts queries reference these via `T.tableName`.
// Keep in sync with the TableName type in @brandos/contracts/auth-types.ts.
//
// P0 — Workspace Foundation: added workspaces, workspace_settings, and
// brand_assets. brand_assets existed as a live Supabase table before P0
// (written to via a raw `.from('brand_assets')` string in
// apps/web/app/api/vlm-analyze/route.ts) but had no canonical row type or
// entry in this table-name map — see @brandos/contracts auth-types.ts
// BrandAssetRow and TableName for the full rationale. A.3 updates
// vlm-analyze/route.ts to also set workspace_id on writes to this table.
export const dbConfig = {
  tables: {
    users:              'users',
    campaigns:          'campaigns',
    personas:           'personas',
    feedback:           'feedback',
    workspaces:         'workspaces',
    workspace_settings: 'workspace_settings',
    brand_assets:       'brand_assets',
    // P3 — BYOK: provider key management, usage telemetry, health tracking
    workspace_api_keys:        'workspace_api_keys',
    workspace_provider_usage:  'workspace_provider_usage',
    workspace_provider_health: 'workspace_provider_health',
    // Priority 4/5 — OAuth-based export integrations (Canva, Figma)
    workspace_oauth_connections: 'workspace_oauth_connections',
    // Priority 5 — Figma Export: ephemeral plugin handoff tokens
    figma_handoff_tokens: 'figma_handoff_tokens',
  },
} as const;

// ── TypeScript type aliases ───────────────────────────────────
export type AuthConfig = typeof authConfig;
export type DbConfig   = typeof dbConfig;
// TableName is the source of truth in @brandos/contracts — this is a local
// convenience alias for use within this package only.
export type TableName  = keyof typeof dbConfig.tables;


