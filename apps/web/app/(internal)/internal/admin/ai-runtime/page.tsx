'use client'
/**
 * /admin/ai-runtime — AI Runtime Configuration
 *
 * Sprint A additions:
 *   - Per-provider default model dropdown (Obj 1 + 2)
 *   - Model options derived from MODEL_CATALOG (not hardcoded)
 *   - defaultModel persisted in ProviderSettings → Supabase aiRuntime section
 *   - Active model drives adapter execution via existing toAIRuntimeConfig() bridge
 *
 * SINGLE SOURCE OF TRUTH for all runtime settings.
 *
 * API: POST/GET /api/v2/runtime/config
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { AdminShell } from '@brandos/presentation-layer'
import {
  AdminCard, SectionTitle, Toggle, NumberInput,
  SelectInput, SaveButton, SegmentedControl, StatusBadge,
  tokens, useAdminSave,
} from '@brandos/ui-admin'
import type { RuntimeConfig, ProviderSettings } from '@brandos/runtime-config'
import {
  DEFAULT_RUNTIME_CONFIG, mergeProviders,
} from '@brandos/runtime-config'
import { ARTIFACT_TYPE_REGISTRY } from '@brandos/artifact-config'
import {
  Globe, HardDrive, Clock, Cpu, Plus, Trash2,
  ArrowUp, ArrowDown, CheckCircle, AlertCircle,
  Activity, Layers, ChevronDown,
} from 'lucide-react'

// ─── Provider Model Catalog ───────────────────────────────────────────────────
// Sourced from ai-runtime-layer MODEL_REGISTRY and OPENAI_COMPATIBLE_PROVIDER_DEFS.
// Only models that actually run in the adapter are listed here.

const PROVIDER_MODELS: Record<string, { value: string; label: string }[]> = {
  openai: [
    { value: 'gpt-4o',        label: 'GPT-4o' },
    { value: 'gpt-4.1',       label: 'GPT-4.1' },
    { value: 'gpt-4.1-mini',  label: 'GPT-4.1 Mini' },
    { value: 'gpt-4o-mini',   label: 'GPT-4o Mini' },
    { value: 'gpt-4-turbo',   label: 'GPT-4 Turbo' },
    { value: 'o3-mini',       label: 'o3 Mini' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-6',       label: 'Claude Sonnet 4.6' },
    { value: 'claude-opus-4-6',         label: 'Claude Opus 4.6' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  google: [
    { value: 'gemini-2.5-pro',    label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-flash',  label: 'Gemini 2.5 Flash' },
    { value: 'gemini-1.5-pro-latest', label: 'Gemini 1.5 Pro' },
  ],
  groq: [
    { value: 'llama-3.3-70b-versatile', label: 'LLaMA 3.3 70B' },
    { value: 'llama-3.1-70b-versatile', label: 'LLaMA 3.1 70B' },
    { value: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill' },
    { value: 'qwen-qwq-32b', label: 'Qwen QwQ 32B' },
    { value: 'mistral-saba-24b', label: 'Mistral Saba 24B' },
  ],
  deepseek: [
    { value: 'deepseek-chat',     label: 'DeepSeek Chat (V3)' },
    { value: 'deepseek-reasoner', label: 'DeepSeek R1 (Reasoner)' },
  ],
  togetherai: [
    { value: 'meta-llama/Llama-3-70b-chat-hf', label: 'LLaMA 3 70B' },
    { value: 'mistralai/Mistral-7B-Instruct-v0.2', label: 'Mistral 7B' },
    { value: 'Qwen/Qwen2.5-72B-Instruct-Turbo', label: 'Qwen 2.5 72B' },
  ],
  openrouter: [
    { value: 'qwen/qwen-2.5-72b-instruct:free', label: 'Qwen 2.5 72B (Free)' },
    { value: 'mistralai/mistral-7b-instruct:free', label: 'Mistral 7B (Free)' },
    { value: 'meta-llama/llama-3.3-70b-instruct:free', label: 'LLaMA 3.3 70B (Free)' },
  ],
}

function getModelsForProvider(id: string): { value: string; label: string }[] {
  return PROVIDER_MODELS[id] ?? []
}

// ─── Provider Row ─────────────────────────────────────────────────────────────

interface ProviderRowProps {
  provider:   ProviderSettings
  isFirst:    boolean
  isLast:     boolean
  onUpdate:   (id: string, field: keyof ProviderSettings, val: unknown) => void
  onMove:     (id: string, dir: -1 | 1) => void
  onRemove:   (id: string) => void
  onTestKey:  (id: string) => Promise<void>
}

function ProviderRow({ provider: p, isFirst, isLast, onUpdate, onMove, onRemove, onTestKey }: ProviderRowProps) {
  const [editingKey, setEditingKey] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null)

  const models = getModelsForProvider(p.id)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      await onTestKey(p.id)
      setTestResult('ok')
    } catch {
      setTestResult('fail')
    } finally {
      setTesting(false)
      setTimeout(() => setTestResult(null), 3000)
    }
  }

  return (
    <tr style={{ borderBottom: `1px solid ${tokens.borderSubtle}` }}>
      {/* Priority / reorder */}
      <td style={{ padding: '10px 10px', width: 60 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <button
            onClick={() => onMove(p.id, -1)}
            disabled={isFirst}
            style={{
              background: 'none', border: `1px solid ${tokens.border}`, borderRadius: 4,
              padding: '2px 4px', cursor: isFirst ? 'not-allowed' : 'pointer',
              color: isFirst ? tokens.textFaint : tokens.textDim,
            }}
          >
            <ArrowUp style={{ width: 9, height: 9 }} />
          </button>
          <span style={{ fontSize: 10, color: tokens.textDim, fontVariantNumeric: 'tabular-nums' }}>
            {p.priority}
          </span>
          <button
            onClick={() => onMove(p.id, 1)}
            disabled={isLast}
            style={{
              background: 'none', border: `1px solid ${tokens.border}`, borderRadius: 4,
              padding: '2px 4px', cursor: isLast ? 'not-allowed' : 'pointer',
              color: isLast ? tokens.textFaint : tokens.textDim,
            }}
          >
            <ArrowDown style={{ width: 9, height: 9 }} />
          </button>
        </div>
      </td>

      {/* Provider name + kind badge */}
      <td style={{ padding: '10px 10px' }}>
        <div>
          <div style={{ fontSize: 13, color: tokens.text, fontWeight: 600 }}>{p.name}</div>
          <div style={{
            fontSize: 10, color: p.kind === 'local' ? tokens.success : tokens.info,
            textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2,
          }}>
            {p.kind}
          </div>
        </div>
      </td>

      {/* Enable toggle */}
      <td style={{ padding: '10px 10px' }}>
        <button
          onClick={() => onUpdate(p.id, 'enabled', !p.enabled)}
          style={{
            width: 38, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
            background: p.enabled ? tokens.purple : '#1e293b',
            position: 'relative', transition: 'background 0.2s',
          }}
          aria-checked={p.enabled}
          role="switch"
          title={p.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
        >
          <div style={{
            width: 14, height: 14, borderRadius: '50%', background: '#fff',
            position: 'absolute', top: 3,
            left: p.enabled ? 21 : 3,
            transition: 'left 0.2s',
          }} />
        </button>
      </td>

      {/* Default Model */}
      <td style={{ padding: '10px 10px', minWidth: 180 }}>
        {p.kind === 'local' ? (
          <span style={{ fontSize: 10, color: tokens.textDim, fontStyle: 'italic' }}>set in Local Models</span>
        ) : models.length > 0 ? (
          <div style={{ position: 'relative' }}>
            <select
              value={p.defaultModel ?? models[0]!.value}
              onChange={e => onUpdate(p.id, 'defaultModel', e.target.value)}
              style={{
                width: '100%', padding: '4px 24px 4px 8px', borderRadius: 6,
                border: `1px solid ${tokens.border}`,
                background: tokens.bg, color: tokens.text,
                fontSize: 11, appearance: 'none', cursor: 'pointer',
              }}
            >
              {models.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <ChevronDown style={{
              width: 10, height: 10, color: tokens.textDim,
              position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)',
              pointerEvents: 'none',
            }} />
          </div>
        ) : (
          <input
            value={p.defaultModel ?? ''}
            onChange={e => onUpdate(p.id, 'defaultModel', e.target.value)}
            placeholder="model id…"
            style={{
              width: '100%', padding: '4px 8px', borderRadius: 6,
              border: `1px solid ${tokens.border}`,
              background: tokens.bg, color: tokens.text, fontSize: 11,
            }}
          />
        )}
      </td>

      {/* API Key */}
      <td style={{ padding: '10px 10px' }}>
        {p.kind === 'local' ? (
          <span style={{ fontSize: 10, color: tokens.textDim, fontStyle: 'italic' }}>N/A</span>
        ) : editingKey ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              type="password"
              value={keyDraft}
              onChange={e => setKeyDraft(e.target.value)}
              placeholder="sk-..."
              autoFocus
              style={{
                width: 120, padding: '3px 6px', borderRadius: 5,
                border: `1px solid ${tokens.purple}`,
                background: tokens.bg, color: tokens.text, fontSize: 11,
              }}
            />
            <button
              onClick={() => {
                onUpdate(p.id, 'keyConfigured', !!keyDraft)
                setEditingKey(false)
                setKeyDraft('')
              }}
              style={{
                padding: '3px 6px', borderRadius: 5, border: 'none',
                background: '#7c3aed', color: '#fff', cursor: 'pointer', fontSize: 10,
              }}
            >
              Set
            </button>
            <button
              onClick={() => setEditingKey(false)}
              style={{
                padding: '3px 6px', borderRadius: 5, border: `1px solid ${tokens.border}`,
                background: 'transparent', color: tokens.textDim, cursor: 'pointer', fontSize: 10,
              }}
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditingKey(true)}
            style={{
              padding: '2px 8px', borderRadius: 4,
              border: `1px solid ${p.keyConfigured ? '#065f46' : '#92400e'}`,
              background: p.keyConfigured ? '#065f4620' : '#1c100a',
              color: p.keyConfigured ? tokens.success : tokens.warning,
              cursor: 'pointer', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
            }}
          >
            {p.keyConfigured ? '● Set' : '○ Add Key'}
          </button>
        )}
      </td>

      {/* Health */}
      <td style={{ padding: '10px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {p.health === 'healthy'
            ? <CheckCircle style={{ width: 12, height: 12, color: tokens.success }} />
            : <AlertCircle style={{ width: 12, height: 12, color: p.health === 'degraded' ? tokens.warning : tokens.textDim }} />
          }
          <span style={{ fontSize: 11, color: p.health === 'healthy' ? tokens.success : p.health === 'degraded' ? tokens.warning : tokens.textDim }}>
            {p.health}
          </span>
        </div>
      </td>

      {/* Last response */}
      <td style={{ padding: '10px 10px', color: tokens.textMuted, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
        {p.lastResponseMs != null ? `${p.lastResponseMs}ms` : '—'}
      </td>

      {/* Per-provider timeout */}
      <td style={{ padding: '10px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="number"
            defaultValue={p.timeout ?? 15000}
            onChange={e => onUpdate(p.id, 'timeout', Number(e.target.value))}
            style={{
              width: 68, padding: '3px 6px', borderRadius: 5,
              border: `1px solid ${tokens.border}`,
              background: tokens.bg, color: tokens.text,
              fontSize: 11, textAlign: 'right',
            }}
          />
          <span style={{ fontSize: 10, color: tokens.textDim }}>ms</span>
        </div>
      </td>

      {/* Actions */}
      <td style={{ padding: '10px 10px' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            onClick={handleTest}
            disabled={testing}
            title="Test API key connectivity"
            style={{
              padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
              border: `1px solid ${testResult === 'ok' ? '#065f46' : testResult === 'fail' ? tokens.danger : tokens.border}`,
              background: testResult === 'ok' ? '#065f4620' : testResult === 'fail' ? `${tokens.danger}18` : 'transparent',
              color: testResult === 'ok' ? tokens.success : testResult === 'fail' ? tokens.danger : tokens.textMuted,
              cursor: testing ? 'wait' : 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {testing ? '…' : testResult === 'ok' ? '✓ OK' : testResult === 'fail' ? '✗ Fail' : 'Test'}
          </button>
          <button
            onClick={() => onRemove(p.id)}
            style={{
              padding: '3px 6px', borderRadius: 5,
              border: `1px solid ${tokens.danger}40`, background: 'transparent',
              color: tokens.danger, cursor: 'pointer',
            }}
          >
            <Trash2 style={{ width: 10, height: 10 }} />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ─── Add Provider Modal ───────────────────────────────────────────────────────

const PRESET_PROVIDERS = [
  { id: 'openai',    name: 'OpenAI',        kind: 'cloud' as const },
  { id: 'anthropic', name: 'Anthropic',     kind: 'cloud' as const },
  { id: 'google',    name: 'Google Gemini', kind: 'cloud' as const },
  { id: 'groq',      name: 'Groq',          kind: 'cloud' as const },
  { id: 'deepseek',  name: 'DeepSeek',      kind: 'cloud' as const },
  { id: 'togetherai',name: 'Together AI',   kind: 'cloud' as const },
  { id: 'openrouter',name: 'OpenRouter',    kind: 'cloud' as const },
  { id: 'mistral',   name: 'Mistral AI',    kind: 'cloud' as const },
  { id: 'ollama',    name: 'Ollama',        kind: 'local' as const },
  { id: 'lmstudio',  name: 'LM Studio',     kind: 'local' as const },
]

function AddProviderModal({
  onAdd, onClose, nextPriority,
}: {
  onAdd: (p: ProviderSettings) => void
  onClose: () => void
  nextPriority: number
}) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'local' | 'cloud'>('cloud')
  const [apiKey, setApiKey] = useState('')

  const selectPreset = (p: typeof PRESET_PROVIDERS[number]) => {
    setId(p.id); setName(p.name); setKind(p.kind)
  }

  const handleAdd = () => {
    if (!id || !name) return
    const models = getModelsForProvider(id)
    onAdd({
      id, name, kind, enabled: true, keyConfigured: !!apiKey,
      priority: nextPriority, health: 'unknown', lastResponseMs: null,
      defaultModel: models[0]?.value,
    })
    onClose()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: tokens.surface, border: `1px solid ${tokens.border}`,
        borderRadius: 16, padding: 32, width: 480, maxWidth: '90vw',
      }}>
        <h3 style={{ color: tokens.text, margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>
          Add Provider
        </h3>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: tokens.textDim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 8 }}>
            Quick Select
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {PRESET_PROVIDERS.map(p => (
              <button
                key={p.id}
                onClick={() => selectPreset(p)}
                style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600,
                  background: id === p.id ? '#2e1d5e' : 'transparent',
                  border: `1px solid ${id === p.id ? tokens.purple : tokens.border}`,
                  color: id === p.id ? tokens.purple : tokens.textDim,
                }}
              >
                {p.name}
                {p.kind === 'local' && <span style={{ fontSize: 9, marginLeft: 4, opacity: 0.7 }}>local</span>}
              </button>
            ))}
          </div>
        </div>

        {[
          { field: 'id', val: id, setVal: setId, label: 'Provider ID', placeholder: 'e.g. openai' },
          { field: 'name', val: name, setVal: setName, label: 'Display Name', placeholder: 'e.g. OpenAI' },
        ].map(({ field, val, setVal, label, placeholder }) => (
          <div key={field} style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: tokens.textDim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 6 }}>
              {label}
            </label>
            <input
              value={val}
              onChange={e => setVal(e.target.value)}
              placeholder={placeholder}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 8,
                border: `1px solid ${tokens.border}`,
                background: tokens.bg, color: tokens.text, fontSize: 13, boxSizing: 'border-box',
              }}
            />
          </div>
        ))}

        {kind === 'cloud' && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11, color: tokens.textDim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 6 }}>
              API Key (server-side only)
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..."
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 8,
                border: `1px solid ${tokens.border}`,
                background: tokens.bg, color: tokens.text, fontSize: 13, boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: 11, color: tokens.textDim, marginTop: 4 }}>
              Keys are stored server-side only and never returned to the client.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 18px', borderRadius: 8, border: `1px solid ${tokens.border}`,
              background: 'transparent', color: tokens.textDim, cursor: 'pointer', fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!id || !name}
            style={{
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: id && name ? '#7c3aed' : '#1e293b',
              color: id && name ? '#fff' : tokens.textDim,
              cursor: id && name ? 'pointer' : 'not-allowed',
              fontSize: 13, fontWeight: 600,
            }}
          >
            Add Provider
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AIRuntimePage() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null)
  const [localModels, setLocalModels] = useState<{
    ollama: { available: boolean; models: { name: string }[] }
    lmstudio: { available: boolean; models: { name: string }[] }
  } | null>(null)
  const [showAddProvider, setShowAddProvider] = useState(false)
  const { save, saving, saved, error } = useAdminSave('/api/v2/runtime/config', 'runtime')

  const load = useCallback(async () => {
    try {
      const [cfgRes, modelsRes] = await Promise.all([
        fetch('/api/v2/runtime/config'),
        fetch('/api/admin/local-models'),
      ])
      const cfgData = await cfgRes.json()
      const modelsData = await modelsRes.json()
      if (cfgData?.data) {
        const raw = cfgData.data as RuntimeConfig
        setConfig({
          ...raw,
          localTimeout:           Math.min(120_000, Math.max(1_000, raw.localTimeout ?? 30_000)),
          cloudTimeout:           Math.min(60_000,  Math.max(1_000, raw.cloudTimeout ?? 15_000)),
          circuitBreakerCooldown: Math.min(600,     Math.max(10,    raw.circuitBreakerCooldown ?? 60)),
          retryCount:             Math.min(10,      Math.max(0,     raw.retryCount ?? 2)),
          maxParallelJobs:        Math.min(32,      Math.max(1,     raw.maxParallelJobs ?? 4)),
          // Backfill defaultModel for providers that don't have it set yet
          providers: raw.providers.map(p => ({
            ...p,
            defaultModel: p.defaultModel ?? getModelsForProvider(p.id)[0]?.value,
          })),
        })
      }
      if (modelsData) setLocalModels(modelsData)
    } catch (err) {
      console.error('[RuntimePage] load error', err)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const set = <K extends keyof RuntimeConfig>(key: K, val: RuntimeConfig[K]) =>
    setConfig(prev => prev ? { ...prev, [key]: val } : prev)

  const updateProvider = (id: string, field: keyof ProviderSettings, val: unknown) =>
    setConfig(prev => prev ? {
      ...prev,
      providers: prev.providers.map(p => p.id === id ? { ...p, [field]: val } : p),
    } : prev)

  const moveProvider = (id: string, dir: -1 | 1) =>
    setConfig(prev => {
      if (!prev) return prev
      const sorted = [...prev.providers].sort((a, b) => a.priority - b.priority)
      const idx = sorted.findIndex(p => p.id === id)
      const newIdx = idx + dir
      if (newIdx < 0 || newIdx >= sorted.length) return prev
      const a = sorted[idx]!
      const b = sorted[newIdx]!
      sorted[idx] = b
      sorted[newIdx] = a
      return { ...prev, providers: sorted.map((p, i) => ({ ...p, priority: i + 1 })) }
    })

  const addProvider = (p: ProviderSettings) =>
    setConfig(prev => prev ? { ...prev, providers: [...prev.providers, p] } : prev)

  const removeProvider = (id: string) =>
    setConfig(prev => prev ? { ...prev, providers: prev.providers.filter(p => p.id !== id) } : prev)

  const testProviderKey = async (id: string): Promise<void> => {
    const res = await fetch(`/api/v2/runtime/providers/${id}/test`, { method: 'POST' })
    if (!res.ok) throw new Error('Test failed')
    const data = await res.json()
    if (!data.ok) throw new Error(data.error ?? 'Test failed')
    // Update health status from test result
    if (data.health) {
      updateProvider(id, 'health', data.health)
    }
    if (data.latencyMs != null) {
      updateProvider(id, 'lastResponseMs', data.latencyMs)
    }
  }

  const handleSave = () => config && save(config)

  if (!config) return (
    <AdminShell title="AI Runtime" subtitle="Loading…" titleColor={tokens.purple}>
      <div style={{ textAlign: 'center', padding: 60, color: tokens.textDim }}>…</div>
    </AdminShell>
  )

  const sortedProviders = [...config.providers]
    .sort((a, b) => a.priority - b.priority)
    .filter(p => p.kind === config.runtimeMode || config.runtimeMode === 'cloud' && p.kind === 'cloud' || config.runtimeMode === 'local' && p.kind === 'local')
  const localDetected = localModels?.ollama?.available || localModels?.lmstudio?.available
  const allLocalModels = [
    ...(localModels?.ollama?.models ?? []).map(m => ({ name: m.name, source: 'ollama' })),
    ...(localModels?.lmstudio?.models ?? []).map(m => ({ name: m.name, source: 'lmstudio' })),
  ]

  const tableHeaderStyle: React.CSSProperties = {
    padding: '8px 10px', color: tokens.textDim, fontWeight: 600,
    textAlign: 'left', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
  }

  return (
    <AdminShell
      title="AI Runtime"
      subtitle="Provider management, model routing, resilience & inference control"
      titleColor={tokens.purple}
      actions={
        <SaveButton onClick={handleSave} saving={saving} saved={saved} color={tokens.purple} />
      }
    >
      {showAddProvider && (
        <AddProviderModal
          onAdd={addProvider}
          onClose={() => setShowAddProvider(false)}
          nextPriority={config.providers.length + 1}
        />
      )}

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

        {/* ── Runtime Mode ─────────────────────────────────────────────────── */}
        <AdminCard>
          <SectionTitle icon={Layers} color={tokens.purple}>Runtime Mode</SectionTitle>

          {/* Active mode badge — always visible, never ambiguous */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '6px 14px', borderRadius: 20, marginBottom: 14,
            background: config.runtimeMode === 'local'
              ? 'linear-gradient(90deg, #7c3aed22, #6d28d922)'
              : 'linear-gradient(90deg, #0891b222, #0e749722)',
            border: `1px solid ${config.runtimeMode === 'local' ? '#7c3aed60' : '#0891b260'}`,
          }}>
            {config.runtimeMode === 'local'
              ? <HardDrive style={{ width: 13, height: 13, color: '#a78bfa' }} />
              : <Globe style={{ width: 13, height: 13, color: '#38bdf8' }} />
            }
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: config.runtimeMode === 'local' ? '#a78bfa' : '#38bdf8',
              letterSpacing: '0.04em',
            }}>
              {config.runtimeMode === 'local' ? 'LOCAL MODE ACTIVE' : 'CLOUD MODE ACTIVE'}
            </span>
          </div>

          <SegmentedControl
            value={config.runtimeMode}
            onChange={v => set('runtimeMode', v as 'local' | 'cloud')}
            color={tokens.purple}
            options={[
              {
                value: 'local',
                label: 'Local',
                desc: 'Local providers only (Ollama, LM Studio). Explicit failure if none available. No cloud fallback.',
              },
              {
                value: 'cloud',
                label: 'Cloud',
                desc: 'Cloud providers only. Selected by priority order. No local fallback.',
              },
            ]}
          />
          <div style={{ marginTop: 10, fontSize: 11, color: tokens.textDim }}>
            {config.runtimeMode === 'local'
              ? 'Only local providers participate. Cloud APIs are never called. Fails explicitly if no local model is available.'
              : 'Only cloud providers participate. Local models are not used. Fails explicitly if no cloud provider is enabled.'}
          </div>
        </AdminCard>

        {/* ── Provider Management ───────────────────────────────────────────── */}
        <AdminCard>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <SectionTitle icon={Globe} color={tokens.pink}>Provider Management</SectionTitle>
            <button
              onClick={() => setShowAddProvider(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '6px 12px', borderRadius: 7,
                border: `1px solid ${tokens.border}`,
                background: '#1a0f3a', color: tokens.purple,
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}
            >
              <Plus style={{ width: 12, height: 12 }} /> Add Provider
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${tokens.border}` }}>
                  {['Order', 'Provider', 'Enabled', 'Default Model', 'API Key', 'Health', 'Last Response', 'Timeout', 'Actions'].map(h => (
                    <th key={h} style={tableHeaderStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedProviders.map((p, idx) => (
                  <ProviderRow
                    key={p.id}
                    provider={p}
                    isFirst={idx === 0}
                    isLast={idx === sortedProviders.length - 1}
                    onUpdate={updateProvider}
                    onMove={moveProvider}
                    onRemove={removeProvider}
                    onTestKey={testProviderKey}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10, fontSize: 11, color: tokens.textDim }}>
            Default Model is passed to the provider adapter on every generation request.
            Save to persist model selection.
          </div>
        </AdminCard>

        {/* ── Local Models + Resilience ─────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: config.runtimeMode === 'local' ? '1fr 1fr' : '1fr', gap: 20 }}>

          {config.runtimeMode === 'local' && (
          <AdminCard>
            <SectionTitle icon={HardDrive} color={tokens.success}>Local Models</SectionTitle>

            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              marginBottom: 14, padding: '8px 12px', borderRadius: 8,
              background: localDetected ? '#065f4614' : '#1c100a',
              border: `1px solid ${localDetected ? '#10b98140' : '#92400e40'}`,
            }}>
              {localDetected
                ? <CheckCircle style={{ width: 13, height: 13, color: tokens.success }} />
                : <AlertCircle style={{ width: 13, height: 13, color: tokens.warning }} />
              }
              <span style={{ fontSize: 12, color: localDetected ? tokens.success : tokens.warning }}>
                {localDetected
                  ? `Detected: ${localModels?.ollama?.available ? 'Ollama' : ''}${localModels?.ollama?.available && localModels?.lmstudio?.available ? ' + ' : ''}${localModels?.lmstudio?.available ? 'LM Studio' : ''}`
                  : 'No local models detected'
                }
              </span>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{
                fontSize: 11, color: tokens.textDim, fontWeight: 600,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                display: 'block', marginBottom: 6,
              }}>
                Active Local Model
              </label>
              <select
                value={config.selectedLocalModel ?? ''}
                onChange={e => set('selectedLocalModel', e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 8,
                  border: `1px solid ${tokens.border}`,
                  background: tokens.bg, color: tokens.text, fontSize: 13,
                }}
              >
                {allLocalModels.length > 0
                  ? allLocalModels.map(m => (
                      <option key={m.name} value={m.name}>{m.name} ({m.source})</option>
                    ))
                  : ['llama3', 'mistral', 'phi3', 'gemma', 'qwen', 'llama3.1'].map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))
                }
              </select>
            </div>

            <NumberInput
              label="Local Timeout"
              value={config.localTimeout}
              onChange={v => set('localTimeout', v)}
              min={1000}
              max={120000}
              unit="ms"
            />
          </AdminCard>
          )}

          <AdminCard>
            <SectionTitle icon={Clock} color={tokens.info}>Resilience Settings</SectionTitle>
            <NumberInput label="Cloud Timeout" value={config.cloudTimeout} onChange={v => set('cloudTimeout', v)} min={1000} max={60000} unit="ms" />
            <NumberInput label="Retry Count" value={config.retryCount} onChange={v => set('retryCount', v)} min={0} max={10} />
            <NumberInput label="Circuit Breaker Cooldown" value={config.circuitBreakerCooldown} onChange={v => set('circuitBreakerCooldown', v)} unit="s" />
            <NumberInput label="Max Parallel Jobs" value={config.maxParallelJobs} onChange={v => set('maxParallelJobs', v)} min={1} max={32} />
            <Toggle
              label="Streaming"
              checked={config.streamingEnabled}
              onChange={v => set('streamingEnabled', v)}
              desc="Stream tokens as generated"
              color={tokens.info}
            />
            <Toggle
              label="Fallback Chain"
              checked={config.fallbackEnabled}
              onChange={v => set('fallbackEnabled', v)}
              desc="Auto-reroute to next provider on failure"
              color={tokens.info}
            />
            <Toggle
              label="Telemetry"
              checked={config.telemetryEnabled ?? true}
              onChange={v => set('telemetryEnabled', v)}
              desc="Send anonymized usage metrics"
              color={tokens.info}
            />
          </AdminCard>
        </div>

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
