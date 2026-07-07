/**
 * packages/presentation-layer/src/components/AdminNav.tsx
 *
 * AdminNav: two variants
 *  - AdminNavSidebar  — vertical sidebar nav (used inside AdminShell)
 *  - AdminNav (default export) — compact dropdown button for workspace header
 */

'use client'
import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Cpu, Package, Shield, Activity, LayoutDashboard, Settings, ChevronDown, X } from 'lucide-react'

const NAV_ITEMS = [
  {
    href:  '/workspace/admin',
    label: 'Dashboard',
    icon:  LayoutDashboard,
    exact:  true,
    color: '#64748b',
  },
  {
    href:  '/workspace/admin/ai-runtime',
    label: 'AI Runtime',
    icon:  Cpu,
    exact:  false,
    color: '#a78bfa',
  },
  {
    href:  '/workspace/admin/artifact-engine',
    label: 'Artifact Engine',
    icon:  Package,
    exact:  false,
    color: '#34d399',
  },
  {
    href:  '/workspace/admin/governance',
    label: 'Governance',
    icon:  Shield,
    exact:  false,
    color: '#a78bfa',
  },
  {
    href:  '/workspace/admin/telemetry',
    label: 'Telemetry',
    icon:  Activity,
    exact:  false,
    color: '#38bdf8',
  },
] as const

// ─── Sidebar variant (used in AdminShell) ────────────────────────────────────

export function AdminNavSidebar() {
  const pathname = usePathname()

  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
        color: '#334155', textTransform: 'uppercase',
        padding: '0 8px 10px',
      }}>
        Platform Admin
      </div>

      {NAV_ITEMS.map(({ href, label, icon: Icon, exact, color }) => {
        const active = exact ? pathname === href : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 8, textDecoration: 'none',
              background:  active ? `${color}14` : 'transparent',
              border:      `1px solid ${active ? `${color}30` : 'transparent'}`,
              color:       active ? color : '#64748b',
              fontSize:    13, fontWeight: active ? 600 : 400,
              transition:  'all 0.15s',
            }}
          >
            <Icon style={{ width: 14, height: 14, flexShrink: 0 }} />
            {label}
          </Link>
        )
      })}

      <div style={{ marginTop: 'auto', paddingTop: 16 }}>
        <Link
          href="/workspace"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 10px', borderRadius: 8, textDecoration: 'none',
            color: '#475569', fontSize: 12,
            border: '1px solid transparent',
            transition: 'all 0.15s',
          }}
        >
          ← Back to Studio
        </Link>
      </div>
    </nav>
  )
}

// ─── Compact dropdown variant (used in workspace header) ─────────────────────

export function AdminNav() {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  // Close on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', borderRadius: 8,
          background: open ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${open ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)'}`,
          color: open ? '#a78bfa' : '#94a3b8',
          cursor: 'pointer', fontSize: 13, fontWeight: 500,
          transition: 'all 0.15s',
        }}
      >
        <Settings style={{ width: 14, height: 14 }} />
        Admin
        <ChevronDown style={{ width: 12, height: 12, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          background: '#0f0f1a', border: '1px solid #1e1e3a',
          borderRadius: 12, padding: '8px', minWidth: 200,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          zIndex: 100,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
            color: '#334155', textTransform: 'uppercase',
            padding: '2px 8px 8px',
          }}>
            Platform Admin
          </div>
          {NAV_ITEMS.map(({ href, label, icon: Icon, color }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '8px 10px', borderRadius: 7, textDecoration: 'none',
                color: '#94a3b8', fontSize: 13, fontWeight: 400,
                transition: 'all 0.12s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = `${color}14`
                ;(e.currentTarget as HTMLElement).style.color = color
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = 'transparent'
                ;(e.currentTarget as HTMLElement).style.color = '#94a3b8'
              }}
            >
              <Icon style={{ width: 13, height: 13, flexShrink: 0 }} />
              {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}


