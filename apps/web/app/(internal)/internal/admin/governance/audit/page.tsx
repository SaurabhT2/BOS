'use client'
/**
 * /admin/governance/audit — Governance Audit Trail Viewer
 *
 * GTM Critical Item 5 (2026-06-21): read-side UI for the governance audit
 * trail. The write path (globalAuditTrail.record(), called from
 * runPhaseCLifecycle() on every governed generation) already existed.
 * This page + GET /api/governance/audit are the missing read path.
 *
 * Platform admins may inspect any workspace via the workspace ID field.
 * (Executive-tier workspace users get their own read-only view at
 * /workspace/governance/audit — see that page for the non-admin path
 * through the same API route.)
 *
 * API: GET /api/governance/audit
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { AdminShell } from '@brandos/presentation-layer'
import { AdminCard, SectionTitle, StatCard, StatusBadge, SelectInput, tokens } from '@brandos/ui-admin'
import { ShieldCheck, RefreshCw, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'

interface AuditEntry {
  requestId: string
  workspaceId: string
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
  workspaceId: string
  viewerRole: 'admin' | 'executive'
  error?: string
  tierRequired?: string
}

const PAGE_SIZE = 25

export default function GovernanceAuditPage() {
  const [workspaceIdInput, setWorkspaceIdInput] = useState('')
  const [offset, setOffset] = useState(0)
  const [passedFilter, setPassedFilter] = useState<'' | 'true' | 'false'>('')
  const [data, setData] = useState<AuditResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (workspaceIdInput.trim()) params.set('workspaceId', workspaceIdInput.trim())
      if (passedFilter) params.set('passed', passedFilter)

      const res = await fetch(`/api/governance/audit?${params}`)
      const json = await res.json()

      if (!res.ok) {
        setError(json?.error ?? 'Failed to load audit trail')
        setData(null)
        return
      }
      setData(json)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load audit trail')
    } finally {
      setLoading(false)
    }
  }, [workspaceIdInput, offset, passedFilter])

  useEffect(() => { void load() }, [load])

  const stats = data?.stats

  return (
    <AdminShell
      title="Governance Audit Trail"
      subtitle="Every governance decision made during artifact generation — scores, pass/fail, repairs"
      titleColor={tokens.pink}
      actions={
        <button
          onClick={() => void load()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 8,
            border: `1px solid ${tokens.border}`,
            background: 'transparent', color: tokens.textMuted,
            cursor: 'pointer', fontSize: 13,
          }}
        >
          <RefreshCw style={{ width: 14, height: 14 }} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      }
    >
      {data?.source === 'memory' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 16px', borderRadius: 8, marginBottom: 16,
          background: `${tokens.warning}15`, border: `1px solid ${tokens.warning}40`,
          color: tokens.warning, fontSize: 13,
        }}>
          <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0 }} />
          Reading from the in-memory fallback buffer (process-local, capped, reset on
          restart) — the <code>brandos_governance_audit</code> table is not reachable.
          Apply <code>supabase/migrations/20260621_governance_audit.sql</code> for durable history.
        </div>
      )}

      {error && (
        <div style={{
          padding: '10px 16px', borderRadius: 8, marginBottom: 16,
          background: `${tokens.danger}15`, border: `1px solid ${tokens.danger}40`,
          color: tokens.danger, fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <AdminCard>
        <SectionTitle icon={ShieldCheck} color={tokens.pink}>Filters</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 16, alignItems: 'end' }}>
          <div>
            <div style={{ fontSize: 12, color: tokens.textMuted, marginBottom: 6, fontWeight: 600 }}>
              Workspace ID <span style={{ color: tokens.textDim }}>(blank = your own workspace)</span>
            </div>
            <input
              value={workspaceIdInput}
              onChange={e => { setWorkspaceIdInput(e.target.value); setOffset(0) }}
              placeholder="uuid…"
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 8,
                border: `1px solid ${tokens.border}`,
                background: tokens.bg, color: tokens.text, fontSize: 13,
                fontFamily: 'monospace',
              }}
            />
          </div>
          <SelectInput
            label="Outcome"
            value={passedFilter}
            onChange={v => { setPassedFilter(v as typeof passedFilter); setOffset(0) }}
            options={[
              { value: '', label: 'All' },
              { value: 'true', label: 'Passed' },
              { value: 'false', label: 'Failed' },
            ]}
          />
        </div>
      </AdminCard>

      {/* ── Stats ────────────────────────────────────────────────────────── */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, margin: '16px 0' }}>
          <StatCard label="Total Decisions" value={String(stats.totalDecisions)} sub="in current view" color={tokens.info} />
          <StatCard label="Pass Rate" value={`${stats.passRate}%`} sub="governance checks passed" color={tokens.success} />
          <StatCard label="Repair Rate" value={`${stats.repairRate}%`} sub="required auto-repair" color={tokens.warning} />
          <StatCard label="Avg Score" value={String(stats.avgScore)} sub="/ 100" color={tokens.purple} />
        </div>
      )}

      {/* ── Entries table ────────────────────────────────────────────────── */}
      <AdminCard>
        <SectionTitle icon={ShieldCheck} color={tokens.pink}>
          Decisions {data ? `(${data.total} total)` : ''}
        </SectionTitle>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: tokens.textDim, fontSize: 13 }}>Loading…</div>
        ) : !data || data.entries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: tokens.textDim, fontSize: 13 }}>
            No governance decisions recorded for this workspace yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${tokens.border}`, textAlign: 'left' }}>
                  {['Timestamp', 'Artifact Type', 'Score', 'Outcome', 'Repaired', 'Violations', 'Request ID'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', color: tokens.textMuted, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e, i) => (
                  <tr key={`${e.requestId}-${i}`} style={{ borderBottom: `1px solid ${tokens.borderSubtle}` }}>
                    <td style={{ padding: '8px 10px', color: tokens.textDim, whiteSpace: 'nowrap' }}>
                      {new Date(e.timestamp).toLocaleString()}
                    </td>
                    <td style={{ padding: '8px 10px', color: tokens.text, textTransform: 'capitalize' }}>{e.artifactType}</td>
                    <td style={{ padding: '8px 10px', color: tokens.text, fontVariantNumeric: 'tabular-nums' }}>{e.score}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <StatusBadge status={e.passed ? 'completed' : 'failed'} label={e.passed ? 'Passed' : 'Failed'} />
                    </td>
                    <td style={{ padding: '8px 10px', color: tokens.textDim }}>
                      {e.repaired ? `Yes (${e.repairAttempts})` : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', color: tokens.textDim, maxWidth: 280 }}>
                      {e.violations.length > 0 ? e.violations.join(', ') : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', color: tokens.textFaint, fontFamily: 'monospace', fontSize: 11 }}>
                      {e.requestId.slice(0, 8)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Pagination ──────────────────────────────────────────────────── */}
        {data && data.total > PAGE_SIZE && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 16 }}>
            <span style={{ fontSize: 12, color: tokens.textDim }}>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} of {data.total}
            </span>
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              style={{
                padding: 6, borderRadius: 6, border: `1px solid ${tokens.border}`,
                background: 'transparent', color: offset === 0 ? tokens.textFaint : tokens.textMuted,
                cursor: offset === 0 ? 'not-allowed' : 'pointer', display: 'flex',
              }}
            >
              <ChevronLeft style={{ width: 14, height: 14 }} />
            </button>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= data.total}
              style={{
                padding: 6, borderRadius: 6, border: `1px solid ${tokens.border}`,
                background: 'transparent',
                color: offset + PAGE_SIZE >= data.total ? tokens.textFaint : tokens.textMuted,
                cursor: offset + PAGE_SIZE >= data.total ? 'not-allowed' : 'pointer', display: 'flex',
              }}
            >
              <ChevronRight style={{ width: 14, height: 14 }} />
            </button>
          </div>
        )}
      </AdminCard>
    </AdminShell>
  )
}
