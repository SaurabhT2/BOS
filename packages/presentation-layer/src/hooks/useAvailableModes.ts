'use client'

/**
 * useAvailableModes — capability-aware hook for RuntimeModeSelector.
 *
 * Phase 7: Updated to RuntimeMode (local | cloud). Imports from @brandos/contracts.
 * DEFAULT_STATE covers both modes.
 */

import { useState, useEffect, useCallback } from 'react'
import type { RuntimeMode } from '@brandos/contracts'

export type ModeAvailability = 'available' | 'degraded' | 'unavailable' | 'checking'

export interface ModeStatus {
  mode: RuntimeMode
  availability: ModeAvailability
  reason?: string
  providerCount: number
}

export interface AvailabilityState {
  modes: Record<RuntimeMode, ModeStatus>
  recommended: RuntimeMode
  loading: boolean
  lastChecked: number | null
  refresh: () => void
}

const DEFAULT_STATE: Record<RuntimeMode, ModeStatus> = {
  local: {
    mode: 'local',
    availability: 'checking',
    providerCount: 0,
  },
  cloud: {
    mode: 'cloud',
    availability: 'checking',
    providerCount: 0,
  },
}

export function useAvailableModes(): AvailabilityState {
  const [modes, setModes] = useState<Record<RuntimeMode, ModeStatus>>(DEFAULT_STATE)
  const [loading, setLoading] = useState(true)
  const [lastChecked, setLastChecked] = useState<number | null>(null)

  const check = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/models/availability', { cache: 'no-store' })
      if (!res.ok) throw new Error('availability check failed')
      const data: {
        modes: Array<{
          mode: RuntimeMode
          available: boolean
          degraded?: boolean
          reason?: string
          providerCount: number
        }>
      } = await res.json()

      const next = { ...DEFAULT_STATE }

      for (const m of data.modes) {
        if (m.mode !== 'local' && m.mode !== 'cloud') continue
        const availability =
          m.available
            ? m.degraded
              ? 'degraded'
              : 'available'
            : 'unavailable'

        next[m.mode] = {
          mode: m.mode,
          availability,
          providerCount: m.providerCount,
          ...(m.reason ? { reason: m.reason } : {}),
        }
      }

      setModes(next)
      setLastChecked(Date.now())
    } catch {
      setModes({
        local: { mode: 'local', availability: 'unavailable', providerCount: 0, reason: 'Requires local Ollama or LM Studio' },
        cloud: { mode: 'cloud', availability: 'available',   providerCount: 1 },
      })
      setLastChecked(Date.now())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    check()
  }, [check])

  const priority: RuntimeMode[] = ['cloud', 'local']
  const recommended =
    priority.find((m) => modes[m].availability === 'available') ??
    priority.find((m) => modes[m].availability === 'degraded') ??
    'cloud'

  return { modes, recommended, loading, lastChecked, refresh: check }
}


