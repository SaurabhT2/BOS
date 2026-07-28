'use client'

/**
 * InspectPanel — the single consolidated home for RuntimeOS observability.
 *
 * Iteration 3 (Artifact-first redesign): replaces three previously separate
 * surfaces — the inline "Semantic Richness" block, the per-slide density
 * badges, and the generation_trace footer that were each duplicated across
 * CarouselRenderer / DeckRenderer / ReportRenderer — plus apps/web's
 * WhyThisPanel and the Advanced rail's session-details view, with one panel.
 *
 * Design intent (per the approved Iteration 2 redesign):
 *   - Closed by default. Nothing in here renders on load.
 *   - Five pillars, always present as tabs — Execution / Quality / Knowledge /
 *     Identity / Learning — even when a given artifact has no data for one
 *     (an honest empty state beats hiding the tab, since the taxonomy itself
 *     is meant to be predictable across every artifact type).
 *   - Pure display component: no fetch, no business logic. Learning's
 *     feedback buttons call back into `onSubmitFeedback` supplied by the
 *     caller (apps/web owns the actual API call), matching this package's
 *     "no business logic" boundary.
 */

import { useState } from 'react'
import { ChevronDown, Cpu, Gauge, Library, Fingerprint, GraduationCap, ThumbsUp, ThumbsDown } from 'lucide-react'
import type { ArtifactInsightSections } from './insights'

type PillarId = 'execution' | 'quality' | 'knowledge' | 'identity' | 'learning'

const PILLARS: { id: PillarId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'execution', label: 'Execution', icon: Cpu },
  { id: 'quality', label: 'Quality', icon: Gauge },
  { id: 'knowledge', label: 'Knowledge', icon: Library },
  { id: 'identity', label: 'Identity', icon: Fingerprint },
  { id: 'learning', label: 'Learning', icon: GraduationCap },
]

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-600 italic py-4 text-center">{children}</p>
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-800/60 last:border-b-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs text-gray-200 font-medium tabular-nums">{value}</span>
    </div>
  )
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  const color = value >= 70 ? 'text-emerald-400' : value >= 40 ? 'text-amber-400' : 'text-red-400'
  const barColor = value >= 70 ? 'bg-emerald-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400">{label}</span>
        <span className={`text-xs font-bold tabular-nums ${color}`}>{value}</span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-1">
        <div className={`h-1 rounded-full ${barColor}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function ExecutionTab({ data }: { data?: ArtifactInsightSections['execution'] }) {
  if (!data) return <EmptyState>No execution trace recorded for this artifact.</EmptyState>
  const outcomeLabel =
    data.governanceOutcome === 'passed_after_repair'
      ? `Repaired (${data.repairAttempts ?? 0} attempt${data.repairAttempts === 1 ? '' : 's'})`
      : data.governanceOutcome === 'bypassed'
        ? 'Bypassed'
        : 'Passed on first pass'
  return (
    <div>
      <Row label="Outcome" value={outcomeLabel} />
      <Row label="Provider" value={data.provider} />
      <Row label="Mode" value={data.generationMode} />
      <Row label="Compilation strategy" value={data.oclStrategy} />
      <Row label="Generated at" value={data.generatedAt ? new Date(data.generatedAt).toLocaleString() : undefined} />
    </div>
  )
}

function QualityTab({ data }: { data?: ArtifactInsightSections['quality'] }) {
  if (!data) return <EmptyState>No quality metrics recorded for this artifact.</EmptyState>
  return (
    <div>
      {typeof data.overallScore === 'number' && <ScoreRow label="Overall" value={data.overallScore} />}
      {data.scores.map((s) => (
        <ScoreRow key={s.label} label={s.label} value={s.value} />
      ))}
      <div className="flex justify-between text-[11px] text-gray-600 mt-2 pt-2 border-t border-gray-800/60">
        {typeof data.totalWords === 'number' && <span>{data.totalWords} words total</span>}
        {typeof data.avgWordsPerUnit === 'number' && <span>{data.avgWordsPerUnit} avg/unit</span>}
      </div>
    </div>
  )
}

function KnowledgeTab({ data }: { data?: ArtifactInsightSections['knowledge'] }) {
  if (!data || data.length === 0) {
    return <EmptyState>No knowledge sources were used for this artifact.</EmptyState>
  }
  return (
    <div className="space-y-2">
      {data.map((item, i) => (
        <div key={i} className="p-2 rounded-lg bg-gray-900 border border-gray-800">
          <p className="text-xs text-gray-300">{item.label}</p>
          {item.value && <p className="text-sm text-emerald-400 font-medium tabular-nums">{item.value}</p>}
          {item.source && <p className="text-[11px] text-gray-600 mt-0.5">{item.source}</p>}
        </div>
      ))}
    </div>
  )
}

function IdentityTab({ data }: { data?: ArtifactInsightSections['identity'] }) {
  if (!data || data.brandMemoryApplied === undefined) {
    return <EmptyState>No brand identity information recorded for this artifact.</EmptyState>
  }
  return (
    <div>
      <Row label="Brand Memory" value={data.brandMemoryApplied ? 'Applied' : 'Off for this generation'} />
    </div>
  )
}

function LearningTab({ data }: { data?: ArtifactInsightSections['learning'] }) {
  const hasViolations = (data?.resolvedViolations?.length ?? 0) > 0
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">Was this useful?</span>
        {data?.feedbackSubmitted ? (
          <span className="text-xs text-emerald-400">Thanks — feedback recorded</span>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => data?.onSubmitFeedback?.('useful')}
              className="flex items-center gap-1 px-2.5 py-1 bg-gray-800 hover:bg-emerald-600/20 hover:text-emerald-400 border border-gray-700 rounded text-xs transition-all"
            >
              <ThumbsUp className="w-3 h-3" />Yes
            </button>
            <button
              onClick={() => data?.onSubmitFeedback?.('generic')}
              className="flex items-center gap-1 px-2.5 py-1 bg-gray-800 hover:bg-red-600/20 hover:text-red-400 border border-gray-700 rounded text-xs transition-all"
            >
              <ThumbsDown className="w-3 h-3" />Generic
            </button>
          </div>
        )}
      </div>
      {hasViolations ? (
        <div>
          <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">Repaired before passing</p>
          <ul className="space-y-1">
            {data!.resolvedViolations!.map((v, i) => (
              <li key={i} className="text-xs text-gray-400 pl-3 border-l border-gray-700">{v}</li>
            ))}
          </ul>
        </div>
      ) : (
        <EmptyState>No repair history for this artifact.</EmptyState>
      )}
    </div>
  )
}

export interface InspectPanelProps {
  sections: ArtifactInsightSections
  className?: string
}

export function InspectPanel({ sections, className = '' }: InspectPanelProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<PillarId>('execution')

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="inspect-panel-body"
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        Inspect
      </button>

      {open && (
        <div
          id="inspect-panel-body"
          role="region"
          aria-label="Artifact inspection details"
          className="mt-2 border border-gray-800 rounded-xl bg-gray-950 overflow-hidden"
        >
          <div className="flex border-b border-gray-800 overflow-x-auto" role="tablist">
            {PILLARS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={active === id}
                onClick={() => setActive(id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  active === id
                    ? 'border-cyan-400 text-cyan-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
          <div className="p-4" role="tabpanel">
            {active === 'execution' && <ExecutionTab data={sections.execution} />}
            {active === 'quality' && <QualityTab data={sections.quality} />}
            {active === 'knowledge' && <KnowledgeTab data={sections.knowledge} />}
            {active === 'identity' && <IdentityTab data={sections.identity} />}
            {active === 'learning' && <LearningTab data={sections.learning} />}
          </div>
        </div>
      )}
    </div>
  )
}

export default InspectPanel
