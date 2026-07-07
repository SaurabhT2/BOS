/**
 * apps/web/lib/internal/runtime-verify-context.ts
 *
 * Resolves the (userId, workspaceId, supabase) triple that internal runtime
 * verification checks need in order to drive real generations — without any
 * human looking up a workspace id by hand.
 *
 * RUNTIME VERIFICATION V2 — WORKSPACE RESOLUTION:
 *   V1 required `BRANDOS_RUNTIME_VERIFY_WORKSPACE_ID` to be extracted from a
 *   real user's session/admin UI and pasted into an env var for every run.
 *   V2 removes that manual step in two layers:
 *
 *     1. Optional, one-time override — `BRANDOS_RUNTIME_VERIFY_WORKSPACE_ID`
 *        + `BRANDOS_RUNTIME_VERIFY_USER_ID` may still be set, exactly once,
 *        as deploy-time config (same tier as BRANDOS_RUNTIME_VERIFY_SECRET
 *        itself — not something extracted via DevTools per run). Useful when
 *        an operator wants verification to exercise a specific, real
 *        workspace (e.g. a staging account with realistic brand data).
 *
 *     2. Zero-config default — when no override is set, this module finds or
 *        creates a single dedicated fixture identity
 *        (`runtime-verify@brandos.internal`) via the Supabase Admin Auth API
 *        (`getSupabaseAdmin().auth.admin.createUser()`), which is the
 *        documented, officially-supported way to provision a user
 *        server-side. Per apps/web/lib/supabase-server.ts, the platform's
 *        signup trigger creates public.users + workspaces +
 *        workspace_settings in one transaction from that auth.users insert,
 *        so the fixture workspace materializes automatically. If a given
 *        environment's trigger does not fire for admin-created users, this
 *        module falls back to provisioning the workspace row directly so
 *        verification still works without operator intervention.
 *
 *   Resolution is idempotent and cached per server process — repeated calls
 *   do not re-create the fixture.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/auth'

export const VERIFY_FIXTURE_EMAIL = 'runtime-verify@brandos.internal'
export const VERIFY_FIXTURE_WORKSPACE_NAME = 'BrandOS Runtime Verification'
export const VERIFY_FIXTURE_WORKSPACE_SLUG = 'brandos-runtime-verify'

export type VerificationIdentitySource =
  | 'request-override'  // workspaceId/userId supplied directly on the request
  | 'env-override'       // BRANDOS_RUNTIME_VERIFY_WORKSPACE_ID / _USER_ID
  | 'fixture-cached'      // resolved earlier this process lifetime
  | 'fixture-existing'    // fixture account already existed in this environment
  | 'fixture-created'     // fixture account was just provisioned

export interface VerificationIdentity {
  userId: string
  workspaceId: string
  supabase: SupabaseClient
  source: VerificationIdentitySource
}

interface RequestOverride {
  workspaceId?: string
  userId?: string
}

let fixtureCache: { userId: string; workspaceId: string } | null = null

/**
 * resolveVerificationIdentity — find-or-create the identity used to drive
 * verification generations. Call this from any internal runtime-verify
 * service that needs to invoke runControlPlane()/executeArtifactPipeline()
 * or write/read workspace-scoped tables.
 *
 * @param override - Optional explicit { workspaceId, userId } from the
 *                    request body, for callers that want to verify a
 *                    specific real workspace rather than the fixture.
 */
export async function resolveVerificationIdentity(
  override?: RequestOverride
): Promise<VerificationIdentity> {
  const supabase = getSupabaseAdmin()

  if (override?.workspaceId && override?.userId) {
    return { userId: override.userId, workspaceId: override.workspaceId, supabase, source: 'request-override' }
  }

  const envWorkspaceId = process.env.BRANDOS_RUNTIME_VERIFY_WORKSPACE_ID
  const envUserId = process.env.BRANDOS_RUNTIME_VERIFY_USER_ID
  if (envWorkspaceId && envUserId) {
    return { userId: envUserId, workspaceId: envWorkspaceId, supabase, source: 'env-override' }
  }

  if (fixtureCache) {
    return { ...fixtureCache, supabase, source: 'fixture-cached' }
  }

  const { userId, workspaceId, created } = await ensureFixtureIdentity(supabase)
  fixtureCache = { userId, workspaceId }
  return { userId, workspaceId, supabase, source: created ? 'fixture-created' : 'fixture-existing' }
}

// ─── Fixture provisioning ──────────────────────────────────────────────────────

async function ensureFixtureIdentity(
  admin: SupabaseClient
): Promise<{ userId: string; workspaceId: string; created: boolean }> {
  const { data: createdResult, error: createErr } = await admin.auth.admin.createUser({
    email: VERIFY_FIXTURE_EMAIL,
    email_confirm: true,
    user_metadata: { brandos_runtime_verify_fixture: true },
  })

  let userId: string | null = createdResult?.user?.id ?? null
  const created = userId !== null

  if (!userId) {
    userId = await findFixtureAuthUserId(admin)
  }

  if (!userId) {
    throw new Error(
      `[runtime-verify] Could not create or locate the runtime-verification fixture user ` +
        `(${VERIFY_FIXTURE_EMAIL}): ${createErr?.message ?? 'unknown error'}`
    )
  }

  // Give the platform's signup trigger a brief window to materialize
  // public.users + workspaces + workspace_settings (see
  // apps/web/lib/supabase-server.ts for the documented trigger behavior).
  const workspaceId =
    (await pollForTriggerProvisionedWorkspace(admin, userId)) ??
    (await manuallyProvisionFixtureWorkspace(admin, userId))

  return { userId, workspaceId, created }
}

async function findFixtureAuthUserId(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (error || !data) return null
  return data.users.find(u => u.email === VERIFY_FIXTURE_EMAIL)?.id ?? null
}

async function pollForTriggerProvisionedWorkspace(
  admin: SupabaseClient,
  userId: string,
  attempts = 5,
  delayMs = 300
): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const { data } = await admin.from('users').select('workspace_id').eq('id', userId).maybeSingle()
    if (data?.workspace_id) return data.workspace_id as string
    await sleep(delayMs)
  }
  return null
}

/**
 * manuallyProvisionFixtureWorkspace — defensive fallback for environments
 * where the signup trigger does not fire for admin-created users. Reuses an
 * existing fixture workspace by slug if one is already there (e.g. created
 * by a previous run whose trigger fired late), otherwise creates one and
 * links it to the fixture user directly.
 */
async function manuallyProvisionFixtureWorkspace(admin: SupabaseClient, userId: string): Promise<string> {
  const { data: existing } = await admin
    .from('workspaces')
    .select('id')
    .eq('slug', VERIFY_FIXTURE_WORKSPACE_SLUG)
    .maybeSingle()

  if (existing?.id) {
    await admin.from('users').update({ workspace_id: existing.id }).eq('id', userId)
    return existing.id as string
  }

  const { data: workspace, error } = await admin
    .from('workspaces')
    .insert({ name: VERIFY_FIXTURE_WORKSPACE_NAME, slug: VERIFY_FIXTURE_WORKSPACE_SLUG, owner_id: userId })
    .select('id')
    .single()

  if (error || !workspace) {
    throw new Error(
      `[runtime-verify] Failed to provision the runtime-verification fixture workspace: ${error?.message ?? 'unknown error'}`
    )
  }

  await admin
    .from('users')
    .upsert({ id: userId, email: VERIFY_FIXTURE_EMAIL, workspace_id: workspace.id }, { onConflict: 'id' })

  return workspace.id as string
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
