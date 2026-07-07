'use client'
/**
 * @brandos/ui-admin — display.tsx
 *
 * Display components: StatCard, StatusBadge.
 */

import * as React from 'react'
import { tokens } from './tokens'

// ─── StatCard ─────────────────────────────────────────────────────────────────

export interface StatCardProps {
  label:  string
  value:  string
  sub:    string
  color?: string
  /** Declared in interface; not yet rendered. Safe to implement. */
  trend?: 'up' | 'down' | 'neutral'
}

export function StatCard({ label, value, sub, color = tokens.info }: StatCardProps) {
  return (
    <div style={{
      background: tokens.bg,
      border: `1px solid ${color}25`,
      borderRadius: 10,
      padding: '16px 18px',
    }}>
      <div style={{
        fontSize: 11, color: tokens.textDim, fontWeight: 600,
        letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 26, fontWeight: 800, color,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.1,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: tokens.textDim, marginTop: 4 }}>{sub}</div>
    </div>
  )
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────

export type StatusBadgeStatus =
  | 'running'
  | 'completed'
  | 'complete'
  | 'failed'
  | 'pending'
  | 'healthy'
  | 'degraded'
  | 'unknown'
  | 'paused'

export interface StatusBadgeProps {
  status: StatusBadgeStatus
  label?: string
}

const STATUS_COLORS: Record<StatusBadgeStatus, string> = {
  running:   '#fb923c',
  completed: '#34d399',
  complete:  '#34d399',
  healthy:   '#34d399',
  failed:    '#ef4444',
  degraded:  '#fb923c',
  pending:   '#94a3b8',
  paused:    '#94a3b8',
  unknown:   '#475569',
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const color = STATUS_COLORS[status]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 4,
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
      background: `${color}18`,
      color,
      border: `1px solid ${color}40`,
    }}>
      {(status === 'running' || status === 'degraded') && (
        <span style={{
          width: 5, height: 5, borderRadius: '50%', background: color,
          display: 'inline-block', animation: 'pulseDot 1s ease-in-out infinite',
        }} />
      )}
      {label ?? status}
    </span>
  )
}


