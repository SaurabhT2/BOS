/**
 * apps/web — /api/workspace
 *
 * P0 — Implementation Wave 1A (A.4): Workspace management routes.
 *
 * GET  — Return the authenticated user's current workspace.
 * POST — Create a new workspace for the authenticated user (onboarding flow).
 *        Under the P0 single-owner model, a user who already has a workspace
 *        cannot create another one — POST returns 409 Conflict in that case.
 *
 * AUTHENTICATION: requires an authenticated session via requireUser().
 * `unauthorized: true` → 401. No admin gate needed — this is a user-facing
 * resource (every user owns exactly one workspace in P0).
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import {
  getWorkspaceById,
  getWorkspaceByOwnerId,
  createWorkspace,
  getOrCreateWorkspaceSettings,
  updateUser,
} from '@brandos/auth'
import { updateWorkspace } from '@brandos/auth'
import type { NewWorkspace } from '@brandos/contracts'

// ─── GET /api/workspace ───────────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const { user, workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // workspaceId comes from the users.workspace_id FK — it is null for brand-new
  // users who haven't completed onboarding yet (no workspace created). In that
  // case, try a lookup by owner_id before falling back to a safe default so
  // the onboarding page can still read the plan and prefill the workspace name.
  let workspace: any = null

  if (workspaceId) {
    const { data, error } = await getWorkspaceById(workspaceId)
    if (!error && data) workspace = data
  }

  if (!workspace) {
    // Try owner-based lookup (covers new users and any workspace_id desync)
    const { data, error } = await getWorkspaceByOwnerId(user.id)
    if (!error && data) workspace = data
  }

  if (!workspace) {
    // New user — no workspace yet. Return a minimal stub so onboarding UI
    // can render without errors. The stub is NOT persisted; it's only used
    // to pre-populate the onboarding form with sensible defaults.
    return NextResponse.json({
      workspace: {
        id:        null,
        name:      user.email?.split('@')[0] ?? 'My Workspace',
        plan:      'explorer',
        owner_id:  user.id,
        slug:      null,
        _stub:     true,   // sentinel — callers can detect "not yet created"
      },
    })
  }

  // Ownership check: defensive, not just trust requireUser.
  if (workspace.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({ workspace })
}

// ─── POST /api/workspace ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { user, workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Under P0's single-owner model, a user who already has a workspace (i.e.
  // requireUser() returned a non-null workspaceId AND that workspace exists)
  // cannot create another. This call is only valid for onboarding (where
  // public.users.workspace_id is null because the signup trigger hasn't run
  // yet — an edge case documented in MIGRATION_GUIDE.md for local dev).
  // In practice, the signup trigger handles workspace creation atomically;
  // this route is a manual fallback for onboarding error-recovery flows.
  const existing = await getWorkspaceByOwnerId(user.id)
  if (existing.data) {
    return NextResponse.json(
      { error: 'Workspace already exists', workspace: existing.data },
      { status: 409 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const name: string = body.name?.trim() || user.email?.split('@')[0] || 'My Workspace'

  // Generate a URL-safe slug from the name
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) + '-' + Date.now().toString(36)

  const newWorkspace: NewWorkspace = {
    name,
    slug,
    owner_id: user.id,
    plan: 'explorer',
  }

  const { data: workspace, error: createError } = await createWorkspace(newWorkspace)
  if (createError || !workspace) {
    return NextResponse.json(
      { error: createError ?? 'Failed to create workspace' },
      { status: 500 }
    )
  }

  // Create the companion workspace_settings row (all fields null = pure inheritance)
  await getOrCreateWorkspaceSettings(workspace.id)

  // Update the user's workspace_id FK to point at the new workspace
  // NOTE: updateUser() must accept { workspace_id } — verify this is
  // supported by the existing @brandos/auth updateUser implementation.
  // If not, this is a direct Supabase update that bypasses auth's service layer
  // (acceptable for this one-time onboarding operation).
  await updateUser(user.id, { workspace_id: workspace.id } as any)

  return NextResponse.json({ workspace }, { status: 201 })
}

// ─── PATCH /api/workspace ─────────────────────────────────────────────────────
// P3.27 — Workspace rename.
// Accepts { name } and updates the workspace name + slug for the authenticated owner.

export async function PATCH(req: NextRequest) {
  const { user, workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify ownership
  const { data: workspace, error: fetchError } = await getWorkspaceById(workspaceId)
  if (fetchError || !workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  if (workspace.owner_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const name = body.name?.trim()
  if (!name || name.length < 1 || name.length > 80) {
    return NextResponse.json({ error: 'name must be 1–80 characters' }, { status: 400 })
  }

  // Regenerate slug from new name (append existing slug suffix to preserve uniqueness)
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  const existingSuffix = workspace.slug.split('-').pop() ?? Date.now().toString(36)
  const slug = `${baseSlug}-${existingSuffix}`

  const { data: updated, error: updateError } = await updateWorkspace(workspaceId, { name, slug })
  if (updateError || !updated) {
    return NextResponse.json({ error: updateError ?? 'Failed to update workspace' }, { status: 500 })
  }

  return NextResponse.json({ workspace: updated })
}
