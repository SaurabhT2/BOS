/**
 * @brandos/ui-admin — IUIAdmin.ts
 *
 * Public boundary file. Defines all exported contracts for agent and tooling use.
 *
 * READ THIS FILE BEFORE MODIFYING src/index.tsx.
 *
 * Rules:
 * - Every exported component must appear in IUIAdminExports.
 * - Prop interfaces listed here are STABLE public contracts.
 * - Do not add @brandos/* imports to this file — this package has zero @brandos/* deps.
 */

import type * as React from 'react'

// ─── Design Tokens ───────────────────────────────────────────────────────────

/**
 * Admin design token keys.
 * Adding a new key is additive (safe). Renaming or removing a key is breaking.
 */
export type TokenKey =
  | 'bg'
  | 'surface'
  | 'surfaceHover'
  | 'border'
  | 'borderSubtle'
  | 'text'
  | 'textMuted'
  | 'textDim'
  | 'textFaint'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'purple'
  | 'pink'
  | 'yellow'
  | 'indigo'

export type ITokens = Record<TokenKey, string>

// ─── Component Props Interfaces ───────────────────────────────────────────────

export interface IAdminCardProps {
  children?: React.ReactNode
  style?: React.CSSProperties
  className?: string
}

export interface ISectionTitleProps {
  children?: React.ReactNode
  icon: React.ComponentType<{
    style?: React.CSSProperties
    className?: string
    size?: number | string
    color?: string
    strokeWidth?: number | string
  }>
  color?: string
}

export interface IToggleProps {
  label?: string
  checked: boolean
  onChange: (value: boolean) => void
  desc?: string
  color?: string
  disabled?: boolean
}

export interface INumberInputProps {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  unit?: string
  disabled?: boolean
}

export interface ISelectInputProps {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}

export interface IStatCardProps {
  label: string
  value: string
  sub: string
  color?: string
  /** Declared in interface; not yet rendered. Safe to implement. */
  trend?: 'up' | 'down' | 'neutral'
}

export interface ISaveButtonProps {
  onClick: () => void
  saving: boolean
  saved: boolean
  color?: string
  label?: string
}

export interface ISegmentedControlProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: Array<{ value: T; label: string; desc?: string }>
  color?: string
}

/** Valid status values for StatusBadge. Adding new values is additive (safe). */
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

export interface IStatusBadgeProps {
  status: StatusBadgeStatus
  label?: string
}

// ─── Hook Return Type ─────────────────────────────────────────────────────────

export interface IAdminSaveResult {
  save: (data: unknown) => Promise<void>
  saving: boolean
  saved: boolean
  error: string | null
}

// ─── Package-level Export Surface ────────────────────────────────────────────

/**
 * Complete list of public exports from @brandos/ui-admin.
 * Used by IPackage.ts and CapabilityRegistry.ts as source of truth.
 *
 * All entries are CONFIRMED ACTIVE in apps/web admin pages (see AGENT_CONTEXT.md).
 */
export interface IUIAdminExports {
  // Design system
  tokens: ITokens

  // Layout
  AdminCard: React.FC<IAdminCardProps>
  SectionTitle: React.FC<ISectionTitleProps>

  // Input controls
  Toggle: React.FC<IToggleProps>
  NumberInput: React.FC<INumberInputProps>
  SelectInput: React.FC<ISelectInputProps>
  SegmentedControl: <T extends string>(props: ISegmentedControlProps<T>) => React.ReactElement

  // Display
  StatCard: React.FC<IStatCardProps>
  StatusBadge: React.FC<IStatusBadgeProps>

  // Actions
  SaveButton: React.FC<ISaveButtonProps>

  // Hooks
  useAdminSave: (saveUrl: string, section: string) => IAdminSaveResult
}

// ─── Package-level Invariants ─────────────────────────────────────────────────

/**
 * Invariant IDs for this package.
 * Referenced by validatePackage() in src/validatePackage.ts.
 */
export type UIAdminInvariantId =
  | 'I-1-no-brandos-imports'
  | 'I-2-no-api-calls-in-components'
  | 'I-3-components-stateless'
  | 'I-4-tokens-single-source'
  | 'I-5-stable-prop-interfaces'
  | 'I-6-status-badge-colors-complete'


