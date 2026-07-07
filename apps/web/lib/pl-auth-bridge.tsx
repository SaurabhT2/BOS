'use client'

/**
 * apps/web — lib/pl-auth-bridge.tsx
 *
 * Cleanup Sprint 2 (WS1): bridges @brandos/auth into @brandos/presentation-layer.
 *
 * @brandos/presentation-layer shell components (WorkspaceShell, AdminShell) no
 * longer import @brandos/auth directly. Instead they read from PLAuthContext.
 * This bridge reads the real auth state from @brandos/auth and injects it.
 *
 * Location: apps/web (the integration seam). Neither PL nor auth owns this.
 */

import { useAuth } from '@brandos/auth'
import { PLAuthProvider } from '@brandos/presentation-layer'
import type { ReactNode } from 'react'

export function PLAuthBridge({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  return (
    <PLAuthProvider value={{ user, logout }}>
      {children}
    </PLAuthProvider>
  )
}
