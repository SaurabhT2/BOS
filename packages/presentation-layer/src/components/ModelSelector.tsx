'use client'

/**
 * ModelSelector — Phase 7
 *
 * Public prop types updated: tier is 'local' | 'cloud' (not frontier/free_cloud/local).
 * Internal grouping by cost can remain inside the component.
 */

import { useState, useEffect } from 'react'
import { Cpu, ChevronDown, Check, Crown, Cloud, Server, Loader } from 'lucide-react'

interface ModelInfo {
  id: string
  name: string
  providerKind: 'local' | 'cloud'
  provider: string
  supportsVision: boolean
  notes?: string
}

interface ModelPreferences {
  local?: string
  cloud?: string
}

interface ModelSelectorProps {
  variant?: 'compact' | 'full'
  activeTier?: 'local' | 'cloud'
  onTierChange?: (tier: 'local' | 'cloud') => void
  /**
   * Phase 7 — Called whenever the user selects a model.
   * Receives the model ID and the tier it belongs to.
   * Used by create/page.tsx to forward the selected model to the generate body.
   */
  onModelChange?: (modelId: string, tier: 'local' | 'cloud') => void
}

const TIER_META = {
  cloud: { label: 'Cloud', icon: Cloud, color: 'text-cyan-400', description: 'Cloud providers (Groq, OpenAI, Anthropic, etc.)' },
  local: { label: 'Local', icon: Server, color: 'text-purple-400', description: 'Private, runs on your machine' },
}

export default function ModelSelector({ variant = 'compact', activeTier, onTierChange, onModelChange }: ModelSelectorProps) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [preferences, setPreferences] = useState<ModelPreferences>({})
  const [open, setOpen] = useState<'local' | 'cloud' | null>(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/models')
      .then(r => r.json())
      .then(data => {
        if (data.models) setModels(data.models)
        if (data.preferences) setPreferences(data.preferences)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const savePreference = async (tier: keyof ModelPreferences, modelId: string) => {
    setSaving(true)
    const newPrefs = { ...preferences, [tier]: modelId }
    setPreferences(newPrefs)
    // Notify parent of model change (Phase 7 — forwards to generate body)
    onModelChange?.(modelId, tier)
    try {
      await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: newPrefs }),
      })
    } finally {
      setSaving(false)
      setOpen(null)
    }
  }

  const tiers: Array<'local' | 'cloud'> = ['cloud', 'local']

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-sm">
        <Loader size={14} className="animate-spin" />
        <span>Loading models...</span>
      </div>
    )
  }

  return (
    <div className="flex gap-3 flex-wrap">
      {tiers.map(tier => {
        const meta        = TIER_META[tier]
        const tierModels  = models.filter(m => m.providerKind === tier)
        const selected    = preferences[tier]
        const selectedModel = tierModels.find(m => m.id === selected) ?? tierModels[0]
        const isActive    = activeTier === tier

        return (
          <div key={tier} className="relative">
            <button
              onClick={() => {
                setOpen(open === tier ? null : tier)
                onTierChange?.(tier)
              }}
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all',
                isActive
                  ? 'bg-white/10 border-white/20 text-white'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/8',
              ].join(' ')}
            >
              <meta.icon size={14} className={meta.color} />
              <span>{selectedModel?.name ?? meta.label}</span>
              <ChevronDown size={12} className="text-slate-400" />
            </button>

            {open === tier && tierModels.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-slate-900 border border-white/10 rounded-xl shadow-xl z-50 py-1">
                <div className="px-3 py-1.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {meta.label} Models
                </div>
                {tierModels.map(model => (
                  <button
                    key={model.id}
                    onClick={() => savePreference(tier, model.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-200 hover:bg-white/5 text-left"
                  >
                    {selected === model.id && <Check size={12} className="text-cyan-400 shrink-0" />}
                    <span className={selected === model.id ? 'text-white' : ''}>{model.name}</span>
                    {model.notes && (
                      <span className="ml-auto text-xs text-slate-500 truncate">{model.notes}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}


