'use client'

/**
 * WorkspaceShell — Shared layout wrapper for all workspace pages.
 * Eliminates the duplicated header/nav in workspace, studio, assets, and memory pages.
 *
 * Usage:
 *   <WorkspaceShell title="Content Studio" backHref="/workspace">
 *     {children}
 *   </WorkspaceShell>
 */

import { usePLAuth } from '../auth/PLAuthContext'
import { useRouter } from 'next/navigation'
import { ArrowLeft, LogOut, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'

interface WorkspaceShellProps {
  children?: ReactNode
  /** Shown after the BrandOS logo. Leave empty for root workspace page. */
  title?: string
  /** Where the back arrow navigates. Omit to hide the arrow. */
  backHref?: string
  /** Extra content rendered in the header right slot, next to user email */
  headerRight?: ReactNode
}

export default function WorkspaceShell({
  children,
  title,
  backHref,
  headerRight,
}: WorkspaceShellProps) {
  const { user, logout } = usePLAuth()
  const router = useRouter()

  return (
    <div className="min-h-screen bg-black text-white">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="border-b border-gray-800 backdrop-blur-sm bg-black/90 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          {/* Left slot */}
          <div className="flex items-center gap-4">
            {backHref && (
              <button
                onClick={() => router.push(backHref)}
                className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}

            {/* Logo */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-lg flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <button
                onClick={() => router.push('/workspace')}
                className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-600 bg-clip-text text-transparent hover:opacity-80 transition-opacity"
              >
                BrandOS
              </button>
            </div>

            {title && (
              <>
                <span className="text-gray-600">/</span>
                <span className="text-gray-300 font-medium">{title}</span>
              </>
            )}
          </div>

          {/* Right slot */}
          <div className="flex items-center gap-4">
            {headerRight}

            <div className="text-sm text-gray-400">{user?.email ?? 'User'}</div>

            <button
              onClick={logout}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded transition-all"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* ── Page content ───────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {children}
      </div>
    </div>
  )
}


