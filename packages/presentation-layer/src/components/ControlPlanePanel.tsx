'use client'

/**
 * BrandOS — ControlPlanePanel
 *
 * The trust-building UI layer for the Enterprise Control Plane.
 * Shows: governance mode selector, live activity log, score badge,
 * routing info, retry count, cost estimate, override toggle.
 *
 * Drop into any workspace page:
 *   <ControlPlanePanel cpData={result.control_plane} isLoading={isLoading} />
 */

import { useState, useEffect, useRef } from 'react'
import type { ActivityEntry, OverrideMode, IntentAnalysis, QualityReport } from '@brandos/contracts'
import type { ControlPlaneData } from '../types/controlPlane'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ControlPlanePanelProps {
  cpData:         ControlPlaneData | null
  isLoading:      boolean
  overrideMode:   OverrideMode
  onModeChange:   (mode: OverrideMode) => void
  streamingLog?:  string[]
}

// ─── Override Mode Config ─────────────────────────────────────────────────────

const OVERRIDE_MODES: Array<{
  id: OverrideMode
  label: string
  desc: string
  color: string
}> = [
  { id: 'standard',   label: 'Standard',      desc: 'Full governance',     color: '#3b82f6' },
  { id: 'strict',     label: 'Strict',         desc: 'Max quality gates',   color: '#8b5cf6' },
  { id: 'fast',       label: 'Fast',           desc: 'Minimal checks',      color: '#f59e0b' },
  { id: 'cost_saver', label: 'Cost Saver',     desc: 'Prefer local/free',   color: '#10b981' },
  { id: 'premium',    label: 'Premium',        desc: 'Best model always',   color: '#ec4899' },
  { id: 'raw',        label: 'Raw Mode',       desc: 'Bypass governance',   color: '#6b7280' },
]

// ─── Score Badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ score, prev }: { score: number; prev?: number }) {
  const color = score >= 88 ? '#10b981' : score >= 78 ? '#3b82f6' : score >= 65 ? '#f59e0b' : '#ef4444'
  const label = score >= 88 ? 'Excellent' : score >= 78 ? 'Good' : score >= 65 ? 'Fair' : 'Low'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <div style={{
        position: 'relative',
        width: 56, height: 56,
      }}>
        <svg width="56" height="56" viewBox="0 0 56 56" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="28" cy="28" r="22" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
          <circle
            cx="28" cy="28" r="22" fill="none"
            stroke={color} strokeWidth="4"
            strokeDasharray={`${2 * Math.PI * 22}`}
            strokeDashoffset={`${2 * Math.PI * 22 * (1 - score / 100)}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color,
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {score}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Quality</div>
        <div style={{ fontSize: 13, fontWeight: 600, color }}>{label}</div>
        {prev !== undefined && prev !== score && (
          <div style={{ fontSize: 11, color: score > prev ? '#10b981' : '#ef4444' }}>
            {score > prev ? '↑' : '↓'} from {prev}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Activity Log ─────────────────────────────────────────────────────────────

function ActivityLogView({ entries, streaming }: { entries?: ActivityEntry[]; streaming?: string[]; children?: React.ReactNode }) {
  if (!entries) return null;
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries, streaming])

  const allLines = [
    ...entries.map(e => ({
      ts: new Date(e.timestamp).toLocaleTimeString('en-US', { hour12: false }),
      level: e.level,
      msg: e.message,
    })),
    ...(streaming || []).map(msg => ({ ts: '...', level: 'info' as const, msg })),
  ]

  const levelColor: Record<string, string> = {
    info:    'rgba(255,255,255,0.55)',
    success: '#10b981',
    warn:    '#f59e0b',
    error:   '#ef4444',
  }

  const levelIcon: Record<string, string> = {
    info:    '◦',
    success: '✓',
    warn:    '⚠',
    error:   '✗',
  }

  return (
    <div
      ref={scrollRef}
      style={{
        height: 220,
        overflowY: 'auto',
        background: '#0a0a0f',
        borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.06)',
        padding: '12px 14px',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 11.5,
      }}
    >
      {allLines.length === 0 ? (
        <div style={{ color: 'rgba(255,255,255,0.2)', padding: '60px 0', textAlign: 'center' }}>
          Awaiting request...
        </div>
      ) : (
        allLines.map((line, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 3, alignItems: 'flex-start' }}>
            <span style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0, fontSize: 10 }}>[{line.ts}]</span>
            <span style={{ color: levelColor[line.level] ?? levelColor.info, flexShrink: 0 }}>
              {levelIcon[line.level] ?? '◦'}
            </span>
            <span style={{ color: levelColor[line.level] ?? levelColor.info, lineHeight: 1.5 }}>
              {line.msg}
            </span>
          </div>
        ))
      )}
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function ControlPlanePanel({
  cpData,
  isLoading,
  overrideMode,
  onModeChange,
  streamingLog = [],
}: ControlPlanePanelProps) {
  const [expanded, setExpanded] = useState(true)
  const [activeTab, setActiveTab] = useState<'log' | 'details' | 'routing'>('log')

  const selectedMode =
  OVERRIDE_MODES.find(m => m.id === overrideMode)
  ?? OVERRIDE_MODES[0]!

  return (
    <div style={{
      background: 'linear-gradient(135deg, #0f1117 0%, #13141e 100%)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12,
      overflow: 'hidden',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', cursor: 'pointer',
          borderBottom: expanded ? '1px solid rgba(255,255,255,0.06)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: isLoading ? '#f59e0b' : cpData ? '#10b981' : '#3b82f6',
            boxShadow: isLoading ? '0 0 8px #f59e0b' : cpData ? '0 0 8px #10b981' : '0 0 8px #3b82f6',
            animation: isLoading ? 'pulse 1s ease-in-out infinite' : 'none',
          }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.02em' }}>
            CONTROL PLANE
          </span>
          {isLoading && (
            <span style={{ fontSize: 10, color: '#f59e0b', fontFamily: 'monospace' }}>PROCESSING…</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {cpData && (
            <>
              {/* Score pill */}
              <div style={{
                fontSize: 11, fontWeight: 700,
                color: (cpData.final_score ?? 0) >= 85 ? '#10b981' : (cpData.final_score ?? 0) >= 70 ? '#f59e0b' : '#ef4444',
                background: (cpData.final_score ?? 0) >= 85 ? 'rgba(16,185,129,0.1)' : (cpData.final_score ?? 0) >= 70 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                border: `1px solid ${(cpData.final_score ?? 0) >= 85 ? 'rgba(16,185,129,0.3)' : (cpData.final_score ?? 0) >= 70 ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'}`,
                borderRadius: 20, padding: '2px 10px',
                fontFamily: 'monospace',
              }}>
                {cpData.final_score ?? 0}/100
              </div>

              {/* Retry badge */}
              {(cpData.retries ?? 0) > 0 && (
                <div style={{
                  fontSize: 10, color: '#f59e0b',
                  background: 'rgba(245,158,11,0.1)',
                  border: '1px solid rgba(245,158,11,0.25)',
                  borderRadius: 20, padding: '2px 8px',
                  fontFamily: 'monospace',
                }}>
                  {cpData.retries ?? 0} retry
                </div>
              )}
            </>
          )}

          {/* Mode pill */}
          <div style={{
            fontSize: 10, fontWeight: 600,
            color: selectedMode.color,
            background: `${selectedMode.color}18`,
            border: `1px solid ${selectedMode.color}40`,
            borderRadius: 20, padding: '2px 9px',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {selectedMode.label}
          </div>

          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>
            {expanded ? '▲' : '▼'}
          </span>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {expanded && (
        <div style={{ padding: 16 }}>

          {/* ── Governance Mode Selector ──────────────────────────────────── */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Governance Mode
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {OVERRIDE_MODES.map(mode => (
                <button
                  key={mode.id}
                  onClick={() => onModeChange(mode.id)}
                  title={mode.desc}
                  style={{
                    padding: '5px 11px',
                    borderRadius: 6,
                    border: `1px solid ${overrideMode === mode.id ? mode.color : 'rgba(255,255,255,0.1)'}`,
                    background: overrideMode === mode.id ? `${mode.color}20` : 'transparent',
                    color: overrideMode === mode.id ? mode.color : 'rgba(255,255,255,0.45)',
                    fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    letterSpacing: '0.03em',
                  }}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Score + Stats Row ─────────────────────────────────────────── */}
          {cpData && (
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
              gap: 8, marginBottom: 14,
            }}>
              {[
                { label: 'Score', value: `${cpData.final_score ?? 0}/100`, color: (cpData.final_score ?? 0) >= 85 ? '#10b981' : '#f59e0b' },
                { label: 'Retries', value: String(cpData.retries ?? 0), color: (cpData.retries ?? 0) > 0 ? '#f59e0b' : '#10b981' },
                {
  label: 'Routing',
  value: cpData.routing?.preferred_tiers?.join(', ') ?? '—',
  color: '#3b82f6'
},
                {
  label: 'Max Cost',
  value: cpData.routing?.max_cost_usd
    ? `$${cpData.routing.max_cost_usd}`
    : '—',
  color: '#8b5cf6'
},
              ].map(stat => (
                <div key={stat.label} style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 8, padding: '8px 10px',
                }}>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
                    {stat.label}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: stat.color, fontFamily: 'monospace' }}>
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Tabs ─────────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {(['log', 'details', 'routing'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '6px 14px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `2px solid ${activeTab === tab ? '#3b82f6' : 'transparent'}`,
                  color: activeTab === tab ? '#3b82f6' : 'rgba(255,255,255,0.35)',
                  fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  textTransform: 'uppercase', letterSpacing: '0.07em',
                  transition: 'all 0.15s',
                  marginBottom: -1,
                }}
              >
                {tab === 'log' ? 'Activity Log' : tab === 'details' ? 'Quality' : 'Routing'}
              </button>
            ))}
          </div>

          {/* ── Activity Log Tab ──────────────────────────────────────────── */}
          {activeTab === 'log' && (
            <ActivityLogView
              entries={cpData?.activity_log ?? []}
              streaming={isLoading ? streamingLog : []}
            />
          )}

          {/* ── Quality Tab ───────────────────────────────────────────────── */}
          {activeTab === 'details' && cpData && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>
              {(cpData.fixes_applied ?? []).length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ color: '#10b981', fontWeight: 600, marginBottom: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    ✓ Auto-Fixed ({(cpData.fixes_applied ?? []).length})
                  </div>
                  {(cpData.fixes_applied ?? []).map((fix, i) => (
                    <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingLeft: 8 }}>
                      {fix}
                    </div>
                  ))}
                </div>
              )}
              {(cpData.flags_remaining ?? []).length > 0 && (
                <div>
                  <div style={{ color: '#f59e0b', fontWeight: 600, marginBottom: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    ⚠ Needs Review ({(cpData.flags_remaining ?? []).length})
                  </div>
                  {(cpData.flags_remaining ?? []).map((flag, i) => (
                    <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingLeft: 8 }}>
                      {flag}
                    </div>
                  ))}
                </div>
              )}
              {(cpData.fixes_applied ?? []).length === 0 && (cpData.flags_remaining ?? []).length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: '#10b981' }}>
                  ✓ No quality issues detected
                </div>
              )}
            </div>
          )}

          {/* ── Routing Tab ───────────────────────────────────────────────── */}
          {activeTab === 'routing' && (
            <div style={{ fontSize: 12 }}>
              {cpData?.routing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
  {
    label: 'Preferred Tiers',
    value: cpData.routing.preferred_tiers?.join(", ") ?? '—'
  },
  {
    label: 'Reason',
    value: cpData.routing.reason ?? '—'
  },
  {
    label: 'Max Latency',
    value: cpData.routing.max_latency_ms
      ? `${cpData.routing.max_latency_ms}ms`
      : '—'
  },
  {
    label: 'Max Cost',
    value: cpData.routing.max_cost_usd
      ? `$${cpData.routing.max_cost_usd}`
      : '—'
  },
  {
    label: 'Quality Floor',
    value: cpData.routing.min_quality_ceiling ?? '—'
  },
  {
    label: 'Forced Provider',
    value: cpData.routing.forceProvider ?? 'none'
  },
].map(row => (
                    <div key={row.label} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                      padding: '7px 10px',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: 6,
                    }}>
                      <span style={{ color: 'rgba(255,255,255,0.35)', flexShrink: 0, marginRight: 12 }}>{row.label}</span>
                      <span style={{ color: 'rgba(255,255,255,0.8)', textAlign: 'right', fontSize: 11 }}>{row.value}</span>
                    </div>
                  ))}
                  {cpData.intent && (
                    <div style={{
                      marginTop: 4, padding: '7px 10px',
                      background: 'rgba(59,130,246,0.06)',
                      border: '1px solid rgba(59,130,246,0.15)',
                      borderRadius: 6, fontSize: 11, color: '#93c5fd',
                    }}>
                      Intent: <strong>{cpData.intent.detected_task}</strong> —{' '}
                      {Math.round(cpData.intent.confidence * 100)}% confidence
                      {cpData.intent.ambiguity_level !== 'low' && ` · ${cpData.intent.ambiguity_level} ambiguity`}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ padding: '20px', textAlign: 'center', color: 'rgba(255,255,255,0.25)' }}>
                  No routing data yet
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}


