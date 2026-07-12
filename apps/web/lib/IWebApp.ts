/**
 * apps/web — IWebApp.ts
 *
 * Public boundary file for the apps/web application.
 *
 * READ THIS FILE BEFORE MODIFYING any route or lib/ file.
 *
 * This file documents:
 * - The route surface (all API routes)
 * - lib/ module purposes and import rules
 * - Architectural invariants
 * - Known issues
 *
 * Unlike package IXxx.ts files, this file does not define exported types —
 * apps/web is an application with no downstream consumers. It defines
 * the INTERNAL surface contract for agents working within the app.
 *
 * @version L5 (upgraded from L2 — ISSUE-2 resolved, dead code removed,
 *          observability hardened, logging standardized)
 */

// ─── Route Descriptors ────────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RouteDescriptor {
  path:           string
  methods:        HttpMethod[]
  authRequired:   boolean
  adminRequired:  boolean
  runtimeExport:  boolean  // has `export const runtime = 'nodejs'`
  pipelineEntry:  'control-plane' | 'admin' | 'observability' | 'utility' | 'none'
  notes?:         string
}

/**
 * Complete route inventory for apps/web.
 * Authoritative — update this when adding or modifying routes.
 *
 * ISSUE-2 RESOLVED: All control-plane/observability routes now have
 * `export const runtime = 'nodejs'`. runtimeExport is true for all entries.
 */
export const ROUTE_INVENTORY: RouteDescriptor[] = [
  // ── Generation ────────────────────────────────────────────────────────────
  { path: '/api/generate',                        methods: ['POST'],             authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'control-plane' },
  { path: '/api/campaigns',                       methods: ['GET'],              authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'control-plane', notes: 'NEW (redesign) — lists the campaigns table, which generate/route.ts already writes to. Needed by Home (recent + review queue) and Library (unified content list); did not exist before.' },
  { path: '/api/carousel',                        methods: ['POST'],             authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'control-plane' },
  { path: '/api/generate-with-progress',          methods: ['GET'],              authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'control-plane' },
  { path: '/api/transform',                       methods: ['POST'],             authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'control-plane' },
  // ── Workspace (entire namespace was missing from this inventory prior to
  // the redesign pass — added for accuracy; none of these are new routes
  // except where noted, they're pre-existing and load-bearing for Settings
  // → AI (Phase 6), Billing, and Home (usage meters).
  { path: '/api/workspace',                       methods: ['GET', 'POST'],      authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'control-plane', notes: 'POST is onboarding-only workspace creation (409 if one already exists) — not a rename endpoint. No PATCH exists; Settings (Phase 6) shows workspace name read-only for this reason.' },
  { path: '/api/workspace/usage',                 methods: ['GET'],              authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'control-plane' },
  { path: '/api/workspace/settings',              methods: ['GET', 'PATCH'],     authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'control-plane', notes: 'Backs Settings → AI\u2019s Quality section (Phase 6). No provider_fallback_order field — Executive "Fallback ordering" UI is a documented placeholder, not wired to real data.' },
  { path: '/api/workspace/providers',             methods: ['GET', 'POST', 'DELETE'], authRequired: true, adminRequired: false, runtimeExport: true, pipelineEntry: 'control-plane', notes: 'BYOK key management — backs Settings → AI\u2019s Providers section (Phase 6, converged from the now-redirected /workspace/settings/providers page).' },
  { path: '/api/workspace/providers/usage',       methods: ['GET'],              authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'control-plane' },
  { path: '/api/planner',                         methods: ['POST'],             authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'control-plane' },

  // ── Artifact ──────────────────────────────────────────────────────────────
  { path: '/api/artifact/export',                 methods: ['POST'],             authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'control-plane' },
  { path: '/api/export',                          methods: ['POST'],             authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'control-plane', notes: 'Legacy export path — prefer /api/artifact/export' },

  // ── Admin ─────────────────────────────────────────────────────────────────
  { path: '/api/admin/providers',                 methods: ['GET', 'POST', 'PATCH'], authRequired: true, adminRequired: true, runtimeExport: true, pipelineEntry: 'admin' },
  // /api/admin/settings REMOVED — use /api/v2/runtime/config, /api/v2/governance/policy, /api/v2/artifact/config
  { path: '/api/admin/runtime-debug',             methods: ['GET'],              authRequired: true,  adminRequired: true,  runtimeExport: true,  pipelineEntry: 'admin' },
  { path: '/api/admin/local-models',              methods: ['GET'],              authRequired: true,  adminRequired: true,  runtimeExport: true,  pipelineEntry: 'admin' },
  { path: '/api/admin/iskill-test',               methods: ['POST'],             authRequired: true,  adminRequired: true,  runtimeExport: true,  pipelineEntry: 'admin' },

  // ── Control Plane Observability (ISSUE-2 RESOLVED — runtime export added) ─
  // /api/control-plane/routing REMOVED — in-memory store, no pipeline connection, unauthenticated
  // /api/control-plane/routing/audit REMOVED — always returned empty audit log
  { path: '/api/v2/runtime/providers/:id/test',   methods: ['POST'],             authRequired: true,  adminRequired: true,  runtimeExport: true,  pipelineEntry: 'admin' },
  { path: '/api/control-plane/brand-memory',      methods: ['POST'], authRequired: true, adminRequired: false, runtimeExport: true, pipelineEntry: 'observability' },
  { path: '/api/control-plane/experiments',       methods: ['GET', 'POST', 'PATCH'], authRequired: true, adminRequired: false, runtimeExport: true, pipelineEntry: 'observability' },
  { path: '/api/control-plane/prompt-library',    methods: ['GET', 'POST', 'PATCH', 'DELETE'], authRequired: true, adminRequired: false, runtimeExport: true, pipelineEntry: 'observability' },
  { path: '/api/control-plane/score-history',     methods: ['GET', 'POST'],      authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'observability', notes: 'Backing store (globalScoreHistory) is an in-memory singleton, not persisted — resets on redeploy. Auth check was missing entirely prior to redesign cleanup; now scopes strictly to session workspaceId.' },
  { path: '/api/control-plane/webhooks',          methods: ['GET', 'POST', 'PATCH', 'DELETE'], authRequired: true, adminRequired: false, runtimeExport: true, pipelineEntry: 'observability' },

  // ── V2 API ────────────────────────────────────────────────────────────────
  { path: '/api/v2/runtime/config',               methods: ['GET', 'POST'],      authRequired: true,  adminRequired: true,  runtimeExport: true,  pipelineEntry: 'admin' },
  { path: '/api/v2/telemetry/stats',              methods: ['GET'],              authRequired: true,  adminRequired: true,  runtimeExport: true,  pipelineEntry: 'observability' },
  { path: '/api/v2/telemetry/experiments',        methods: ['GET'],              authRequired: true,  adminRequired: true,  runtimeExport: true,  pipelineEntry: 'observability' },
  { path: '/api/v2/governance/policy',            methods: ['GET', 'POST'],      authRequired: true,  adminRequired: true,  runtimeExport: true,  pipelineEntry: 'admin' },
  { path: '/api/v2/artifact/config',              methods: ['GET', 'POST'],      authRequired: true,  adminRequired: true,  runtimeExport: true,  pipelineEntry: 'admin' },
  { path: '/api/v2/artifact/queue',               methods: ['GET', 'POST'],      authRequired: true,  adminRequired: true,  runtimeExport: true,  pipelineEntry: 'admin' },

  // ── Utility ───────────────────────────────────────────────────────────────
  { path: '/api/health',                          methods: ['GET'],              authRequired: false, adminRequired: false, runtimeExport: true,  pipelineEntry: 'utility' },
  // /api/vlm-analyze REMOVED — superseded by /api/assets/[id]/analyze (redesign
  // cleanup). The CPL-orchestrator path used here never reached production
  // parity with the direct-call implementation — see that route's notes.
  { path: '/api/upload',                          methods: ['POST'],             authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'utility' },
  { path: '/api/extract-from-url',                methods: ['POST'],             authRequired: false, adminRequired: false, runtimeExport: true,  pipelineEntry: 'utility' },
  { path: '/api/persona',                         methods: ['GET', 'POST'],      authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'utility', notes: 'POST uses an `action` discriminator (create|switch|delete|update_tone|update_profile) — no PATCH/DELETE verbs exist. update_profile added (redesign Phase 4) for Brand Workspace → Voice; update_tone kept as a deprecated alias rather than removed (action string may be called from elsewhere in the monorepo, not verifiable from apps/web).' },
  { path: '/api/feedback',                        methods: ['POST'],             authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'utility' },
  { path: '/api/models/availability',             methods: ['GET'],              authRequired: false, adminRequired: false, runtimeExport: true,  pipelineEntry: 'utility' },
  { path: '/api/memory',                          methods: ['GET', 'POST'],      authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'control-plane' },
  { path: '/api/assets',                          methods: ['GET', 'POST'],      authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'utility', notes: 'Was missing from this inventory prior to the redesign pass — added for accuracy, not a new route.' },
  { path: '/api/assets/:id',                      methods: ['GET', 'PATCH', 'DELETE'], authRequired: true, adminRequired: false, runtimeExport: true, pipelineEntry: 'utility', notes: 'PATCH/DELETE added during redesign cleanup — file previously only exported POST (a duplicate of the analyze route), leaving PATCH/DELETE unreachable (405) despite the frontend already calling them.' },
  { path: '/api/assets/:id/analyze',              methods: ['POST'],             authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'utility' },
  { path: '/api/assets/:id/download',             methods: ['GET'],              authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'utility' },
  { path: '/api/assets/:id/reindex',              methods: ['POST'],             authRequired: true,  adminRequired: false, runtimeExport: true,  pipelineEntry: 'utility' },
]

// ─── Lib Module Descriptors ────────────────────────────────────────────────────

export interface LibModuleDescriptor {
  path:           string
  purpose:        string
  allowedImports: string[]
  notes?:         string
}

export const LIB_MODULES: LibModuleDescriptor[] = [
  {
    path:    'lib/admin/require-admin.ts',
    purpose: 'Next.js-specific admin auth guard. Re-exports types from @brandos/control-plane-layer. Implements Next.js request cookie handling.',
    allowedImports: ['next/server', '@supabase/ssr', '@brandos/control-plane-layer (types only)'],
    notes:   'Framework-specific wrapper. NOT a bug duplicate — must stay in apps/web.',
  },
  {
    path:    'lib/supabase-server.ts',
    purpose: 'Server-side Supabase client factory. requireUser() — authenticates user from Next.js cookie context AND resolves workspaceId + isPlatformAdmin from public.users (P0 — Implementation Wave 1A).',
    allowedImports: ['@supabase/ssr', 'next/headers'],
    notes:   'Must stay in apps/web — depends on next/headers which cannot be in a library package. requireUser() is the canonical source of workspaceId for all routes — do not re-derive it from user.id.',
  },
  {
    path:    'lib/server-analytics.ts',
    purpose: 'PostHog analytics bridge. trackServer() is the canonical server event function. All other exports are deprecated stubs.',
    allowedImports: ['posthog-node'],
    notes:   'Phase 3 migration target: @brandos/telemetry-store. trackGeneration/trackEvent/getAnalyticsSummary are deprecated.',
  },
  {
    path:    'lib/client-analytics.ts',
    purpose: 'Client-side analytics. trackEvent(), trackGenerationPerformance(), trackActivationStep().',
    allowedImports: ['posthog-js'],
    notes:   'Client component only — do not import in server routes.',
  },
  {
    path:    'lib/runtime-diagnostics.ts',
    purpose: 'RuntimeDiagnosticsService — assembles admin runtime health snapshot including live test invocation.',
    allowedImports: ['@brandos/control-plane-layer', '@brandos/ai-runtime-layer', '@brandos/contracts'],
  },
  {
    path:    'lib/ai-runtime.ts',
    purpose: 'Lazy-init IAIRuntime singleton for observability-only use (telemetry stats, capability checks).',
    allowedImports: ['@brandos/ai-runtime-layer', '@brandos/contracts'],
    notes:   'Not for generation. Generation must go through control-plane-layer.',
  },
  {
    path:    'lib/control-plane.ts',
    purpose: 'Re-exports @brandos/control-plane-layer for routes.',
    allowedImports: ['@brandos/control-plane-layer'],
  },
  {
    path:    'lib/artifact-engine.ts',
    purpose: 'Intentionally empty stub. Prevents accidental direct artifact engine imports from routes.',
    allowedImports: [],
    notes:   'MUST remain empty. Artifact access goes through control-plane-layer.',
  },
  {
    path:    'lib/env.ts',
    purpose: 'Re-exports validateEnv, requireEnv from @brandos/shared-utils.',
    allowedImports: ['@brandos/shared-utils'],
  },
  {
    path:    'lib/auth.ts',
    purpose: 'Re-exports authService, getSupabaseClient/Admin, supabase, AuthUser, AuthSession from @brandos/auth (direct — Cleanup Sprint 2 WS1 removed the presentation-layer hop).',
    allowedImports: ['@brandos/auth'],
    notes:   'Not used by any API route — routes use requireUser()/requireAdmin() directly. Kept for client component auth use.',
  },
  {
    path:    'lib/agents/transformAgent.ts',
    purpose: 'Content transformation agent — multi-format repurposing logic.',
    allowedImports: ['@brandos/control-plane-layer'],
  },
  {
    path:    'lib/agents/plannerAgent.ts',
    purpose: 'Content planning agent — generates content plan from brief.',
    allowedImports: ['@brandos/control-plane-layer'],
  },
  {
    path:    'lib/agents/exportAgent.ts',
    purpose: 'Export orchestration agent.',
    allowedImports: ['@brandos/control-plane-layer'],
  },
]

// ─── Invariant Descriptors ────────────────────────────────────────────────────

export type WebAppInvariantId =
  | 'I-1-generation-through-control-plane'
  | 'I-2-artifact-through-execute-pipeline'
  | 'I-3-admin-routes-require-admin'
  | 'I-4-nodejs-runtime-export'
  | 'I-5-no-cross-route-imports'
  | 'I-6-require-admin-framework-wrapper'
  | 'I-7-artifact-engine-lib-empty'
  | 'I-8-server-analytics-trackserver-only'

// ─── Known Issue Types ────────────────────────────────────────────────────────

export type WebAppIssueId =
  | 'ISSUE-1-require-admin-classification'
  | 'ISSUE-3-scripts-test-not-in-turbo'
  | 'ISSUE-4-supabase-any-types-in-routes'
  | 'ISSUE-5-verify-update-asset-export'
  | 'ISSUE-6-override-mode-not-auto-inferred'
  | 'ISSUE-7-campaign-lite-grouping-not-persisted'
  /**
   * ISSUE-2 is RESOLVED. All 7 control-plane/observability routes now have
   * `export const runtime = 'nodejs'`. This type literal is kept to allow
   * existing CapabilityRegistry entries to be updated without a breaking change.
   * Remove after the next registry cleanup pass.
   * @deprecated — ISSUE-2 resolved
   */
  | 'ISSUE-2-RESOLVED-missing-nodejs-runtime-export'

/**
 * ISSUE-5 (open, redesign cleanup): app/api/assets/[id]/route.ts now calls
 * `updateAsset(id, workspaceId, fields)` from @brandos/auth for its PATCH
 * handler. This export was inferred from the package's existing naming
 * convention (getAsset, createAsset, updateAssetStatus, updateAssetVlmResult
 * are all confirmed real, in-use exports) but @brandos/auth's source is
 * outside apps/web and was not available to confirm `updateAsset` itself
 * exists with this signature. Please verify against the actual package
 * before deploying, or swap the call for whatever the real generic-field
 * update helper is named. This also fixes a real bug: the route previously
 * only exported POST, leaving the AssetDrawer's existing "Save changes" and
 * "Archive" actions returning 405 in production.
 *
 * ISSUE-6 (open, redesign): brandos_rollout_plan.html Phase 2 calls for
 * removing the override-mode selector from Create's UI and "auto-infer
 * from task type." The Create page (app/(workspace)/workspace/create/page.tsx)
 * no longer shows a manual override-mode picker in the main flow, but every
 * format still sends the same 'standard' override mode it always defaulted
 * to — there is no real per-format inference logic. This is because
 * OverrideMode's full set of member values is defined in
 * @brandos/control-plane-layer, whose source isn't available from apps/web;
 * only 'standard' is confirmed to exist. Implementing real auto-inference
 * requires knowing the other valid values. ControlPlanePanel's manual
 * onModeChange escape hatch is still wired up in the right column for
 * power users, so no capability was removed — just not yet auto-inferred.
 *
 * ISSUE-7 (open, redesign): Campaign Lite (strategic doc §5) sequences the
 * existing per-format generate calls and groups results under a client-
 * generated campaign_brief_id, but this id is NOT written to the database —
 * the campaigns table has no backing column for it (confirmed: no such
 * column appears in any INSERT in app/api/generate/route.ts or
 * app/api/carousel/route.ts). Grouping only holds for the current
 * browser session's Preview step; reloading the page or visiting Library
 * loses the grouping. A real persisted Campaign needs the schema change
 * the strategic doc describes as "Campaign Full," its own later phase —
 * this is a @brandos/contracts change outside apps/web's boundary.
 */


