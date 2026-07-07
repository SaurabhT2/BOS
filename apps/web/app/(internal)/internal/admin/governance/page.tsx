'use client'
/**
 * /admin/governance — Governance & Policy Administration
 *
 * SINGLE SOURCE OF TRUTH for all compliance, quality, and governance rules.
 *
 * MERGED FROM:
 *   - /admin/control-plane  (Safety & Quality section, Approval Flow section)
 *   - Screen 4              (Policy Administration — entire standalone page)
 *
 * ELIMINATED DUPLICATIONS:
 *   - brandSafetyMode / safetyMode (was split across Control Plane + AI Runtime)
 *   - scoreThreshold (was in both Control Plane + AI Runtime Resilience)
 *   - approvalRequired toggles (was in Control Plane, now here only)
 *
 * API: POST/GET /api/v2/governance/policy
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { AdminShell } from '@brandos/presentation-layer'
import {
  AdminCard, SectionTitle, Toggle, NumberInput,
  SelectInput, SaveButton, SegmentedControl,
  StatusBadge, tokens, useAdminSave,
} from '@brandos/ui-admin'
import type { PolicyConfig } from '@brandos/governance-config'
import { DEFAULT_POLICY_CONFIG, TASK_TYPES, validatePolicyPatch } from '@brandos/governance-config'
import {
  Shield, Sliders, CheckCircle, AlertTriangle,
  Lock, Plus, X, FileText,
} from 'lucide-react'

// ─── Score Threshold Slider ───────────────────────────────────────────────────

function ScoreSlider({
  task, value, onChange,
}: { task: string; value: number; onChange: (v: number) => void }) {
  const color = value >= 85 ? tokens.success : value >= 70 ? tokens.info : tokens.warning
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 36px', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <span style={{ fontSize: 12, color: tokens.textMuted, textTransform: 'capitalize' }}>{task}</span>
      <div style={{ position: 'relative', height: 6, borderRadius: 3, background: '#1e293b' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${value}%`, borderRadius: 3, background: color,
          transition: 'width 0.15s',
        }} />
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{
            position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%',
          }}
        />
      </div>
      <span style={{
        fontSize: 13, color, fontWeight: 700,
        fontVariantNumeric: 'tabular-nums', textAlign: 'right',
      }}>
        {value}
      </span>
    </div>
  )
}

// ─── Banned Phrase Input ──────────────────────────────────────────────────────

function BannedPhraseManager({
  phrases, onChange,
}: { phrases: string[]; onChange: (p: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const add = () => {
    const trimmed = draft.trim()
    if (!trimmed || phrases.includes(trimmed)) return
    onChange([...phrases, trimmed])
    setDraft('')
    inputRef.current?.focus()
  }

  const remove = (phrase: string) => onChange(phrases.filter(p => p !== phrase))

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Add banned phrase…"
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 8,
            border: `1px solid ${tokens.border}`,
            background: tokens.bg, color: tokens.text, fontSize: 13,
          }}
        />
        <button
          onClick={add}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none',
            background: '#7c3aed', color: '#fff',
            cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}
        >
          Add
        </button>
      </div>
      {phrases.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {phrases.map(p => (
            <span
              key={p}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 6,
                background: `${tokens.danger}18`,
                border: `1px solid ${tokens.danger}40`,
                color: tokens.danger, fontSize: 12,
              }}
            >
              {p}
              <button
                onClick={() => remove(p)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, display: 'flex' }}
              >
                <X style={{ width: 10, height: 10 }} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GovernancePage() {
  const [config, setConfig] = useState<PolicyConfig | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const { save, saving, saved, error: saveError } = useAdminSave('/api/v2/governance/policy', 'governance')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v2/governance/policy')
      const json = await res.json()
      // API returns { ok: true, data: PolicyConfig }
      setConfig(json?.data ?? DEFAULT_POLICY_CONFIG)
    } catch {
      setConfig(DEFAULT_POLICY_CONFIG)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const set = <K extends keyof PolicyConfig>(key: K, val: PolicyConfig[K]) =>
    setConfig(prev => prev ? { ...prev, [key]: val } : prev)

  const setQuality = (key: string, val: unknown) =>
    setConfig(prev => prev ? { ...prev, quality: { ...prev.quality, [key]: val } } : prev)

  const setModelGov = (key: string, val: unknown) =>
    setConfig(prev => prev ? { ...prev, modelGovernance: { ...prev.modelGovernance, [key]: val } } : prev)

  const setApproval = (key: string, val: unknown) =>
    setConfig(prev => prev ? { ...prev, approvalGates: { ...prev.approvalGates, [key]: val } } : prev)

  const setThreshold = (task: string, val: number) =>
    setConfig(prev => prev ? { ...prev, scoreThresholds: { ...prev.scoreThresholds, [task]: val } } : prev)

  const handleSave = () => {
    if (!config) return
    const result = validatePolicyPatch(config)
    if (!result.valid) {
      setValidationErrors(result.errors)
      return
    }
    setValidationErrors([])
    save(config)
  }

  if (!config) return (
    <AdminShell title="Governance" subtitle="Loading…" titleColor={tokens.purple}>
      <div style={{ textAlign: 'center', padding: 60, color: tokens.textDim }}>…</div>
    </AdminShell>
  )

  return (
    <AdminShell
      title="Governance & Policy"
      subtitle="Enterprise governance rules — compliance, quality thresholds, approval gates, content controls"
      titleColor={tokens.purple}
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <a
            href="/internal/admin/governance/audit"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 8,
              border: `1px solid ${tokens.border}`,
              color: tokens.textMuted, fontSize: 13, textDecoration: 'none',
            }}
          >
            View Audit Trail
          </a>
          <SaveButton onClick={handleSave} saving={saving} saved={saved} color={tokens.purple} />
        </div>
      }
    >
      {(validationErrors.length > 0 || saveError) && (
        <div style={{
          padding: '10px 16px', borderRadius: 8, marginBottom: 16,
          background: `${tokens.danger}18`, border: `1px solid ${tokens.danger}40`,
          color: tokens.danger, fontSize: 13,
        }}>
          {validationErrors.length > 0
            ? validationErrors.map((e, i) => <div key={i}>{e}</div>)
            : saveError
          }
        </div>
      )}

      <div style={{ display: 'grid', gap: 20 }}>

        {/* ── Model & Provider Governance ──────────────────────────────────── */}
        <AdminCard>
          <SectionTitle icon={Lock} color={tokens.purple}>Model & Provider Governance</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <Toggle
                label="Cloud providers only"
                desc="Disallow local/Ollama models"
                checked={config.modelGovernance.cloudProvidersOnly}
                onChange={v => setModelGov('cloudProvidersOnly', v)}
                color={tokens.purple}
              />
              <Toggle
                label="Local models only"
                desc="Disallow cloud API calls"
                checked={config.modelGovernance.localModelsOnly}
                onChange={v => setModelGov('localModelsOnly', v)}
                color={tokens.purple}
              />
              {config.modelGovernance.cloudProvidersOnly && config.modelGovernance.localModelsOnly && (
                <div style={{
                  marginTop: 8, padding: '6px 10px', borderRadius: 6,
                  background: `${tokens.danger}18`, border: `1px solid ${tokens.danger}40`,
                  color: tokens.danger, fontSize: 11,
                }}>
                  ⚠ Both constraints active — all requests will fail.
                </div>
              )}
            </div>
            <div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: tokens.textDim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 6 }}>
                  Denied Models (comma-separated)
                </label>
                <input
                  value={config.modelGovernance.deniedModels.join(', ')}
                  onChange={e => setModelGov('deniedModels', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  placeholder="e.g. openai/gpt-3.5-turbo"
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 8,
                    border: `1px solid ${tokens.border}`,
                    background: tokens.bg, color: tokens.text, fontSize: 13, boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: tokens.textDim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 6 }}>
                  Allowed Providers (empty = all)
                </label>
                <input
                  value={config.modelGovernance.allowedProviders.join(', ')}
                  onChange={e => setModelGov('allowedProviders', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  placeholder="e.g. openai, anthropic"
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 8,
                    border: `1px solid ${tokens.border}`,
                    background: tokens.bg, color: tokens.text, fontSize: 13, boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          </div>
        </AdminCard>

        {/* ── Quality Config ───────────────────────────────────────────────── */}
        <AdminCard>
          <SectionTitle icon={Shield} color={tokens.warning}>Quality & Safety</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <Toggle
                label="Hallucination Guard"
                desc="Validate factual consistency before output"
                checked={config.quality.hallucinationGuard}
                onChange={v => setQuality('hallucinationGuard', v)}
                color={tokens.warning}
              />
              <Toggle
                label="Auto Regenerate if Below Threshold"
                desc="Re-run if quality score fails"
                checked={config.quality.autoRegenerate}
                onChange={v => setQuality('autoRegenerate', v)}
                color={tokens.warning}
              />
              <NumberInput
                label="Score Threshold (global)"
                value={config.quality.scoreThreshold}
                onChange={v => setQuality('scoreThreshold', v)}
                min={0}
                max={100}
                unit="/ 100"
              />
            </div>
            <div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: tokens.textMuted, marginBottom: 8, fontWeight: 600 }}>
                  Brand Safety Mode
                </div>
                <SegmentedControl
                  value={config.quality.brandSafetyMode}
                  onChange={v => setQuality('brandSafetyMode', v as 'off' | 'standard' | 'strict')}
                  color={tokens.warning}
                  options={[
                    { value: 'off', label: 'Off', desc: 'No safety filtering' },
                    { value: 'standard', label: 'Standard', desc: 'Standard brand-safe filters' },
                    { value: 'strict', label: 'Strict', desc: 'All outputs reviewed' },
                  ]}
                />
                <div style={{ marginTop: 8, fontSize: 11, color: tokens.textDim }}>
                  {config.quality.brandSafetyMode === 'strict'
                    ? 'All outputs reviewed before delivery. May increase latency.'
                    : config.quality.brandSafetyMode === 'standard'
                    ? 'Standard brand-safety filters active on all generations.'
                    : 'Safety filters disabled. Use only in trusted environments.'}
                </div>
              </div>
            </div>
          </div>
        </AdminCard>

        {/* ── Score Thresholds by Task Type ────────────────────────────────── */}
        <AdminCard>
          <SectionTitle icon={Sliders} color={tokens.info}>Score Thresholds by Task Type</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 40px' }}>
            {TASK_TYPES.map(task => (
              <ScoreSlider
                key={task}
                task={task}
                value={config.scoreThresholds[task] ?? 70}
                onChange={v => setThreshold(task, v)}
              />
            ))}
          </div>
          <div style={{ fontSize: 11, color: tokens.textDim, marginTop: 8, borderTop: `1px solid ${tokens.borderSubtle}`, paddingTop: 10 }}>
            Per-task thresholds override the global threshold above. Generations scoring below threshold trigger auto-regeneration if enabled.
          </div>
        </AdminCard>

        {/* ── Approval Gates ────────────────────────────────────────────────── */}
        <AdminCard>
          <SectionTitle icon={CheckCircle} color={tokens.success}>Approval Gates & Retry Policy</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <Toggle
                label="Require publishing approval"
                desc="Human must approve before output is published"
                checked={config.approvalGates.requirePublishingApproval}
                onChange={v => setApproval('requirePublishingApproval', v)}
                color={tokens.success}
              />
              <Toggle
                label="Require approval for high-risk content"
                checked={config.approvalGates.requireApprovalForHighRisk}
                onChange={v => setApproval('requireApprovalForHighRisk', v)}
                color={tokens.success}
              />
              <Toggle
                label="Require approval for long articles (>2000w)"
                checked={config.approvalGates.requireApprovalForLongArticle}
                onChange={v => setApproval('requireApprovalForLongArticle', v)}
                color={tokens.success}
              />
              <Toggle
                label="Require approval for external publish"
                checked={config.approvalGates.requireApprovalForExternalPublish}
                onChange={v => setApproval('requireApprovalForExternalPublish', v)}
                color={tokens.success}
              />
            </div>
            <div>
              <NumberInput
                label="Max Retries (0–10)"
                value={config.approvalGates.maxRetries}
                onChange={v => setApproval('maxRetries', v)}
                min={0}
                max={10}
              />
              <Toggle
                label="Retry escalation"
                desc="Use better model on each retry"
                checked={config.approvalGates.retryEscalation}
                onChange={v => setApproval('retryEscalation', v)}
                color={tokens.success}
              />
            </div>
          </div>
        </AdminCard>

        {/* ── Compliance & Governance Mode ─────────────────────────────────── */}
        <AdminCard>
          <SectionTitle icon={AlertTriangle} color={tokens.pink}>Compliance & Governance Mode</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: tokens.textMuted, marginBottom: 8, fontWeight: 600 }}>
                  Compliance Mode
                </div>
                <SegmentedControl
                  value={config.complianceMode}
                  onChange={v => set('complianceMode', v as PolicyConfig['complianceMode'])}
                  color={tokens.pink}
                  options={[
                    { value: 'off',    label: 'Off' },
                    { value: 'basic',  label: 'Basic' },
                    { value: 'strict', label: 'Strict' },
                    { value: 'hipaa',  label: 'HIPAA' },
                  ]}
                />
              </div>
            </div>
            <div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: tokens.textMuted, marginBottom: 8, fontWeight: 600 }}>
                  Default Governance Mode
                </div>
                <SegmentedControl
                  value={config.governanceMode}
                  onChange={v => set('governanceMode', v as PolicyConfig['governanceMode'])}
                  color={tokens.indigo}
                  options={[
                    { value: 'standard',   label: 'Standard' },
                    { value: 'strict',     label: 'Strict' },
                    { value: 'fast',       label: 'Fast' },
                    { value: 'cost_saver', label: 'Cost Saver' },
                    { value: 'premium',    label: 'Premium' },
                  ]}
                />
              </div>
            </div>
          </div>
        </AdminCard>

        {/* ── Content Controls ─────────────────────────────────────────────── */}
        <AdminCard>
          <SectionTitle icon={FileText} color={tokens.textMuted}>Content Controls</SectionTitle>
          <Toggle
            label="Enforce brand voice"
            desc="Apply brand tone rules to all outputs"
            checked={config.enforceBrandVoice}
            onChange={v => set('enforceBrandVoice', v)}
            color={tokens.info}
          />
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, color: tokens.textMuted, fontWeight: 600, marginBottom: 10 }}>
              Banned Phrases
            </div>
            <BannedPhraseManager
              phrases={config.bannedPhrases}
              onChange={v => set('bannedPhrases', v)}
            />
          </div>
        </AdminCard>

      </div>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={() => { setConfig(DEFAULT_POLICY_CONFIG); setValidationErrors([]) }}
          style={{
            padding: '8px 16px', borderRadius: 8,
            border: `1px solid ${tokens.border}`,
            background: 'transparent', color: tokens.textDim,
            cursor: 'pointer', fontSize: 13,
          }}
        >
          Reset to Defaults
        </button>
        {config.updatedAt && (
          <div style={{ fontSize: 11, color: tokens.textDim }}>
            Last updated: {config.updatedAt} by {config.updatedBy ?? 'system'}
          </div>
        )}
      </div>
    </AdminShell>
  )
}


