/**
 * @brandos/ui-admin — tokens.ts
 *
 * Design token constants. Single source of truth for the admin color palette.
 * All components must reference tokens.* — no inline hex values.
 *
 * Adding a new key is additive (safe).
 * Renaming or removing a key is a breaking change for all consumers.
 */

export const tokens = {
  bg:           '#060612',
  surface:      '#0d0d1a',
  surfaceHover: '#111127',
  border:       '#1e1e3a',
  borderSubtle: '#0f172a',
  text:         '#e2e8f0',
  textMuted:    '#94a3b8',
  textDim:      '#475569',
  textFaint:    '#334155',

  // Semantic colors
  info:    '#38bdf8',
  success: '#34d399',
  warning: '#fb923c',
  danger:  '#ef4444',
  purple:  '#a78bfa',
  pink:    '#f472b6',
  yellow:  '#fbbf24',
  indigo:  '#6366f1',
} as const

export type Tokens = typeof tokens


