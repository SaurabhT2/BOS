'use client'
/**
 * @brandos/ui-admin — layout.tsx
 *
 * Layout primitives: AdminCard, SectionTitle.
 */

import * as React from 'react'
import { tokens } from './tokens'

// ─── AdminCard ────────────────────────────────────────────────────────────────

export interface AdminCardProps {
  children?: React.ReactNode
  style?: React.CSSProperties
  className?: string
}

export function AdminCard({ children, style, className }: AdminCardProps) {
  return (
    <div
      className={className}
      style={{
        background:   tokens.surface,
        border:       `1px solid ${tokens.border}`,
        borderRadius: 12,
        padding:      20,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// ─── SectionTitle ─────────────────────────────────────────────────────────────

type IconComponent = React.ComponentType<{
  style?: React.CSSProperties
  className?: string
  size?: number | string
  color?: string
  strokeWidth?: number | string
}>

export interface SectionTitleProps {
  children?: React.ReactNode
  icon:      IconComponent
  color?:    string
}

export function SectionTitle({ children, icon: Icon, color = tokens.info }: SectionTitleProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
      <div style={{
        width: 26, height: 26, borderRadius: 6,
        background: `${color}20`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon style={{ width: 13, height: 13, color }} />
      </div>
      <h2 style={{
        fontSize: 13, fontWeight: 700, letterSpacing: '0.08em',
        color: tokens.textMuted, textTransform: 'uppercase', margin: 0,
      }}>
        {children}
      </h2>
    </div>
  )
}


