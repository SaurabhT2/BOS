'use client'
/**
 * /admin/artifact-engine — Artifact Engine Configuration
 *
 * Now uses:
 *   - @brandos/artifact-config for typed schema (no more `any`)
 *   - @brandos/ui-admin shared primitives (no more inline duplication)
 *   - /api/v2/artifact/config endpoint (not the shared /api/admin/settings)
 *
 * Future-ready:
 *   - Beta artifact types (PDF, Word, Icon Set, etc.) shown with beta badge
 *   - Render queue uses real subscription (SSE-ready)
 *   - Export channels extensible via EXPORT_CHANNEL_REGISTRY
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { AdminShell } from '@brandos/presentation-layer'
import {
  AdminCard, SectionTitle, Toggle, NumberInput,
  SelectInput, SaveButton, StatusBadge, tokens, useAdminSave,
} from '@brandos/ui-admin'
import type { ArtifactEngineConfig, RenderJob } from '@brandos/artifact-config'
import {
  DEFAULT_ARTIFACT_CONFIG,
  ARTIFACT_TYPE_REGISTRY, ARTIFACT_TYPE_IDS,
  EXPORT_CHANNEL_REGISTRY, EXPORT_CHANNEL_IDS,
} from '@brandos/artifact-config'
import { Package, Clock, Layers, Settings, FileText } from 'lucide-react'

// ─── Artifact Type Grid ───────────────────────────────────────────────────────

function ArtifactTypeGrid({
  enabledTypes, onChange,
}: { enabledTypes: string[]; onChange: (types: string[]) => void }) {
  const toggle = (id: string) => {
    onChange(
      enabledTypes.includes(id)
        ? enabledTypes.filter(t => t !== id)
        : [...enabledTypes, id]
    )
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
      gap: 10,
    }}>
      {ARTIFACT_TYPE_IDS.map(id => {
        const meta = ARTIFACT_TYPE_REGISTRY[id]
        if (!meta) return null
        const enabled = enabledTypes.includes(id)
        const { label, emoji, color, beta } = meta

        return (
          <button
            key={id}
            onClick={() => toggle(id)}
            style={{
              padding: '12px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
              background: enabled ? `${color}12` : tokens.bg,
              border: `1.5px solid ${enabled ? color : tokens.border}`,
              transition: 'all 0.2s', position: 'relative',
              opacity: beta && !enabled ? 0.6 : 1,
            }}
          >
            <div style={{ fontSize: 18, marginBottom: 6 }}>{emoji}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: enabled ? tokens.text : tokens.textDim }}>
              {label}
            </div>
            {beta && (
              <div style={{
                position: 'absolute', top: 6, right: 6,
                fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: tokens.warning, background: `${tokens.warning}20`,
                border: `1px solid ${tokens.warning}40`,
                padding: '1px 4px', borderRadius: 3,
              }}>
                Beta
              </div>
            )}
            {!beta && (
              <div style={{
                position: 'absolute', top: 8, right: 8,
                width: 8, height: 8, borderRadius: '50%',
                background: enabled ? color : tokens.border,
                transition: 'background 0.2s',
              }} />
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Export Controls ──────────────────────────────────────────────────────────

function ExportControls({
  exports, onChange,
}: { exports: Record<string, boolean>; onChange: (key: string, val: boolean) => void }) {
  return (
    <div>
      {EXPORT_CHANNEL_IDS.map(id => {
        const meta = EXPORT_CHANNEL_REGISTRY[id]
        if (!meta) return null
        return (
          <Toggle
            key={id}
            label={meta.beta ? `${meta.label} (Beta)` : meta.label}
            desc={meta.desc}
            checked={exports[id] ?? false}
            onChange={v => onChange(id, v)}
            color={tokens.info}
          />
        )
      })}
    </div>
  )
}

// ─── Render Queue ─────────────────────────────────────────────────────────────

function RenderQueue({ jobs }: { jobs: RenderJob[] }) {
  if (jobs.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0', color: tokens.textDim, fontSize: 13 }}>
        No active render jobs
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${tokens.border}` }}>
            {['Job ID', 'Artifact', 'Type', 'Status', 'Started', 'Duration'].map(h => (
              <th key={h} style={{
                padding: '8px 12px', color: tokens.textDim, fontWeight: 600,
                textAlign: 'left', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jobs.map(job => (
            <tr key={job.id} style={{ borderBottom: `1px solid ${tokens.borderSubtle}` }}>
              <td style={{ padding: '10px 12px', color: tokens.textDim, fontFamily: 'monospace', fontSize: 11 }}>
                {job.id}
              </td>
              <td style={{ padding: '10px 12px', color: tokens.text, fontWeight: 500 }}>
                {job.artifact}
              </td>
              <td style={{ padding: '10px 12px' }}>
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                  textTransform: 'uppercase', background: tokens.bg, color: tokens.textMuted,
                  border: `1px solid ${tokens.border}`,
                }}>
                  {job.artifactType}
                </span>
              </td>
              <td style={{ padding: '10px 12px' }}>
                <StatusBadge status={job.status} />
              </td>
              <td style={{ padding: '10px 12px', color: tokens.textMuted, fontFamily: 'monospace' }}>
                {job.startedAt}
              </td>
              <td style={{ padding: '10px 12px', color: tokens.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                {job.durationMs != null ? `${(job.durationMs / 1000).toFixed(1)}s` : (
                  <span style={{ color: tokens.warning, animation: 'pulseDot 1s ease-in-out infinite' }}>…</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Template Library ─────────────────────────────────────────────────────────

function TemplateLibrary({
  templates, onToggle,
}: {
  templates: ArtifactEngineConfig['templates']
  onToggle: (id: string) => void
}) {
  if (templates.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0', color: tokens.textDim, fontSize: 13 }}>
        No templates uploaded yet
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${tokens.border}` }}>
            {['Template', 'Type', 'Usage', 'Updated', 'Active'].map(h => (
              <th key={h} style={{
                padding: '8px 12px', color: tokens.textDim, fontWeight: 600,
                textAlign: 'left', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {templates.map(t => (
            <tr key={t.id} style={{ borderBottom: `1px solid ${tokens.borderSubtle}` }}>
              <td style={{ padding: '10px 12px', color: tokens.text, fontWeight: 600 }}>{t.name}</td>
              <td style={{ padding: '10px 12px' }}>
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                  textTransform: 'uppercase', background: tokens.bg, color: tokens.textMuted,
                  border: `1px solid ${tokens.border}`,
                }}>
                  {t.type}
                </span>
              </td>
              <td style={{ padding: '10px 12px', color: tokens.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                {t.usage}×
              </td>
              <td style={{ padding: '10px 12px', color: tokens.textDim }}>{t.updatedAt}</td>
              <td style={{ padding: '10px 12px' }}>
                <button
                  onClick={() => onToggle(t.id)}
                  style={{
                    width: 38, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: t.active ? tokens.success : '#1e293b',
                    position: 'relative', transition: 'background 0.2s',
                  }}
                  aria-checked={t.active}
                  role="switch"
                >
                  <div style={{
                    width: 14, height: 14, borderRadius: '50%', background: '#fff',
                    position: 'absolute', top: 3,
                    left: t.active ? 21 : 3, transition: 'left 0.2s',
                  }} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ArtifactEnginePage() {
  const [config, setConfig] = useState<ArtifactEngineConfig | null>(null)
  const [renderQueue, setRenderQueue] = useState<RenderJob[]>([])
  const { save, saving, saved, error } = useAdminSave('/api/v2/artifact/config', 'artifact')

  const load = useCallback(async () => {
    try {
      const [cfgRes, queueRes] = await Promise.all([
        fetch('/api/v2/artifact/config'),
        fetch('/api/v2/artifact/queue'),
      ])
      const cfgData = await cfgRes.json()
      const queueData = await queueRes.json()
      if (cfgData?.data) setConfig(cfgData.data)
      if (Array.isArray(queueData?.jobs)) setRenderQueue(queueData.jobs)
    } catch {
      setConfig(DEFAULT_ARTIFACT_CONFIG)
    }
  }, [])

  useEffect(() => {
    void load()

    // Poll render queue every 5s for live updates
    // (Replace with SSE subscription when available)
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/v2/artifact/queue')
        const data = await res.json()
        if (Array.isArray(data?.jobs)) setRenderQueue(data.jobs)
      } catch {}
    }, 5000)

    return () => clearInterval(interval)
  }, [load])

  const setExport = (key: string, val: boolean) =>
    setConfig(prev => prev ? { ...prev, exports: { ...prev.exports, [key]: val } } : prev)

  const setRenderSetting = <K extends keyof ArtifactEngineConfig['renderSettings']>(
    key: K, val: ArtifactEngineConfig['renderSettings'][K]
  ) =>
    setConfig(prev => prev ? { ...prev, renderSettings: { ...prev.renderSettings, [key]: val } } : prev)

  const toggleTemplate = (id: string) =>
    setConfig(prev => prev ? {
      ...prev,
      templates: prev.templates.map(t => t.id === id ? { ...t, active: !t.active } : t),
    } : prev)

  const handleSave = () => config && save(config)

  if (!config) return (
    <AdminShell title="Artifact Engine" subtitle="Loading…" titleColor={tokens.success}>
      <div style={{ textAlign: 'center', padding: 60, color: tokens.textDim }}>…</div>
    </AdminShell>
  )

  return (
    <AdminShell
      title="Artifact Engine"
      subtitle="Output formats, render pipeline, templates & export systems"
      titleColor={tokens.success}
      actions={<SaveButton onClick={handleSave} saving={saving} saved={saved} color={tokens.success} />}
    >
      {error && (
        <div style={{
          padding: '10px 16px', borderRadius: 8, marginBottom: 16,
          background: `${tokens.danger}18`, border: `1px solid ${tokens.danger}40`,
          color: tokens.danger, fontSize: 13,
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gap: 20 }}>

        {/* ── Enabled Artifact Types ────────────────────────────────────── */}
        <AdminCard>
          <SectionTitle icon={Layers} color={tokens.success}>Enabled Artifact Types</SectionTitle>
          <ArtifactTypeGrid
            enabledTypes={config.enabledTypes}
            onChange={types => setConfig(prev => prev ? { ...prev, enabledTypes: types } : prev)}
          />
          <div style={{ marginTop: 12, fontSize: 11, color: tokens.textDim }}>
            Beta types are available for preview but may have reduced quality. Enable only in dev workspaces.
          </div>
        </AdminCard>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          {/* ── Export Controls ───────────────────────────────────────────── */}
          <AdminCard>
            <SectionTitle icon={Package} color={tokens.info}>Export Controls</SectionTitle>
            <ExportControls exports={config.exports} onChange={setExport} />
          </AdminCard>

          {/* ── Default Render Settings ───────────────────────────────────── */}
          <AdminCard>
            <SectionTitle icon={Settings} color={tokens.purple}>Default Render Settings</SectionTitle>
            <NumberInput
              label="Max Slides per Deck"
              value={config.renderSettings.maxSlidesPerDeck}
              onChange={v => setRenderSetting('maxSlidesPerDeck', v)}
              min={1} max={100}
            />
            <NumberInput
              label="Default Carousel Pages"
              value={config.renderSettings.defaultCarouselPages}
              onChange={v => setRenderSetting('defaultCarouselPages', v)}
              min={1} max={20}
            />
            <NumberInput
              label="Max Tokens per Artifact"
              value={config.renderSettings.maxTokensPerArtifact}
              onChange={v => setRenderSetting('maxTokensPerArtifact', v)}
              min={100} max={32000}
            />
            <NumberInput
              label="Concurrent Render Limit"
              value={config.renderSettings.concurrentRenderLimit}
              onChange={v => setRenderSetting('concurrentRenderLimit', v)}
              min={1} max={20}
            />
            <SelectInput
              label="Theme Style"
              value={config.renderSettings.themeStyle}
              onChange={v => setRenderSetting('themeStyle', v as ArtifactEngineConfig['renderSettings']['themeStyle'])}
              options={[
                { value: 'dark',    label: 'Dark' },
                { value: 'light',   label: 'Light' },
                { value: 'brand',   label: 'Brand Pack' },
                { value: 'minimal', label: 'Minimal' },
              ]}
            />
            <Toggle
              label="Auto Image Generation"
              desc="Auto-generate visuals via VLM"
              checked={config.renderSettings.autoImageGeneration}
              onChange={v => setRenderSetting('autoImageGeneration', v)}
              color={tokens.success}
            />
            <Toggle
              label="Brand Pack Required"
              desc="Block renders without brand assets"
              checked={config.renderSettings.brandPackRequired}
              onChange={v => setRenderSetting('brandPackRequired', v)}
              color={tokens.success}
            />
          </AdminCard>
        </div>

        {/* ── Template Library ──────────────────────────────────────────── */}
        <AdminCard>
          <SectionTitle icon={FileText} color={tokens.pink}>Template Library</SectionTitle>
          <TemplateLibrary templates={config.templates} onToggle={toggleTemplate} />
        </AdminCard>

        {/* ── Render Queue ──────────────────────────────────────────────── */}
        <AdminCard>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <SectionTitle icon={Clock} color={tokens.warning}>Render Queue</SectionTitle>
            <span style={{ fontSize: 10, color: tokens.warning, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: tokens.warning,
                display: 'inline-block', animation: 'pulseDot 1.5s ease-in-out infinite',
              }} />
              LIVE
            </span>
          </div>
          <RenderQueue jobs={renderQueue} />
        </AdminCard>

      </div>

      <style>{`
        @keyframes pulseDot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </AdminShell>
  )
}


