'use client'

/**
 * /workspace/settings/governance-audit — Governance Audit Trail (Executive)
 *
 * GTM Critical Item 5 (2026-06-21): workspace-facing read view for the
 * compliance audit trail, gated to Executive-tier workspaces. Reuses the
 * same GET /api/governance/audit route as the admin viewer — the route
 * itself enforces the tier check server-side (resolveTierLimits), so this
 * page being reachable does not bypass anything; a non-Executive workspace
 * hitting this page just sees the route's 403.
 *
 * No workspace-id override here (unlike the admin page) — a workspace user
 * may only ever see their own workspace's trail.
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, ShieldCheck, RefreshCw, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'

interface AuditEntry {
  requestId: string
  artifactType: string
  score: number
  passed: boolean
  violations: string[]
  repaired: boolean
  repairAttempts: number
  timestamp: string
}

interface AuditResponse {
  entries: AuditEntry[]
  total: number
  limit: number
  offset: number
  source: 'supabase' | 'memory'
  stats: { totalDecisions: number; passRate: number; repairRate: number; avgScore: number }
  error?: string
  tierRequired?: string
}

const PAGE_SIZE = 20

export default function WorkspaceGovernanceAuditPage() {
  const router = useRouter()
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<AuditResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tierBlocked, setTierBlocked] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/governance/audit?limit=${PAGE_SIZE}&offset=${offset}`)
      const json: AuditResponse = await res.json()

      if (res.status === 403) {
        setTierBlocked(true)
        setError(json?.error ?? 'This page requires the Executive plan')
        return
      }
      if (!res.ok) {
        setError(json?.error ?? 'Failed to load audit trail')
        return
      }
      setData(json)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load audit trail')
    } finally {
      setLoading(false)
    }
  }, [offset])

  useEffect(() => { void load() }, [load])

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <button
            onClick={() => router.push('/workspace/settings')}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <ShieldCheck className="w-5 h-5 text-amber-400" />
          <div className="flex-1">
            <h1 className="text-lg font-semibold">Governance Audit Trail</h1>
            <p className="text-xs text-gray-400">Every governance decision made during artifact generation</p>
          </div>
          <button
            onClick={() => void load()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {loading && !data && !error && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
          </div>
        )}

        {tierBlocked && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-center">
            <ShieldCheck className="w-6 h-6 text-amber-400 mx-auto mb-2" />
            <p className="text-sm text-amber-200 font-medium mb-1">Executive plan required</p>
            <p className="text-xs text-amber-300/70">
              The governance audit trail is part of the Executive compliance package.
            </p>
            <button
              onClick={() => router.push('/workspace/settings/billing')}
              className="mt-4 text-xs font-semibold text-amber-300 hover:text-amber-200"
            >
              View plans →
            </button>
          </div>
        )}

        {error && !tierBlocked && (
          <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {data?.source === 'memory' && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-xs text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Showing recent in-process activity only — durable history storage is not yet available.
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatTile label="Decisions" value={String(data.stats.totalDecisions)} />
              <StatTile label="Pass rate" value={`${data.stats.passRate}%`} />
              <StatTile label="Repair rate" value={`${data.stats.repairRate}%`} />
              <StatTile label="Avg score" value={String(data.stats.avgScore)} />
            </div>

            {data.entries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-800 p-10 text-center">
                <p className="text-sm text-gray-400">No governance decisions recorded yet.</p>
                <p className="text-xs text-gray-600 mt-1">
                  Entries appear here as content is generated in your workspace.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
                {data.entries.map((e, i) => (
                  <div key={`${e.requestId}-${i}`} className="flex items-start gap-3 px-4 py-3">
                    <div
                      className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                        e.passed ? 'bg-emerald-400' : 'bg-red-400'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-200 capitalize">{e.artifactType}</span>
                        <span className="text-xs text-gray-500">score {e.score}</span>
                        {e.repaired && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-950 text-blue-300">
                            repaired ×{e.repairAttempts}
                          </span>
                        )}
                      </div>
                      {e.violations.length > 0 && (
                        <p className="text-xs text-red-400 mt-1">{e.violations.join(', ')}</p>
                      )}
                      <p className="text-xs text-gray-600 mt-1">{new Date(e.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {data.total > PAGE_SIZE && (
              <div className="flex justify-end items-center gap-2 text-xs text-gray-500">
                <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} of {data.total}</span>
                <button
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0}
                  className="p-1.5 rounded border border-gray-800 disabled:text-gray-700 text-gray-400 hover:text-gray-200 disabled:hover:text-gray-700"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={offset + PAGE_SIZE >= data.total}
                  className="p-1.5 rounded border border-gray-800 disabled:text-gray-700 text-gray-400 hover:text-gray-200 disabled:hover:text-gray-700"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
    </div>
  )
}
