// app/api/persona/route.ts
//
// Cleanup Sprint 2: removed getGlobalBrandIntelligenceRuntime.
// The BI persona service probe (biRuntime.personaService?.handleAction) always
// failed in practice — BrandIntelligenceRuntime never exposed personaService.
// Replaced with direct @brandos/auth calls for persona operations.
// Supabase fallback write is retained for the create action.

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import {
  setDefaultPersona,
  deletePersona,
  updatePersona,
} from '@brandos/auth'
import { syncWorkspaceConfiguration } from '@brandos/control-plane-layer'

export const runtime = 'nodejs'

/**
 * EM-1.2 correlation: once a fire-and-forget syncWorkspaceConfiguration()
 * call resolves, record the returned assetId and sync timestamp on the
 * local persona row (see supabase/migrations/20260715120000_persona_intelligence_os_sync.sql).
 * Deliberately not awaited by callers — this runs after the HTTP response
 * has already been sent; a failure here only means the cache-freshness
 * columns stay stale, not that the user's edit was lost.
 */
async function persistSyncCorrelation(
  personaId: string,
  syncPromise: ReturnType<typeof syncWorkspaceConfiguration>,
): Promise<void> {
  const result = await syncPromise
  if (!result) return // sync skipped or failed — nothing to record
  const { error } = await updatePersona(personaId, {
    intelligence_asset_id: result.assetId,
    synced_to_intelligence_os_at: new Date().toISOString(),
  })
  if (error) {
    console.error('[persona/route] Failed to persist IntelligenceOS sync correlation:', error)
  }
}

// GET — list all personas for the current user
export async function GET(_req: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: personas, error } = await supabase
    .from('personas')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, personas })
}

// POST — create / switch / delete / update-tone
// Auth owns persona persistence (Fix G1). Routes through @brandos/auth.
export async function POST(req: NextRequest) {
  const { user, workspaceId, supabase, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { action, personaId, name, role, description, tone } = body

    if (!action) return NextResponse.json({ error: 'Missing action' }, { status: 400 })

    switch (action) {
      case 'create': {
        if (!name || !role)
          return NextResponse.json({ error: 'Missing name or role' }, { status: 400 })
        // Create via Supabase directly — auth.createPersona() not yet available
        // P0 — Implementation Wave 1A: workspace_id is required (PersonaRow.workspace_id NOT NULL)
        const { data, error } = await supabase
          .from('personas')
          .insert({
            user_id: user.id,
            workspace_id: workspaceId,
            name,
            tone: tone ?? 'executive',
            domain: role,
            audience: description ?? null,
            key_themes: [],
            visual_style: {},
            is_default: false,
          })
          .select()
          .single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })

        // EM-1.2: IntelligenceOS is now the system of record for explicit
        // brand configuration — see @brandos/control-plane-layer's
        // workspace-configuration/service.ts. Fire this after the local
        // write succeeds and do not fail the request on sync failure
        // (personas is a write-through CACHE now, but the local write is
        // still what the user is waiting on).
        void persistSyncCorrelation(
          data.id,
          syncWorkspaceConfiguration({
            workspaceId,
            name: data.name,
            tone: data.tone,
            domain: data.domain,
            audience: data.audience,
            keyThemes: data.key_themes,
          }),
        )

        return NextResponse.json({ success: true, persona: data })
      }

      case 'switch': {
        if (!personaId) return NextResponse.json({ error: 'Missing personaId' }, { status: 400 })
        // setDefaultPersona(userId, personaId) → { error: string | null }
        const { error } = await setDefaultPersona(user.id, personaId)
        if (error) return NextResponse.json({ error }, { status: 500 })
        return NextResponse.json({ success: true })
      }

      case 'delete': {
        if (!personaId) return NextResponse.json({ error: 'Missing personaId' }, { status: 400 })
        // deletePersona(personaId) — no userId arg; auth enforces ownership via RLS
        const { error } = await deletePersona(personaId)
        if (error) return NextResponse.json({ error }, { status: 500 })
        return NextResponse.json({ success: true })
      }

      case 'update_tone': {
        // DEPRECATED — superseded by 'update_profile' below, which accepts
        // the same {tone} shape plus the rest of the editable persona
        // fields (Brand Workspace → Voice tab needs name/audience/
        // key_themes editing, not just tone). Kept working rather than
        // removed: this action string may be called from elsewhere in the
        // monorepo outside apps/web, which wasn't available to verify.
        // New callers should use 'update_profile' instead.
        if (!personaId || !tone)
          return NextResponse.json({ error: 'Missing personaId or tone' }, { status: 400 })
        const { data, error } = await updatePersona(personaId, { tone })
        if (error) return NextResponse.json({ error }, { status: 500 })

        // EM-1.2 — see the 'create' branch above for rationale.
        if (data) {
          void persistSyncCorrelation(
            personaId,
            syncWorkspaceConfiguration({
              workspaceId,
              name: data.name,
              tone: data.tone,
              domain: data.domain,
              audience: data.audience,
              keyThemes: data.key_themes,
            }),
          )
        }

        return NextResponse.json({ success: true, persona: data })
      }

      // NEW (redesign, Phase 4): Brand Workspace → Voice needs to edit a
      // persona's full profile (name, tone, audience, key_themes), not
      // just tone. Converges with update_tone above rather than adding a
      // separate, narrower endpoint — both call the same updatePersona()
      // from @brandos/auth, already proven to accept arbitrary partial
      // PersonaRow updates (see also app/api/assets/[id]/analyze/route.ts,
      // which calls it with a {visual_style} patch).
      case 'update_profile': {
        if (!personaId)
          return NextResponse.json({ error: 'Missing personaId' }, { status: 400 })

        const updates: Record<string, unknown> = {}
        if (typeof name === 'string' && name.trim()) updates.name = name.trim()
        if (typeof tone === 'string' && tone.trim()) updates.tone = tone.trim()
        if (typeof body.audience === 'string') updates.audience = body.audience
        if (typeof body.domain === 'string') updates.domain = body.domain
        if (Array.isArray(body.key_themes)) {
          updates.key_themes = body.key_themes.filter((t: unknown): t is string => typeof t === 'string')
        }

        if (Object.keys(updates).length === 0) {
          return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 })
        }

        const { data, error } = await updatePersona(personaId, updates)
        if (error) return NextResponse.json({ error }, { status: 500 })

        // EM-1.2 — see the 'create' branch above for rationale.
        if (data) {
          void persistSyncCorrelation(
            personaId,
            syncWorkspaceConfiguration({
              workspaceId,
              name: data.name,
              tone: data.tone,
              domain: data.domain,
              audience: data.audience,
              keyThemes: data.key_themes,
            }),
          )
        }

        return NextResponse.json({ success: true, persona: data })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error: any) {
    console.error('[persona/route]', error)
    return NextResponse.json({ error: error?.message || 'Persona operation failed' }, { status: 500 })
  }
}
