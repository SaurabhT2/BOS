export const runtime = 'nodejs'

// P0 — Implementation Wave 1A: added requireUser() auth gate and session-scoped
// workspaceId (same pattern as brand-memory/experiments/webhooks routes).
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { globalPromptLibrary } from '@brandos/control-plane-layer'
import type { PromptLibraryEntry } from '@brandos/control-plane-layer'

export async function GET(req: Request) {
  const { workspaceId, user, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (id) {
    const entry = globalPromptLibrary.get(id)
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(entry)
  }

  const task_type = searchParams.get('task_type')
  const search = searchParams.get('search')
  const recommended = searchParams.get('recommended')
  const min_score_raw = searchParams.get('min_score')
  const tags_raw = searchParams.get('tags')

  const filters = {
    workspace_id: workspaceId,
    ...(task_type ? { task_type } : {}),
    ...(search ? { search } : {}),
    ...(recommended === 'true' ? { recommended_only: true } : {}),
    ...(min_score_raw ? { min_score: parseInt(min_score_raw, 10) } : {}),
    ...(tags_raw ? { tags: tags_raw.split(',').filter(Boolean) } : {}),
  }

  return NextResponse.json(globalPromptLibrary.list(filters))
}

export async function POST(req: Request) {
  const { workspaceId, user, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as Omit<PromptLibraryEntry, 'id' | 'usage_count' | 'success_rate' | 'updated_at' | 'version'>
    // Force workspace_id and created_by to session values
    const entry = globalPromptLibrary.save({
      ...body,
      workspace_id: workspaceId,
      created_by: user.id,
    })
    return NextResponse.json(entry)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const { user, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as {
      action: 'clone' | 'version'
      id: string
      title?: string
      prompt_text?: string
      system_context?: string
      description?: string
    }

    if (body.action === 'clone') {
      const cloned = globalPromptLibrary.clone(body.id, user.id)
      return NextResponse.json(cloned ?? { error: 'Not found' })
    }

    if (body.action === 'version') {
      const versioned = globalPromptLibrary.update(body.id, {
        description: body.description,
        system_context: body.system_context,
      })
      return NextResponse.json(versioned ?? { error: 'Not found' })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const { unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id') ?? ''
  const deleted = globalPromptLibrary.delete(id)
  return NextResponse.json({ deleted })
}
