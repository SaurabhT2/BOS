'use client'
/**
 * @brandos/ui-admin — actions.tsx
 *
 * Action components: SaveButton.
 */

import * as React from 'react'
import { tokens } from './tokens'

// ─── SaveButton ───────────────────────────────────────────────────────────────

export interface SaveButtonProps {
  onClick:  () => void
  saving:   boolean
  saved:    boolean
  color?:   string
  label?:   string
}

export function SaveButton({ onClick, saving, saved, color = tokens.info, label = 'Save Changes' }: SaveButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '7px 14px', borderRadius: 8, cursor: saving ? 'wait' : 'pointer',
        background: saved ? '#065f46' : `${color}18`,
        border: `1px solid ${saved ? '#10b981' : color}`,
        color: saved ? '#6ee7b7' : color,
        fontSize: 12, fontWeight: 600, transition: 'all 0.2s',
      }}
    >
      {saved ? '✓ Saved' : saving ? '…' : label}
    </button>
  )
}


