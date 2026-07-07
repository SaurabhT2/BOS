/**
 * @brandos/control-plane-layer — admin/require-admin.ts
 *
 * Framework-agnostic admin auth types.
 *
 * ARCHITECTURE: The implementation lives in apps/web/lib/admin/require-admin.ts
 * so this package stays framework-agnostic (no Next.js dependency).
 *
 * Consumer (apps/web) imports from:
 *   '@/lib/admin/require-admin'
 *
 * This file exports only the shared result types so other packages
 * can reference them without pulling in Next.js.
 */

export interface AdminAuthResult {
  ok: true;
  userId: string;
  /**
   * FK → workspaces.id — the platform admin's own workspace.
   *
   * P0 — Implementation Wave 1A: NEW field. Admin routes are global in
   * scope (AdminSettingsService, platform-wide config) and generally do not
   * need this — but some admin diagnostics (e.g. /api/admin/iskill-test)
   * invoke generation (runControlPlane), which requires a workspace_id.
   * Using the admin's own workspace for such diagnostics is correct: the
   * diagnostic generation is attributed to the admin who ran it.
   */
  workspaceId: string;
}

export interface AdminAuthDenied {
  ok: false;
  // Framework-specific response object — typed as unknown here.
  // In apps/web this is narrowed to NextResponse.
  response: unknown;
}

export type AdminAuthCheck = AdminAuthResult | AdminAuthDenied;


