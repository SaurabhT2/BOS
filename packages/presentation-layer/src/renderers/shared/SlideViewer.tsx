'use client'

/**
 * SlideViewer — shared pagination shell for slide-based artifacts.
 *
 * Iteration 3 (Artifact-first redesign): Carousel and Deck both moved from an
 * accordion list (one slide open at a time, content hidden by default) to a
 * single-active-slide viewer — full content always visible for the current
 * slide, matching "looks like the finished deliverable" rather than "looks
 * like a list of collapsed records." Extracted here once instead of each
 * renderer reimplementing its own pagination state, keyboard handling, and
 * touch-swipe logic (engineering requirement: no duplicated renderer logic).
 *
 * Render-prop shaped: callers own their own slide visuals (colors, labels,
 * per-type content) and only borrow the pagination chrome.
 */

import { useCallback, useRef } from 'react'
import type { KeyboardEvent, ReactNode, TouchEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export interface SlideViewerProps {
  count: number
  activeIndex: number
  onChange: (index: number) => void
  renderSlide: (index: number) => ReactNode
  /** Accessible label, e.g. "Slide" or "Deck slide". */
  itemLabel?: string
  className?: string
}

const SWIPE_THRESHOLD_PX = 40

export function SlideViewer({
  count,
  activeIndex,
  onChange,
  renderSlide,
  itemLabel = 'Slide',
  className = '',
}: SlideViewerProps) {
  const touchStartX = useRef<number | null>(null)

  const goTo = useCallback(
    (index: number) => {
      if (count === 0) return
      onChange(Math.max(0, Math.min(count - 1, index)))
    },
    [count, onChange]
  )

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(activeIndex + 1) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(activeIndex - 1) }
    if (e.key === 'Home') { e.preventDefault(); goTo(0) }
    if (e.key === 'End') { e.preventDefault(); goTo(count - 1) }
  }

  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    touchStartX.current = e.touches[0]?.clientX ?? null
  }

  const handleTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    if (touchStartX.current === null) return
    const endX = e.changedTouches[0]?.clientX ?? touchStartX.current
    const dx = endX - touchStartX.current
    if (dx > SWIPE_THRESHOLD_PX) goTo(activeIndex - 1)
    else if (dx < -SWIPE_THRESHOLD_PX) goTo(activeIndex + 1)
    touchStartX.current = null
  }

  if (count === 0) return null

  return (
    <div
      className={`space-y-3 ${className}`}
      role="group"
      aria-roledescription="carousel"
      aria-label={`${itemLabel} ${activeIndex + 1} of ${count}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="relative">
        {renderSlide(activeIndex)}

        {count > 1 && (
          <>
            <button
              type="button"
              aria-label={`Previous ${itemLabel.toLowerCase()}`}
              onClick={() => goTo(activeIndex - 1)}
              disabled={activeIndex === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-gray-900/80 border border-gray-700 flex items-center justify-center text-gray-300 hover:text-white hover:border-gray-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label={`Next ${itemLabel.toLowerCase()}`}
              onClick={() => goTo(activeIndex + 1)}
              disabled={activeIndex === count - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-gray-900/80 border border-gray-700 flex items-center justify-center text-gray-300 hover:text-white hover:border-gray-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          {Array.from({ length: count }).map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to ${itemLabel.toLowerCase()} ${i + 1}`}
              aria-current={i === activeIndex}
              onClick={() => goTo(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === activeIndex ? 'w-5 bg-cyan-400' : 'w-1.5 bg-gray-700 hover:bg-gray-600'
              }`}
            />
          ))}
        </div>
      )}

      <p className="text-center text-[11px] text-gray-600 tabular-nums">
        {activeIndex + 1} / {count}
      </p>
    </div>
  )
}

export default SlideViewer
