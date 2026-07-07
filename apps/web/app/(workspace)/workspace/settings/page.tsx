'use client'

/**
 * /workspace/settings — Settings (workspace / team / billing)
 *
 * P3.27 — Workspace rename is now supported via PATCH /api/workspace.
 * Name is shown as an editable field; saving updates name + slug.
 *
 * TEAM: no /api/workspace/members or similar route exists anywhere in
 * apps/web — omitted until that API exists.
 */

import * as React from 'react'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Settings, Loader2, Sliders, Zap, Building2, ChevronRight, ShieldCheck, Link2,
  Pencil, Check, X, BarChart2,
} from 'lucide-react'

interface WorkspaceData {
  id: string
  name: string
  plan: string
  slug?: string
  created_at?: string
}

const PLAN_LABEL: Record<string, string> = {
  explorer: 'Explorer',
  professional: 'Professional',
  executive: 'Executive',
}
const PLAN_COLOR: Record<string, string> = {
  explorer: 'text-gray-400 bg-gray-400/10 border-gray-400/20',
  professional: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
  executive: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
}

export default function WorkspaceSettingsPage() {
  const router = useRouter()
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameLoading, setRenameLoading] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/workspace')
      .then(r => r.json())
      .then(d => setWorkspace(d?.workspace ?? d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleRename() {
    const name = renameDraft.trim()
    if (!name || name === workspace?.name) { setRenaming(false); return }
    setRenameLoading(true)
    setRenameError(null)
    try {
      const res = await fetch('/api/workspace', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Rename failed')
      setWorkspace(prev => prev ? { ...prev, name: data.workspace.name } : prev)
      setRenaming(false)
    } catch (e: any) {
      setRenameError(e.message)
    } finally {
      setRenameLoading(false)
    }
  }

  function startRename() {
    setRenameDraft(workspace?.name ?? '')
    setRenameError(null)
    setRenaming(true)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
      </div>
    )
  }

  const plan = workspace?.plan ?? 'explorer'

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <Settings className="w-5 h-5 text-purple-400" />
          <div className="flex-1">
            <h1 className="text-lg font-semibold">Settings</h1>
            <p className="text-xs text-gray-400">Workspace and billing</p>
          </div>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${PLAN_COLOR[plan] ?? PLAN_COLOR.explorer}`}>
            {PLAN_LABEL[plan] ?? plan}
          </span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-purple-400" />
            <h2 className="text-sm font-semibold text-gray-200">Workspace</h2>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <p className="text-xs text-gray-500 mb-0.5">Name</p>
            {renaming ? (
              <div className="mt-1 space-y-2">
                <input
                  type="text"
                  value={renameDraft}
                  onChange={e => setRenameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false) }}
                  maxLength={80}
                  autoFocus
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                />
                {renameError && <p className="text-xs text-red-400">{renameError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleRename}
                    disabled={renameLoading || !renameDraft.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
                  >
                    {renameLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Save
                  </button>
                  <button
                    onClick={() => setRenaming(false)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs font-medium transition-colors"
                  >
                    <X className="w-3 h-3" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 mt-0.5">
                <p className="text-sm text-gray-200 flex-1">{workspace?.name ?? '—'}</p>
                <button
                  onClick={startRename}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-purple-400 transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  Rename
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-200">Configure</h2>
          <div className="rounded-xl border border-gray-800 bg-gray-900 divide-y divide-gray-800">
            <button
              onClick={() => router.push('/workspace/settings/ai')}
              className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-800/40 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Sliders className="w-4 h-4 text-purple-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-200">AI Intelligence</p>
                  <p className="text-xs text-gray-500">Quality settings, providers, and usage</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" />
            </button>
            <button
              onClick={() => router.push('/workspace/analytics')}
              className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-800/40 transition-colors"
            >
              <div className="flex items-center gap-3">
                <BarChart2 className="w-4 h-4 text-cyan-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-200">Analytics</p>
                  <p className="text-xs text-gray-500">Quality trends, format breakdown, generation history</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" />
            </button>
            <button
              onClick={() => router.push('/workspace/settings/integrations')}
              className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-800/40 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Link2 className="w-4 h-4 text-cyan-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-200">Export Integrations</p>
                  <p className="text-xs text-gray-500">Connect Canva and other design tools</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" />
            </button>
            <button
              onClick={() => router.push('/workspace/settings/billing')}
              className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-800/40 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Zap className="w-4 h-4 text-purple-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-200">Usage &amp; Plan</p>
                  <p className="text-xs text-gray-500">Quotas, capabilities, upgrade</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" />
            </button>
            {/* Governance audit trail — Executive plan only */}
            {plan === 'executive' && (
              <button
                onClick={() => router.push('/workspace/settings/governance-audit')}
                className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-800/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-200">Governance Audit Trail</p>
                    <p className="text-xs text-gray-500">Compliance record of every governance decision</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" />
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
