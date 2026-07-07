'use client'

/**
 * WorkspaceNav — persistent five-item navigation shell.
 *
 * Approved IA (do not add a sixth item; do not fork by tier):
 *   Home · Create · Intelligence · Library · Settings
 *
 * "Brand" renamed to "Intelligence" per Phase 1 UX Audit P0.4 — semantic
 * change only, route (/workspace/brand) unchanged. Critical for positioning
 * the product as an AI Operating System rather than a settings panel.
 *
 * Renders identically for every workspace plan (Explorer / Professional /
 * Executive). Tier gating happens INSIDE each screen via UpgradeGate, never
 * by hiding or restructuring this nav.
 *
 * `WorkspaceShell` from @brandos/presentation-layer is a per-page header
 * ({title, backHref, headerRight}) with no nav slot — it is not reused here.
 * This component is the real, new persistent shell called for by Phase 1.
 */

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@brandos/auth'
import {
  Sparkles, Home, Wand2, Brain, LayoutGrid, Settings, LogOut, Menu, X,
} from 'lucide-react'

// ─── Nav model ──────────────────────────────────────────────────────────────

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** Pathname prefixes that should also mark this item active. */
  matchPrefixes: string[]
}

const NAV_ITEMS: NavItem[] = [
  { href: '/workspace',          label: 'Home',         icon: Home,       matchPrefixes: ['/workspace'] },
  { href: '/workspace/create',   label: 'Create',       icon: Wand2,      matchPrefixes: ['/workspace/create'] },
  { href: '/workspace/brand',    label: 'Intelligence', icon: Brain,      matchPrefixes: ['/workspace/brand'] },
  { href: '/workspace/library',  label: 'Library',      icon: LayoutGrid, matchPrefixes: ['/workspace/library'] },
  { href: '/workspace/settings', label: 'Settings',     icon: Settings,   matchPrefixes: ['/workspace/settings'] },
]

/**
 * "Home" (/workspace) would otherwise match every /workspace/* path as a
 * prefix. It is active only on an exact match; every other item uses
 * prefix matching so sub-routes (e.g. /workspace/settings/ai) keep their
 * parent tab highlighted.
 */
function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === '/workspace') return pathname === '/workspace'
  return item.matchPrefixes.some(p => pathname === p || pathname.startsWith(p + '/'))
}

// ─── Component ──────────────────────────────────────────────────────────────

export function WorkspaceNav() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isLoading, logout } = useAuth()
  const [mobileOpen, setMobileOpen] = React.useState(false)

  return (
    <>
      {/* ── Top bar (all breakpoints) ─────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-black/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          {/* Brand mark */}
          <Link href="/workspace" className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-lg flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold bg-gradient-to-r from-cyan-400 to-blue-600 bg-clip-text text-transparent hidden sm:inline">
              BrandOS
            </span>
          </Link>

          {/* Desktop nav items */}
          <nav className="hidden md:flex items-center gap-1 flex-1 justify-center" aria-label="Primary">
            {NAV_ITEMS.map(item => {
              const active = isActive(pathname, item)
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>

          {/* Right side: user + logout (desktop), menu toggle (mobile) */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:block text-sm text-gray-400 max-w-[14rem] truncate">
              {isLoading ? (
                // Still resolving the session (e.g. Vercel cold start) — show a
                // neutral skeleton instead of a misleading hardcoded placeholder.
                <span className="inline-block h-3 w-24 animate-pulse rounded bg-gray-800" aria-hidden="true" />
              ) : (
                user?.email ?? 'Signed out'
              )}
            </div>
            <button
              onClick={logout}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded transition-all"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
            <button
              onClick={() => setMobileOpen(o => !o)}
              className="md:hidden p-2 text-gray-400 hover:text-white"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* ── Mobile nav drawer ──────────────────────────────────────────── */}
        {mobileOpen && (
          <nav className="md:hidden border-t border-gray-800 px-4 py-2" aria-label="Primary">
            {NAV_ITEMS.map(item => {
              const active = isActive(pathname, item)
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2.5 px-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    active ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              )
            })}
            <button
              onClick={() => { setMobileOpen(false); logout() }}
              className="w-full flex items-center gap-2.5 px-2 py-2.5 mt-1 rounded-lg text-sm font-medium text-gray-400 hover:text-white border-t border-gray-800"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </nav>
        )}
      </header>
    </>
  )
}
