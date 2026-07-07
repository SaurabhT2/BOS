'use client'

/**
 * RuntimeModeSelector — Phase 7
 *
 * Replaces runtimeModeSelector. Two buttons only: Local and Cloud.
 * Imports RuntimeMode from @brandos/contracts (L0), not from ai-runtime-layer.
 */

import { useEffect, useRef, useState } from 'react'
import { HardDrive, Globe, WifiOff } from 'lucide-react'
import type { RuntimeMode } from '@brandos/contracts'
import { RUNTIME_MODE_LABELS } from '@brandos/contracts'
import type { ModeStatus } from '../hooks/useAvailableModes'
import type { LucideIcon } from 'lucide-react'

interface RuntimeModeSelectorProps {
  value: RuntimeMode
  onChange: (mode: RuntimeMode) => void
  disabled?: boolean
  modeStatuses?: Record<RuntimeMode, ModeStatus>
  autoSelect?: boolean
  recommendedMode?: RuntimeMode
}

const MODE_ICONS: Record<RuntimeMode, LucideIcon> = {
  local: HardDrive,
  cloud: Globe,
}

const MODE_GRADIENTS: Record<RuntimeMode, string> = {
  local: 'from-violet-600 to-purple-700',
  cloud: 'from-cyan-500 to-blue-600',
}

const MODE_RINGS: Record<RuntimeMode, string> = {
  local: 'ring-violet-500',
  cloud: 'ring-cyan-400',
}

const MODES: RuntimeMode[] = ['local', 'cloud']

export default function RuntimeModeSelector({
  value,
  onChange,
  disabled = false,
  modeStatuses,
  autoSelect = true,
  recommendedMode,
}: RuntimeModeSelectorProps) {
  useEffect(() => {
    if (!autoSelect || !modeStatuses || !recommendedMode) return
    const status = modeStatuses[value]
    if (status && status.availability === 'unavailable') {
      onChange(recommendedMode)
    }
  }, [modeStatuses, value, autoSelect, recommendedMode, onChange])

  const getModeDisabled = (mode: RuntimeMode): boolean => {
    if (disabled) return true
    if (!modeStatuses) return false
    return modeStatuses[mode]?.availability === 'unavailable'
  }

  const getModeStatus = (mode: RuntimeMode): ModeStatus['availability'] => {
    if (!modeStatuses) return 'available'
    return modeStatuses[mode]?.availability ?? 'available'
  }

  return (
    <div className="flex gap-2">
      {MODES.map((mode) => {
        const isActive   = value === mode
        const isDisabled = getModeDisabled(mode)
        const status     = getModeStatus(mode)
        const meta       = RUNTIME_MODE_LABELS[mode]
        const Icon       = MODE_ICONS[mode]

        return (
          <button
            key={mode}
            onClick={() => !isDisabled && onChange(mode)}
            disabled={isDisabled}
            title={meta.desc}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
              isActive
                ? `bg-gradient-to-r ${MODE_GRADIENTS[mode]} text-white ring-2 ${MODE_RINGS[mode]}`
                : 'bg-white/5 text-slate-300 hover:bg-white/10',
              isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
            ].join(' ')}
          >
            {status === 'unavailable'
              ? <WifiOff size={14} className="text-red-400" />
              : <Icon size={14} />
            }
            <span>{meta.label}</span>
            {isActive && (
              <span style={{
                fontSize: 9, fontWeight: 800, letterSpacing: '0.07em',
                opacity: 0.85, marginLeft: 2,
              }}>
                ●
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}


