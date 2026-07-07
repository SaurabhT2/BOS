'use client'

/**
 * AdminShell — Layout wrapper for BrandOS admin pages.
 * Provides header + side rail + content area.
 */

import { usePLAuth } from '../auth/PLAuthContext'
import { useRouter } from 'next/navigation'
import { Sparkles, LogOut, ShieldCheck } from 'lucide-react'
import { AdminNavSidebar } from './AdminNav'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

interface AdminShellProps {
  children?: ReactNode
  title: string
  subtitle?: string
  titleColor?: string
  actions?: ReactNode
}

export default function AdminShell({
  children,
  title,
  subtitle,
  titleColor = '#38bdf8',
  actions,
}: AdminShellProps) {
  const { user, logout } = usePLAuth()
  const router = useRouter()

  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#060612', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header
        style={{
          borderBottom: '1px solid #1e1e3a',
          background: 'rgba(6,6,18,0.95)',
          backdropFilter: 'blur(12px)',
          position: 'sticky',
          top: 0,
          zIndex: 50,
          padding: '0 24px',
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 60,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button
              onClick={() => router.push('/workspace')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 7,
                  background: 'linear-gradient(135deg, #38bdf8, #6366f1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Sparkles style={{ width: 16, height: 16, color: '#fff' }} />
              </div>

              <span
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  background: 'linear-gradient(90deg, #38bdf8, #818cf8)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                BrandOS
              </span>
            </button>

            <span style={{ color: '#1e293b', fontSize: 16 }}>/</span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldCheck style={{ width: 14, height: 14, color: '#6366f1' }} />
              <span style={{ fontSize: 13, color: '#6366f1', fontWeight: 600 }}>
                Admin
              </span>
            </div>

            <span style={{ color: '#1e293b', fontSize: 16 }}>/</span>

            <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>
              {title}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {actions}

            <span style={{ fontSize: 12, color: '#475569' }}>
              {mounted ? (user?.email ?? 'Admin') : 'Admin'}
            </span>

            <button
              onClick={logout}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 10px',
                borderRadius: 7,
                cursor: 'pointer',
                background: 'transparent',
                border: '1px solid #1e293b',
                color: '#64748b',
                fontSize: 12,
                transition: 'all 0.15s',
              }}
            >
              <LogOut style={{ width: 12, height: 12 }} />
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div
        style={{
          maxWidth: 1400,
          margin: '0 auto',
          display: 'flex',
          gap: 24,
          padding: '28px 24px',
        }}
      >
        <AdminNavSidebar />

        <main style={{ flex: 1, minWidth: 0 }}>
          {/* Page title */}
          <div style={{ marginBottom: 28 }}>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 800,
                margin: 0,
                background: `linear-gradient(90deg, ${titleColor}, ${titleColor}99)`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                letterSpacing: '-0.02em',
              }}
            >
              {title}
            </h1>

            {subtitle && (
              <p
                style={{
                  fontSize: 13,
                  color: '#475569',
                  margin: '6px 0 0',
                  fontWeight: 400,
                }}
              >
                {subtitle}
              </p>
            )}
          </div>

          {children}
        </main>
      </div>
    </div>
  )
}

