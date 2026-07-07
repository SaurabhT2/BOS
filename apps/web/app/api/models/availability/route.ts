/**
 * app/api/models/availability/route.ts
 *
 * Phase 8: Returns two mode entries: local and cloud.
 * bespoke/cloud_free/cloud_pro removed from response vocabulary.
 */

import { NextResponse } from 'next/server'
import type { RuntimeMode } from '@brandos/contracts'

export const runtime = 'nodejs'

interface ModeAvailabilityResult {
  mode: RuntimeMode
  available: boolean
  degraded: boolean
  providerCount: number
  score: number
  reason?: string
  models?: string[]
}

const CLOUD_KEYS = [
  'GROQ_API_KEY',
  'TOGETHER_API_KEY',
  'OPENROUTER_API_KEY',
  'DEEPSEEK_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
]

function countConfigured(keys: string[]): number {
  return keys.filter((k) => !!process.env[k]).length
}

function isProduction(): boolean {
  return (
    process.env.VERCEL === '1' ||
    process.env.NODE_ENV === 'production' ||
    !!process.env.VERCEL_URL
  )
}

async function getOllamaModels(): Promise<string[]> {
  const url =
    process.env.BESPOKE_REMOTE_URL ||
    (isProduction() ? null : 'http://localhost:11434')

  if (!url) return []

  try {
    const res = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(2500),
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.models || [])
      .map((m: any) => String(m.name || '').toLowerCase())
      .filter(Boolean)
  } catch {
    return []
  }
}

function recommendMode(
  localAvailable: boolean,
  cloudAvailable: boolean,
): RuntimeMode {
  if (cloudAvailable) return 'cloud'
  if (localAvailable) return 'local'
  return 'cloud'
}

export async function GET() {
  try {
    // ── Local availability ──────────────────────────────────────────────────
    const ollamaModels   = await getOllamaModels()
    const localAvailable = ollamaModels.length > 0
    const localScore     = localAvailable ? 100 : 0

    const localResult: ModeAvailabilityResult = {
      mode:          'local',
      available:     localAvailable,
      degraded:      false,
      providerCount: localAvailable ? 1 : 0,
      score:         localScore,
      ...(localAvailable
        ? { models: ollamaModels.slice(0, 5) }
        : { reason: 'No local models detected. Start Ollama or LM Studio.' }),
    }

    // ── Cloud availability ──────────────────────────────────────────────────
    const cloudCount     = countConfigured(CLOUD_KEYS)
    const cloudAvailable = cloudCount > 0 || isProduction()
    const cloudDegraded  = cloudAvailable && cloudCount < 2
    const cloudScore     = cloudAvailable ? Math.min(100, cloudCount * 30 + 40) : 0

    const cloudResult: ModeAvailabilityResult = {
      mode:          'cloud',
      available:     cloudAvailable,
      degraded:      cloudDegraded,
      providerCount: cloudCount,
      score:         cloudScore,
      ...(cloudDegraded
        ? { reason: 'Limited cloud keys configured. Add more for better reliability.' }
        : !cloudAvailable
          ? { reason: 'No cloud API keys configured. Add at least one in Settings.' }
          : {}),
    }

    return NextResponse.json({
      modes: [localResult, cloudResult],
      recommended: recommendMode(localAvailable, cloudAvailable),
    })
  } catch (err: any) {
    return NextResponse.json(
      {
        modes: [
          { mode: 'local', available: false, degraded: false, providerCount: 0, score: 0, reason: 'Check failed' },
          { mode: 'cloud', available: true,  degraded: true,  providerCount: 1, score: 50 },
        ],
        recommended: 'cloud',
        error: err?.message,
      },
      { status: 200 }
    )
  }
}


