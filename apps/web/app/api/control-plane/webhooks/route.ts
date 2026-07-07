export const runtime = 'nodejs'

// P0 — Implementation Wave 1A: added requireUser() auth gate and session-scoped
// workspaceId (same pattern as experiments/route.ts and brand-memory/route.ts).
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { globalWebhookService } from '@brandos/control-plane-layer'
import type { WebhookEvent } from '@brandos/control-plane-layer'

export async function GET(req: Request) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const webhookId = searchParams.get('webhook_id') ?? undefined

  if (searchParams.get('logs') === 'true') {
    return NextResponse.json(globalWebhookService.getDeliveryLog(webhookId))
  }

  return NextResponse.json(globalWebhookService.getWebhooks(workspaceId))
}

export async function POST(req: Request) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as {
      url?: string
      secret?: string
      events?: WebhookEvent[]
      headers?: Record<string, string>
      active?: boolean
      retry_limit?: number
    }

    if (!body.url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 })
    }

    // workspace_id in body is ignored — always scoped to the session workspace
    const webhook = globalWebhookService.addWebhook(workspaceId, {
      workspace_id: workspaceId,
      url: body.url,
      secret: body.secret ?? crypto.randomUUID(),
      events: body.events ?? ['generation.completed'],
      headers: body.headers ?? {},
      active: body.active ?? true,
      retry_limit: body.retry_limit ?? 3,
    })

    return NextResponse.json(webhook)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as { id?: string; [key: string]: unknown }
    const updated = globalWebhookService.updateWebhook(workspaceId, body.id ?? '', body)
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(updated)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const { workspaceId, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id') ?? ''
  const deleted = globalWebhookService.deleteWebhook(workspaceId, id)
  return NextResponse.json({ deleted })
}
