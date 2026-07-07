'use client'

import * as React from 'react'
import { useState, useEffect, useRef, useCallback } from 'react'
// useAuth import removed (Phase 1/5 cleanup) — was only used by the
// standalone per-page header (user email + logout), which WorkspaceNav now
// renders globally; no longer called anywhere in this file.
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Upload, Search,
  Image, FileText, Archive, Download, Cpu,
  RefreshCw, CheckCircle, AlertCircle, Clock, X,
  Loader2, Repeat, Mail, Layers, ChevronDown, ChevronRight,
  LayoutGrid, Presentation, BookOpen, Sparkles,
} from 'lucide-react'
import type { BrandAssetRow, BrandAssetStatus } from '@brandos/auth'
import { TRANSFORM_MODES, extractSourceText, runRepurpose } from '@/lib/repurpose'
import { NewsletterRenderer } from '@brandos/presentation-layer'
import type { NewsletterArtifact } from '@brandos/contracts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  })
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<BrandAssetStatus, { label: string; color: string; icon: React.ReactNode }> = {
  uploading:  { label: 'Uploading',  color: 'text-blue-400 bg-blue-400/10',   icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  processing: { label: 'Processing', color: 'text-yellow-400 bg-yellow-400/10', icon: <Clock className="w-3 h-3 animate-pulse" /> },
  indexed:    { label: 'Indexed',    color: 'text-green-400 bg-green-400/10',  icon: <CheckCircle className="w-3 h-3" /> },
  failed:     { label: 'Failed',     color: 'text-red-400 bg-red-400/10',      icon: <AlertCircle className="w-3 h-3" /> },
  archived:   { label: 'Archived',   color: 'text-gray-500 bg-gray-500/10',    icon: <Archive className="w-3 h-3" /> },
}

function StatusBadge({ status }: { status: BrandAssetStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.indexed
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  )
}

// ─── Asset Icon ───────────────────────────────────────────────────────────────

function AssetIcon({ mimeType, storagePath }: { mimeType: string; storagePath: string | null }) {
  if (isImage(mimeType) && storagePath) {
    return (
      <div className="w-12 h-12 rounded bg-gray-800 flex items-center justify-center overflow-hidden">
        <Image className="w-6 h-6 text-cyan-400" />
      </div>
    )
  }
  return (
    <div className="w-12 h-12 rounded bg-gray-800 flex items-center justify-center">
      <FileText className="w-6 h-6 text-gray-400" />
    </div>
  )
}

// ─── Image Preview ────────────────────────────────────────────────────────────
// Fetches a signed URL for the asset and renders it as a preview img.

function ImagePreview({ assetId }: { assetId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setUrl(null)

    fetch(`/api/assets/${assetId}/download`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d.signedUrl) setUrl(d.signedUrl)
        else setError(true)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [assetId])

  if (loading) {
    return (
      <div className="w-full h-40 rounded bg-gray-900 flex items-center justify-center mb-4">
        <Loader2 className="w-5 h-5 text-gray-600 animate-spin" />
      </div>
    )
  }

  if (error || !url) {
    return (
      <div className="w-full h-40 rounded bg-gray-900 flex items-center justify-center mb-4 border border-gray-800">
        <span className="text-xs text-gray-600">Preview unavailable</span>
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="Asset preview"
      className="w-full max-h-48 object-contain rounded bg-gray-900 mb-4 border border-gray-800"
      onError={() => { setUrl(null); setError(true) }}
    />
  )
}

// ─── Asset Card ───────────────────────────────────────────────────────────────

interface AssetCardProps {
  asset: BrandAssetRow
  onSelect: (asset: BrandAssetRow) => void
}

function AssetCard({ asset, onSelect }: AssetCardProps) {
  return (
    <button
      onClick={() => onSelect(asset)}
      className="w-full text-left bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-600 transition-all hover:bg-gray-800/50 group"
    >
      <div className="flex items-start gap-3">
        <AssetIcon mimeType={asset.mime_type} storagePath={asset.storage_path} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-white truncate">{asset.name}</p>
            <StatusBadge status={asset.status} />
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{asset.original_filename}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-600">
            <span>{formatBytes(asset.size_bytes)}</span>
            <span>·</span>
            <span>{formatDate(asset.created_at)}</span>
          </div>
          {asset.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {asset.tags.slice(0, 3).map(tag => (
                <span key={tag} className="px-1.5 py-0.5 text-xs bg-gray-700/60 text-gray-400 rounded">
                  {tag}
                </span>
              ))}
              {asset.tags.length > 3 && (
                <span className="text-xs text-gray-600">+{asset.tags.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── Asset Detail Drawer ──────────────────────────────────────────────────────

interface AssetDrawerProps {
  asset: BrandAssetRow
  onClose: () => void
  onUpdated: (asset: BrandAssetRow) => void
  onArchived: (assetId: string) => void
}

function AssetDrawer({ asset, onClose, onUpdated, onArchived }: AssetDrawerProps) {
  const [name, setName] = useState(asset.name)
  const [tagsInput, setTagsInput] = useState(asset.tags.join(', '))
  const [saving, setSaving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const showMessage = (type: 'ok' | 'err', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean)
      const res = await fetch(`/api/assets/${asset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || asset.name, tags }),
      })
      const data = await res.json()
      if (!res.ok) return showMessage('err', data.error ?? 'Save failed')
      onUpdated(data.asset)
      showMessage('ok', 'Saved')
    } finally {
      setSaving(false)
    }
  }

  async function handleAnalyze() {
    setAnalyzing(true)
    try {
      const res = await fetch(`/api/assets/${asset.id}/analyze`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) return showMessage('err', data.error ?? 'Analysis failed')
      onUpdated(data.asset)
      showMessage('ok', isImage(asset.mime_type) ? 'Visual analysis complete' : 'Document analysis complete')
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleDownload() {
    const res = await fetch(`/api/assets/${asset.id}/download`)
    const data = await res.json()
    if (!res.ok) return showMessage('err', data.error ?? 'Download failed')
    window.open(data.signedUrl, '_blank')
  }

  async function handleArchive() {
    if (!confirm(`Archive "${asset.name}"? It will be hidden from your vault.`)) return
    setArchiving(true)
    try {
      const res = await fetch(`/api/assets/${asset.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) return showMessage('err', data.error ?? 'Archive failed')
      onArchived(asset.id)
      onClose()
    } finally {
      setArchiving(false)
    }
  }

  const canAnalyze = asset.status !== 'archived'
  const analysisLabel = isImage(asset.mime_type) ? 'Run VLM Analysis' : 'Analyze Document'
  const analyzingLabel = isImage(asset.mime_type) ? 'Analyzing image…' : 'Analyzing document…'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-gray-950 border-l border-gray-800 h-full overflow-y-auto p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <AssetIcon mimeType={asset.mime_type} storagePath={asset.storage_path} />
            <div>
              <h2 className="text-base font-semibold text-white line-clamp-1">{asset.name}</h2>
              <StatusBadge status={asset.status} />
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Image preview */}
        {isImage(asset.mime_type) && asset.storage_path && (
          <ImagePreview assetId={asset.id} />
        )}

        {/* Feedback message */}
        {message && (
          <div className={`mb-4 px-3 py-2 rounded text-sm ${
            message.type === 'ok' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
          }`}>
            {message.text}
          </div>
        )}

        {/* Metadata */}
        <div className="space-y-3 mb-6 text-sm">
          {[
            { label: 'Original filename', value: asset.original_filename },
            { label: 'MIME type',         value: asset.mime_type },
            { label: 'Size',              value: formatBytes(asset.size_bytes) },
            { label: 'Uploaded',          value: formatDate(asset.created_at) },
            { label: 'Last updated',      value: formatDate(asset.updated_at) },
            { label: 'Usage count',       value: String(asset.usage_count) },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between gap-4">
              <span className="text-gray-500 shrink-0">{label}</span>
              <span className="text-gray-300 text-right truncate">{value}</span>
            </div>
          ))}
        </div>

        {/* Editable fields */}
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Display name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Tags (comma-separated)</label>
            <input
              type="text"
              value={tagsInput}
              onChange={e => setTagsInput(e.target.value)}
              placeholder="logo, primary, brand"
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium transition-colors"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        {/* Brand intelligence contribution — what this asset taught BrandOS */}
        {asset.vlm_analysis && (
          <div className="mb-6">
            <h3 className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 inline-block" />
              What this {isImage(asset.mime_type) ? 'image' : 'document'} contributed
            </h3>
            <div className="bg-gray-900 rounded p-3 text-xs space-y-2 text-gray-300 border border-gray-800">
              {(asset.vlm_analysis as any).confidence !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Analysis confidence</span>
                  <span className={`font-medium ${
                    (asset.vlm_analysis as any).confidence >= 70 ? 'text-emerald-400' :
                    (asset.vlm_analysis as any).confidence >= 40 ? 'text-amber-400' : 'text-gray-400'
                  }`}>{(asset.vlm_analysis as any).confidence}%</span>
                </div>
              )}
              {(asset.vlm_analysis as any).description && (
                <p className="text-gray-400 italic">&ldquo;{(asset.vlm_analysis as any).description}&rdquo;</p>
              )}
              {(asset.vlm_analysis as any).document_type && (
                <p><span className="text-gray-500">Document type: </span>{(asset.vlm_analysis as any).document_type}</p>
              )}
              {(asset.vlm_analysis as any).topics?.length > 0 && (
                <div>
                  <p className="text-gray-500 mb-1">Topics identified:</p>
                  <div className="flex flex-wrap gap-1">
                    {((asset.vlm_analysis as any).topics as string[]).map((t: string) => (
                      <span key={t} className="px-1.5 py-0.5 rounded bg-blue-950/50 text-blue-300 text-[10px]">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {(asset.vlm_analysis as any).mood && (
                <p><span className="text-gray-500">Visual mood: </span>{(asset.vlm_analysis as any).mood}</p>
              )}
              {(asset.vlm_analysis as any).colors?.primary?.length > 0 && (
                <div>
                  <p className="text-gray-500 mb-1.5">Colors added to your palette:</p>
                  <div className="flex gap-1.5 mt-1">
                    {((asset.vlm_analysis as any).colors.primary as string[]).slice(0, 5).map((c: string) => (
                      <div key={c} className="flex flex-col items-center gap-1">
                        <span
                          title={c}
                          style={{ backgroundColor: c }}
                          className="w-7 h-7 rounded border border-gray-700 inline-block"
                        />
                        <span className="text-[9px] text-gray-600 font-mono">{c}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[10px] text-gray-600 pt-1 border-t border-gray-800">
                These signals from this {isImage(asset.mime_type) ? 'image' : 'document'} feed into your Brand Intelligence →
                {isImage(asset.mime_type) ? ' Visual Identity.' : ' Signals and Visual Identity.'}
                <button
                  onClick={() => window.open('/workspace/brand?tab=visual', '_blank')}
                  className="ml-1 text-cyan-600 hover:text-cyan-400 underline"
                >
                  View Visual Identity
                </button>
              </p>
            </div>
          </div>
        )}

        {/* If not yet analyzed, prompt the user */}
        {!asset.vlm_analysis && asset.status === 'indexed' && (
          <div className="mb-6 p-3 rounded-lg bg-gray-900/50 border border-dashed border-gray-700">
            <p className="text-xs text-gray-500">
              This {isImage(asset.mime_type) ? 'image' : 'document'} hasn&rsquo;t been analyzed yet.
              Run analysis to extract brand signals and{isImage(asset.mime_type) ? ' palette colors.' : ' vocabulary signals.'}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2">
          <button
            onClick={handleDownload}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-700 hover:border-gray-500 rounded text-sm text-gray-300 hover:text-white transition-colors"
          >
            <Download className="w-4 h-4" />
            Download
          </button>

          {canAnalyze && (
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-cyan-700 hover:border-cyan-500 rounded text-sm text-cyan-400 hover:text-cyan-300 transition-colors disabled:opacity-50"
            >
              {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />}
              {analyzing ? analyzingLabel : analysisLabel}
            </button>
          )}

          {asset.status !== 'archived' && (
            <button
              onClick={handleArchive}
              disabled={archiving}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-red-900 hover:border-red-700 rounded text-sm text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
            >
              {archiving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
              {archiving ? 'Archiving…' : 'Archive asset'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Upload Zone ──────────────────────────────────────────────────────────────

interface UploadZoneProps {
  onUploaded: (assets: BrandAssetRow[]) => void
}

function UploadZone({ onUploaded }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const appendLog = (msg: string) => setLog(prev => [...prev, msg])

  async function uploadFiles(files: File[]) {
    if (!files.length) return
    setUploading(true)
    setLog([])
    appendLog(`📤 Uploading ${files.length} file(s)…`)

    const formData = new FormData()
    files.forEach(f => formData.append('files', f))

    try {
      const res = await fetch('/api/assets', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) {
        appendLog(`❌ ${data.error ?? 'Upload failed'}`)
        return
      }
      appendLog(`✅ ${data.assets.length} asset(s) created`)
      if (data.errors?.length) data.errors.forEach((e: string) => appendLog(`⚠️ ${e}`))
      onUploaded(data.assets)

      // ── Auto-analyze image assets after upload ────────────────────────────
      // Documents are already transitioned to 'indexed' server-side.
      // Image analysis requires a separate call; we fire it for each image
      // asset so they don't stay stuck in 'processing'.
      const imageAssets = (data.assets as BrandAssetRow[]).filter(a =>
        a.mime_type.startsWith('image/')
      )
      if (imageAssets.length > 0) {
        appendLog(`🔍 Analyzing ${imageAssets.length} image(s)…`)
        const analyzeResults = await Promise.allSettled(
          imageAssets.map(async (a) => {
            const r = await fetch(`/api/assets/${a.id}/analyze`, { method: 'POST' })
            const d = await r.json()
            if (r.ok && d.asset) return d.asset as BrandAssetRow
            console.warn(`[UploadZone] analyze failed for ${a.id}:`, d.error)
            return null
          })
        )
        analyzeResults.forEach((result, i) => {
          if (result.status === 'fulfilled' && result.value) {
            onUploaded([result.value]) // update the asset in parent state
            appendLog(`✅ ${imageAssets[i]?.name ?? 'Image'} analyzed`)
          } else {
            appendLog(`⚠️ ${imageAssets[i]?.name ?? 'Image'} analysis failed — retry via Analyze button`)
          }
        })
      }
    } catch (err: any) {
      appendLog(`❌ ${err?.message ?? 'Upload failed'}`)
    } finally {
      setUploading(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    uploadFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
        dragging ? 'border-cyan-500 bg-cyan-500/5' : 'border-gray-700 hover:border-gray-600'
      }`}
    >
      <Upload className={`w-8 h-8 mx-auto mb-3 ${dragging ? 'text-cyan-400' : 'text-gray-600'}`} />
      <p className="text-sm text-gray-400 mb-1">
        Drag and drop files, or{' '}
        <button
          onClick={() => inputRef.current?.click()}
          className="text-cyan-400 hover:text-cyan-300 underline"
        >
          browse
        </button>
      </p>
      <p className="text-xs text-gray-600">Images, PDFs, Word docs, text — up to 50 MB each</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => e.target.files && uploadFiles(Array.from(e.target.files))}
      />
      {(uploading) && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-cyan-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Processing…
        </div>
      )}
      {log.length > 0 && (
        <div className="mt-4 text-left bg-black/40 rounded p-3 font-mono text-xs space-y-0.5">
          {log.map((line, i) => (
            <div key={i} className={line.startsWith('❌') ? 'text-red-400' : line.startsWith('⚠️') ? 'text-yellow-400' : 'text-green-400'}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Content Card (NEW — Phase 5: Unified Library) ───────────────────────────
// Renders a row from /api/campaigns (the de facto Content table — strategic
// doc §1). Read-only for now: no edit/archive endpoint exists for campaigns
// rows (only generate/export write to this table; see /api/campaigns notes).

interface ContentRow {
  id: string
  title: string
  topic: string
  format: string
  status: 'draft' | 'generated' | 'exported' | 'paid'
  qa_score_before: number | null
  qa_score_after: number | null
  created_at: string
}

const CONTENT_STATUS_CONFIG: Record<ContentRow['status'], { label: string; color: string }> = {
  draft:     { label: 'Draft',     color: 'text-gray-400 bg-gray-400/10' },
  generated: { label: 'Generated', color: 'text-blue-400 bg-blue-400/10' },
  exported:  { label: 'Exported',  color: 'text-green-400 bg-green-400/10' },
  paid:      { label: 'Published', color: 'text-purple-400 bg-purple-400/10' },
}

function ContentCard({ content, onSelect }: { content: ContentRow; onSelect: (c: ContentRow) => void }) {
  const statusCfg = CONTENT_STATUS_CONFIG[content.status] ?? CONTENT_STATUS_CONFIG.draft
  return (
    <button
      onClick={() => onSelect(content)}
      className="w-full text-left bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-600 transition-all hover:bg-gray-800/50"
    >
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded bg-gray-800 flex items-center justify-center shrink-0">
          <FileText className="w-6 h-6 text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-white truncate">{content.title}</p>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusCfg.color}`}>
              {statusCfg.label}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate capitalize">{content.format}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-600">
            <span>{formatDate(content.created_at)}</span>
            {content.qa_score_after != null && (
              <>
                <span>·</span>
                <span>score {content.qa_score_after}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

// ─── Repurpose (GTM Critical Item 2, 2026-06-21) ──────────────────────────────
// Runtime, Control Plane, governance, and persistence for repurposing already
// existed (POST /api/transform — see apps/web/lib/agents/transformAgent.ts).
// What was missing was a workspace UI entry point AND a way to obtain a
// campaign's full content text (GET /api/campaigns/[id] — added alongside
// this component; the list route deliberately omits the content column).
//
// extractSourceText() / TRANSFORM_MODES / runRepurpose() live in
// @/lib/repurpose — shared with the Create flow's Save-step entry point so
// the text-extraction logic isn't duplicated across the two call sites.

interface TransformOutput { label: string; content: string; type: string }
interface TransformResultPayload {
  mode: string
  title: string
  outputs: TransformOutput[]
}

function RepurposeSection({ content }: { content: ContentRow }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState(TRANSFORM_MODES[0].value)
  const [loadingSource, setLoadingSource] = useState(false)
  const [transforming, setTransforming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TransformResultPayload | null>(null)

  async function handleRepurpose() {
    setTransforming(true)
    setLoadingSource(true)
    setError(null)
    setResult(null)
    try {
      // Fetch full content — the list payload that produced this ContentRow
      // only carries topic (truncated to 120 chars), not the full body.
      const res = await fetch(`/api/campaigns/${content.id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not load this item\u2019s content')
      setLoadingSource(false)

      const sourceText = extractSourceText(data.campaign?.content)
      if (!sourceText.trim()) {
        throw new Error('Couldn\u2019t extract text from this item to repurpose')
      }

      const transformResult = await runRepurpose({ mode, sourceText, sourceFilename: content.title })
      setResult(transformResult)
    } catch (err: any) {
      setError(err?.message ?? 'Repurpose failed')
    } finally {
      setTransforming(false)
      setLoadingSource(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-gray-700 text-sm text-gray-300 hover:border-gray-500 hover:text-white transition-colors"
      >
        <Repeat className="w-4 h-4" />
        Repurpose this content
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white flex items-center gap-2">
          <Repeat className="w-4 h-4 text-purple-400" />
          Repurpose into…
        </h3>
        <button onClick={() => { setOpen(false); setResult(null); setError(null) }} className="text-gray-500 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      {!result && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {TRANSFORM_MODES.map(m => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                  mode === m.value
                    ? 'border-purple-500 bg-purple-500/10 text-purple-200'
                    : 'border-gray-800 text-gray-400 hover:border-gray-600'
                }`}
              >
                <div className="font-medium">{m.label}</div>
                <div className="text-gray-500 mt-0.5">{m.hint}</div>
              </button>
            ))}
          </div>

          <button
            onClick={handleRepurpose}
            disabled={transforming}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
          >
            {transforming ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {loadingSource ? 'Loading content…' : 'Generating…'}
              </>
            ) : (
              'Generate'
            )}
          </button>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </>
      )}

      {result && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">Generated {result.outputs?.length ?? 0} output(s) — saved to your Library.</p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {(result.outputs ?? []).map((o, i) => (
              <div key={i} className="rounded-lg bg-gray-800/60 p-3">
                <p className="text-xs font-medium text-gray-300 mb-1">{o.label}</p>
                <p className="text-xs text-gray-500 whitespace-pre-wrap line-clamp-4">{o.content}</p>
              </div>
            ))}
          </div>
          <button
            onClick={() => { setResult(null); setError(null) }}
            className="text-xs text-purple-400 hover:text-purple-300"
          >
            Repurpose into something else →
          </button>
        </div>
      )}
    </div>
  )
}


// Opened by clicking a ContentCard. Two responsibilities, both GTM Critical
// items whose natural home is "click into a piece of content in Library":
//   Item 4 — Artifact Version History: GET /api/artifacts/[id]/versions
//   Item 2 — Repurpose: extracts text from content.content (fetched via the
//            new GET /api/campaigns/[id] route) and posts it to /api/transform

interface VersionEntry {
  version: number
  score: number | null
  stampedAt: string
  artifactType?: string
}

function VersionHistorySection({ campaignId, scoreAfter }: { campaignId: string; scoreAfter: number | null }) {
  const [versions, setVersions] = useState<VersionEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState<'supabase' | 'unavailable' | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/artifacts/${campaignId}/versions`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        setVersions(d?.versions ?? [])
        setSource(d?.source ?? null)
      })
      .catch(() => { if (!cancelled) setVersions([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [campaignId])

  if (loading) {
    return <p className="text-xs text-gray-600">Loading version history…</p>
  }

  if (source === 'unavailable') {
    return (
      <p className="text-xs text-gray-600">
        Version history isn&rsquo;t available right now — the versioning table hasn&rsquo;t been provisioned yet.
      </p>
    )
  }

  if (!versions || versions.length === 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-gray-800/60">
          <span className="font-medium text-gray-300">v1 — Generated</span>
          {scoreAfter != null && (
            <span className={`font-medium ${scoreAfter >= 70 ? 'text-emerald-400' : scoreAfter >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
              Score: {scoreAfter}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-600 pt-1">
          Single version — no governance repairs were needed.
        </p>
      </div>
    )
  }

  // Build a narrative from the versions
  const firstScore = versions[0]?.score
  const lastScore = versions[versions.length - 1]?.score ?? scoreAfter
  const repairCount = versions.length - 1
  const improved = lastScore != null && firstScore != null && lastScore > firstScore

  return (
    <div className="space-y-3">
      {/* Governance narrative summary */}
      {versions.length > 1 && (
        <div className={`text-xs px-3 py-2.5 rounded-lg border ${
          improved ? 'bg-emerald-950/30 border-emerald-900/50 text-emerald-300' : 'bg-gray-800/40 border-gray-700/50 text-gray-400'
        }`}>
          {repairCount === 1
            ? `Quality check failed on first attempt — BrandOS automatically improved it.`
            : `Quality check failed ${repairCount} times — BrandOS repaired it ${repairCount} time${repairCount > 1 ? 's' : ''}.`
          }
          {firstScore != null && lastScore != null && (
            <span className="block mt-1 font-medium">
              Score went from {firstScore} → {lastScore}
              {improved ? ` (+${lastScore - firstScore})` : ''}
            </span>
          )}
        </div>
      )}

      {/* Version timeline */}
      <div className="space-y-1.5">
        {versions.map((v, i) => {
          const isFirst = i === 0
          const isLast = i === versions.length - 1
          const threshold = 70 // platform default
          const passed = v.score != null && v.score >= threshold
          const label = isFirst && versions.length > 1
            ? 'Initial generation'
            : i > 0 && i < versions.length - 1
            ? `Repair attempt ${i}`
            : isLast && versions.length > 1
            ? 'Final (delivered)'
            : 'Generated'

          return (
            <div key={v.version} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-gray-800/60">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  passed ? 'bg-emerald-400' : 'bg-amber-400'
                }`} />
                <span className="font-medium text-gray-300">v{v.version}</span>
                <span className="text-gray-600">{label}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-gray-600">{new Date(v.stampedAt).toLocaleDateString()}</span>
                {v.score != null && (
                  <span className={`font-medium ${passed ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {v.score} {passed ? '✓' : '✗'}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── P3.22 — Artifact lineage section ────────────────────────────────────────
// Shows sibling pieces in the same campaign brief inside the detail drawer.
// Data source: GET /api/campaigns filtered by campaign_brief_id (passed via
// query params if the route supports it, otherwise fetch all and filter client).

const FORMAT_BADGE_COLORS: Record<string, string> = {
  carousel:      'text-cyan-400 bg-cyan-950 border-cyan-800',
  post:          'text-blue-400 bg-blue-950 border-blue-800',
  linkedin_post: 'text-blue-400 bg-blue-950 border-blue-800',
  deck:          'text-purple-400 bg-purple-950 border-purple-800',
  report:        'text-amber-400 bg-amber-950 border-amber-800',
  newsletter:    'text-green-400 bg-green-950 border-green-800',
  article:       'text-gray-400 bg-gray-800 border-gray-700',
}

function ArtifactLineageSection({ briefId, briefTitle, currentId }: {
  briefId: string
  briefTitle?: string
  currentId: string
}) {
  const [siblings, setSiblings] = React.useState<ContentRow[]>([])
  const [loading, setLoading]   = React.useState(true)

  React.useEffect(() => {
    fetch('/api/campaigns?limit=50')
      .then(r => r.json())
      .then(d => {
        const all: ContentRow[] = d.campaigns ?? []
        setSiblings(all.filter(c => (c as any).campaign_brief_id === briefId && c.id !== currentId))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [briefId, currentId])

  if (loading) return null
  if (siblings.length === 0) return null

  return (
    <div className="mt-6">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Campaign lineage
        {briefTitle && <span className="normal-case font-normal text-gray-600 ml-1">— {briefTitle}</span>}
      </h3>
      <div className="space-y-1.5">
        {siblings.map(s => {
          const badgeColor = FORMAT_BADGE_COLORS[s.format] ?? 'text-gray-400 bg-gray-800 border-gray-700'
          return (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-800 bg-gray-900 text-xs">
              <span className={`px-1.5 py-0.5 rounded-full border text-xs shrink-0 ${badgeColor}`}>
                {s.format.replace('linkedin_', '')}
              </span>
              <span className="text-gray-300 flex-1 truncate">{s.title}</span>
              {s.qa_score_after != null && (
                <span className={`shrink-0 font-medium tabular-nums ${s.qa_score_after >= 70 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {s.qa_score_after}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ContentDetailDrawer({ content, onClose }: { content: ContentRow; onClose: () => void }) {
  const finalScore = content.qa_score_after
  const initialScore = content.qa_score_before
  const wasRepaired = initialScore != null && finalScore != null && finalScore > initialScore

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-gray-950 border-l border-gray-800 h-full overflow-y-auto p-6">
        <div className="flex items-start justify-between mb-6">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white truncate">{content.title}</h2>
            <p className="text-xs text-gray-500 capitalize mt-0.5">{content.format}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors shrink-0 ml-3">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quality score summary */}
        {finalScore != null && (
          <div className={`mb-5 px-4 py-3 rounded-xl border ${
            wasRepaired
              ? 'bg-emerald-950/20 border-emerald-900/50'
              : finalScore >= 70
              ? 'bg-gray-900 border-gray-800'
              : 'bg-amber-950/20 border-amber-900/50'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Quality score</span>
              <span className={`text-sm font-bold ${
                finalScore >= 70 ? 'text-emerald-400' : 'text-amber-400'
              }`}>
                {finalScore} / 100
              </span>
            </div>
            {wasRepaired && initialScore != null && (
              <p className="text-xs text-emerald-300/80 mt-1">
                Improved from {initialScore} → {finalScore} through automatic quality repair.
              </p>
            )}
            {!wasRepaired && finalScore >= 70 && (
              <p className="text-xs text-gray-500 mt-1">Passed quality gate on first generation.</p>
            )}
          </div>
        )}

        <RepurposeSection content={content} />

        {/* Newsletter artifact preview — rendered inline when format is newsletter */}
        {content.format === 'newsletter' && (content as any).content && (
          <div className="mt-6">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Preview</h3>
            <NewsletterRenderer artifact={(content as any).content as NewsletterArtifact} />
          </div>
        )}

        <div className="mt-6">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Generation Quality</h3>
          <VersionHistorySection campaignId={content.id} scoreAfter={content.qa_score_after} />
        </div>

        {/* P3.22 — Artifact lineage: show sibling pieces in the same campaign */}
        {(content as any).campaign_brief_id && (content as any).campaign_brief_id !== content.id && (
          <ArtifactLineageSection
            briefId={(content as any).campaign_brief_id}
            briefTitle={(content as any).campaign_brief_title}
            currentId={content.id}
          />
        )}
      </div>
    </div>
  )
}

// ─── Content tab (NEW — Phase 5) ──────────────────────────────────────────────
// Backed by /api/campaigns (built in Phase 2). Read-only list — no edit/
// archive contract exists for campaigns rows today (see route notes).

function ContentTab({ onCreateNew }: { onCreateNew: () => void }) {
  const [content, setContent] = useState<ContentRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<ContentRow['status'] | ''>('')

  const fetchContent = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (statusFilter) params.set('status', statusFilter)
      const res = await fetch(`/api/campaigns?${params}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to load content'); return }
      setContent(data.campaigns ?? [])
      setTotal(data.count ?? 0)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load content')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { fetchContent() }, [fetchContent])

  const [selected, setSelected] = useState<ContentRow | null>(null)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as ContentRow['status'] | '')}
          className="px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-300 focus:outline-none focus:border-gray-500"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="generated">Generated</option>
          <option value="exported">Exported</option>
          <option value="paid">Published</option>
        </select>

        {/* Campaign filter — campaign_brief_id column exists; switch to Campaigns tab to see grouped view */}
        <Link
          href="#"
          onClick={e => { e.preventDefault(); (document.querySelector('[data-tab="campaigns"]') as HTMLButtonElement)?.click() }}
          className="px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
        >
          View by Campaign
        </Link>

        <button
          onClick={fetchContent}
          className="p-2 border border-gray-700 rounded text-gray-400 hover:text-white transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        <span className="text-sm text-gray-600 ml-auto">
          {loading ? 'Loading…' : `${content.length} / ${total} items`}
        </span>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {!loading && !error && content.length === 0 && (
        <div className="text-center py-16 text-gray-600">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm mb-3">You haven&rsquo;t created anything yet — let&rsquo;s start.</p>
          <button onClick={onCreateNew} className="text-sm text-cyan-400 hover:text-cyan-300 font-medium">
            Create your first piece →
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 gap-3 text-gray-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading content…</span>
        </div>
      )}

      {!loading && content.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {content.map(c => <ContentCard key={c.id} content={c} onSelect={setSelected} />)}
        </div>
      )}

      {selected && (
        <ContentDetailDrawer content={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

// ─── P2.14 Campaigns tab — groups content by campaign_brief_id ───────────────
// campaign_brief_id and campaign_brief_title columns exist in the campaigns
// table (confirmed from schema_inventory). Content items without a brief_id
// are shown in an "Ungrouped" bucket so nothing is hidden.

const FORMAT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  carousel:      LayoutGrid,
  deck:          Presentation,
  report:        BookOpen,
  newsletter:    Mail,
  linkedin_post: FileText,
  article:       FileText,
}

interface CampaignBrief {
  id: string               // campaign_brief_id (or synthetic '__ungrouped__')
  title: string
  topic: string
  createdAt: string
  items: ContentRow[]
}

function CampaignsTab({ onCreateNew }: { onCreateNew: () => void }) {
  const [briefs, setBriefs]   = useState<CampaignBrief[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<ContentRow | null>(null)

  const fetchAndGroup = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/campaigns?limit=200')
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to load'); return }
      const all: ContentRow[] = data.campaigns ?? []

      // Group by campaign_brief_id; ungrouped items get their own bucket
      const map = new Map<string, CampaignBrief>()
      for (const item of all) {
        const bid = (item as any).campaign_brief_id ?? '__ungrouped__'
        const btitle = (item as any).campaign_brief_title ?? (bid === '__ungrouped__' ? 'Individual pieces' : item.title)
        if (!map.has(bid)) {
          map.set(bid, { id: bid, title: btitle, topic: item.topic, createdAt: item.created_at, items: [] })
        }
        map.get(bid)!.items.push(item)
      }
      const sorted = [...map.values()].sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      setBriefs(sorted)
      // Auto-expand the first brief
      if (sorted.length > 0) setExpanded(new Set([sorted[0]!.id]))
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchAndGroup() }, [fetchAndGroup])

  function toggle(id: string) {
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  if (loading) return (
    <div className="flex items-center justify-center py-16 gap-3 text-gray-600">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">Loading campaigns…</span>
    </div>
  )

  if (error) return (
    <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 text-sm text-red-400">{error}</div>
  )

  if (briefs.length === 0) return (
    <div className="text-center py-16 text-gray-600">
      <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="text-sm mb-3">No campaigns yet — create multi-format content to see it grouped here.</p>
      <button onClick={onCreateNew} className="text-sm text-cyan-400 hover:text-cyan-300 font-medium">
        Create your first campaign →
      </button>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {briefs.filter(b => b.id !== '__ungrouped__').length} campaigns · {briefs.flatMap(b => b.items).length} pieces
        </p>
        <button onClick={fetchAndGroup} className="p-2 border border-gray-700 rounded text-gray-400 hover:text-white transition-colors" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {briefs.map(brief => {
        const isOpen = expanded.has(brief.id)
        const isUngrouped = brief.id === '__ungrouped__'
        return (
          <div key={brief.id} className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
            <button
              onClick={() => toggle(brief.id)}
              className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-800/40 transition-colors"
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isUngrouped ? 'bg-gray-800' : 'bg-cyan-950'}`}>
                {isUngrouped ? <FileText className="w-4 h-4 text-gray-500" /> : <Sparkles className="w-4 h-4 text-cyan-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{brief.title}</p>
                <p className="text-xs text-gray-500 truncate">
                  {brief.items.length} piece{brief.items.length !== 1 ? 's' : ''} · {formatDate(brief.createdAt)}
                  {!isUngrouped && ` · ${brief.topic}`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Format badge pills */}
                <div className="hidden sm:flex gap-1">
                  {[...new Set(brief.items.map(i => i.format))].slice(0, 3).map(fmt => {
                    const Icon = FORMAT_ICON[fmt] ?? FileText
                    return (
                      <span key={fmt} className="flex items-center gap-1 text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                        <Icon className="w-3 h-3" />
                        {fmt.replace('linkedin_', '')}
                      </span>
                    )
                  })}
                </div>
                {isOpen ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-gray-800 divide-y divide-gray-800">
                {brief.items.map(item => (
                  <button
                    key={item.id}
                    onClick={() => setSelected(item)}
                    className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-gray-800/30 transition-colors"
                  >
                    {(() => { const Icon = FORMAT_ICON[item.format] ?? FileText; return <Icon className="w-4 h-4 text-gray-500 shrink-0" /> })()}
                    <span className="flex-1 text-sm text-gray-300 truncate">{item.title}</span>
                    {item.qa_score_after != null && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${item.qa_score_after >= 70 ? 'text-emerald-400 bg-emerald-400/10' : 'text-amber-400 bg-amber-400/10'}`}>
                        {item.qa_score_after}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${CONTENT_STATUS_CONFIG[item.status]?.color ?? 'text-gray-500 bg-gray-800'}`}>
                      {CONTENT_STATUS_CONFIG[item.status]?.label ?? item.status}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {selected && <ContentDetailDrawer content={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const router = useRouter()

  // P2.17: Three tabs — Knowledge Assets / Generated Content / Campaigns
  // "Knowledge Assets" positions uploaded files as intelligence inputs, not
  // just files. "Generated Content" is clear output. "Campaigns" (P2.14)
  // groups generated content by campaign_brief_id.
  const [libraryTab, setLibraryTab] = useState<'assets' | 'content' | 'campaigns'>('assets')

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Library</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Knowledge assets teach your brand · Generated content shows what the brand has created
            </p>
          </div>
        </div>

        {/* Three-tab navigation */}
        <div className="flex items-center gap-1 border-b border-gray-800">
          {([
            { id: 'assets',    label: 'Knowledge Assets',   'data-tab': 'assets'    },
            { id: 'content',   label: 'Generated Content',  'data-tab': 'content'   },
            { id: 'campaigns', label: 'Campaigns',          'data-tab': 'campaigns' },
          ] as const).map(t => (
            <button
              key={t.id}
              data-tab={t['data-tab']}
              onClick={() => setLibraryTab(t.id)}
              className={`px-3.5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                libraryTab === t.id
                  ? 'border-cyan-500 text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {libraryTab === 'assets'
          ? <AssetsTab />
          : libraryTab === 'content'
            ? <ContentTab onCreateNew={() => router.push('/workspace/create')} />
            : <CampaignsTab onCreateNew={() => router.push('/workspace/create')} />
        }
      </div>
    </div>
  )
}

// ─── Assets tab — ORIGINAL implementation, unchanged behavior ────────────────
// (was the entire default-exported page body before the redesign; now
// extracted as a tab so it can sit alongside the new Content tab.)

function AssetsTab() {

  const [assets, setAssets]       = useState<BrandAssetRow[]>([])
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [selected, setSelected]   = useState<BrandAssetRow | null>(null)

  // Filters
  const [search, setSearch]       = useState('')
  const [mimeFilter, setMimeFilter] = useState<'all' | 'image' | 'document'>('all')
  const [statusFilter, setStatusFilter] = useState<BrandAssetStatus | ''>('')

  const fetchAssets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '100', mimeCategory: mimeFilter })
      if (statusFilter) params.set('status', statusFilter)
      const res = await fetch(`/api/assets?${params}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to load assets'); return }
      setAssets(data.assets ?? [])
      setTotal(data.count ?? 0)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load assets')
    } finally {
      setLoading(false)
    }
  }, [mimeFilter, statusFilter])

  useEffect(() => { fetchAssets() }, [fetchAssets])

  // Filtered by search term (client-side)
  const filtered = assets.filter(a =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.original_filename.toLowerCase().includes(search.toLowerCase()) ||
    a.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
  )

  function handleUploaded(newAssets: BrandAssetRow[]) {
    setAssets(prev => {
      // Merge: update existing assets (from auto-analyze) or prepend new ones
      const updated = [...prev]
      for (const a of newAssets) {
        const idx = updated.findIndex(x => x.id === a.id)
        if (idx >= 0) updated[idx] = a
        else updated.unshift(a)
      }
      return updated
    })
    // Recalculate total only for genuinely new assets
    const genuinelyNew = newAssets.filter(a => !assets.some(x => x.id === a.id))
    if (genuinelyNew.length > 0) setTotal(prev => prev + genuinelyNew.length)
  }

  function handleUpdated(updated: BrandAssetRow) {
    setAssets(prev => prev.map(a => a.id === updated.id ? updated : a))
    if (selected?.id === updated.id) setSelected(updated)
  }

  function handleArchived(assetId: string) {
    setAssets(prev => prev.filter(a => a.id !== assetId))
    setTotal(prev => Math.max(0, prev - 1))
    setSelected(null)
  }

  return (
    <>
      <div className="space-y-6">
        {/* Upload zone */}
        <section>
          <h2 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">Upload assets</h2>
          <UploadZone onUploaded={handleUploaded} />
        </section>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search assets…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
            />
          </div>

          {/* Type filter */}
          <div className="flex rounded border border-gray-700 overflow-hidden text-sm">
            {(['all', 'image', 'document'] as const).map(v => (
              <button
                key={v}
                onClick={() => setMimeFilter(v)}
                className={`px-3 py-1.5 capitalize transition-colors ${
                  mimeFilter === v ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {v === 'all' ? 'All' : v === 'image' ? 'Images' : 'Docs'}
              </button>
            ))}
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            className="px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-300 focus:outline-none focus:border-gray-500"
          >
            <option value="">All statuses</option>
            <option value="indexed">Indexed</option>
            <option value="processing">Processing</option>
            <option value="failed">Failed</option>
            <option value="archived">Archived</option>
          </select>

          <button
            onClick={fetchAssets}
            className="p-2 border border-gray-700 rounded text-gray-400 hover:text-white transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <span className="text-sm text-gray-600 ml-auto">
            {loading ? 'Loading…' : `${filtered.length} / ${total} assets`}
          </span>
        </div>

        {/* Asset grid */}
        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-16 text-gray-600">
            <Image className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No assets yet. Upload files above to get started.</p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-16 gap-3 text-gray-600">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading assets…</span>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map(asset => (
              <AssetCard key={asset.id} asset={asset} onSelect={setSelected} />
            ))}
          </div>
        )}
      </div>

      {/* Asset detail drawer */}
      {selected && (
        <AssetDrawer
          asset={selected}
          onClose={() => setSelected(null)}
          onUpdated={handleUpdated}
          onArchived={handleArchived}
        />
      )}
    </>
  )
}