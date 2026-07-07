'use client'
/**
 * /admin — Platform Dashboard
 *
 * Lightweight overview page that replaces Control Plane as the admin landing.
 * Aggregates live health data from all contexts.
 * Owns ZERO configuration — it only displays.
 */

import * as React from 'react'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { AdminShell } from '@brandos/presentation-layer'
import { AdminCard, SectionTitle, StatCard, StatusBadge, tokens } from '@brandos/ui-admin'
import { Cpu, Package, Shield, Activity, CheckCircle, AlertCircle } from 'lucide-react'

interface DashboardData {
  runtime: {
    mode: string
    enabledProviders: number
    totalProviders: number
    healthyProviders: number
  }
  telemetry: {
    requestsToday: number
    successRate: number
    avgLatencyMs: number
  }
  governance: {
    complianceMode: string
    governanceMode: string
    bannedPhrases: number
  }
  artifacts: {
    enabledTypes: number
    enabledExports: number
    queueDepth: number
  }
}

const SECTIONS = [
  {
    href:  '/internal/admin/ai-runtime',
    label: 'AI Runtime',
    desc:  'Providers, routing, resilience',
    icon:  Cpu,
    color: tokens.purple,
    key:   'runtime' as const,
  },
  {
    href:  '/internal/admin/governance',
    label: 'Governance',
    desc:  'Policy, compliance, quality',
    icon:  Shield,
    color: tokens.pink,
    key:   'governance' as const,
  },
  {
    href:  '/internal/admin/artifact-engine',
    label: 'Artifact Engine',
    desc:  'Types, export, render pipeline',
    icon:  Package,
    color: tokens.success,
    key:   'artifacts' as const,
  },
  {
    href:  '/internal/admin/telemetry',
    label: 'Telemetry',
    desc:  'Live stats, experiments',
    icon:  Activity,
    color: tokens.info,
    key:   'telemetry' as const,
  },
]

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/v2/runtime/config').then(r => r.json()).catch(() => null),
      fetch('/api/v2/telemetry/stats').then(r => r.json()).catch(() => null),
      fetch('/api/v2/governance/policy').then(r => r.json()).catch(() => null),
      fetch('/api/v2/artifact/config').then(r => r.json()).catch(() => null),
    ]).then(([rt, tel, gov, art]) => {
      setData({
        runtime: {
          mode:             rt?.data?.runtimeMode ?? '—',
          enabledProviders: rt?.data?.providers?.filter((p: any) => p.enabled).length ?? 0,
          totalProviders:   rt?.data?.providers?.length ?? 0,
          healthyProviders: rt?.data?.providers?.filter((p: any) => p.health === 'healthy').length ?? 0,
        },
        telemetry: {
          requestsToday: tel?.data?.requestsToday ?? 0,
          successRate:   tel?.data?.successRate ?? 0,
          avgLatencyMs:  tel?.data?.avgLatencyMs ?? 0,
        },
        governance: {
          complianceMode: gov?.data?.complianceMode ?? '—',
          governanceMode: gov?.data?.governanceMode ?? '—',
          bannedPhrases:  gov?.data?.bannedPhrases?.length ?? 0,
        },
        artifacts: {
          enabledTypes:   art?.data?.enabledTypes?.length ?? 0,
          enabledExports: Object.values(art?.data?.exports ?? {}).filter(Boolean).length,
          queueDepth:     0,
        },
      })
    })
  }, [])

  return (
    <AdminShell
      title="Platform Admin"
      subtitle="BrandOS platform health overview"
      titleColor={tokens.info}
    >
      {/* Live stats bar */}
      <AdminCard style={{ marginBottom: 20 }}>
        <SectionTitle icon={Activity} color={tokens.info}>Live Platform Stats</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          <StatCard
            label="Requests Today"
            value={data ? data.telemetry.requestsToday.toLocaleString() : '—'}
            sub="last 24 hours"
            color={tokens.info}
          />
          <StatCard
            label="Success Rate"
            value={data ? `${data.telemetry.successRate.toFixed(1)}%` : '—'}
            sub="across all providers"
            color={tokens.success}
          />
          <StatCard
            label="Avg Latency"
            value={data ? `${data.telemetry.avgLatencyMs}ms` : '—'}
            sub="p50 across providers"
            color={tokens.purple}
          />
          <StatCard
            label="Active Providers"
            value={data ? `${data.runtime.enabledProviders}/${data.runtime.totalProviders}` : '—'}
            sub={`${data?.runtime.healthyProviders ?? 0} healthy`}
            color={tokens.warning}
          />
        </div>
      </AdminCard>

      {/* Section cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {SECTIONS.map(({ href, label, desc, icon: Icon, color, key }) => (
          <Link key={href} href={href} style={{ textDecoration: 'none' }}>
            <AdminCard style={{
              cursor: 'pointer', transition: 'border-color 0.15s',
              borderColor: tokens.border,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: `${color}18`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon style={{ width: 18, height: 18, color }} />
                </div>
                <span style={{ fontSize: 11, color: tokens.textDim }}>→</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: tokens.text, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 12, color: tokens.textDim, marginBottom: 12 }}>{desc}</div>

              {/* Context-specific summary */}
              {data && key === 'runtime' && (
                <div style={{ fontSize: 11, color: tokens.textMuted }}>
                  Mode: <span style={{ color }}>{data.runtime.mode}</span>
                  {' · '}{data.runtime.enabledProviders} providers enabled
                </div>
              )}
              {data && key === 'governance' && (
                <div style={{ fontSize: 11, color: tokens.textMuted }}>
                  {data.governance.complianceMode} compliance
                  {' · '}{data.governance.governanceMode} mode
                </div>
              )}
              {data && key === 'artifacts' && (
                <div style={{ fontSize: 11, color: tokens.textMuted }}>
                  {data.artifacts.enabledTypes} types enabled
                  {' · '}{data.artifacts.enabledExports} exports active
                </div>
              )}
              {data && key === 'telemetry' && (
                <div style={{ fontSize: 11, color: tokens.textMuted }}>
                  {data.telemetry.requestsToday.toLocaleString()} requests today
                </div>
              )}
            </AdminCard>
          </Link>
        ))}
      </div>
    </AdminShell>
  )
}


