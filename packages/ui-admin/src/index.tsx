/**
 * @brandos/ui-admin
 *
 * Shared admin UI primitives.
 *
 * Split into sub-modules for maintainability (L2 → L3 migration).
 * All public exports remain at @brandos/ui-admin — no consumer changes required.
 *
 * Sub-modules:
 *   tokens.ts    — design token constants
 *   layout.tsx   — AdminCard, SectionTitle
 *   inputs.tsx   — Toggle, NumberInput, SelectInput, SegmentedControl
 *   display.tsx  — StatCard, StatusBadge
 *   actions.tsx  — SaveButton
 *   hooks.ts     — useAdminSave
 */

'use client'

export { tokens } from './tokens'
export type { Tokens } from './tokens'

export { AdminCard, SectionTitle } from './layout'
export type { AdminCardProps, SectionTitleProps } from './layout'

export { Toggle, NumberInput, SelectInput, SegmentedControl } from './inputs'
export type {
  ToggleProps,
  NumberInputProps,
  SelectInputProps,
  SegmentedControlProps,
} from './inputs'

export { StatCard, StatusBadge } from './display'
export type { StatCardProps, StatusBadgeProps, StatusBadgeStatus } from './display'

export { SaveButton } from './actions'
export type { SaveButtonProps } from './actions'

export { useAdminSave } from './hooks'
export type { AdminSaveResult } from './hooks'


