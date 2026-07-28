'use client'

/**
 * ReportRenderer — renders a canonical ReportArtifact.
 *
 * Owned capability: presentation.render.report
 *
 * Deterministic rendering — no semantic inference happens here.
 * All content comes from the artifact. Renderer displays what exists.
 *
 * Iteration 3 (Artifact-first redesign): a report is meant to be read, not
 * paged through — every section now renders in full, in reading order, with
 * no accordion toggle. The generation_trace footer was removed (see
 * ./insights.ts — that data now feeds the Inspect panel via
 * buildExecutionInsight, rendered by the caller alongside this component).
 *
 * Renders:
 *   - Artifact-level: title, executive summary, section count, metadata
 *   - Per-section: heading, type badge, body, key_findings, data_points, callout
 */

import { useState } from 'react'
import { FileText, BarChart2, Copy, Check } from 'lucide-react'
import type { ReportArtifact } from '@brandos/contracts'

// ─── Section type metadata ────────────────────────────────────────────────────

type ReportSectionType = 'executive_summary' | 'findings' | 'data' | 'recommendations' | 'appendix' | 'cover'

const SECTION_TYPE_COLORS: Record<ReportSectionType | string, string> = {
  executive_summary: 'from-blue-500 to-indigo-600',
  findings:          'from-emerald-500 to-teal-600',
  data:              'from-violet-500 to-purple-600',
  recommendations:   'from-amber-500 to-orange-600',
  appendix:          'from-gray-400 to-gray-500',
  cover:             'from-cyan-500 to-blue-600',
}

const SECTION_TYPE_LABELS: Record<ReportSectionType | string, string> = {
  executive_summary: 'Executive Summary',
  findings:          'Findings',
  data:              'Data',
  recommendations:   'Recommendations',
  appendix:          'Appendix',
  cover:             'Cover',
}

function getSectionColor(type: string): string {
  return SECTION_TYPE_COLORS[type] ?? 'from-gray-500 to-gray-600'
}

function getSectionLabel(type: string): string {
  return SECTION_TYPE_LABELS[type] ?? type
}

// ─── Report header ────────────────────────────────────────────────────────────

function ReportHeader({ artifact }: { artifact?: ReportArtifact }) {
  if (!artifact) return null
  const m = artifact.report_meta

  return (
    <div className="border border-gray-700 rounded-xl bg-gray-950 p-4 mb-4 space-y-3">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <FileText className="w-4 h-4 text-blue-400" />
          <span className="text-[10px] text-blue-400 uppercase tracking-widest font-medium">Report</span>
        </div>
        <h2 className="text-white font-bold text-lg leading-tight">{artifact.title}</h2>
        {artifact.summary && (
          <p className="text-gray-400 text-sm mt-1">{artifact.summary}</p>
        )}
      </div>

      {artifact.summary && (
        <div className="p-3 rounded-lg bg-blue-950/30 border border-blue-800/30">
          <p className="text-xs text-blue-400 uppercase tracking-wider mb-1.5">Executive Summary</p>
          <p className="text-sm text-gray-200 leading-relaxed">{artifact.summary}</p>
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>{artifact.sections.length} sections</span>
        {m?.word_count && (
          <>
            <span>·</span>
            <span>~{m.word_count.toLocaleString()} words</span>
          </>
        )}
        {m?.estimated_read_minutes && (
          <>
            <span>·</span>
            <span>~{m.estimated_read_minutes}m read</span>
          </>
        )}
        {m?.report_type && (
          <>
            <span>·</span>
            <span className="capitalize">{m.report_type.replace('_', ' ')}</span>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Section — always fully rendered, document-style ─────────────────────────

function ReportSection({
  section,
  index,
  onCopy,
  isCopied,
}: {
  section: NonNullable<ReportArtifact['sections'][number]>
  index: number
  onCopy: () => void
  isCopied: boolean
}) {
  const sectionType = ((section as unknown) as Record<string, unknown>).type as string | undefined
  const gradient = getSectionColor(sectionType ?? 'findings')
  const label    = getSectionLabel(sectionType ?? 'findings')

  return (
    <div className="border-b border-gray-800/60 last:border-b-0 py-5 first:pt-0">
      <div className="flex items-center gap-3 mb-3">
        <div
          className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white bg-gradient-to-br ${gradient} flex-shrink-0`}
        >
          {index + 1}
        </div>
        <span className={`text-xs font-semibold uppercase tracking-wider bg-gradient-to-r ${gradient} bg-clip-text text-transparent`}>
          {label}
        </span>
      </div>

      <div className="pl-10 space-y-3">
        <div>
          <p className="text-base text-white font-semibold leading-snug">{section.heading}</p>
          {section.subheading && (
            <p className="text-sm text-gray-400 mt-1">{section.subheading}</p>
          )}
        </div>

        {section.body && (
          <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{section.body}</p>
        )}

        {section.key_findings && section.key_findings.length > 0 && (
          <ul className="space-y-1.5">
            {section.key_findings.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                <span className="text-cyan-500 mt-0.5 flex-shrink-0">→</span>
                <span className="leading-relaxed">{b}</span>
              </li>
            ))}
          </ul>
        )}

        {section.data_points && section.data_points.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <BarChart2 className="w-3 h-3 text-emerald-400" />
              <p className="text-xs text-emerald-400 uppercase tracking-wider">Data Points</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {section.data_points.map((stat, i) => (
                <div key={i} className="p-2 rounded-lg bg-gray-900 border border-gray-800">
                  <p className="text-base font-bold text-emerald-400 tabular-nums">{stat.value}</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">{stat.label}</p>
                  {stat.source && (
                    <p className="text-xs text-gray-600 mt-1">{stat.source}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={onCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
        >
          {isCopied
            ? <><Check className="w-3 h-3 text-emerald-400" />Copied</>
            : <><Copy className="w-3 h-3" />Copy section text</>
          }
        </button>
      </div>
    </div>
  )
}

// ─── Plain-text extraction ─────────────────────────────────────────────────
// Consumed by apps/web's unified ExportMenu ("Copy as text").

export function extractReportPlainText(artifact: ReportArtifact): string {
  const parts: (string | undefined)[] = [artifact.title, artifact.summary, '']
  artifact.sections.forEach((section) => {
    parts.push(section.heading)
    if (section.subheading) parts.push(section.subheading)
    if (section.body) parts.push(section.body)
    if (section.key_findings) parts.push(...section.key_findings.map(k => `• ${k}`))
    if (section.data_points) parts.push(...section.data_points.map(d => `${d.value} — ${d.label}`))
    parts.push('')
  })
  return parts.filter((p): p is string => Boolean(p)).join('\n')
}

// ─── Main renderer ────────────────────────────────────────────────────────────

interface ReportRendererProps {
  artifact: ReportArtifact
  onCopySection?: (section: ReportArtifact['sections'][number]) => void
}

export function ReportRenderer({ artifact, onCopySection }: ReportRendererProps) {
  const [copiedSection, setCopiedSection] = useState<number | null>(null)

  const handleCopy = (section: ReportArtifact['sections'][number], index: number) => {
    const parts = [
      section.heading,
      section.subheading,
      section.body,
      ...(section.key_findings ?? []),
      ...(section.data_points?.map(s => `${s.value} — ${s.label}`) ?? []),
    ].filter(Boolean)
    const text = parts.join('\n\n')
    navigator.clipboard.writeText(text).catch(() => {})
    setCopiedSection(index)
    setTimeout(() => setCopiedSection(null), 1800)
    onCopySection?.(section)
  }

  return (
    <div className="space-y-0">
      <ReportHeader artifact={artifact} />

      <div className="border border-gray-800 rounded-xl bg-gray-950 px-4">
        {artifact.sections.map((section, index) => (
          <ReportSection
            key={section.id ?? index}
            section={section}
            index={index}
            onCopy={() => handleCopy(section, index)}
            isCopied={copiedSection === index}
          />
        ))}
      </div>
    </div>
  )
}
export default ReportRenderer
