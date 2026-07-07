'use client'

/**
 * ReportRenderer — renders a canonical ReportArtifact.
 *
 * Owned capability: presentation.render.report
 *
 * Deterministic rendering — no semantic inference happens here.
 * All content comes from the artifact. Renderer displays what exists.
 *
 * Renders:
 *   - Artifact-level: title, executive summary, section count, metadata
 *   - Per-section: heading, type badge, body, key_findings, data_points, callout, citations
 *
 * FIXES (presentation-layer cleanup):
 *   - getSectionColor now uses section.type field (not section.heading string)
 *   - Removed duplicate "Callout" block that re-rendered section.body after "Body"
 *   - Removed duplicate "Citations" block that re-rendered data_points after "Data Points"
 *   - Unused imports (AlertCircle, Quote) removed
 */

import { useState } from 'react'
import {
  ChevronDown, ChevronUp, FileText, BarChart2,
  Copy, Check,
} from 'lucide-react'
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

// ─── Section card ─────────────────────────────────────────────────────────────

function ReportSectionCard({
  section,
  index,
  isExpanded,
  onToggle,
  onCopy,
  isCopied,
}: {
  section: NonNullable<ReportArtifact['sections'][number]>
  index: number
  isExpanded: boolean
  onToggle: () => void
  onCopy: () => void
  isCopied: boolean
}) {
  // Use section.type for color coding if present; fall back to 'findings' default.
  // section.heading is the human-readable title — not a type discriminant.
  const sectionType = ((section as unknown) as Record<string, unknown>).type as string | undefined
  const gradient = getSectionColor(sectionType ?? 'findings')
  const label    = getSectionLabel(sectionType ?? 'findings')

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden bg-gray-950">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-900/60 transition-colors"
        onClick={onToggle}
      >
        <div
          className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white bg-gradient-to-br ${gradient} flex-shrink-0`}
        >
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <span className={`text-xs font-semibold uppercase tracking-wider bg-gradient-to-r ${gradient} bg-clip-text text-transparent`}>
            {label}
          </span>
          <p className="text-sm text-white font-medium truncate mt-0.5">{section.heading}</p>
        </div>
        {isExpanded
          ? <ChevronUp className="w-4 h-4 text-gray-500 flex-shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
        }
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-800/60 space-y-4 pt-3">

          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Heading</p>
            <p className="text-sm text-white font-semibold leading-snug">{section.heading}</p>
            {section.subheading && (
              <p className="text-sm text-gray-400 mt-1">{section.subheading}</p>
            )}
          </div>

          {section.body && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Body</p>
              <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{section.body}</p>
            </div>
          )}

          {section.key_findings && section.key_findings.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Key Points</p>
              <ul className="space-y-1.5">
                {section.key_findings.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                    <span className="text-cyan-500 mt-0.5 flex-shrink-0">→</span>
                    <span className="leading-relaxed">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
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
      )}
    </div>
  )
}

// ─── Main renderer ────────────────────────────────────────────────────────────

interface ReportRendererProps {
  artifact: ReportArtifact
  onCopySection?: (section: ReportArtifact['sections'][number]) => void
}

export function ReportRenderer({ artifact, onCopySection }: ReportRendererProps) {
  const [expandedSection, setExpandedSection] = useState<number | null>(0)
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
    <div className="space-y-4">
      <ReportHeader artifact={artifact} />

      {artifact.sections.map((section, index) => (
        <ReportSectionCard
          key={section.id ?? index}
          section={section}
          index={index}
          isExpanded={expandedSection === index}
          onToggle={() => setExpandedSection(expandedSection === index ? null : index)}
          onCopy={() => handleCopy(section, index)}
          isCopied={copiedSection === index}
        />
      ))}

      {artifact.generation_trace && (
        <div className="text-[10px] text-gray-700 text-center pt-2 space-y-0.5">
          <p>Generated {new Date(artifact.generation_trace.generated_at).toLocaleTimeString()}</p>
          <p>
            {artifact.generation_trace.governance_outcome === 'passed_after_repair'
              ? `Repaired (${artifact.generation_trace.repair_attempts} attempt${artifact.generation_trace.repair_attempts !== 1 ? 's' : ''})`
              : 'Passed governance'
            }
            {' · '}
            {artifact.generation_trace.provider ?? 'unknown provider'}
          </p>
        </div>
      )}
    </div>
  )
}
export default ReportRenderer


