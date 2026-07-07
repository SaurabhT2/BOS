'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Experiment, ExperimentVariant } from '@brandos/control-plane-layer'

const TASK_TYPES = ['chat', 'post', 'carousel', 'deck', 'report', 'campaign']
const PROVIDERS = ['openai', 'anthropic', 'google', 'ollama', 'lmstudio']

interface ExperimentWithStats extends Experiment {
  stats?: Record<string, { samples: number; avg_score: number; avg_latency_ms: number; avg_cost_usd: number }>
  winner?: { variantId: string; reason: string } | null
}

function StatusBadge({ status }: { status: Experiment['status'] }) {
  const colors = { draft: '#374151/#94a3b8', running: '#064e3b/#34d399', paused: '#451a03/#fb923c', completed: '#1e3a5f/#60a5fa' }
  const [bg, color] = (colors[status] ?? '#374151/#94a3b8').split('/')
  return (
    <span style={{ background: bg, color, padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{status}</span>
  )
}

function NewExperimentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (exp: Experiment) => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [taskTypes, setTaskTypes] = useState<string[]>(['post'])
  const [variants, setVariants] = useState<Array<{ name: string; traffic: number; provider: string; model: string }>>([
    { name: 'Control (GPT-4o)', traffic: 70, provider: 'openai', model: 'openai/gpt-4o' },
    { name: 'Challenger (Claude)', traffic: 30, provider: 'anthropic', model: 'anthropic/claude-3-sonnet' },
  ])
  const [error, setError] = useState('')

  const totalTraffic = variants.reduce((s, v) => s + v.traffic, 0)

  const submit = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    if (Math.abs(totalTraffic - 100) > 0.1) { setError(`Traffic must sum to 100% (currently ${totalTraffic}%)`); return }

    const body: Record<string, unknown> = {
      // workspace_id scoped server-side — not sent
      name,
      description: desc,
      status: 'draft',
      task_type: taskTypes[0] ?? 'post',
      variants: variants.map((v, i) => ({
        id: `var_${i}`,
        name: v.name,
        config: { provider: v.provider, model_id: v.model },
        weight: v.traffic / 100,
      })),
    }

    const res = await fetch('/api/control-plane/experiments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json() as Experiment | { error: string }
    if ('error' in data) { setError(data.error); return }
    onCreated(data)
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 16, padding: 32, width: 560, maxHeight: '80vh', overflowY: 'auto' }}>
        <h2 style={{ color: '#f1f5f9', fontSize: 18, fontWeight: 700, marginBottom: 24 }}>New A/B Experiment</h2>

        {error && <div style={{ color: '#fca5a5', background: '#2d1b1b', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>{error}</div>}

        <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Experiment Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. GPT-4o vs Claude on posts"
          style={{ width: '100%', background: '#0f0f1a', border: '1px solid #2a2a4a', borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 14, boxSizing: 'border-box', marginBottom: 16 }} />

        <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Description</label>
        <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
          style={{ width: '100%', background: '#0f0f1a', border: '1px solid #2a2a4a', borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 14, boxSizing: 'border-box', marginBottom: 16, resize: 'vertical' }} />

        <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8 }}>Apply to Task Types</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {TASK_TYPES.map(t => (
            <button key={t} onClick={() => setTaskTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
              style={{ padding: '4px 12px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 12,
                background: taskTypes.includes(t) ? '#7c3aed' : '#1e1e3a', color: taskTypes.includes(t) ? '#fff' : '#94a3b8' }}>{t}</button>
          ))}
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <label style={{ color: '#94a3b8', fontSize: 12 }}>Variants (traffic must sum to 100%)</label>
            <span style={{ color: Math.abs(totalTraffic - 100) < 0.1 ? '#10b981' : '#ef4444', fontSize: 12, fontWeight: 700 }}>{totalTraffic}%</span>
          </div>
          {variants.map((v, i) => (
            <div key={i} style={{ background: '#0f0f1a', borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr 1fr', gap: 8, alignItems: 'center' }}>
                <input value={v.name} onChange={e => { const updated = [...variants]; updated[i] = { ...v, name: e.target.value }; setVariants(updated) }}
                  placeholder="Variant name"
                  style={{ background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 6, padding: '6px 10px', color: '#e2e8f0', fontSize: 13 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="number" value={v.traffic} min="0" max="100"
                    onChange={e => { const updated = [...variants]; updated[i] = { ...v, traffic: parseInt(e.target.value) || 0 }; setVariants(updated) }}
                    style={{ width: 50, background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 6, padding: '6px 8px', color: '#7c3aed', fontSize: 13, fontWeight: 700 }} />
                  <span style={{ color: '#64748b', fontSize: 12 }}>%</span>
                </div>
                <input value={v.model} onChange={e => { const updated = [...variants]; updated[i] = { ...v, model: e.target.value }; setVariants(updated) }}
                  placeholder="model_id"
                  style={{ background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 6, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                {variants.length > 2 && (
                  <button onClick={() => setVariants(variants.filter((_, j) => j !== i))}
                    style={{ background: '#2d1b1b', border: 'none', borderRadius: 6, padding: '6px', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>✕</button>
                )}
              </div>
            </div>
          ))}
          <button onClick={() => setVariants([...variants, { name: `Variant ${variants.length + 1}`, traffic: 0, provider: 'openai', model: '' }])}
            style={{ background: '#1e1e3a', border: '1px dashed #374151', borderRadius: 8, padding: '8px 16px', color: '#64748b', cursor: 'pointer', fontSize: 13, width: '100%' }}>
            + Add Variant
          </button>
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #374151', borderRadius: 8, padding: '10px 20px', color: '#94a3b8', cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} style={{ background: '#7c3aed', border: 'none', borderRadius: 8, padding: '10px 24px', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Create Experiment</button>
        </div>
      </div>
    </div>
  )
}

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<ExperimentWithStats[]>([])
  const [showNew, setShowNew] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/control-plane/experiments')
    const data = await res.json() as Experiment[]
    setExperiments(data)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const action = async (id: string, act: 'start' | 'stop') => {
    await fetch('/api/control-plane/experiments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: act }),
    })
    await load()
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f1a', color: '#e2e8f0', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(135deg,#f59e0b,#ef4444)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🧪</div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>A/B Model Testing</h1>
            </div>
            <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>Split traffic across models and strategies. Let data pick the winner.</p>
          </div>
          <button onClick={() => setShowNew(true)}
            style={{ background: '#7c3aed', border: 'none', borderRadius: 8, padding: '10px 20px', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
            + New Experiment
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: '#7c3aed', padding: 80 }}>Loading experiments...</div>
        ) : experiments.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 80 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🧪</div>
            <div style={{ color: '#64748b', fontSize: 16, marginBottom: 8 }}>No experiments yet</div>
            <div style={{ color: '#374151', fontSize: 13 }}>Create your first experiment to compare models side-by-side.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {experiments.map(exp => (
              <div key={exp.id} style={{ background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 12, padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 16 }}>{exp.name}</span>
                      <StatusBadge status={exp.status} />
                    </div>
                    <div style={{ color: '#64748b', fontSize: 13 }}>{exp.description}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <span style={{ background: '#1e293b', color: '#94a3b8', padding: '2px 8px', borderRadius: 12, fontSize: 11 }}>{exp.task_type}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {exp.status === 'draft' && (
                      <button onClick={() => action(exp.id, 'start')}
                        style={{ background: '#064e3b', border: 'none', borderRadius: 6, padding: '6px 14px', color: '#34d399', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>▶ Start</button>
                    )}
                    {exp.status === 'running' && (
                      <button onClick={() => action(exp.id, 'stop')}
                        style={{ background: '#1a1a2e', border: '1px solid #374151', borderRadius: 6, padding: '6px 14px', color: '#94a3b8', cursor: 'pointer', fontSize: 13 }}>⏹ Stop</button>
                    )}
                  </div>
                </div>

                {/* Variant bars */}
                <div style={{ display: 'flex', gap: 12 }}>
                  {exp.variants.map(variant => (
                    <div key={variant.id} style={{ flex: 1, background: '#0f0f1a', borderRadius: 8, padding: 12, position: 'relative' }}>
                      <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{variant.name}</div>
                      <div style={{ color: '#7c3aed', fontSize: 20, fontWeight: 800, marginBottom: 2 }}>{((variant.weight ?? 0) * 100).toFixed(0)}%</div>
                      {variant.config.model_id && <div style={{ color: '#64748b', fontSize: 11 }}>{variant.config.model_id}</div>}
                      {exp.winner?.variantId === variant.id && (
                        <div style={{ position: 'absolute', top: 8, right: 8, background: '#064e3b', borderRadius: 6, padding: '2px 8px', color: '#34d399', fontSize: 10, fontWeight: 700 }}>WINNER</div>
                      )}
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, color: '#374151', fontSize: 12 }}>
                  <span>Created: {new Date(exp.created_at).toLocaleDateString()}</span>
                  <span>Total samples: {exp.total_samples}</span>
                  {exp.winner && <span style={{ color: '#34d399' }}>✓ {exp.winner.reason}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showNew && (
        <NewExperimentModal
          onClose={() => setShowNew(false)}
          onCreated={exp => { setExperiments(prev => [exp, ...prev]); setShowNew(false) }}
        />
      )}
    </div>
  )
}


