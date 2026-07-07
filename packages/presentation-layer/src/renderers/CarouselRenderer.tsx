'use client'

/**
 * CarouselRenderer — renders a canonical CarouselArtifact.
 *
 * UPDATED: was CarouselBlueprint input, now CarouselArtifact.
 *
 * Deterministic rendering — no semantic inference happens here.
 * All content comes from the artifact. Renderer displays what exists.
 *
 * Renders:
 *   - Artifact-level: title, hook, summary, cta, narrative arc
 *   - Richness telemetry: overall_score, density, evidence, persuasion
 *   - Per-slide: headline, subheadline, body, bullets, insight, key_takeaway,
 *                supporting_evidence, cta, visual_direction, speaker_notes
 *   - Semantic density badge per slide
 */

import { useState } from 'react'
import {
  ChevronDown, ChevronUp, Copy, Check,
  Lightbulb, Target, BarChart2, BookOpen, Zap,
} from 'lucide-react'
import type { CarouselArtifact, RichCarouselSlide } from '@brandos/contracts'

// ─── Role metadata ────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<RichCarouselSlide['role'], string> = {
  hook:      'from-cyan-500 to-blue-600',
  problem:   'from-red-500 to-rose-600',
  reframe:   'from-violet-500 to-purple-600',
  framework: 'from-amber-500 to-orange-600',
  evidence:  'from-emerald-500 to-teal-600',
  insight:   'from-pink-500 to-rose-600',
  cta:       'from-cyan-500 to-blue-600',
}

const ROLE_LABELS: Record<RichCarouselSlide['role'], string> = {
  hook:      'Hook',
  problem:   'Problem',
  reframe:   'Reframe',
  framework: 'Framework',
  evidence:  'Evidence',
  insight:   'Insight',
  cta:       'CTA',
}

// ─── Score badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ value = 0, label = "" }: { value?: number; label?: string; children?: React.ReactNode }) {
  const color = value >= 70 ? 'text-emerald-400' : value >= 40 ? 'text-amber-400' : 'text-red-400'
  return (
    <span className="flex flex-col items-center">
      <span className={`text-base font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-[10px] text-gray-500 uppercase tracking-widest">{label}</span>
    </span>
  )
}

// ─── Richness telemetry bar ───────────────────────────────────────────────────

function RichnessBar({ score = 0 }: { score?: number; children?: React.ReactNode }) {
  const color = score >= 70 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="w-full bg-gray-800 rounded-full h-1.5 mt-1">
      <div className={`h-1.5 rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
    </div>
  )
}

// ─── Artifact-level header ────────────────────────────────────────────────────

function ArtifactHeader({ artifact }: { artifact?: CarouselArtifact; children?: React.ReactNode }) {
  if (!artifact) return null;
  const m = artifact.richness_metrics
  return (
    <div className="border border-gray-700 rounded-xl bg-gray-950 p-4 mb-4 space-y-3">
      {/* Title + hook */}
      <div>
        <h2 className="text-white font-bold text-lg leading-tight">{artifact.title}</h2>
        {artifact.hook && artifact.hook !== artifact.title && (
          <p className="text-cyan-400 text-sm mt-1 italic">"{artifact.hook}"</p>
        )}
      </div>

      {/* Summary */}
      {artifact.summary && (
        <p className="text-gray-400 text-sm leading-relaxed">{artifact.summary}</p>
      )}

      {/* Narrative arc */}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <BookOpen className="w-3 h-3" />
        <span className="capitalize">{artifact.narrative_arc.structure.replace('-', ' ')}</span>
        <span>·</span>
        <span>{artifact.carousel_meta.slide_count} slides</span>
        {artifact.carousel_meta.estimated_read_seconds && (
          <>
            <span>·</span>
            <span>~{Math.ceil(artifact.carousel_meta.estimated_read_seconds / 60)}m read</span>
          </>
        )}
      </div>

      {/* Richness metrics */}
      <div className="border-t border-gray-800 pt-3">
        <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Semantic Richness</p>
        <div className="grid grid-cols-4 gap-3">
          <ScoreBadge value={m.overall_score} label="Overall" />
          <ScoreBadge value={m.density_score} label="Density" />
          <ScoreBadge value={m.evidence_score} label="Evidence" />
          <ScoreBadge value={m.persuasion_score} label="Persuasion" />
        </div>
        <RichnessBar score={m.overall_score} />
        <div className="flex justify-between text-[10px] text-gray-600 mt-1">
          <span>{m.total_content_words} words total</span>
          <span>{m.avg_words_per_unit} avg/slide</span>
          <span>CTA quality: {m.cta_quality_score}</span>
        </div>
      </div>

      {/* CTA pill */}
      {artifact.cta && (
        <div className="flex items-center gap-2">
          <Target className="w-3 h-3 text-cyan-500 flex-shrink-0" />
          <span className="text-xs text-cyan-400 font-medium">{artifact.cta}</span>
        </div>
      )}

      {/* Palette */}
      {artifact.carousel_meta.palette.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 uppercase tracking-widest">Palette</span>
          <div className="flex gap-1">
            {artifact.carousel_meta.palette.map((hex, i) => (
              <div
                key={i}
                className="w-4 h-4 rounded-full border border-gray-700"
                style={{ backgroundColor: hex }}
                title={hex}
              />
            ))}
          </div>
          <span className="text-[10px] text-gray-600">{artifact.carousel_meta.font_style}</span>
        </div>
      )}
    </div>
  )
}

// ─── Rich slide expander ──────────────────────────────────────────────────────

function SlideCard({
  slide,
  isExpanded = false,
  onToggle = () => {},
  onCopy = () => {},
  isCopied = false,
}: {
  slide?: RichCarouselSlide
  isExpanded?: boolean
  onToggle?: () => void
  onCopy?: () => void
  isCopied?: boolean
  children?: React.ReactNode
}) {
  if (!slide) return null;
  const gradient = ROLE_COLORS[slide.role]
  const density = slide.semantic_density_score ?? 0
  const densityColor = density >= 60 ? 'text-emerald-400' : density >= 30 ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden bg-gray-950">
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-900/60 transition-colors"
        onClick={onToggle}
      >
        <div
          className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white bg-gradient-to-br ${gradient} flex-shrink-0`}
        >
          {slide.slide}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold uppercase tracking-wider bg-gradient-to-r ${gradient} bg-clip-text text-transparent`}>
              {ROLE_LABELS[slide.role]}
            </span>
            {/* Density badge */}
            <span className={`text-[10px] tabular-nums ${densityColor}`}>
              {density > 0 && `${density}d`}
            </span>
          </div>
          <p className="text-sm text-white font-medium truncate mt-0.5">{slide.headline}</p>
        </div>
        {isExpanded
          ? <ChevronUp className="w-4 h-4 text-gray-500 flex-shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
        }
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-800/60 space-y-4 pt-3">

          {/* Headline */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Headline</p>
            <p className="text-sm text-white font-semibold leading-snug">{slide.headline}</p>
            {slide.subheadline && (
              <p className="text-sm text-gray-400 mt-1 leading-snug">{slide.subheadline}</p>
            )}
          </div>

          {/* Body */}
          {slide.body && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Body</p>
              <p className="text-sm text-gray-300 leading-relaxed">{slide.body}</p>
            </div>
          )}

          {/* Bullets */}
          {slide.bullets && slide.bullets.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Bullets</p>
              <ul className="space-y-1.5">
                {slide.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                    <span className="text-cyan-500 mt-0.5 flex-shrink-0">→</span>
                    <span className="leading-relaxed">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Insight */}
          {slide.insight && (
            <div className="p-3 rounded-lg bg-violet-950/30 border border-violet-800/30">
              <div className="flex items-center gap-1.5 mb-1">
                <Lightbulb className="w-3 h-3 text-violet-400" />
                <p className="text-xs text-violet-400 uppercase tracking-wider font-medium">Insight</p>
              </div>
              <p className="text-sm text-gray-200 leading-relaxed">{slide.insight}</p>
            </div>
          )}

          {/* Supporting evidence */}
          {slide.supporting_evidence && slide.supporting_evidence.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <BarChart2 className="w-3 h-3 text-emerald-400" />
                <p className="text-xs text-emerald-400 uppercase tracking-wider">Evidence</p>
              </div>
              <ul className="space-y-1">
                {slide.supporting_evidence.map((e, i) => (
                  <li key={i} className="text-xs text-gray-400 leading-relaxed pl-3 border-l border-emerald-700">
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Key takeaway */}
          {slide.key_takeaway && (
            <div className="p-3 rounded-lg bg-cyan-950/30 border border-cyan-800/30">
              <div className="flex items-center gap-1.5 mb-1">
                <Zap className="w-3 h-3 text-cyan-400" />
                <p className="text-xs text-cyan-400 uppercase tracking-wider font-medium">Key Takeaway</p>
              </div>
              <p className="text-sm text-white font-medium leading-snug">{slide.key_takeaway}</p>
            </div>
          )}

          {/* Slide CTA */}
          {slide.cta && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Slide CTA</p>
              <p className="text-sm text-cyan-400 font-medium">{slide.cta}</p>
            </div>
          )}

          {/* Visual direction */}
          {slide.visual_direction && (
            <div className="p-3 rounded-lg bg-gray-900 border border-gray-800">
              <p className="text-xs text-amber-500 uppercase tracking-wider mb-1">Visual Direction</p>
              <p className="text-xs text-gray-400 leading-relaxed">{slide.visual_direction}</p>
            </div>
          )}

          {/* Emphasis keywords */}
          {slide.emphasis_keywords && slide.emphasis_keywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {slide.emphasis_keywords.map((k, i) => (
                <span key={i} className="px-2 py-0.5 rounded-full bg-gray-800 text-xs text-gray-400 border border-gray-700">
                  {k}
                </span>
              ))}
            </div>
          )}

          {/* Speaker notes */}
          {slide.speaker_notes && (
            <div className="p-3 rounded-lg bg-gray-900/50 border border-dashed border-gray-700">
              <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Speaker Notes</p>
              <p className="text-xs text-gray-500 italic leading-relaxed">{slide.speaker_notes}</p>
            </div>
          )}

          {/* Semantic scores */}
          {(slide.semantic_density_score !== undefined || slide.persuasion_score !== undefined) && (
            <div className="flex gap-4 pt-1 border-t border-gray-800">
              {slide.semantic_density_score !== undefined && (
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider">Density</p>
                  <p className={`text-sm font-bold tabular-nums ${densityColor}`}>
                    {slide.semantic_density_score}
                  </p>
                </div>
              )}
              {slide.persuasion_score !== undefined && (
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider">Persuasion</p>
                  <p className={`text-sm font-bold tabular-nums ${
                    (slide.persuasion_score ?? 0) >= 60 ? 'text-emerald-400' :
                    (slide.persuasion_score ?? 0) >= 30 ? 'text-amber-400' : 'text-red-400'
                  }`}>
                    {slide.persuasion_score}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Copy button */}
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
          >
            {isCopied
              ? <><Check className="w-3 h-3 text-emerald-400" />Copied</>
              : <><Copy className="w-3 h-3" />Copy slide text</>
            }
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main renderer ────────────────────────────────────────────────────────────

interface CarouselRendererProps {
  /** UPDATED: accepts full CarouselArtifact, not CarouselBlueprint */
  artifact: CarouselArtifact
  onCopySlide?: (slide: RichCarouselSlide) => void
}

export function CarouselRenderer({ artifact, onCopySlide }: CarouselRendererProps) {
  const [expandedSlide, setExpandedSlide] = useState<number | null>(1)
  const [copiedSlide, setCopiedSlide] = useState<number | null>(null)

  const handleCopy = (slide: RichCarouselSlide) => {
    const parts = [slide.headline, slide.subheadline, slide.body, ...(slide.bullets ?? [])].filter(Boolean)
    const text = parts.join('\n\n')
    navigator.clipboard.writeText(text).catch(() => {})
    setCopiedSlide(slide.slide)
    setTimeout(() => setCopiedSlide(null), 1800)
    onCopySlide?.(slide)
  }

  return (
    <div className="space-y-4">
      {/* Artifact-level header with richness telemetry */}
      <ArtifactHeader artifact={artifact} />

      {/* Slides */}
      {artifact.slides.map(slide => (
        <SlideCard
          key={slide.slide}
          slide={slide}
          isExpanded={expandedSlide === slide.slide}
          onToggle={() => setExpandedSlide(expandedSlide === slide.slide ? null : slide.slide)}
          onCopy={() => handleCopy(slide)}
          isCopied={copiedSlide === slide.slide}
        />
      ))}

      {/* Generation trace footer */}
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
            {' · '}
            {artifact.generation_trace.generation_mode ?? 'unknown mode'}
          </p>
        </div>
      )}
    </div>
  )
}
export default CarouselRenderer


