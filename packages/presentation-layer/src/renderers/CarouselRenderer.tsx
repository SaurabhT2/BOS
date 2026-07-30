'use client'

/**
 * CarouselRenderer — renders a canonical CarouselArtifact.
 *
 * Deterministic rendering — no semantic inference happens here.
 * All content comes from the artifact. Renderer displays what exists.
 *
 * Iteration 3 (Artifact-first redesign):
 *   - Richness telemetry, per-slide density badges, and the generation_trace
 *     footer were removed from this component. That data still exists — it
 *     now flows through `buildExecutionInsight` / `buildQualityInsight`
 *     (see ./insights.ts) into the Inspect panel, rendered by the caller
 *     (apps/web) alongside this component rather than inside it. See
 *     UX_IMPLEMENTATION_PROGRESS.md Phase 5 for the full rationale.
 *   - Slides moved from an accordion (one open at a time, content hidden by
 *     default) to SlideViewer — a single active slide shown at full content,
 *     with prev/next, dot pagination, arrow-key and swipe navigation. The
 *     artifact should look like the finished carousel, not a list of
 *     collapsed records.
 *
 * Renders:
 *   - Artifact-level: title, hook, summary, cta, narrative arc
 *   - Per-slide: headline, subheadline, body, bullets, insight, key_takeaway,
 *                supporting_evidence, cta, visual_direction, speaker_notes
 */

import { useState } from 'react'
import {
  Copy, Check, Lightbulb, Target, BarChart2, BookOpen, Zap,
} from 'lucide-react'
import type { CarouselArtifact, RichCarouselSlide } from '@brandos/contracts'
import { resolveTheme, type ResolvedTheme } from '@brandos/composition-layer'
import { SlideViewer } from './shared/SlideViewer'

// ─── Role metadata ────────────────────────────────────────────────────────────
//
// RENDERING V2 PHASE 3: role→color is no longer a hardcoded gradient table.
// Studio now calls the same resolveTheme() the export renderers use (see
// COMPOSITION_MODEL.md §9 and RENDERING_ROADMAP_V2.md Phase 3) — the palette
// swatch this component already displayed below (see the "Palette" row in
// ArtifactHeader) is now the theme actually driving the slide badge color,
// closing the "Studio shows it, exports ignore it" gap the review flagged.
// This is a narrower integration than the full CompositionDocument/block
// model — see COMPOSITION_MODEL.md §9 for why Studio consumes ResolvedTheme
// only, not the full model, in this phase.

const ROLE_LABELS: Record<RichCarouselSlide['role'], string> = {
  hook:      'Hook',
  problem:   'Problem',
  reframe:   'Reframe',
  framework: 'Framework',
  evidence:  'Evidence',
  insight:   'Insight',
  cta:       'CTA',
}

// ─── Artifact-level header ────────────────────────────────────────────────────

function ArtifactHeader({ artifact }: { artifact?: CarouselArtifact }) {
  if (!artifact) return null;
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

      {/* CTA — a customer-facing part of the deliverable, kept above any
          measurement of the deliverable (see Iteration 2 §F.9/§E) */}
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

// ─── Full-content slide (always fully shown — this is SlideViewer's active slide) ──

function SlideContent({
  slide,
  theme,
  onCopy,
  isCopied,
}: {
  slide?: RichCarouselSlide
  theme: ResolvedTheme
  onCopy?: () => void
  isCopied?: boolean
}) {
  if (!slide) return null;
  const badgeGradient = `linear-gradient(135deg, ${theme.palette.primary}, ${theme.palette.accent})`

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden bg-gray-950">
      {/* Slide identity */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/60">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
          style={{ background: badgeGradient }}
        >
          {slide.slide}
        </div>
        <span
          className="text-xs font-semibold uppercase tracking-wider bg-clip-text text-transparent"
          style={{ backgroundImage: badgeGradient }}
        >
          {ROLE_LABELS[slide.role]}
        </span>
      </div>

      <div className="px-4 pb-4 pt-4 space-y-4">
        {/* Headline */}
        <div>
          <p className="text-lg text-white font-semibold leading-snug">{slide.headline}</p>
          {slide.subheadline && (
            <p className="text-sm text-gray-400 mt-1 leading-snug">{slide.subheadline}</p>
          )}
        </div>

        {/* Body */}
        {slide.body && (
          <p className="text-sm text-gray-300 leading-relaxed">{slide.body}</p>
        )}

        {/* Bullets */}
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
          <p className="text-sm text-cyan-400 font-medium">{slide.cta}</p>
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

        {/* Copy button — contextual, per-slide utility; not a page-level action */}
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
// Consumed by apps/web's unified ExportMenu ("Copy as text") — see
// NewsletterRenderer.tsx's extractNewsletterPlainText for the parallel case.

export function extractCarouselPlainText(artifact: CarouselArtifact): string {
  const parts: (string | undefined)[] = [artifact.title, artifact.hook, artifact.summary, '']
  for (const slide of artifact.slides) {
    parts.push(`${ROLE_LABELS[slide.role]}: ${slide.headline}`)
    if (slide.subheadline) parts.push(slide.subheadline)
    if (slide.body) parts.push(slide.body)
    if (slide.bullets) parts.push(...slide.bullets.map(b => `• ${b}`))
    parts.push('')
  }
  if (artifact.cta) parts.push(artifact.cta)
  return parts.filter((p): p is string => Boolean(p)).join('\n')
}

// ─── Main renderer ────────────────────────────────────────────────────────────

interface CarouselRendererProps {
  artifact: CarouselArtifact
  onCopySlide?: (slide: RichCarouselSlide) => void
}

export function CarouselRenderer({ artifact, onCopySlide }: CarouselRendererProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [copiedSlide, setCopiedSlide] = useState<number | null>(null)

  // Resolved once per artifact, not per slide/render — matches
  // resolveTheme()'s own "exactly once per (artifact, theme) pair" contract
  // (COMPOSITION_MODEL.md §3.1).
  const theme = resolveTheme(artifact)

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
      <ArtifactHeader artifact={artifact} />

      <SlideViewer
        count={artifact.slides.length}
        activeIndex={activeIndex}
        onChange={setActiveIndex}
        itemLabel="Slide"
        renderSlide={(i) => {
          const slide = artifact.slides[i]
          return (
            <SlideContent
              slide={slide}
              theme={theme}
              onCopy={() => slide && handleCopy(slide)}
              isCopied={slide ? copiedSlide === slide.slide : false}
            />
          )
        }}
      />
    </div>
  )
}
export default CarouselRenderer
