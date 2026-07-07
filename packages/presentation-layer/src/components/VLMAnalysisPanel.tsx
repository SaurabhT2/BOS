'use client'

/**
 * VLMAnalysisPanel — Upload images for AI visual brand analysis.
 * Shows color palettes, typography, layout, brand tone from real VLM analysis.
 */

import { useState, useRef } from 'react'
import { Upload, Eye, Palette, Type, Layout, Loader, Check, AlertCircle } from 'lucide-react'

interface VLMAnalysisResult {
  colors: {
    primary: string[]
    secondary: string[]
    accent: string[]
    background: string[]
    raw_description: string
  }
  typography: { styles: string[]; weight: string; personality: string }
  layout: { structure: string; density: string; alignment: string; grid: string }
  brand_tone: { mood: string; energy: string; formality: string; archetype: string }
  design_language: { style: string; era: string; keywords: string[] }
  creative_direction: string
  confidence: number
  brand_consistency?: { score: number; signals: string[]; issues: string[] }
}

type ContextType = 'brand_asset' | 'competitor' | 'ad' | 'website' | 'logo' | 'social_post' | 'deck'

const CONTEXT_OPTIONS: { value: ContextType; label: string }[] = [
  { value: 'brand_asset', label: 'Brand Asset' },
  { value: 'logo', label: 'Logo' },
  { value: 'website', label: 'Website Screenshot' },
  { value: 'ad', label: 'Advertisement' },
  { value: 'social_post', label: 'Social Post' },
  { value: 'deck', label: 'Presentation Slide' },
  { value: 'competitor', label: 'Competitor Creative' },
]

export default function VLMAnalysisPanel() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [context, setContext] = useState<ContextType>('brand_asset')
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<VLMAnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paletteMerged, setPaletteMerged] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (e: any) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setResult(null)
    setError(null)
    setPaletteMerged(false)

    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(f)
  }

  const analyze = async () => {
    if (!file) return
    setAnalyzing(true)
    setError(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('context', context)

    try {
      const res = await fetch('/api/vlm-analyze', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok || data.error) {
        setError(data.error || 'Analysis failed')
        return
      }

      setResult(data.analysis)
      setPaletteMerged(data.palette_merged ?? false)
    } catch {
      setError('Network error — analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Upload area */}
      <div
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-gray-700 hover:border-cyan-600/50 rounded-xl p-8 text-center cursor-pointer transition-all"
      >
        {preview ? (
          <div className="space-y-3">
            <img src={preview} alt="Preview" className="max-h-48 mx-auto rounded-lg object-contain" />
            <div className="text-sm text-gray-400">{file?.name} · Click to change</div>
          </div>
        ) : (
          <div className="space-y-2">
            <Upload className="w-10 h-10 text-gray-600 mx-auto" />
            <div className="text-gray-400 text-sm">Upload brand image for AI visual analysis</div>
            <div className="text-gray-600 text-xs">PNG, JPG, WebP · max 10 MB</div>
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />

      {/* Context selector */}
      {file && (
        <div className="flex gap-2 flex-wrap">
          {CONTEXT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setContext(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                context === opt.value
                  ? 'bg-cyan-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Analyze button */}
      {file && (
        <button
          onClick={analyze}
          disabled={analyzing}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 rounded-lg font-semibold transition-all"
        >
          {analyzing ? (
            <><Loader className="w-4 h-4 animate-spin" /> Analyzing with VLM...</>
          ) : (
            <><Eye className="w-4 h-4" /> Analyze with Visual AI</>
          )}
        </button>
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-600/10 border border-red-600/20 rounded-lg text-sm text-red-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Confidence + palette merged notice */}
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500">
              Analysis confidence: <span className={result.confidence > 70 ? 'text-green-400' : 'text-yellow-400'}>{result.confidence}%</span>
            </div>
            {paletteMerged && (
              <div className="flex items-center gap-1.5 text-xs text-cyan-400">
                <Check className="w-3.5 h-3.5" /> Brand palette updated
              </div>
            )}
          </div>

          {/* Color palette */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Palette className="w-4 h-4 text-cyan-400" /> Color Palette
            </div>
            <div className="space-y-2">
              {(['primary', 'secondary', 'accent', 'background'] as const).map(group => (
                result.colors[group].length > 0 && (
                  <div key={group} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-20 capitalize">{group}</span>
                    <div className="flex gap-1.5">
                      {result.colors[group].map((hex, i) => (
                        <div key={i} className="group relative">
                          <div
                            className="w-6 h-6 rounded border border-gray-700"
                            style={{ backgroundColor: hex }}
                          />
                          <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-800 text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                            {hex}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              ))}
            </div>
            {result.colors.raw_description && (
              <div className="text-xs text-gray-500 italic">{result.colors.raw_description}</div>
            )}
          </div>

          {/* Typography + Layout grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-2 text-sm font-semibold mb-2">
                <Type className="w-4 h-4 text-purple-400" /> Typography
              </div>
              <div className="text-xs text-gray-400 space-y-1">
                <div><span className="text-gray-500">Weight:</span> {result.typography.weight}</div>
                <div><span className="text-gray-500">Personality:</span> {result.typography.personality}</div>
                {result.typography.styles.map((s, i) => (
                  <div key={i} className="text-gray-300">{s}</div>
                ))}
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-2 text-sm font-semibold mb-2">
                <Layout className="w-4 h-4 text-yellow-400" /> Layout
              </div>
              <div className="text-xs text-gray-400 space-y-1">
                <div><span className="text-gray-500">Density:</span> {result.layout.density}</div>
                <div><span className="text-gray-500">Alignment:</span> {result.layout.alignment}</div>
                <div><span className="text-gray-500">Structure:</span> {result.layout.structure}</div>
              </div>
            </div>
          </div>

          {/* Brand tone */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-sm font-semibold mb-2">Brand Tone</div>
            <div className="flex flex-wrap gap-2">
              {[result.brand_tone.mood, result.brand_tone.energy, result.brand_tone.formality, result.brand_tone.archetype].map((t, i) => (
                <span key={i} className="px-2.5 py-1 bg-gray-800 text-xs text-gray-300 rounded-full">{t}</span>
              ))}
            </div>
          </div>

          {/* Creative direction */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-sm font-semibold mb-2">AI Creative Direction</div>
            <p className="text-sm text-gray-400 leading-relaxed">{result.creative_direction}</p>
          </div>

          {/* Brand consistency */}
          {result.brand_consistency && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold">Brand Consistency</div>
                <div className={`text-sm font-bold ${result.brand_consistency.score > 70 ? 'text-green-400' : 'text-yellow-400'}`}>
                  {result.brand_consistency.score}/100
                </div>
              </div>
              {result.brand_consistency.issues.length > 0 && (
                <div className="text-xs text-red-400 mt-1 space-y-0.5">
                  {result.brand_consistency.issues.map((issue, i) => (
                    <div key={i}>⚠ {issue}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


