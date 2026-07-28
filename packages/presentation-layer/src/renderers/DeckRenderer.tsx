'use client'

/**
 * DeckRenderer — renders a canonical DeckArtifact.
 *
 * Owned capability: presentation.render.deck
 *
 * Deterministic rendering — no semantic inference happens here.
 * All content comes from the artifact. Renderer displays what exists.
 *
 * Iteration 3 (Artifact-first redesign): the generation_trace footer was
 * removed (that data now flows into the Inspect panel via
 * buildExecutionInsight — see ./insights.ts and apps/web's create/page.tsx).
 * Slides moved from an accordion to SlideViewer, shared with CarouselRenderer,
 * so the deck reads like a presentation — one slide filling the frame,
 * advanced with prev/next, dots, arrow keys, or a swipe — rather than a
 * stacked list of collapsed records.
 *
 * Renders:
 *   - Artifact-level: title, theme, slide count
 *   - Per-slide: title, type badge, bullets, stats, speaker_notes, layout
 *   - Slide type color-coding: cover, content, data, closing
 */

import { useState } from 'react'
import { BarChart2, Copy, Check } from 'lucide-react'
import type { DeckArtifact } from '@brandos/contracts'
import { SlideViewer } from './shared/SlideViewer'

// ─── Slide type metadata ───────────────────────────────────────────────────────

type DeckSlideType = 'cover' | 'content' | 'data' | 'closing' | 'section'

const SLIDE_TYPE_COLORS: Record<DeckSlideType | string, string> = {
  cover:   'from-indigo-500 to-purple-600',
  content: 'from-blue-500 to-cyan-600',
  data:    'from-emerald-500 to-teal-600',
  closing: 'from-amber-500 to-orange-600',
  section: 'from-gray-500 to-gray-600',
}

const SLIDE_TYPE_LABELS: Record<DeckSlideType | string, string> = {
  cover:   'Cover',
  content: 'Content',
  data:    'Data',
  closing: 'Closing',
  section: 'Section',
}

function getSlideColor(type: string): string {
  return SLIDE_TYPE_COLORS[type] ?? 'from-gray-500 to-gray-600'
}

function getSlideLabel(type: string): string {
  return SLIDE_TYPE_LABELS[type] ?? type
}

// ─── Deck header ──────────────────────────────────────────────────────────────

function DeckHeader({ artifact }: { artifact?: DeckArtifact }) {
  if (!artifact) return null
  const theme = artifact.semantic_theme

  return (
    <div className="border border-gray-700 rounded-xl bg-gray-950 p-4 mb-4 space-y-3">
      <div>
        <h2 className="text-white font-bold text-lg leading-tight">{artifact.title}</h2>
        {artifact.summary && (
          <p className="text-gray-400 text-sm mt-1">{artifact.summary}</p>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>{artifact.slides.length} slides</span>
        {artifact.deck_meta?.estimated_duration_minutes && (
          <>
            <span>·</span>
            <span>~{artifact.deck_meta.estimated_duration_minutes}m presentation</span>
          </>
        )}
        {artifact.audience?.label && (
          <>
            <span>·</span>
            <span>{artifact.audience?.label}</span>
          </>
        )}
      </div>

      {/* Theme preview */}
      {theme && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[10px] text-gray-500 uppercase tracking-widest">Theme</span>
          {[theme.primaryColor, theme.accentColor, theme.bgColor].filter(Boolean).map((hex, i) => (
            <div
              key={i}
              className="w-4 h-4 rounded-full border border-gray-700"
              style={{ backgroundColor: hex }}
              title={hex}
            />
          ))}
          {theme.fontTitle && (
            <span className="text-[10px] text-gray-600">{theme.fontTitle}</span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Full-content slide ─────────────────────────────────────────────────────

function DeckSlideContent({
  slide,
  index,
  onCopy,
  isCopied,
}: {
  slide: NonNullable<DeckArtifact['slides'][number]>
  index: number
  onCopy: () => void
  isCopied: boolean
}) {
  const gradient = getSlideColor(slide.type)
  const label    = getSlideLabel(slide.type)

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden bg-gray-950">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/60">
        <div
          className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white bg-gradient-to-br ${gradient} flex-shrink-0`}
        >
          {index + 1}
        </div>
        <span className={`text-xs font-semibold uppercase tracking-wider bg-gradient-to-r ${gradient} bg-clip-text text-transparent`}>
          {label}
        </span>
      </div>

      <div className="px-4 pb-4 pt-4 space-y-4">
        <div>
          <p className="text-lg text-white font-semibold leading-snug">{slide.title}</p>
          {slide.subtitle && (
            <p className="text-sm text-gray-400 mt-1">{slide.subtitle}</p>
          )}
        </div>

        {slide.bullets && slide.bullets.length > 0 && (
          <ul className="space-y-1.5">
            {slide.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                <span className="text-cyan-500 mt-0.5 flex-shrink-0">→</span>
                <span className="leading-relaxed">{b}</span>
              </li>
            ))}
          </ul>
        )}

        {slide.body && (
          <p className="text-sm text-gray-300 leading-relaxed">{slide.body}</p>
        )}

        {slide.stats && slide.stats.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <BarChart2 className="w-3 h-3 text-emerald-400" />
              <p className="text-xs text-emerald-400 uppercase tracking-wider">Stats</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {slide.stats.map((stat, i) => (
                <div key={i} className="p-2 rounded-lg bg-gray-900 border border-gray-800">
                  <p className="text-base font-bold text-emerald-400 tabular-nums">{stat.value}</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">{stat.label}</p>
                  {stat.delta && (
                    <p className="text-xs text-gray-600 mt-1">{stat.delta}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {slide.visual_direction && (
          <div className="p-3 rounded-lg bg-gray-900 border border-gray-800">
            <p className="text-xs text-amber-500 uppercase tracking-wider mb-1">Visual Direction</p>
            <p className="text-xs text-gray-400 leading-relaxed">{slide.visual_direction}</p>
          </div>
        )}

        {slide.speaker_notes && (
          <div className="p-3 rounded-lg bg-gray-900/50 border border-dashed border-gray-700">
            <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Speaker Notes</p>
            <p className="text-xs text-gray-500 italic leading-relaxed">{slide.speaker_notes}</p>
          </div>
        )}

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
    </div>
  )
}

// ─── Plain-text extraction ─────────────────────────────────────────────────
// Consumed by apps/web's unified ExportMenu ("Copy as text").

export function extractDeckPlainText(artifact: DeckArtifact): string {
  const parts: (string | undefined)[] = [artifact.title, artifact.summary, '']
  artifact.slides.forEach((slide, i) => {
    parts.push(`${getSlideLabel(slide.type)} (${i + 1}): ${slide.title}`)
    if (slide.subtitle) parts.push(slide.subtitle)
    if (slide.body) parts.push(slide.body)
    if (slide.bullets) parts.push(...slide.bullets.map(b => `• ${b}`))
    if (slide.stats) parts.push(...slide.stats.map(s => `${s.value} — ${s.label}`))
    parts.push('')
  })
  return parts.filter((p): p is string => Boolean(p)).join('\n')
}

// ─── Main renderer ────────────────────────────────────────────────────────────

interface DeckRendererProps {
  artifact: DeckArtifact
  onCopySlide?: (slide: DeckArtifact['slides'][number]) => void
}

export function DeckRenderer({ artifact, onCopySlide }: DeckRendererProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [copiedSlide, setCopiedSlide] = useState<number | null>(null)

  const handleCopy = (slide: DeckArtifact['slides'][number], index: number) => {
    const parts = [
      slide.title,
      slide.subtitle,
      slide.body,
      ...(slide.bullets ?? []),
      ...(slide.stats?.map(s => `${s.value} — ${s.label}`) ?? []),
    ].filter(Boolean)
    const text = parts.join('\n\n')
    navigator.clipboard.writeText(text).catch(() => {})
    setCopiedSlide(index)
    setTimeout(() => setCopiedSlide(null), 1800)
    onCopySlide?.(slide)
  }

  return (
    <div className="space-y-4">
      <DeckHeader artifact={artifact} />

      <SlideViewer
        count={artifact.slides.length}
        activeIndex={activeIndex}
        onChange={setActiveIndex}
        itemLabel="Deck slide"
        renderSlide={(i) => {
          const slide = artifact.slides[i]
          if (!slide) return null
          return (
            <DeckSlideContent
              slide={slide}
              index={i}
              onCopy={() => handleCopy(slide, i)}
              isCopied={copiedSlide === i}
            />
          )
        }}
      />
    </div>
  )
}
export default DeckRenderer
