/**
 * app/api/admin/local-models/route.ts
 *
 * Detects locally installed models via Ollama + LM Studio.
 *
 * FIX: Added requireAdmin() auth guard — previously unauthenticated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'

export const runtime = 'nodejs'

async function getOllamaModels(): Promise<{ name: string; size?: string }[]> {
  const base = process.env.BESPOKE_REMOTE_URL ?? 'http://localhost:11434'
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return []
    const data = await res.json()
    return (data.models ?? []).map((m: { name: string; size?: number }) => ({
      name: m.name,
      size: m.size ? `${(m.size / 1e9).toFixed(1)}GB` : undefined,
    }))
  } catch {
    return []
  }
}

async function getLMStudioModels(): Promise<{ name: string }[]> {
  try {
    const res = await fetch('http://localhost:1234/v1/models', { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return []
    const data = await res.json()
    return (data.data ?? []).map((m: { id: string }) => ({ name: m.id }))
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return (auth as any).response

  const [ollama, lmstudio] = await Promise.all([getOllamaModels(), getLMStudioModels()])
  return NextResponse.json({
    ok: true,
    ollama: { available: ollama.length > 0, models: ollama },
    lmstudio: { available: lmstudio.length > 0, models: lmstudio },
  })
}


