/**
 * BrandOS — Webhook Sink Service
 * Push telemetry to customer systems with retry, signing, and audit logs.
 */

import type { WebhookConfig, WebhookDelivery, WebhookEvent } from '../shared/types'

// ─── HMAC signing (Web Crypto API, works in Edge/Node) ────────────────────────

async function signPayload(secret: string, payload: string): Promise<string> {
  try {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
    return 'sha256=' + Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return ''
  }
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const webhookStore = new Map<string, WebhookConfig[]>()    // workspaceId -> configs
const deliveryLog: WebhookDelivery[] = []
const MAX_DELIVERY_LOG = 5000

// ─── Service ──────────────────────────────────────────────────────────────────

export class WebhookService {
  // Config management
  addWebhook(workspaceId: string, config: Omit<WebhookConfig, 'id' | 'created_at' | 'failure_count'>): WebhookConfig {
    const wh: WebhookConfig = {
      ...config,
      id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      created_at: new Date().toISOString(),
      failure_count: 0,
    }
    const existing = webhookStore.get(workspaceId) ?? []
    existing.push(wh)
    webhookStore.set(workspaceId, existing)
    return wh
  }

  getWebhooks(workspaceId: string): WebhookConfig[] {
    return webhookStore.get(workspaceId) ?? []
  }

  updateWebhook(workspaceId: string, id: string, patch: Partial<WebhookConfig>): WebhookConfig | null {
    const whs = webhookStore.get(workspaceId) ?? []
    const idx = whs.findIndex(w => w.id === id)
    if (idx === -1) return null
    whs[idx] = {
  ...(whs[idx] as WebhookConfig),
  ...patch,
};
    return whs[idx] ?? null;
  }

  deleteWebhook(workspaceId: string, id: string): boolean {
    const whs = webhookStore.get(workspaceId) ?? []
    const filtered = whs.filter(w => w.id !== id)
    webhookStore.set(workspaceId, filtered)
    return filtered.length < whs.length
  }

  // Delivery
  async emit(workspaceId: string, event: WebhookEvent, payload: Record<string, unknown>): Promise<void> {
    const webhooks = this.getWebhooks(workspaceId).filter(
      w => w.active && w.events.includes(event),
    )

    await Promise.allSettled(
      webhooks.map(wh => this.deliver(wh, event, payload)),
    )
  }

  private async deliver(
    wh: WebhookConfig,
    event: WebhookEvent,
    payload: Record<string, unknown>,
    attempt = 1,
  ): Promise<void> {
    const body = JSON.stringify({
      id: `evt_${Date.now()}`,
      event,
      timestamp: new Date().toISOString(),
      data: payload,
    })

    const signature = await signPayload(wh.secret, body)

    const delivery: WebhookDelivery = {
      id: `del_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      webhook_id: wh.id,
      event,
      payload,
      status: 'pending',
      attempts: attempt,
      last_attempt_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }

    try {
      const res = await fetch(wh.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-BrandOS-Signature': signature,
          'X-BrandOS-Event': event,
          ...wh.headers,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      })

      delivery.response_status = res.status
      delivery.status = res.ok ? 'delivered' : 'failed'

      if (!res.ok && attempt < wh.retry_limit) {
        delivery.status = 'retrying'
        // Exponential backoff: 2^attempt * 1000ms
        const delay = Math.pow(2, attempt) * 1000
        setTimeout(() => this.deliver(wh, event, payload, attempt + 1), delay)
      }

      if (!res.ok) {
        this.updateWebhook(wh.id, wh.id, { failure_count: wh.failure_count + 1 })
      }
    } catch (err) {
      delivery.status = attempt < wh.retry_limit ? 'retrying' : 'failed'
      delivery.error = (err as Error).message
      if (attempt < wh.retry_limit) {
        setTimeout(() => this.deliver(wh, event, payload, attempt + 1), Math.pow(2, attempt) * 1000)
      }
    }

    deliveryLog.push(delivery)
    if (deliveryLog.length > MAX_DELIVERY_LOG) {
      deliveryLog.splice(0, deliveryLog.length - MAX_DELIVERY_LOG)
    }
  }

  getDeliveryLog(webhookId?: string, limit = 100): WebhookDelivery[] {
    const results = webhookId
      ? deliveryLog.filter(d => d.webhook_id === webhookId)
      : [...deliveryLog]
    return results.slice(-limit).reverse()
  }
}

export const globalWebhookService = new WebhookService()


