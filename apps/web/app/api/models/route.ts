/**
 * app/api/models/route.ts — Phase 7
 *
 * GET  — Returns the list of available models grouped by tier (local/cloud),
 *         derived from enabled admin providers + Ollama local models.
 *         ModelSelector fetches this endpoint to populate its dropdown.
 *
 * POST — Acknowledges a preference save. Model preferences are maintained
 *         client-side by ModelSelector; this endpoint exists so the component
 *         can call it without 404. Per-request model overrides are forwarded
 *         via the `model` field in the /api/generate body (Phase 4 path),
 *         not persisted here — WorkspaceSettingsRow has no preferred_model column.
 *
 * AUTHENTICATION: requireUser() — workspace-scoped.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'
import { SupabaseAdminSettingsService } from '@brandos/control-plane-layer'
import { PROVIDER_REGISTRY } from '@brandos/contracts'
import type { ProviderSettings } from '@brandos/runtime-config'

export const runtime = 'nodejs'

// ─── Model catalog (mirrors admin/ai-runtime page MODEL_CATALOG) ──────────────
// Extend this table when new models are available from providers.

const PROVIDER_MODELS: Record<string, { id: string; name: string; notes?: string }[]> = {
  openai: [
    { id: 'gpt-4o',       name: 'GPT-4o' },
    { id: 'gpt-4.1',      name: 'GPT-4.1' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
    { id: 'gpt-4o-mini',  name: 'GPT-4o Mini', notes: 'Recommended' },
    { id: 'gpt-4-turbo',  name: 'GPT-4 Turbo' },
    { id: 'o3-mini',      name: 'o3 Mini' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-6',         name: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-6',           name: 'Claude Opus 4.6' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', notes: 'Recommended' },
  ],
  google: [
    { id: 'gemini-2.5-pro',        name: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash',      name: 'Gemini 2.5 Flash', notes: 'Recommended' },
    { id: 'gemini-1.5-pro-latest', name: 'Gemini 1.5 Pro' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile',       name: 'LLaMA 3.3 70B', notes: 'Recommended' },
    { id: 'llama-3.1-70b-versatile',       name: 'LLaMA 3.1 70B' },
    { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 Distill' },
    { id: 'qwen-qwq-32b',                  name: 'Qwen QwQ 32B' },
    { id: 'mistral-saba-24b',              name: 'Mistral Saba 24B' },
  ],
  deepseek: [
    { id: 'deepseek-chat',     name: 'DeepSeek Chat (V3)', notes: 'Recommended' },
    { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Reasoner)' },
  ],
  togetherai: [
    { id: 'meta-llama/Llama-3-70b-chat-hf',     name: 'LLaMA 3 70B', notes: 'Recommended' },
    { id: 'mistralai/Mistral-7B-Instruct-v0.2', name: 'Mistral 7B' },
    { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo',    name: 'Qwen 2.5 72B' },
  ],
  openrouter: [
    { id: 'qwen/qwen-2.5-72b-instruct:free',        name: 'Qwen 2.5 72B (Free)', notes: 'Free' },
    { id: 'mistralai/mistral-7b-instruct:free',     name: 'Mistral 7B (Free)',   notes: 'Free' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'LLaMA 3.3 70B (Free)', notes: 'Free' },
  ],
}

// ─── Local model detection ────────────────────────────────────────────────────

async function getOllamaModels(): Promise<{ id: string; name: string }[]> {
  const base =
    process.env.BESPOKE_REMOTE_URL ??
    (process.env.NODE_ENV === 'production' ? null : 'http://localhost:11434')

  if (!base) return []

  try {
    const res = await fetch(`${base}/api/tags`, {
      signal: AbortSignal.timeout(2500),
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.models ?? [])
      .map((m: { name: string }) => ({ id: m.name, name: m.name }))
      .filter((m: { id: string }) => Boolean(m.id))
  } catch {
    return []
  }
}

// ─── GET /api/models ──────────────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const { unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Load admin provider settings to determine which cloud providers are enabled
    const snapshot = await SupabaseAdminSettingsService.load()
    const adminProviders: ProviderSettings[] = snapshot?.aiRuntime?.providers ?? []

    // Build enabled cloud provider set; fall back to registry defaults if no admin config
    const hasAdminConfig = adminProviders.length > 0
    const activeCloudIds: Set<string> = hasAdminConfig
      ? new Set(
          adminProviders
            .filter((p: ProviderSettings) => p.enabled && p.kind === 'cloud')
            .map((p: ProviderSettings) => p.id)
        )
      : new Set(
          PROVIDER_REGISTRY
            .filter(p => p.kind === 'cloud' && p.enabled_by_default)
            .map(p => p.id)
        )

    // Build model list for enabled cloud providers, in registry priority order
    const cloudModels: Array<{
      id: string
      name: string
      providerKind: 'cloud'
      provider: string
      supportsVision: boolean
      notes?: string
    }> = []

    for (const p of PROVIDER_REGISTRY.filter(pd => pd.kind === 'cloud')) {
      if (!activeCloudIds.has(p.id)) continue
      const catalog = PROVIDER_MODELS[p.id]
      if (!catalog || catalog.length === 0) {
        // No catalog entry; emit the registry default model as the only option
        cloudModels.push({
          id:             p.defaultModel,
          name:           `${p.name} · ${p.defaultModel}`,
          providerKind:   'cloud',
          provider:       p.id,
          supportsVision: ['anthropic', 'openai', 'google'].includes(p.id),
        })
        continue
      }

      // Prefer admin-configured default model first
      const adminProvider = adminProviders.find(ap => ap.id === p.id)
      const adminDefault = adminProvider?.defaultModel
      const orderedCatalog = adminDefault
        ? [
            catalog.find(m => m.id === adminDefault) ?? { id: adminDefault, name: adminDefault, notes: 'Default' },
            ...catalog.filter(m => m.id !== adminDefault),
          ]
        : catalog

      for (const m of orderedCatalog) {
        cloudModels.push({
          id:             m.id,
          name:           `${p.name} · ${m.name}`,
          providerKind:   'cloud',
          provider:       p.id,
          supportsVision: ['anthropic', 'openai', 'google'].includes(p.id),
          notes:          m.notes,
        })
      }
    }

    // Local models from Ollama
    const ollamaModels = await getOllamaModels()
    const localModels = ollamaModels.map(m => ({
      id:             m.id,
      name:           m.name,
      providerKind:   'local' as const,
      provider:       'ollama',
      supportsVision: false,
    }))

    // Preferences: empty by default — ModelSelector manages them client-side.
    // The actual per-request model is forwarded via the `model` field in
    // /api/generate body (Phase 4 execution path).
    return NextResponse.json({
      models:      [...cloudModels, ...localModels],
      preferences: {},
    })
  } catch (err) {
    console.error('[GET /api/models] error', err)
    // Graceful degradation — ModelSelector handles empty models gracefully
    return NextResponse.json({ models: [], preferences: {} })
  }
}

// ─── POST /api/models — acknowledge preference ────────────────────────────────
// ModelSelector calls this to persist its preference. Since WorkspaceSettingsRow
// has no preferred_model column (as of Phase 7), preferences are maintained
// client-side by ModelSelector and forwarded per-request via the `model` body
// field in /api/generate. This endpoint returns OK so the component doesn't error.

export async function POST(req: NextRequest) {
  const { unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Acknowledge the preference without persisting (no DB column yet).
  // The model selection is forwarded per-request via the generate body `model` field.
  return NextResponse.json({ ok: true, preferences: (body as any)?.preferences ?? {} })
}
