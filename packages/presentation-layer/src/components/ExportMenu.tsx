'use client'

/**
 * ExportMenu — the single export workflow for the artifact-first experience.
 *
 * Iteration 3 (Artifact-first redesign): replaces the previous ExportToolbar
 * cluster (standalone Copy button, primary Export button, "More export
 * options" menu, and an "ISkill validated" pill all visible at once) with one
 * dominant action.
 *
 * Default behavior: clicking "Export" downloads the recommended format for
 * this artifact type immediately — no intermediate dialog for the common
 * case. Secondary formats are one click away in the menu (each row triggers
 * its own download immediately, no separate "Download" confirm step).
 * Multi-format batch export is real but deliberately tucked behind a labeled
 * link rather than being the default interaction, since it's the rare case.
 *
 * Pure UI: every action is a caller-supplied callback. This component never
 * calls fetch — apps/web owns the actual export request and blob download.
 */

import { useState, useRef, useEffect } from 'react'
import { Download, Loader2, Check } from 'lucide-react'

export interface ExportFormatOption {
  id: string
  label: string
}

export interface ExportMenuProps {
  /** The format downloaded immediately on the primary button click. */
  recommendedFormat: ExportFormatOption
  /** Every other format, available from the menu. */
  secondaryFormats: ExportFormatOption[]
  /** Called with a single format id to export it immediately. */
  onExport: (formatId: string) => void | Promise<void>
  /** Called with a list of format ids for the batch path. */
  onExportBatch?: (formatIds: string[]) => void | Promise<void>
  /** Called to copy the artifact as plain text — folded into the menu rather than a standalone top-level button. */
  onCopyText?: () => void | Promise<void>
  /** Called to copy the artifact's raw JSON — the one developer-facing escape hatch, kept as a small link rather than a peer action. */
  onCopyJSON?: () => void | Promise<void>
  /** Format id currently exporting, if any — shows a spinner on that row. */
  busyFormatId?: string | null
  className?: string
}

export function ExportMenu({
  recommendedFormat,
  secondaryFormats,
  onExport,
  onExportBatch,
  onCopyText,
  onCopyJSON,
  busyFormatId = null,
  className = '',
}: ExportMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [batchSelection, setBatchSelection] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setBatchMode(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const allFormats = [recommendedFormat, ...secondaryFormats]

  const handleCopy = async () => {
    await onCopyText?.()
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const toggleBatch = (id: string) => {
    setBatchSelection((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div ref={containerRef} className={`relative inline-flex items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => onExport(recommendedFormat.id)}
        disabled={busyFormatId === recommendedFormat.id}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
      >
        {busyFormatId === recommendedFormat.id
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <Download className="w-4 h-4" />
        }
        Export
      </button>

      <button
        type="button"
        aria-label="More export formats"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        className="px-2 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 text-xs transition-colors"
      >
        ▾
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-2 w-64 border border-gray-700 rounded-xl bg-gray-950 shadow-xl z-20 py-1">
          <div className="px-3 py-2 text-[10px] text-gray-500 uppercase tracking-widest">
            Export as {recommendedFormat.label}
          </div>
          <button
            onClick={() => { onExport(recommendedFormat.id); setMenuOpen(false) }}
            className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-200 hover:bg-gray-900 transition-colors"
          >
            {recommendedFormat.label}
            <Download className="w-3.5 h-3.5 text-gray-500" />
          </button>

          {onCopyText && (
            <button
              onClick={handleCopy}
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-200 hover:bg-gray-900 transition-colors"
            >
              Copy as text
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : null}
            </button>
          )}

          {secondaryFormats.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] text-gray-500 uppercase tracking-widest border-t border-gray-800 mt-1">
                More formats
              </div>
              {secondaryFormats.map((f) => (
                <button
                  key={f.id}
                  onClick={() => { onExport(f.id); setMenuOpen(false) }}
                  disabled={busyFormatId === f.id}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-200 hover:bg-gray-900 disabled:opacity-60 transition-colors"
                >
                  {f.label}
                  {busyFormatId === f.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />
                    : <Download className="w-3.5 h-3.5 text-gray-500" />
                  }
                </button>
              ))}
            </>
          )}

          {(onExportBatch || onCopyJSON) && (
            <div className="border-t border-gray-800 mt-1 pt-1">
              {onExportBatch && !batchMode && (
                <button
                  onClick={() => setBatchMode(true)}
                  className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Export several formats at once ›
                </button>
              )}
              {onCopyJSON && !batchMode && (
                <button
                  onClick={() => { onCopyJSON(); setMenuOpen(false) }}
                  className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Developer format (JSON)
                </button>
              )}
              {onExportBatch && batchMode && (
                <div className="px-3 py-2 space-y-1.5">
                  {allFormats.map((f) => (
                    <label key={f.id} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={batchSelection.has(f.id)}
                        onChange={() => toggleBatch(f.id)}
                        className="rounded border-gray-600 bg-gray-800"
                      />
                      {f.label}
                    </label>
                  ))}
                  <button
                    onClick={async () => {
                      if (batchSelection.size === 0) return
                      await onExportBatch(Array.from(batchSelection))
                      setMenuOpen(false)
                      setBatchMode(false)
                      setBatchSelection(new Set())
                    }}
                    disabled={batchSelection.size === 0}
                    className="w-full mt-1 px-2 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-xs text-gray-200 transition-colors"
                  >
                    Download {batchSelection.size || ''} format{batchSelection.size === 1 ? '' : 's'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ExportMenu
