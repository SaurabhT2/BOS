'use client'

import { useState, useEffect, useCallback } from 'react'
import type { PromptLibraryEntry } from '@brandos/control-plane-layer'

const TASK_TYPES = ['', 'chat', 'post', 'carousel', 'deck', 'report', 'campaign', 'remix', 'export']

function ScorePill({ score }: { score: number }) {
  const color = score >= 90 ? '#10b981' : score >= 80 ? '#3b82f6' : '#f59e0b'
  return (
    <span style={{ background: color + '22', color, border: `1px solid ${color}44`, padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>
      {score}
    </span>
  )
}

function PromptCard({ entry, onClone, onDelete }: { entry: PromptLibraryEntry; onClone: (id: string) => void | Promise<void>; onDelete: (id: string) => void | Promise<void>; key?: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{ background: '#1a1a2e', border: `1px solid ${entry.is_recommended ? '#7c3aed44' : '#2a2a4a'}`, borderRadius: 12, padding: 20, position: 'relative' }}>
      {entry.is_recommended && (
        <div style={{ position: 'absolute', top: 12, right: 12, background: 'linear-gradient(135deg,#7c3aed,#2563eb)', borderRadius: 20, padding: '2px 10px', fontSize: 10, fontWeight: 700, color: '#fff' }}>
          ⭐ RECOMMENDED
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{entry.title}</div>
          <div style={{ color: '#64748b', fontSize: 13 }}>{entry.description}</div>
        </div>
        <ScorePill score={entry.score_achieved} />
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ background: '#1e293b', color: '#60a5fa', padding: '2px 8px', borderRadius: 12, fontSize: 11 }}>{entry.task_type}</span>
        {entry.tags.map(tag => (
          <span key={tag} style={{ background: '#1e293b', color: '#94a3b8', padding: '2px 8px', borderRadius: 12, fontSize: 11 }}>{tag}</span>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12, color: '#64748b' }}>
        <span>Used {entry.usage_count}×</span>
        <span>Success {(entry.success_rate * 100).toFixed(0)}%</span>
        <span>v{entry.version}</span>
        <span>{new Date(entry.created_at).toLocaleDateString()}</span>
      </div>

      {expanded && (
        <div style={{ background: '#0f0f1a', borderRadius: 8, padding: 16, marginBottom: 12, fontSize: 12, color: '#94a3b8', fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>
          {entry.prompt_text}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setExpanded(!expanded)}
          style={{ background: '#1e1e3a', border: '1px solid #374151', borderRadius: 6, padding: '6px 12px', color: '#94a3b8', cursor: 'pointer', fontSize: 12 }}>
          {expanded ? 'Hide' : 'Preview'}
        </button>
        <button onClick={() => onClone(entry.id)}
          style={{ background: '#1e3a5f', border: 'none', borderRadius: 6, padding: '6px 12px', color: '#60a5fa', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          Clone
        </button>
        <button onClick={() => { if (confirm('Delete this prompt?')) onDelete(entry.id) }}
          style={{ background: '#2d1b1b', border: 'none', borderRadius: 6, padding: '6px 12px', color: '#fca5a5', cursor: 'pointer', fontSize: 12 }}>
          Delete
        </button>
      </div>
    </div>
  )
}

export default function PromptLibraryPage() {
  const [prompts, setPrompts] = useState<PromptLibraryEntry[]>([])
  const [search, setSearch] = useState('')
  const [taskFilter, setTaskFilter] = useState('')
  const [recommendedOnly, setRecommendedOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showSave, setShowSave] = useState(false)
  const [newPrompt, setNewPrompt] = useState({ title: '', task_type: 'post', prompt_text: '', description: '', tags: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({
      // workspace_id scoped server-side — not sent
      ...(search && { search }),
      ...(taskFilter && { task_type: taskFilter }),
      ...(recommendedOnly && { recommended: 'true' }),
    })
    const res = await fetch(`/api/control-plane/prompt-library?${params}`)
    const data = await res.json() as PromptLibraryEntry[]
    setPrompts(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [search, taskFilter, recommendedOnly])

  useEffect(() => { void load() }, [load])

  const savePrompt = async () => {
    setSaving(true)
    const res = await fetch('/api/control-plane/prompt-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // workspace_id scoped server-side — not sent
        title: newPrompt.title,
        description: newPrompt.description,
        task_type: newPrompt.task_type,
        prompt_text: newPrompt.prompt_text,
        tags: newPrompt.tags.split(',').map(s => s.trim()).filter(Boolean),
        score_achieved: 90,
        created_at: new Date().toISOString(),
        created_by: 'user',
        is_recommended: true,
      }),
    })
    await res.json()
    setSaving(false)
    setShowSave(false)
    setNewPrompt({ title: '', task_type: 'post', prompt_text: '', description: '', tags: '' })
    await load()
  }

  const clone = async (id: string) => {
    const entry = prompts.find(p => p.id === id)
    await fetch('/api/control-plane/prompt-library', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clone', id, title: `${entry?.title ?? 'Prompt'} (copy)`, user_id: 'user' }),
    })
    await load()
  }

  const del = async (id: string) => {
    await fetch(`/api/control-plane/prompt-library?id=${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f1a', color: '#e2e8f0', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(135deg,#10b981,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📚</div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Prompt Library</h1>
            </div>
            <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>Searchable vault of high-scoring prompts. Clone, version, and reuse.</p>
          </div>
          <button onClick={() => setShowSave(true)}
            style={{ background: '#10b981', border: 'none', borderRadius: 8, padding: '10px 20px', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
            + Save Prompt
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search prompts..."
            style={{ flex: 1, minWidth: 200, background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 8, padding: '8px 14px', color: '#e2e8f0', fontSize: 14 }}
          />
          <select value={taskFilter} onChange={e => setTaskFilter(e.target.value)}
            style={{ background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 8, padding: '8px 14px', color: '#94a3b8', fontSize: 14, cursor: 'pointer' }}>
            {TASK_TYPES.map(t => <option key={t} value={t}>{t || 'All Tasks'}</option>)}
          </select>
          <button onClick={() => setRecommendedOnly(!recommendedOnly)}
            style={{ padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: recommendedOnly ? '#7c3aed' : '#1a1a2e', color: recommendedOnly ? '#fff' : '#94a3b8',
              border: `1px solid ${recommendedOnly ? '#7c3aed' : '#2a2a4a'}` }}>
            ⭐ Recommended Only
          </button>
          <button onClick={load} style={{ background: '#1a1a2e', border: '1px solid #374151', borderRadius: 8, padding: '8px 14px', color: '#94a3b8', cursor: 'pointer' }}>↻</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: '#7c3aed', padding: 80 }}>Loading library...</div>
        ) : prompts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 80 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📚</div>
            <div style={{ color: '#64748b', fontSize: 16, marginBottom: 8 }}>No prompts yet</div>
            <div style={{ color: '#374151', fontSize: 13 }}>Save a prompt manually or generate content with score ≥90 to auto-capture.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
            {prompts.map(p => <PromptCard key={p.id} entry={p} onClone={clone} onDelete={del} />)}
          </div>
        )}
      </div>

      {/* Save modal */}
      {showSave && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 16, padding: 32, width: 520 }}>
            <h2 style={{ color: '#f1f5f9', fontSize: 18, fontWeight: 700, marginBottom: 24 }}>Save to Prompt Library</h2>

            {(['title', 'description'] as const).map(field => (
              <div key={field} style={{ marginBottom: 14 }}>
                <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4, textTransform: 'capitalize' }}>{field}</label>
                <input value={newPrompt[field]} onChange={e => setNewPrompt({ ...newPrompt, [field]: e.target.value })}
                  style={{ width: '100%', background: '#0f0f1a', border: '1px solid #2a2a4a', borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 14, boxSizing: 'border-box' }} />
              </div>
            ))}

            <div style={{ marginBottom: 14 }}>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Task Type</label>
              <select value={newPrompt.task_type} onChange={e => setNewPrompt({ ...newPrompt, task_type: e.target.value })}
                style={{ background: '#0f0f1a', border: '1px solid #2a2a4a', borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 14 }}>
                {TASK_TYPES.filter(Boolean).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Tags (comma separated)</label>
              <input value={newPrompt.tags} onChange={e => setNewPrompt({ ...newPrompt, tags: e.target.value })}
                placeholder="e.g. linkedin, b2b, engagement"
                style={{ width: '100%', background: '#0f0f1a', border: '1px solid #2a2a4a', borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 14, boxSizing: 'border-box' }} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Prompt Text</label>
              <textarea value={newPrompt.prompt_text} onChange={e => setNewPrompt({ ...newPrompt, prompt_text: e.target.value })} rows={5}
                style={{ width: '100%', background: '#0f0f1a', border: '1px solid #2a2a4a', borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box', resize: 'vertical', fontFamily: 'monospace' }} />
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSave(false)} style={{ background: 'transparent', border: '1px solid #374151', borderRadius: 8, padding: '10px 20px', color: '#94a3b8', cursor: 'pointer' }}>Cancel</button>
              <button onClick={savePrompt} disabled={saving} style={{ background: '#10b981', border: 'none', borderRadius: 8, padding: '10px 24px', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                {saving ? 'Saving...' : 'Save to Library'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


