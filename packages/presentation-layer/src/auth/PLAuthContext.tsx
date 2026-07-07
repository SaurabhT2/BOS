'use client'

/**
 * @brandos/presentation-layer — auth/PLAuthContext.tsx
 *
 * Cleanup Sprint 2 (WS1): Removes @brandos/auth runtime dependency from PL.
 *
 * Previously, WorkspaceShell and AdminShell imported useAuth() directly from
 * @brandos/auth. This coupled the presentation layer to the auth implementation.
 *
 * Solution: PL defines a minimal IPLAuthContext interface (no @brandos/auth import)
 * and a React context + hook that reads from it. apps/web injects the real auth
 * state via <PLAuthProvider> which wraps @brandos/auth's useAuth().
 *
 * Dependency flow:
 *   apps/web → @brandos/auth → provides IPLAuthContext value to PLAuthProvider
 *   @brandos/presentation-layer → PLAuthContext (no @brandos/auth import)
 *
 * This makes presentation-layer independently testable — mock the context, no
 * real auth required.
 */

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

// ─── Minimal auth shape PL components need ────────────────────────────────────
// Typed independently of @brandos/auth — no import. This is the presentation
// contract: only the fields that shell components actually render.

export interface IPLAuthContext {
  /** Authenticated user — null when not logged in */
  user: { email?: string | null } | null
  /** Log out the current user */
  logout: () => void | Promise<void>
}

// ─── Context ──────────────────────────────────────────────────────────────────

const PLAuthContext = createContext<IPLAuthContext | null>(null)
PLAuthContext.displayName = 'PLAuthContext'

// ─── Provider ─────────────────────────────────────────────────────────────────

interface PLAuthProviderProps {
  value: IPLAuthContext
  children: ReactNode
}

/**
 * PLAuthProvider — wraps PL shell components with an auth context value.
 *
 * apps/web usage:
 *   import { PLAuthProvider } from '@brandos/presentation-layer'
 *   import { useAuth } from '@brandos/auth'
 *
 *   function AppShell({ children }) {
 *     const { user, logout } = useAuth()  // @brandos/auth
 *     return (
 *       <PLAuthProvider value={{ user, logout }}>
 *         {children}
 *       </PLAuthProvider>
 *     )
 *   }
 *
 * Or — if apps/web wraps everything in AuthProvider already — use the
 * convenience adapter PLAuthBridge (below) to avoid the boilerplate.
 */
export function PLAuthProvider({ value, children }: PLAuthProviderProps) {
  return (
    <PLAuthContext.Provider value={value}>
      {children}
    </PLAuthContext.Provider>
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * usePLAuth — internal hook for PL shell components.
 *
 * Returns a safe default (null user, no-op logout) when no provider is present,
 * so components degrade gracefully in test environments.
 */
export function usePLAuth(): IPLAuthContext {
  const ctx = useContext(PLAuthContext)
  if (!ctx) {
    // Graceful degradation: no provider = unauthenticated shell
    return { user: null, logout: () => {} }
  }
  return ctx
}
