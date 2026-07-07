'use client'

/**
 * NewsletterRenderer — renders a canonical NewsletterArtifact.
 *
 * Owned capability: presentation.render.newsletter
 *
 * Deterministic rendering — no semantic inference happens here.
 * All content comes from the artifact. Renderer displays what exists.
 *
 * Renders:
 *   - Email header: subject line, preview text, from / badge
 *   - Per-section: intro, story, quick-takes, callout, cta, sponsor, divider
 *   - Newsletter meta: read time, section count, word count
 */

import { useState } from 'react'
import { Mail, Clock, Copy, Check, BookOpen, Zap, MessageCircle } from 'lucide-react'
import type { NewsletterArtifact, NewsletterSection } from '@brandos/contracts'

// ─── Section type config ──────────────────────────────────────────────────────

const SECTION_COLORS: Record<string, string> = {
  intro:        'border-blue-800/40 bg-blue-950/20',
  story:        'border-gray-700 bg-gray-900/40',
  'quick-takes': 'border-emerald-800/40 bg-emerald-950/20',
  callout:      'border-amber-700/40 bg-amber-950/20',
  cta:          'border-violet-700/40 bg-violet-950/20',
  sponsor:      'border-gray-600/40 bg-gray-800/20',
  divider:      'border-gray-700/30 bg-transparent',
}

const SECTION_LABELS: Record<string, string> = {
  intro:        'Opening',
  story:        'Main Story',
  'quick-takes': 'Quick Takes',
  callout:      'Callout',
  cta:          'Call to Action',
  sponsor:      'Sponsor',
  divider:      '',
}

// ─── Newsletter email header ──────────────────────────────────────────────────

function NewsletterHeader({ artifact }: { artifact: NewsletterArtifact }) {
  return (
    <div className="border border-gray-700 rounded-xl bg-gray-950 p-4 mb-4 space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Mail className="w-4 h-4 text-blue-400" />
        <span className="text-[10px] text-blue-400 uppercase tracking-widest font-medium">Newsletter</span>
      </div>

      {/* Subject line */}
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Subject</p>
        <h2 className="text-white font-bold text-base leading-snug">{artifact.subject_line}</h2>
      </div>

      {/* Preview text */}
      {artifact.preview_text && (
        <p className="text-gray-400 text-sm">{artifact.preview_text}</p>
      )}

      {/* Meta row */}
      <div className="flex flex-wrap gap-3 pt-1">
        {artifact.newsletter_meta?.estimated_read_minutes && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Clock className="w-3 h-3" />
            <span>{artifact.newsletter_meta.estimated_read_minutes} min read</span>
          </div>
        )}
        {artifact.newsletter_meta?.section_count && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <BookOpen className="w-3 h-3" />
            <span>{artifact.newsletter_meta.section_count} sections</span>
          </div>
        )}
        {artifact.newsletter_meta?.word_count && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Zap className="w-3 h-3" />
            <span>{artifact.newsletter_meta.word_count} words</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Section renderers ────────────────────────────────────────────────────────

function QuickTakesSection({ section }: { section: NewsletterSection }) {
  return (
    <div>
      {section.heading && (
        <h3 className="text-sm font-semibold text-emerald-400 mb-3">{section.heading}</h3>
      )}
      {section.body && section.body.trim() && (
        <p className="text-gray-300 text-sm mb-3 leading-relaxed">{section.body}</p>
      )}
      {section.bullets && section.bullets.length > 0 && (
        <ul className="space-y-2">
          {section.bullets.map((bullet, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              <span className="leading-relaxed">{bullet}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CalloutSection({ section }: { section: NewsletterSection }) {
  return (
    <div>
      {section.callout ? (
        <div className="border-l-2 border-amber-400 pl-4">
          <p className="text-amber-200 text-sm font-medium italic leading-relaxed">{section.callout}</p>
        </div>
      ) : (
        <p className="text-gray-300 text-sm leading-relaxed">{section.body}</p>
      )}
    </div>
  )
}

function CtaSection({ section }: { section: NewsletterSection }) {
  return (
    <div className="text-center space-y-3">
      {section.heading && (
        <h3 className="text-sm font-semibold text-violet-300">{section.heading}</h3>
      )}
      <p className="text-gray-300 text-sm leading-relaxed">{section.body}</p>
      {section.bullets && section.bullets.length > 0 && (
        <div className="mt-2 space-y-1">
          {section.bullets.map((b, i) => (
            <div key={i} className="flex items-center gap-2 justify-center text-xs text-violet-400">
              <MessageCircle className="w-3 h-3" />
              <span>{b}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StandardSection({ section }: { section: NewsletterSection }) {
  return (
    <div>
      {section.heading && (
        <h3 className="text-sm font-semibold text-white mb-2">{section.heading}</h3>
      )}
      <p className="text-gray-300 text-sm leading-relaxed">{section.body}</p>
      {section.bullets && section.bullets.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {section.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
              <span className="mt-2 w-1 h-1 rounded-full bg-gray-500 flex-shrink-0" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SectionCard({ section }: { section: NewsletterSection }) {
  if (section.type === 'divider') {
    return <div className="border-t border-gray-700/50 my-2" />
  }

  const borderBg = SECTION_COLORS[section.type] ?? 'border-gray-700 bg-gray-900/40'
  const label    = SECTION_LABELS[section.type] ?? section.type

  return (
    <div className={`rounded-xl border p-4 ${borderBg}`}>
      {label && (
        <p className="text-[9px] uppercase tracking-widest text-gray-500 mb-2">{label}</p>
      )}
      {section.type === 'quick-takes' && <QuickTakesSection section={section} />}
      {section.type === 'callout'     && <CalloutSection section={section} />}
      {section.type === 'cta'         && <CtaSection section={section} />}
      {(section.type === 'intro' || section.type === 'story' || section.type === 'sponsor') && (
        <StandardSection section={section} />
      )}
    </div>
  )
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyNewsletterButton({ artifact }: { artifact: NewsletterArtifact }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const lines: string[] = [
      `Subject: ${artifact.subject_line}`,
      `Preview: ${artifact.preview_text ?? ''}`,
      '',
      artifact.hook ? `${artifact.hook}\n` : '',
    ]
    for (const s of artifact.sections) {
      if (s.type === 'divider') { lines.push('---'); continue }
      if (s.heading) lines.push(`## ${s.heading}`)
      if (s.body)    lines.push(s.body)
      if (s.bullets) lines.push(...s.bullets.map(b => `• ${b}`))
      if (s.callout) lines.push(`> ${s.callout}`)
      lines.push('')
    }
    await navigator.clipboard.writeText(lines.filter(Boolean).join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors px-2 py-1 rounded-lg border border-gray-700 hover:border-gray-500"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy text'}
    </button>
  )
}

// ─── Main renderer ────────────────────────────────────────────────────────────

interface NewsletterRendererProps {
  artifact?: NewsletterArtifact
  className?: string
}

export default function NewsletterRenderer({ artifact, className = '' }: NewsletterRendererProps) {
  if (!artifact) {
    return (
      <div className={`text-center py-12 ${className}`}>
        <Mail className="w-8 h-8 text-gray-600 mx-auto mb-3" />
        <p className="text-gray-500 text-sm">No newsletter to display</p>
      </div>
    )
  }

  if (artifact.artifact_type !== 'newsletter') {
    return (
      <div className={`text-center py-12 ${className}`}>
        <p className="text-red-400 text-sm">Expected newsletter artifact, got: {(artifact as any).artifact_type}</p>
      </div>
    )
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <NewsletterHeader artifact={artifact} />
        </div>
        <div className="flex-shrink-0 pt-1">
          <CopyNewsletterButton artifact={artifact} />
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {artifact.sections.map((section) => (
          <SectionCard key={section.id} section={section} />
        ))}
      </div>

      {/* CTA at artifact level if not already in a section */}
      {artifact.cta && !artifact.sections.some(s => s.type === 'cta') && (
        <div className="rounded-xl border border-violet-700/40 bg-violet-950/20 p-4 text-center">
          <p className="text-[9px] uppercase tracking-widest text-gray-500 mb-2">Call to Action</p>
          <p className="text-gray-300 text-sm">{artifact.cta}</p>
        </div>
      )}
    </div>
  )
}
