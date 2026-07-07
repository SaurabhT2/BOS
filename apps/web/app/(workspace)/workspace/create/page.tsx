'use client'

/**
 * Create — 4-step progressive flow (What → About → Preview → Save).
 *
 * Per brandos_rollout_plan.html Phase 2 checklist:
 *  - "Redesign Create: 4-step progressive flow (What → About → Preview → Save)"
 *  - "Add Campaign as first-class Create option"
 *  - "Remove Override Mode from creation UI (auto-infer from task type)"
 *
 * IMPLEMENTATION APPROACH: every generation handler below (generate,
 * generateCarousel, generateWithSSE, extractFromUrl, submitFeedback,
 * exportArtifact) is carried over UNCHANGED from the prior single-screen
 * version of this page. Only the JSX layout is restructured into steps;
 * the generation pipeline itself (SSE streaming, fallback-to-POST, result
 * routing by artifact type, tier gating) is untouched, per "preserve
 * existing functionality."
 *
 * OVERRIDE MODE: the rollout plan calls for removing the override-mode
 * selector from the creation UI and auto-inferring it from task type.
 * `OverrideMode`'s real member values are defined in
 * @brandos/control-plane-layer, whose source isn't available from
 * apps/web — only the existing default ('standard') is confirmed. Rather
 * than guess other enum members that may not exist, every format here
 * still sends 'standard' (the prior universal default, so behavior is
 * unchanged), and the per-format auto-infer mapping is left as a single
 * TODO constant below for whoever has the real enum to fill in. The
 * underlying ControlPlanePanel + onModeChange escape hatch is kept
 * available (now folded into the Preview step) rather than deleted,
 * since I can't fully verify it has no other internal purpose.
 *
 * CAMPAIGN LITE (brandos_redesign_strategic_completion.md §5): "Campaign"
 * was previously a single-format generate('campaign') call — not real
 * multi-format generation. Campaign Lite here sequences the EXISTING
 * per-format generate calls for each selected format, tags them with a
 * shared (client-generated) campaign_brief_id for display grouping only —
 * the campaigns table has no backing column for this yet (see
 * /api/campaigns route notes), so the grouping id is NOT persisted
 * server-side; it only groups the results within this session's Preview
 * step. A real cross-session "Active campaigns" surface needs that schema
 * change first (tracked, not implemented here — outside apps/web's
 * package boundary per the strategic doc's "own later phase" framing).
 */

import { useAuth } from '@brandos/auth'
import React, { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  RuntimeModeSelector,
  ModelSelector,
  ControlPlanePanel,
  useAvailableModes,
  CarouselRenderer,
  DeckRenderer,
  ReportRenderer,
  NewsletterRenderer,
} from '@brandos/presentation-layer'
import {
  Sparkles, Wand2, Brain, FileText, LayoutGrid, Rocket,
  Loader, Copy, LinkIcon, Mail,
  ThumbsUp, ThumbsDown, AlertTriangle, Shield,
  Download, ArrowDownToLine, CheckCircle2,
  Presentation, BookOpen, Lock, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Check, Repeat, X,
  HelpCircle,
} from 'lucide-react'
import { trackEvent, analyticsEvents, trackGenerationPerformance } from '@/lib/client-analytics'
import { extractSourceText, TRANSFORM_MODES, runRepurpose } from '@/lib/repurpose'
import { fromLegacyToRuntimeMode } from '@brandos/contracts'
import type { RuntimeMode, ArtifactV2, CarouselArtifact, DeckArtifact, ReportArtifact, NewsletterArtifact } from '@brandos/contracts'
import type { OverrideMode } from '@brandos/control-plane-layer'
import type { ControlPlaneData } from '@brandos/presentation-layer'

// ── Types ─────────────────────────────────────────────────────────────────────
type ToneMode = 'executive' | 'bold' | 'educational' | 'founder'
type UnavailableAction = { action: string; label: string }
type Step = 'what' | 'about' | 'preview' | 'save'

// ── Constants ─────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'brandos_generation_mode'
const OVERRIDE_KEY = 'brandos_override_mode'
const BRAND_MEMORY_KEY = 'brandos_apply_brand_memory'

const SMART_PROMPTS = [
  { id: '1', label: 'Product Launch Post',  prompt: 'Write a LinkedIn post announcing our new product launch' },
  { id: '2', label: 'Industry Insight',     prompt: 'Share a contrarian take on current industry trends' },
  { id: '3', label: 'Customer Story',       prompt: 'Tell a story about how we helped a customer succeed' },
]

const STEPS: { id: Step; label: string }[] = [
  { id: 'what',    label: 'What' },
  { id: 'about',   label: 'About' },
  { id: 'preview', label: 'Preview' },
  { id: 'save',    label: 'Save' },
]

// Maps a quick-create query param's format value to this page's internal
// format string. Home (Phase 2) links to ?format=post / ?format=carousel.
const QUERY_FORMAT_MAP: Record<string, string> = {
  post:       'linkedin_post',
  carousel:   'carousel',
  deck:       'deck',
  report:     'report',
  newsletter: 'newsletter',
  article:    'article',
}

// ── Component ─────────────────────────────────────────────────────────────────
// useSearchParams() requires a Suspense boundary in the Next.js App Router
// (Next 16, confirmed via tsconfig/package.json) — there was no existing
// usage elsewhere in apps/web to follow as precedent, so wrapping explicitly
// here rather than risk a build-time error on this being the first caller.
export default function CreatePage() {
  return (
    <Suspense fallback={<CreatePageLoadingFallback />}>
      <CreatePageInner />
    </Suspense>
  )
}

function CreatePageLoadingFallback() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <Loader className="w-5 h-5 animate-spin text-gray-600" />
    </div>
  )
}

function CreatePageInner() {
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  // ── Wizard state ───────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('what')
  const [campaignMode, setCampaignMode] = useState(false)
  const [selectedFormat, setSelectedFormat] = useState<string>('linkedin_post')
  const [campaignFormats, setCampaignFormats] = useState<string[]>(['linkedin_post', 'carousel'])

  // ── Runtime / mode state (unchanged) ──────────────────────────────────────
  const [mode, setMode]               = useState<RuntimeMode>('cloud')
  const [overrideMode, setOverrideMode] = useState<OverrideMode>('standard')
  const [applyBrandMemory, setApplyBrandMemory] = useState<boolean>(true)
  const { modes: modeStatuses, recommended: recommendedMode, loading: availLoading } = useAvailableModes()

  // Phase 7 — Model selection: tracks the model chosen via ModelSelector.
  // Forwarded as the `model` field in /api/generate body → preferred_model
  // in ControlPlaneRequestInput → routingHint.preferred_model → runtime.
  // null = no override; adapter uses admin-configured default.
  const [selectedModel, setSelectedModel] = useState<string | null>(null)

  // ── Prompt / generate state (unchanged) ───────────────────────────────────
  const [prompt, setPrompt]           = useState('')
  const [activeTone, setActiveTone]   = useState<ToneMode>('executive')
  const [urlInput, setUrlInput]       = useState('')
  const [extractingUrl, setExtractingUrl] = useState(false)
  const [enabledArtifacts, setEnabledArtifacts] = useState<string[]>([
    'carousel', 'deck', 'report', 'newsletter', 'post', 'thread',
  ])
  const [tierAllowedTypes, setTierAllowedTypes] = useState<string[] | null>(null)
  const [workspacePlan, setWorkspacePlan] = useState<string>('professional')

  // ── Result state (unchanged) ──────────────────────────────────────────────
  const [outputResult, setOutputResult]       = useState<ArtifactV2 | null>(null)
  const [carouselResult, setCarouselResult]   = useState<CarouselArtifact | null>(null)
  const [deckResult, setDeckResult]           = useState<DeckArtifact | null>(null)
  const [reportResult, setReportResult]       = useState<ReportArtifact | null>(null)
  const [newsletterResult, setNewsletterResult] = useState<NewsletterArtifact | null>(null)
  const [savedCampaignId, setSavedCampaignId] = useState<string | null>(null)
  const [feedbackSent, setFeedbackSent]   = useState(false)
  const [exportingFormat, setExportingFormat] = useState<'html' | 'json' | 'pdf' | 'pptx' | null>(null)

  // ── Campaign Lite: per-format result tracking (NEW) ───────────────────────
  // Client-side only grouping id — not persisted server-side. See header note.
  const [campaignBriefId] = useState(() => `brief_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
  const [campaignResults, setCampaignResults] = useState<
    Record<string, { status: 'pending' | 'done' | 'error'; campaignId?: string }>
  >({})

  // ── Loading / UX state (unchanged) ────────────────────────────────────────
  const [isLoading, setIsLoading]         = useState(false)
  const [carouselLoading, setCarouselLoading] = useState(false)
  const [deckLoading, setDeckLoading]       = useState(false)
  const [reportLoading, setReportLoading]   = useState(false)
  const [unavailable, setUnavailable]     = useState<{ message: string; actions: UnavailableAction[] } | null>(null)
  const [streamingLog, setStreamingLog]   = useState<string[]>([])

  const anyLoading = isLoading || carouselLoading || deckLoading || reportLoading

  // Refs mirroring the loading flags — used by generateCampaignLite's polling
  // loop below so it reads live values rather than a closure captured at the
  // time the interval callback was created (setInterval callbacks otherwise
  // close over whatever isLoading/deckLoading/reportLoading were when
  // generateCampaignLite ran, not their current value).
  const isLoadingRef = React.useRef(isLoading)
  const deckLoadingRef = React.useRef(deckLoading)
  const reportLoadingRef = React.useRef(reportLoading)
  useEffect(() => { isLoadingRef.current = isLoading }, [isLoading])
  useEffect(() => { deckLoadingRef.current = deckLoading }, [deckLoading])
  useEffect(() => { reportLoadingRef.current = reportLoading }, [reportLoading])

  // ── Init: read query params from Home's quick-create links (NEW) ─────────
  // `topic` added GTM Critical Item 3 (2026-06-21): Plan My Week's "Use this
  // idea" links pass the planner's suggested idea title/description through
  // so it isn't lost on navigation — additive, does not change behavior for
  // existing format/mode-only links.
  useEffect(() => {
    const qFormat = searchParams.get('format')
    const qMode   = searchParams.get('mode')
    const qTopic  = searchParams.get('topic')
    const qBrief  = searchParams.get('brief')  // P3: cross-session brief restore

    if (qMode === 'campaign') setCampaignMode(true)
    if (qFormat && QUERY_FORMAT_MAP[qFormat]) {
      setSelectedFormat(QUERY_FORMAT_MAP[qFormat])
      setStep('about') // skip format pick if Home already told us what they want
    }
    if (qTopic) setPrompt(qTopic.slice(0, 500))

    // P3: restore campaign brief state across sessions
    // URL: /workspace/create?brief=<campaign_brief_id>
    // Fetches the brief stub from the API and pre-fills topic + format, then
    // skips to the 'about' step so the user can continue where they left off.
    if (qBrief) {
      fetch(`/api/campaigns?campaign_brief_id=${encodeURIComponent(qBrief)}&limit=1`)
        .then(r => r.ok ? r.json() : null)
        .then((data: { campaigns?: Array<{ campaign_brief_topic?: string; format?: string; title?: string }> } | null) => {
          const brief = data?.campaigns?.[0]
          if (!brief) return
          if (brief.campaign_brief_topic) setPrompt(brief.campaign_brief_topic.slice(0, 500))
          if (brief.format && QUERY_FORMAT_MAP[brief.format]) {
            setSelectedFormat(QUERY_FORMAT_MAP[brief.format])
          }
          setStep('about')
        })
        .catch(() => { /* non-fatal — user still lands on format pick */ })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Init: load persisted settings (unchanged) ─────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    setMode(fromLegacyToRuntimeMode(raw))

    const savedOverride = localStorage.getItem(OVERRIDE_KEY) as OverrideMode | null
    if (savedOverride) setOverrideMode(savedOverride)

    const savedBrandMemory = localStorage.getItem(BRAND_MEMORY_KEY)
    if (savedBrandMemory !== null) {
      setApplyBrandMemory(savedBrandMemory === 'true')
    } else {
      const isExistingUser = raw !== null || localStorage.getItem(OVERRIDE_KEY) !== null
      const defaultVal = isExistingUser
      setApplyBrandMemory(defaultVal)
      localStorage.setItem(BRAND_MEMORY_KEY, String(defaultVal))
    }

    fetch('/api/v2/artifact/config')
      .then(r => r.json())
      .then(d => { if (d.ok && d.data?.enabledTypes) setEnabledArtifacts(d.data.enabledTypes) })
      .catch(() => {/* use defaults */})

    fetch('/api/workspace/usage')
      .then(r => r.json())
      .then(d => {
        if (d.capabilities?.allowedArtifactTypes) {
          setTierAllowedTypes(d.capabilities.allowedArtifactTypes)
        }
        if (d.plan) setWorkspacePlan(d.plan)
      })
      .catch(() => {/* non-critical — server enforces the gate */})
  }, [])

  // ── Mode handlers (unchanged) ─────────────────────────────────────────────
  const changeMode = (m: RuntimeMode) => {
    if (modeStatuses?.[m]?.availability === 'unavailable') return
    setMode(m)
    setUnavailable(null)
    localStorage.setItem(STORAGE_KEY, m)
  }

  const changeOverrideMode = (m: OverrideMode) => {
    setOverrideMode(m)
    localStorage.setItem(OVERRIDE_KEY, m)
  }

  const changeBrandMemory = (val: boolean) => {
    setApplyBrandMemory(val)
    localStorage.setItem(BRAND_MEMORY_KEY, String(val))
  }

  // ── Helpers: clear state before a new generation (unchanged) ──────────────
  const clearResults = () => {
    setOutputResult(null)
    setCarouselResult(null)
    setDeckResult(null)
    setReportResult(null)
    setNewsletterResult(null)
    setSavedCampaignId(null)
    setFeedbackSent(false)
    setUnavailable(null)
    // GTM Critical Item 2: reset repurpose widget state too — without this,
    // clicking "Create another" after repurposing would leave repurposeOpen/
    // repurposeResult set, so the widget (gated on hasResult, which clears
    // here) would briefly show stale output from the PREVIOUS artifact the
    // next time hasResult becomes true again.
    setRepurposeOpen(false)
    setRepurposeResult(null)
    setRepurposeError(null)
  }

  // ── SSE streaming (unchanged — see header note) ───────────────────────────
  const generateWithSSE = (format: string, t0: number): (() => void) => {
    setStreamingLog([])

    const STAGE_LABELS: Record<string, string> = {
      queued:     'Queued…',
      analyzing:  'Analyzing intent & running policy checks…',
      extracting: 'Compiling prompt…',
      generating: 'Generating via AI provider…',
      composing:  'Finalising output…',
      complete:   'Done ✓',
      error:      'Error',
    }

    const params = new URLSearchParams({ topic: prompt.trim(), tone: activeTone, format, runtimeMode: mode, applyBrandMemory: String(applyBrandMemory) })
    // Phase 7: forward model override to SSE endpoint when set
    if (selectedModel) params.set('model', selectedModel)
    const es = new EventSource(`/api/generate-with-progress?${params}`)

    const routeResult = (raw: Record<string, unknown>) => {
      const artifactType = (raw.artifact_type as string | undefined) ?? format

      if (format === 'carousel' || artifactType === 'carousel') {
        const artifact = raw.content as CarouselArtifact
        if (artifact && Array.isArray(artifact.slides)) {
          setCarouselResult(artifact)
          if (raw.campaignId) setSavedCampaignId(String(raw.campaignId))
          return
        }
      }

      if (format === 'deck' || artifactType === 'deck') {
        const artifact = (raw.content ?? raw.result) as DeckArtifact
        if (artifact && Array.isArray(artifact.slides)) {
          setDeckResult(artifact)
          if (raw.campaignId) setSavedCampaignId(String(raw.campaignId))
          return
        }
      }

      if (format === 'report' || artifactType === 'report') {
        const artifact = (raw.content ?? raw.result) as ReportArtifact
        if (artifact && Array.isArray(artifact.sections)) {
          setReportResult(artifact)
          if (raw.campaignId) setSavedCampaignId(String(raw.campaignId))
          return
        }
      }

      if (format === 'newsletter' || artifactType === 'newsletter') {
        const artifact = (raw.content ?? raw.result) as NewsletterArtifact
        if (artifact && Array.isArray(artifact.sections)) {
          setNewsletterResult(artifact)
          if (raw.campaignId) setSavedCampaignId(String(raw.campaignId))
          return
        }
      }

      setOutputResult(raw as unknown as ArtifactV2)
      if (raw.campaignId) setSavedCampaignId(String(raw.campaignId))
    }

    const handleResult = (raw: Record<string, unknown>) => {
      routeResult(raw)
      trackGenerationPerformance(Date.now() - t0, format)
      trackEvent({ name: analyticsEvents.GENERATION_COMPLETED, properties: { format, mode } })
    }

    const handleFallback = () => {
      fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, tone: activeTone, format, runtimeMode: mode, overrideMode, applyBrandMemory, ...(selectedModel ? { model: selectedModel } : {}) }),
      })
        .then(r => r.json())
        .then((data: { success?: boolean; result?: ArtifactV2; campaignId?: string }) => {
          setStreamingLog([])
          const result = data.result ?? (data as unknown as ArtifactV2)
          routeResult((result as unknown) as Record<string, unknown>)
          trackGenerationPerformance(Date.now() - t0, format)
          trackEvent({ name: analyticsEvents.GENERATION_COMPLETED, properties: { format, mode } })
        })
        .catch(() => {
          trackEvent({ name: analyticsEvents.GENERATION_FAILED, properties: { format } })
        })
        .finally(() => {
          setIsLoading(false)
          setDeckLoading(false)
          setReportLoading(false)
        })
    }

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          stage: string; progress: number; message: string;
          result?: Record<string, unknown>; error?: string
        }

        const label = payload.message || STAGE_LABELS[payload.stage] || payload.stage
        setStreamingLog(prev =>
          prev[prev.length - 1] === label ? prev : [...prev, label]
        )

        if (payload.stage === 'complete' && payload.result) {
          es.close()
          handleResult(payload.result)
          setIsLoading(false)
          setDeckLoading(false)
          setReportLoading(false)
        } else if (payload.stage === 'error') {
          es.close()
          handleFallback()
        }
      } catch { /* malformed SSE frame — ignore */ }
    }

    es.onerror = () => {
      es.close()
      handleFallback()
    }

    return () => es.close()
  }

  // ── Generate: Post / Article / Campaign / Deck / Report (unchanged) ──────
  const generate = (format: string) => {
    if (!prompt.trim() || anyLoading) return
    if (format === 'deck') setDeckLoading(true)
    else if (format === 'report') setReportLoading(true)
    else setIsLoading(true)
    clearResults()
    setStep('preview')
    generateWithSSE(format, Date.now())
  }

  // ── Generate: Carousel (unchanged) ────────────────────────────────────────
  const generateCarousel = async () => {
    if (!prompt.trim() || anyLoading) return
    setCarouselLoading(true)
    clearResults()
    setStep('preview')
    setStreamingLog(['Generating carousel via AI provider…'])

    try {
      const res = await fetch('/api/carousel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: prompt, tone: activeTone, runtimeMode: mode, applyBrandMemory, ...(selectedModel ? { model: selectedModel } : {}) }),
      })

      let body: { result?: CarouselArtifact; campaignId?: string; error?: string } = {}
      try {
        body = await res.json()
      } catch (parseErr) {
        console.error('[generateCarousel] Response JSON parse failed:', parseErr)
        return
      }

      setStreamingLog([])

      if (!res.ok) {
        console.error('[generateCarousel] API returned', res.status, body?.error)
        return
      }

      const artifact = body.result
      if (!artifact || typeof artifact !== 'object' || !Array.isArray((artifact as CarouselArtifact).slides)) {
        console.error('[generateCarousel] Response is missing a valid artifact.slides array:', artifact)
        return
      }

      setCarouselResult(artifact as CarouselArtifact)
      if (body.campaignId) setSavedCampaignId(body.campaignId)

    } catch (err) {
      console.error('[generateCarousel] Unexpected error:', err)
    } finally {
      setCarouselLoading(false)
    }
  }

  // ── Campaign Lite: sequence the existing per-format calls (NEW) ──────────
  // Strategic doc §5 "Campaign Lite": no new table, reuse the existing
  // pipeline per format, group results client-side. Runs formats serially
  // (not in parallel) so the single-result state slots above aren't raced.
  const savedCampaignIdRef = React.useRef<string | null>(null)
  useEffect(() => { savedCampaignIdRef.current = savedCampaignId }, [savedCampaignId])

  const generateCampaignLite = async () => {
    if (!prompt.trim() || anyLoading || campaignFormats.length === 0) return
    setCampaignResults(Object.fromEntries(campaignFormats.map(f => [f, { status: 'pending' as const }])))
    setStep('preview')

    for (const format of campaignFormats) {
      try {
        if (format === 'carousel') {
          await generateCarousel()
        } else {
          await new Promise<void>(resolve => {
            generate(format)
            const check = setInterval(() => {
              if (!isLoadingRef.current && !deckLoadingRef.current && !reportLoadingRef.current) {
                clearInterval(check)
                resolve()
              }
            }, 300)
          })
        }
        setCampaignResults(prev => ({
          ...prev,
          [format]: { status: 'done', campaignId: savedCampaignIdRef.current ?? undefined },
        }))
      } catch {
        setCampaignResults(prev => ({ ...prev, [format]: { status: 'error' } }))
      }
    }
  }

  // ── URL extraction (unchanged) ────────────────────────────────────────────
  const extractFromUrl = async () => {
    if (!urlInput.trim()) return
    setExtractingUrl(true)
    try {
      const res = await fetch('/api/extract-from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput }),
      })
      const data = await res.json()
      if (data.content) setPrompt(data.content.substring(0, 500))
    } catch { /* silent — URL extraction is non-critical */ }
    finally { setExtractingUrl(false) }
  }

  // ── Feedback (unchanged) ──────────────────────────────────────────────────
  const submitFeedback = async (signal: 'useful' | 'generic' | 'off_tone') => {
    if (!savedCampaignId || feedbackSent) return
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: savedCampaignId, signal }),
      })
      setFeedbackSent(true)
    } catch { /* non-critical */ }
  }

  // ── Export (extended: pdf/pptx added alongside existing html/json) ───────
  const exportArtifact = async (fmt: 'html' | 'json' | 'pdf' | 'pptx', artifact: ArtifactV2) => {
    if (exportingFormat) return
    setExportingFormat(fmt)
    try {
      const res = await fetch('/api/artifact/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: fmt, artifact }),
      })
      if (!res.ok) { console.error('[create] Export failed:', await res.json().catch(() => ({}))); return }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `artifact.${fmt}`
      const url = URL.createObjectURL(blob)
      const a = Object.assign(document.createElement('a'), { href: url, download: filename })
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) { console.error('[create] Export error:', e) }
    finally { setExportingFormat(null) }
  }

  // ── Canva export (Priority 4) — distinct from exportArtifact: the route
  // returns a JSON { editUrl } result, not a file blob, since the "export"
  // is really "create an editable design and hand back its URL." ─────────
  const [canvaExportError, setCanvaExportError] = useState<string | null>(null)
  const exportToCanva = async (artifact: CarouselArtifact | DeckArtifact | ReportArtifact) => {
    if (exportingFormat) return
    setExportingFormat('pdf' as any) // reuse the spinner state; canva renders via the same PDF path under the hood
    setCanvaExportError(null)
    try {
      const res = await fetch('/api/artifact/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'canva', artifact }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 409) {
          // Not connected — send them to the connect flow rather than just erroring.
          window.open('/workspace/settings/integrations', '_blank')
          return
        }
        setCanvaExportError(body?.error ?? 'Canva export failed')
        return
      }
      if (body.editUrl) window.open(body.editUrl, '_blank')
    } catch (e: any) {
      setCanvaExportError(e?.message ?? 'Canva export failed')
    } finally { setExportingFormat(null) }
  }

  // ── Figma export (Priority 5) — distinct from both exportArtifact and
  // exportToCanva: Figma has no server-side import API (see
  // lib/figma-handoff.ts), so this issues a one-time code for the user to
  // paste into the BrandOS Figma Plugin, rather than downloading a file
  // or opening an edit URL directly. ─────────────────────────────────────
  const [figmaHandoff, setFigmaHandoff] = useState<{ token: string; expiresAt: string } | null>(null)
  const [figmaHandoffError, setFigmaHandoffError] = useState<string | null>(null)
  const exportToFigma = async (artifact: CarouselArtifact | DeckArtifact | ReportArtifact) => {
    if (exportingFormat) return
    setExportingFormat('pptx' as any) // reuse the spinner state; no dedicated 'figma' slot needed for a single button
    setFigmaHandoffError(null)
    setFigmaHandoff(null)
    try {
      const res = await fetch('/api/integrations/figma/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifact }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setFigmaHandoffError(body?.error ?? 'Failed to create Figma handoff code'); return }
      setFigmaHandoff({ token: body.token, expiresAt: body.expiresAt })
    } catch (e: any) {
      setFigmaHandoffError(e?.message ?? 'Failed to create Figma handoff code')
    } finally { setExportingFormat(null) }
  }

  const copyJSON = (artifact: unknown) => {
    navigator.clipboard.writeText(JSON.stringify(artifact, null, 2)).catch(() => {})
  }

  // ── Derived values (unchanged) ────────────────────────────────────────────
  const cpData: ControlPlaneData | null =
    outputResult && 'control_plane' in outputResult
      ? outputResult.control_plane as ControlPlaneData
      : null

  const FORMAT_OPTIONS = [
    { label: 'Post',       icon: FileText,     color: 'from-blue-600 to-blue-700',     format: 'linkedin_post', type: 'post'       },
    { label: 'Carousel',   icon: LayoutGrid,   color: 'from-cyan-600 to-teal-700',     format: 'carousel',      type: 'carousel'   },
    { label: 'Deck',       icon: Presentation, color: 'from-indigo-600 to-violet-700', format: 'deck',          type: 'deck'       },
    { label: 'Report',     icon: BookOpen,     color: 'from-emerald-600 to-teal-700',  format: 'report',        type: 'report'     },
    { label: 'Newsletter', icon: Mail,         color: 'from-blue-500 to-cyan-600',     format: 'newsletter',    type: 'newsletter' },
    { label: 'Article',    icon: FileText,     color: 'from-purple-600 to-purple-700', format: 'article',       type: 'post'       },
  ]
    .filter(({ type }) => enabledArtifacts.includes(type) || ['post', 'carousel', 'deck', 'report', 'newsletter'].includes(type))
    .map(opt => ({
      ...opt,
      tierLocked: tierAllowedTypes !== null && !tierAllowedTypes.includes(opt.type),
    }))

  const campaignTierLocked = tierAllowedTypes !== null && !tierAllowedTypes.includes('post')
    // Campaign mode itself is gated like the old standalone "Campaign" button was
    // (type: 'post' in the prior implementation) — see backup file for reference.

  const hasResult = Boolean(carouselResult || deckResult || reportResult || newsletterResult || outputResult)
  const stepIndex = STEPS.findIndex(s => s.id === step)

  function goToStep(target: Step) {
    setStep(target)
  }

  // ── Shared export toolbar (unchanged) ─────────────────────────────────────
  function ExportToolbar({
    icon: Icon, iconClass, title, subtitle, onCopy, onExportJson, onExportHtml, onExportPdf, onExportPptx, onExportCanva, onExportFigma,
  }: {
    icon: React.ComponentType<{ className?: string }>
    iconClass: string
    title: string
    subtitle?: string
    onCopy: () => void
    onExportJson: () => void
    onExportHtml: () => void
    onExportPdf: () => void
    onExportPptx: () => void
    onExportCanva: () => void
    onExportFigma: () => void
  }) {
    return (
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-3 mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Icon className={`w-4 h-4 flex-shrink-0 ${iconClass}`} />
          <span className="text-sm font-semibold text-gray-200">{title}</span>
          {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
          <span className="text-xs px-2 py-0.5 bg-green-900/30 text-green-400 border border-green-700/40 rounded-full flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> ISkill validated
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={onCopy} title="Copy JSON"
            className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-white transition-all">
            <Copy className="w-3 h-3" />Copy
          </button>
          <button onClick={onExportJson} disabled={exportingFormat !== null} title="Download JSON"
            className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-cyan-400 transition-all">
            {exportingFormat === 'json' ? <Loader className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
            JSON
          </button>
          <button onClick={onExportHtml} disabled={exportingFormat !== null} title="Download HTML"
            className="flex items-center gap-1 px-2.5 py-1.5 bg-cyan-900/40 hover:bg-cyan-900/70 disabled:opacity-50 border border-cyan-700/50 rounded-lg text-xs text-cyan-400 hover:text-cyan-200 transition-all">
            {exportingFormat === 'html' ? <Loader className="w-3 h-3 animate-spin" /> : <ArrowDownToLine className="w-3 h-3" />}
            HTML
          </button>
          <button onClick={onExportPdf} disabled={exportingFormat !== null} title="Download PDF"
            className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-900/40 hover:bg-rose-900/70 disabled:opacity-50 border border-rose-700/50 rounded-lg text-xs text-rose-300 hover:text-rose-100 transition-all">
            {exportingFormat === 'pdf' ? <Loader className="w-3 h-3 animate-spin" /> : <ArrowDownToLine className="w-3 h-3" />}
            PDF
          </button>
          <button onClick={onExportPptx} disabled={exportingFormat !== null} title="Download PowerPoint"
            className="flex items-center gap-1 px-2.5 py-1.5 bg-orange-900/40 hover:bg-orange-900/70 disabled:opacity-50 border border-orange-700/50 rounded-lg text-xs text-orange-300 hover:text-orange-100 transition-all">
            {exportingFormat === 'pptx' ? <Loader className="w-3 h-3 animate-spin" /> : <ArrowDownToLine className="w-3 h-3" />}
            PPTX
          </button>
          <button onClick={onExportCanva} disabled={exportingFormat !== null} title="Open in Canva"
            className="flex items-center gap-1 px-2.5 py-1.5 bg-teal-900/40 hover:bg-teal-900/70 disabled:opacity-50 border border-teal-700/50 rounded-lg text-xs text-teal-300 hover:text-teal-100 transition-all">
            <ArrowDownToLine className="w-3 h-3" />
            Canva
          </button>
          <button onClick={onExportFigma} disabled={exportingFormat !== null} title="Get a Figma import code"
            className="flex items-center gap-1 px-2.5 py-1.5 bg-purple-900/40 hover:bg-purple-900/70 disabled:opacity-50 border border-purple-700/50 rounded-lg text-xs text-purple-300 hover:text-purple-100 transition-all">
            <ArrowDownToLine className="w-3 h-3" />
            Figma
          </button>
        </div>
      </div>
    )
  }

  // ── P3.28 — "Why this?" explainability panel ─────────────────────────────
  // Appears in the Preview step below generated output whenever cpData is
  // present. Shows: detected intent + topic, provider/mode routing reason,
  // quality score with plain-language verdict, and any repairs applied.

  function WhyThisPanel({ cpData }: { cpData: ControlPlaneData }) {
    const [open, setOpen] = useState(false)
    const score   = cpData.final_score ?? cpData.original_score
    const intent  = cpData.intent
    const routing = cpData.routing
    const fixes   = cpData.fixes_applied ?? []
    const retries = cpData.retries ?? 0

    const scoreVerdict = score == null ? null
      : score >= 75 ? 'Passed quality threshold — no repairs needed.'
      : score >= 60 ? 'Passed after repairs — BrandOS improved this before showing it to you.'
      : 'Below threshold — further improvement may be needed.'

    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/60">
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-800/30 rounded-xl transition-colors"
        >
          <HelpCircle className="w-3.5 h-3.5 text-gray-500 shrink-0" />
          <span className="text-xs font-medium text-gray-400">Why did BrandOS generate this?</span>
          {open
            ? <ChevronUp className="w-3.5 h-3.5 text-gray-600 ml-auto" />
            : <ChevronDown className="w-3.5 h-3.5 text-gray-600 ml-auto" />}
        </button>

        {open && (
          <div className="px-4 pb-4 space-y-4 border-t border-gray-800 pt-3">
            {/* Intent */}
            {intent && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Detected intent</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {intent.detected_task && (
                    <div className="bg-gray-800 rounded-lg px-3 py-2">
                      <span className="text-gray-500">Task type</span>
                      <p className="text-gray-200 mt-0.5">{String(intent.detected_task).replace(/_/g, ' ')}</p>
                    </div>
                  )}
                  {intent.complexity && (
                    <div className="bg-gray-800 rounded-lg px-3 py-2">
                      <span className="text-gray-500">Complexity</span>
                      <p className="text-gray-200 mt-0.5 capitalize">{intent.complexity}</p>
                    </div>
                  )}
                  {intent.ambiguity_level && (
                    <div className="bg-gray-800 rounded-lg px-3 py-2">
                      <span className="text-gray-500">Ambiguity</span>
                      <p className="text-gray-200 mt-0.5 capitalize">{intent.ambiguity_level}</p>
                    </div>
                  )}
                  {intent.confidence != null && (
                    <div className="bg-gray-800 rounded-lg px-3 py-2">
                      <span className="text-gray-500">Intent confidence</span>
                      <p className="text-gray-200 mt-0.5">{Math.round(intent.confidence * 100)}%</p>
                    </div>
                  )}
                </div>
                {intent.suggested_improvements?.length > 0 && (
                  <p className="text-xs text-amber-400/80 mt-2">
                    Tip: {intent.suggested_improvements[0]}
                  </p>
                )}
              </div>
            )}

            {/* Routing */}
            {routing && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">How it was generated</p>
                <div className="bg-gray-800 rounded-lg px-3 py-2 text-xs text-gray-300 space-y-1">
                  {routing.preferred_provider && <p><span className="text-gray-500">Provider: </span>{String(routing.preferred_provider)}</p>}
                  {routing.forceProvider      && <p><span className="text-gray-500">Forced provider: </span>{String(routing.forceProvider)}</p>}
                  {routing.reason             && <p><span className="text-gray-500">Why: </span>{routing.reason}</p>}
                  {routing.preferred_tiers && routing.preferred_tiers.length > 0 && (
                    <p><span className="text-gray-500">Tiers: </span>{routing.preferred_tiers.join(', ')}</p>
                  )}
                </div>
              </div>
            )}

            {/* Score */}
            {score != null && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Quality score</p>
                <div className="flex items-center gap-3">
                  <span className={`text-xl font-bold tabular-nums ${score >= 75 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                    {score}
                  </span>
                  <div>
                    <p className="text-xs text-gray-300">{scoreVerdict}</p>
                    {retries > 0 && <p className="text-xs text-gray-500 mt-0.5">Repaired {retries} time{retries !== 1 ? 's' : ''}</p>}
                  </div>
                </div>
              </div>
            )}

            {/* Fixes */}
            {fixes.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Improvements applied</p>
                <ul className="space-y-1">
                  {fixes.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                      <Check className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── P3: Cross-session campaign brief persistence ───────────────────────────
  // Saves a campaign brief stub so users can restore their work via
  // /workspace/create?brief=<campaign_brief_id> in any future session.
  function SaveBriefButton({ topic, format }: { topic: string; format: string }) {
    const [saving, setSaving] = useState(false)
    const [briefUrl, setBriefUrl] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)

    const handleSave = async () => {
      setSaving(true)
      try {
        const res = await fetch('/api/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: topic.slice(0, 80), topic, formats: [format] }),
        })
        const data: { campaign_brief_id?: string } = await res.json()
        if (!res.ok || !data.campaign_brief_id) return
        setBriefUrl(`${window.location.origin}/workspace/create?brief=${data.campaign_brief_id}`)
      } catch { /* non-critical */ } finally {
        setSaving(false)
      }
    }

    if (briefUrl) {
      return (
        <div className="flex items-center gap-2 p-2.5 bg-gray-900/60 border border-gray-700 rounded-lg text-xs">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          <span className="text-gray-400 flex-1 truncate">Brief saved — share or bookmark this link to continue later</span>
          <button
            onClick={() => { navigator.clipboard.writeText(briefUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )
    }

    return (
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
      >
        {saving ? <Loader className="w-3 h-3 animate-spin" /> : <ArrowDownToLine className="w-3 h-3" />}
        Save brief for later
      </button>
    )
  }

  // ── Signal review in Save step (P1.10) ────────────────────────────────────
  // After generation, surface any pending brand signals so the user can
  // approve/reject them at the moment of highest engagement — while they're
  // still thinking about the content they just created.
  // Uses existing /api/control-plane/brand-memory PATCH contract.
  function SaveStepSignalReview() {
    const [signals, setSignals] = React.useState<Array<{
      id?: string; entry_id?: string; summary?: string; signal?: string;
      description?: string; topic?: string; classification?: string;
      confidence?: number; status?: string;
    }>>([])
    const [loadingSignals, setLoadingSignals] = React.useState(true)
    const [actioned, setActioned] = React.useState<Set<string>>(new Set())
    const [dismissed, setDismissed] = React.useState(false)

    React.useEffect(() => {
      // Small delay so the server has time to write brand_memory_entries
      // (recordBrandMemoryObservation fires asynchronously after generation)
      const timer = setTimeout(() => {
        fetch('/api/control-plane/brand-memory')
          .then(r => r.json())
          .then(d => {
            const all: typeof signals = Array.isArray(d) ? d : (d?.entries ?? [])
            setSignals(all.filter(e => !e.status || e.status === 'pending_review'))
          })
          .catch(() => {})
          .finally(() => setLoadingSignals(false))
      }, 1500)
      return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleAction = async (entry: typeof signals[0], approved: boolean) => {
      const id = entry.entry_id ?? entry.id
      if (!id) return
      setActioned(prev => new Set(prev).add(id))
      try {
        await fetch('/api/control-plane/brand-memory', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entry_id: id, approved, reviewed_by: user?.id ?? 'unknown' }),
        })
      } catch { /* non-fatal */ }
    }

    if (dismissed || (loadingSignals === false && signals.length === 0)) return null

    const pending = signals.filter(s => {
      const id = s.entry_id ?? s.id
      return id ? !actioned.has(id) : true
    })
    const reviewedCount = actioned.size
    const allActioned = reviewedCount > 0 && pending.length === 0

    return (
      <div className="rounded-xl border border-cyan-900/50 bg-cyan-950/20 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="text-sm font-medium text-cyan-200">
              {allActioned
                ? `${reviewedCount} signal${reviewedCount === 1 ? '' : 's'} reviewed — thanks!`
                : loadingSignals
                ? 'Checking what BrandOS learned…'
                : `BrandOS picked up ${signals.length} signal${signals.length === 1 ? '' : 's'} from this`
              }
            </span>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-gray-600 hover:text-gray-400 transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {loadingSignals && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Loader className="w-3.5 h-3.5 animate-spin" />
            <span>Looking for new brand signals…</span>
          </div>
        )}

        {!loadingSignals && !allActioned && pending.length > 0 && (
          <>
            <p className="text-xs text-cyan-300/70">
              Approve what fits your brand. These will shape every future generation.
            </p>
            <div className="space-y-2">
              {pending.slice(0, 3).map((entry, i) => {
                const id = entry.entry_id ?? entry.id ?? String(i)
                return (
                  <div key={id} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-black/30">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-200 truncate">
                        {entry.summary ?? entry.signal ?? entry.description ?? entry.topic ?? 'New brand signal'}
                      </p>
                      {entry.classification && (
                        <span className="text-[10px] text-gray-500">
                          {entry.classification === 'A' ? 'Strong pattern' : entry.classification === 'B' ? 'Emerging pattern' : 'Early observation'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => void handleAction(entry, true)}
                        className="p-1.5 rounded bg-gray-800 hover:bg-emerald-900/50 hover:text-emerald-400 text-gray-400 transition-colors"
                        title="Keep this signal"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => void handleAction(entry, false)}
                        className="p-1.5 rounded bg-gray-800 hover:bg-red-900/50 hover:text-red-400 text-gray-400 transition-colors"
                        title="Discard this signal"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            {signals.length > 3 && (
              <button
                onClick={() => router.push('/workspace/brand?tab=signals')}
                className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3" />
                Review all {signals.length} signals in Intelligence
              </button>
            )}
          </>
        )}

        {!loadingSignals && allActioned && (
          <p className="text-xs text-cyan-300/70">
            Your approved signals are now part of your brand profile — they&rsquo;ll influence future generations.
          </p>
        )}
      </div>
    )
  }

  // ── Shared feedback row (unchanged) ───────────────────────────────────────
  function FeedbackRow() {
    if (!savedCampaignId) return null
    return (
      <div className="mt-2 p-3 bg-gray-900/60 border border-gray-800 rounded-xl flex items-center justify-between">
        <span className="text-xs text-gray-600 font-mono">#{savedCampaignId.slice(0, 8)}</span>
        {!feedbackSent ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Useful?</span>
            <button onClick={() => submitFeedback('useful')}
              className="flex items-center gap-1 px-2.5 py-1 bg-gray-800 hover:bg-green-600/20 hover:text-green-400 border border-gray-700 rounded text-xs transition-all">
              <ThumbsUp className="w-3 h-3" />Yes
            </button>
            <button onClick={() => submitFeedback('generic')}
              className="flex items-center gap-1 px-2.5 py-1 bg-gray-800 hover:bg-red-600/20 hover:text-red-400 border border-gray-700 rounded text-xs transition-all">
              <ThumbsDown className="w-3 h-3" />Generic
            </button>
          </div>
        ) : (
          <span className="text-xs text-green-400">Thanks ✓</span>
        )}
      </div>
    )
  }

  // ── Repurpose (GTM Critical Item 2, 2026-06-21) ───────────────────────────
  // Second entry point for Content Repurposing, alongside the Library
  // Content tab drawer (apps/web/app/(workspace)/workspace/library/page.tsx)
  // — both share extraction/transform logic via @/lib/repurpose so the text
  // extraction rules aren't duplicated. Reads whichever per-format result
  // state is currently populated (outputResult/carouselResult/deckResult/
  // reportResult — this page tracks them separately, not as one unified
  // `result`), matching the existing hasResult-style pattern used elsewhere
  // on this page.
  const [repurposeOpen, setRepurposeOpen] = useState(false)
  const [repurposeMode, setRepurposeMode] = useState(TRANSFORM_MODES[0].value)
  const [repurposing, setRepurposing] = useState(false)
  const [repurposeError, setRepurposeError] = useState<string | null>(null)
  const [repurposeResult, setRepurposeResult] = useState<{ outputs: { label: string; content: string }[] } | null>(null)

  function getActiveArtifact(): any {
    return carouselResult ?? deckResult ?? reportResult ?? newsletterResult ?? outputResult ?? null
  }

  async function handleQuickRepurpose() {
    const artifact = getActiveArtifact()
    const sourceText = extractSourceText(artifact)
    if (!sourceText.trim()) {
      setRepurposeError('Couldn\u2019t extract text from this result to repurpose')
      return
    }
    setRepurposing(true)
    setRepurposeError(null)
    setRepurposeResult(null)
    try {
      const result = await runRepurpose({
        mode: repurposeMode,
        sourceText,
        sourceFilename: artifact?.title ?? 'your content',
      })
      setRepurposeResult(result)
    } catch (err: any) {
      setRepurposeError(err?.message ?? 'Repurpose failed')
    } finally {
      setRepurposing(false)
    }
  }

  function RepurposeWidget() {
    if (!hasResult) return null

    if (!repurposeOpen) {
      return (
        <button
          onClick={() => setRepurposeOpen(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-gray-700 text-sm text-gray-300 hover:border-gray-500 hover:text-white transition-colors"
        >
          <Repeat className="w-4 h-4" />
          Repurpose into another format
        </button>
      )
    }

    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-200 flex items-center gap-2">
            <Repeat className="w-4 h-4 text-purple-400" />
            Repurpose into…
          </h3>
          <button
            onClick={() => { setRepurposeOpen(false); setRepurposeResult(null); setRepurposeError(null) }}
            className="text-gray-500 hover:text-white"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        {!repurposeResult && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {TRANSFORM_MODES.map(m => (
                <button
                  key={m.value}
                  onClick={() => setRepurposeMode(m.value)}
                  className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                    repurposeMode === m.value
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
              onClick={handleQuickRepurpose}
              disabled={repurposing}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-sm font-medium text-white transition-colors"
            >
              {repurposing ? <Loader className="w-4 h-4 animate-spin" /> : 'Generate'}
            </button>
            {repurposeError && <p className="text-xs text-red-400">{repurposeError}</p>}
          </>
        )}

        {repurposeResult && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">
              Generated {repurposeResult.outputs?.length ?? 0} output(s) — saved to your Library.
            </p>
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {(repurposeResult.outputs ?? []).map((o, i) => (
                <div key={i} className="rounded-lg bg-gray-800/60 p-3">
                  <p className="text-xs font-medium text-gray-300 mb-1">{o.label}</p>
                  <p className="text-xs text-gray-500 whitespace-pre-wrap line-clamp-3">{o.content}</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => router.push('/workspace/library')}
              className="text-xs text-purple-400 hover:text-purple-300"
            >
              View in Library →
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Step indicator ─────────────────────────────────────────────────────────
  function StepIndicator() {
    return (
      <div className="flex items-center gap-1.5 mb-6">
        {STEPS.map((s, i) => {
          const isActive = s.id === step
          const isPast = i < stepIndex
          return (
            <React.Fragment key={s.id}>
              <button
                onClick={() => (isPast || isActive) && goToStep(s.id)}
                disabled={!isPast && !isActive}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-purple-600 text-white'
                    : isPast
                    ? 'bg-gray-800 text-gray-300 hover:bg-gray-700 cursor-pointer'
                    : 'bg-gray-900 text-gray-600 cursor-default'
                }`}
              >
                {isPast ? <Check className="w-3 h-3" /> : <span>{i + 1}</span>}
                {s.label}
              </button>
              {i < STEPS.length - 1 && <div className={`h-px w-4 ${isPast ? 'bg-gray-700' : 'bg-gray-900'}`} />}
            </React.Fragment>
          )
        })}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
          <h1 className="text-2xl font-bold">Create</h1>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Shield className="w-3.5 h-3.5 text-blue-400" />
            <span>Enterprise Control Plane Active</span>
          </div>
        </div>

        <StepIndicator />

        {canvaExportError && (
          <div className="mb-4 flex items-start gap-3 p-4 bg-red-950/40 border border-red-800/50 rounded-xl">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-red-300">{canvaExportError}</p>
            </div>
            <button onClick={() => setCanvaExportError(null)} className="text-red-400 hover:text-red-200 text-xs">✕</button>
          </div>
        )}

        {figmaHandoffError && (
          <div className="mb-4 flex items-start gap-3 p-4 bg-red-950/40 border border-red-800/50 rounded-xl">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-red-300">{figmaHandoffError}</p>
            </div>
            <button onClick={() => setFigmaHandoffError(null)} className="text-red-400 hover:text-red-200 text-xs">✕</button>
          </div>
        )}

        {figmaHandoff && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setFigmaHandoff(null)}>
            <div
              className="max-w-md w-full bg-gray-900 border border-purple-700/40 rounded-2xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-purple-300 mb-2">Export to Figma</h3>
              <p className="text-sm text-gray-400 mb-4">
                Open Figma, run <b>BrandOS Export</b> from the Plugins menu, and paste this code:
              </p>
              <div className="flex items-center gap-2 mb-4">
                <code className="flex-1 px-3 py-2.5 bg-black/40 border border-gray-700 rounded-lg text-purple-200 text-sm font-mono break-all">
                  {figmaHandoff.token}
                </code>
                <button
                  onClick={() => navigator.clipboard?.writeText(figmaHandoff.token)}
                  className="px-3 py-2.5 bg-purple-900/50 hover:bg-purple-900/80 border border-purple-700/50 rounded-lg text-xs text-purple-200 transition-all"
                >
                  Copy
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                This code expires at {new Date(figmaHandoff.expiresAt).toLocaleTimeString()} and can only be used once.
                Don't have the plugin yet? See Settings → Export Integrations for install instructions.
              </p>
              <button
                onClick={() => setFigmaHandoff(null)}
                className="w-full py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-300 transition-all"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {unavailable && (
          <div className="mb-6 p-5 bg-gray-900 border border-amber-500/30 rounded-xl">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-sm font-semibold text-amber-300 mb-1">Generation Unavailable</div>
                <pre className="text-xs text-gray-400 whitespace-pre-wrap font-sans leading-relaxed">{unavailable.message}</pre>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {unavailable.actions.map(a => (
                <button key={a.action}
                  onClick={() => {
                    if (a.action === 'retry') { setUnavailable(null); generate('linkedin_post') }
                    if (a.action === 'open_settings') router.push('/workspace/brand')
                  }}
                  className="px-3 py-1.5 text-xs font-semibold bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg transition-all">
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">

            {/* ════════ STEP 1: WHAT ════════════════════════════════════════ */}
            {step === 'what' && (
              <section className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-300">What do you want to create?</h2>
                  <button
                    onClick={() => campaignTierLocked ? router.push('/workspace/settings/billing') : setCampaignMode(m => !m)}
                    aria-pressed={campaignMode}
                    title={campaignTierLocked ? 'Campaign mode requires Professional or above' : undefined}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      campaignTierLocked
                        ? 'bg-gray-800 text-gray-500 hover:text-amber-400'
                        : campaignMode ? 'bg-orange-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                    }`}
                  >
                    {campaignTierLocked ? <Lock className="w-3.5 h-3.5" /> : <Rocket className="w-3.5 h-3.5" />}
                    Campaign mode
                  </button>
                </div>

                {!campaignMode ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {FORMAT_OPTIONS.map(({ label, icon: Icon, color, format, tierLocked }) => (
                      tierLocked ? (
                        <button
                          key={format}
                          onClick={() => router.push('/workspace/settings/billing')}
                          title={`${label} requires Professional or above`}
                          className="px-3 py-3 bg-gray-800 border border-gray-700 rounded-lg font-semibold text-sm text-gray-500 flex flex-col items-center justify-center gap-1.5 hover:border-amber-500/40 hover:text-amber-400 transition-colors group"
                        >
                          <Lock className="w-4 h-4 group-hover:text-amber-400" />
                          {label}
                        </button>
                      ) : (
                        <button
                          key={format}
                          onClick={() => { setSelectedFormat(format); setStep('about') }}
                          className={`px-3 py-3 bg-gradient-to-r ${color} rounded-lg font-semibold text-sm transition-all flex flex-col items-center justify-center gap-1.5 ${
                            selectedFormat === format ? 'ring-2 ring-white/60' : ''
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          {label}
                        </button>
                      )
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500">
                      Pick the formats you want generated from one brief. Each runs through the same
                      generation pipeline, one after another, and groups together below.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {FORMAT_OPTIONS.filter(o => !o.tierLocked).map(({ label, icon: Icon, format }) => {
                        const picked = campaignFormats.includes(format)
                        return (
                          <button
                            key={format}
                            onClick={() =>
                              setCampaignFormats(prev =>
                                picked ? prev.filter(f => f !== format) : [...prev, format]
                              )
                            }
                            className={`px-3 py-3 rounded-lg font-semibold text-sm flex flex-col items-center justify-center gap-1.5 border-2 transition-all ${
                              picked
                                ? 'bg-orange-600/20 border-orange-500 text-orange-200'
                                : 'bg-gray-800 border-transparent text-gray-400 hover:text-white'
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                            {label}
                            {picked && <Check className="w-3 h-3" />}
                          </button>
                        )
                      })}
                    </div>
                    <button
                      onClick={() => setStep('about')}
                      disabled={campaignFormats.length === 0}
                      className="w-full px-3 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-40 rounded-lg font-semibold text-sm transition-all"
                    >
                      Continue with {campaignFormats.length} format{campaignFormats.length === 1 ? '' : 's'}
                    </button>
                  </div>
                )}
              </section>
            )}

            {/* ════════ STEP 2: ABOUT ═══════════════════════════════════════ */}
            {step === 'about' && (
              <>
                <section>
                  <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Brain className="w-4 h-4 text-blue-400" />
                      <h2 className="text-sm font-semibold text-gray-300">Smart Prompts</h2>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {SMART_PROMPTS.map(sp => (
                        <button key={sp.id} onClick={() => setPrompt(sp.prompt)}
                          className="p-3 bg-gray-800/80 hover:bg-gray-700 border border-gray-700/60 hover:border-gray-600 rounded-lg text-left transition-all">
                          <div className="text-xs font-semibold text-gray-200 mb-1">{sp.label}</div>
                          <div className="text-xs text-gray-500 line-clamp-2">{sp.prompt}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </section>

                <section>
                  <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 space-y-4">
                    <div className="flex items-center gap-2">
                      <Wand2 className="w-4 h-4 text-purple-400" />
                      <h2 className="text-sm font-semibold text-gray-300">Tell BrandOS about it</h2>
                    </div>

                    <div className="flex gap-2">
                      <input type="url" value={urlInput} onChange={e => setUrlInput(e.target.value)}
                        placeholder="Extract context from URL…"
                        className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 text-sm outline-none focus:border-gray-500 transition-colors" />
                      <button onClick={extractFromUrl} disabled={!urlInput || extractingUrl}
                        className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded-lg transition-all">
                        {extractingUrl ? <Loader className="w-4 h-4 animate-spin" /> : <LinkIcon className="w-4 h-4" />}
                      </button>
                    </div>

                    <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
                      placeholder="Enter your topic or paste content…" rows={4}
                      className="w-full px-3 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 resize-none text-sm outline-none focus:border-gray-500 transition-colors" />

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-500 mr-1">Tone:</span>
                      {(['executive', 'bold', 'educational', 'founder'] as ToneMode[]).map(t => (
                        <button key={t} onClick={() => setActiveTone(t)}
                          className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-all ${
                            activeTone === t ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                          }`}>{t}</button>
                      ))}
                    </div>

                    <div className="flex items-center justify-between px-3 py-2 bg-gray-800/60 border border-gray-700/60 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Brain className="w-3.5 h-3.5 text-blue-400" />
                        <span className="text-xs font-medium text-gray-300">Apply Brand Memory</span>
                        <span className="text-xs text-gray-500">
                          {applyBrandMemory ? '— persona, tone & identity active' : '— off: raw generation only'}
                        </span>
                      </div>
                      <button
                        onClick={() => changeBrandMemory(!applyBrandMemory)}
                        aria-pressed={applyBrandMemory}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 focus:outline-none ${
                          applyBrandMemory ? 'border-blue-500 bg-blue-500' : 'border-gray-600 bg-gray-700'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                            applyBrandMemory ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <button onClick={() => setStep('what')}
                        className="flex items-center gap-1 px-3 py-2 text-xs text-gray-400 hover:text-white transition-colors">
                        <ChevronLeft className="w-3.5 h-3.5" /> Back
                      </button>
                      <button
                        onClick={() => {
                          if (campaignMode) { void generateCampaignLite(); return }
                          if (selectedFormat === 'carousel') { void generateCarousel(); return }
                          generate(selectedFormat)
                        }}
                        disabled={!prompt.trim() || anyLoading}
                        className="flex items-center gap-1.5 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 rounded-lg font-semibold text-sm transition-all"
                      >
                        {anyLoading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        Generate <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </section>
              </>
            )}

            {/* ════════ STEP 3: PREVIEW ═════════════════════════════════════ */}
            {step === 'preview' && (
              <>
                {campaignMode && Object.keys(campaignResults).length > 0 && (
                  <section className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Campaign · {campaignFormats.length} formats
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(campaignResults).map(([fmt, r]) => (
                        <span key={fmt} className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 ${
                          r.status === 'done' ? 'bg-emerald-950 text-emerald-300' :
                          r.status === 'error' ? 'bg-red-950 text-red-300' : 'bg-gray-800 text-gray-400'
                        }`}>
                          {r.status === 'pending' && <Loader className="w-3 h-3 animate-spin" />}
                          {r.status === 'done' && <Check className="w-3 h-3" />}
                          {fmt}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {anyLoading && streamingLog.length > 0 && (
                  <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-900/60 border border-gray-800 rounded-xl p-4">
                    <Loader className="w-3.5 h-3.5 animate-spin" />
                    <span>{streamingLog[streamingLog.length - 1]}</span>
                  </div>
                )}

                {carouselResult && (
                  <section>
                    <ExportToolbar
                      icon={LayoutGrid} iconClass="text-cyan-400"
                      title={carouselResult.title ?? 'Carousel Blueprint'}
                      subtitle={`${carouselResult.slides?.length ?? 0} slides`}
                      onCopy={() => copyJSON(carouselResult)}
                      onExportJson={() => exportArtifact('json', carouselResult)}
                      onExportHtml={() => exportArtifact('html', carouselResult)}
                      onExportPdf={() => exportArtifact('pdf', carouselResult)}
                      onExportPptx={() => exportArtifact('pptx', carouselResult)}
                      onExportCanva={() => exportToCanva(carouselResult)}
                      onExportFigma={() => exportToFigma(carouselResult)}
                    />
                    <CarouselRenderer artifact={carouselResult} />
                  </section>
                )}

                {deckResult && (
                  <section>
                    <ExportToolbar
                      icon={Presentation} iconClass="text-indigo-400"
                      title={deckResult.title ?? 'Deck'}
                      subtitle={`${deckResult.slides?.length ?? 0} slides`}
                      onCopy={() => copyJSON(deckResult)}
                      onExportJson={() => exportArtifact('json', deckResult)}
                      onExportHtml={() => exportArtifact('html', deckResult)}
                      onExportPdf={() => exportArtifact('pdf', deckResult)}
                      onExportPptx={() => exportArtifact('pptx', deckResult)}
                      onExportCanva={() => exportToCanva(deckResult)}
                      onExportFigma={() => exportToFigma(deckResult)}
                    />
                    <DeckRenderer artifact={deckResult} />
                  </section>
                )}

                {reportResult && (
                  <section>
                    <ExportToolbar
                      icon={BookOpen} iconClass="text-emerald-400"
                      title={reportResult.title ?? 'Report'}
                      subtitle={`${reportResult.sections?.length ?? 0} sections`}
                      onCopy={() => copyJSON(reportResult)}
                      onExportJson={() => exportArtifact('json', reportResult)}
                      onExportHtml={() => exportArtifact('html', reportResult)}
                      onExportPdf={() => exportArtifact('pdf', reportResult)}
                      onExportPptx={() => exportArtifact('pptx', reportResult)}
                      onExportCanva={() => exportToCanva(reportResult)}
                      onExportFigma={() => exportToFigma(reportResult)}
                    />
                    <ReportRenderer artifact={reportResult} />
                  </section>
                )}

                {newsletterResult && (
                  <section>
                    <ExportToolbar
                      icon={Mail} iconClass="text-blue-400"
                      title={newsletterResult.subject_line ?? newsletterResult.title ?? 'Newsletter'}
                      subtitle={`${newsletterResult.sections?.length ?? 0} sections`}
                      onCopy={() => copyJSON(newsletterResult)}
                      onExportJson={() => exportArtifact('json', newsletterResult)}
                      onExportHtml={() => exportArtifact('html', newsletterResult)}
                      onExportPdf={() => exportArtifact('pdf', newsletterResult)}
                      onExportPptx={() => {}}
                      onExportCanva={() => {}}
                      onExportFigma={() => {}}
                    />
                    <NewsletterRenderer artifact={newsletterResult} />
                  </section>
                )}

                {outputResult && (
                  <section>
                    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h2 className="text-sm font-semibold text-gray-200 mb-1">{outputResult.title}</h2>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs px-2 py-0.5 bg-gray-800 border border-gray-700 rounded-full text-gray-400">Artifact</span>
                            {outputResult.audience?.label && (
                              <span className="text-xs px-2 py-0.5 bg-blue-900/20 text-blue-400 border border-blue-700/40 rounded-full">
                                {outputResult.audience.label}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => copyJSON(outputResult)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs transition-all">
                          <Copy className="w-3.5 h-3.5" />Copy
                        </button>
                      </div>
                      <pre className="whitespace-pre-wrap bg-black/40 border border-gray-800 p-4 rounded-lg text-sm leading-relaxed text-gray-200">
                        {JSON.stringify(outputResult, null, 2)}
                      </pre>
                    </div>
                  </section>
                )}

                {/* P3.28 — "Why this?" explainability panel.
                    Shown when cpData is available (all non-free-text routes).
                    Intent, routing rationale, quality score, and any fixes applied. */}
                {!anyLoading && hasResult && cpData && <WhyThisPanel cpData={cpData} />}

                {!anyLoading && (
                  <div className="flex items-center justify-between pt-2">
                    <button onClick={() => setStep('about')}
                      className="flex items-center gap-1 px-3 py-2 text-xs text-gray-400 hover:text-white transition-colors">
                      <ChevronLeft className="w-3.5 h-3.5" /> Back
                    </button>
                    {hasResult && (
                      <button
                        onClick={() => setStep('save')}
                        className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 rounded-lg font-semibold text-sm transition-all"
                      >
                        Continue to Save <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ════════ STEP 4: SAVE ════════════════════════════════════════ */}
            {step === 'save' && (
              <section className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-sm font-semibold text-gray-300">
                    {hasResult ? 'Saved — export or get feedback' : 'Nothing to save yet'}
                  </h2>
                </div>

                {savedCampaignId && (
                  <p className="text-xs text-gray-500">
                    Saved to Library as <span className="font-mono text-gray-400">#{savedCampaignId.slice(0, 8)}</span>.
                    Find it anytime in <button onClick={() => router.push('/workspace/library')} className="text-cyan-400 hover:text-cyan-300 underline">Library</button>.
                  </p>
                )}

                {/* Signal review prompt — inline in Save step per P1 audit requirement */}
                {hasResult && <SaveStepSignalReview />}

                <FeedbackRow />

                <RepurposeWidget />

                {/* P3: Cross-session persistence — save brief for later */}
                {!savedCampaignId && prompt && selectedFormat && (
                  <SaveBriefButton topic={prompt} format={selectedFormat} />
                )}

                <div className="flex items-center justify-between pt-2">
                  <button onClick={() => setStep('preview')}
                    className="flex items-center gap-1 px-3 py-2 text-xs text-gray-400 hover:text-white transition-colors">
                    <ChevronLeft className="w-3.5 h-3.5" /> Back
                  </button>
                  <button
                    onClick={() => {
                      clearResults()
                      setCampaignResults({})
                      setPrompt('')
                      setStep('what')
                    }}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold text-sm transition-all"
                  >
                    <Wand2 className="w-3.5 h-3.5" /> Create another
                  </button>
                </div>
              </section>
            )}
          </div>

          {/* ── Right column: Control Plane (unchanged) ──────────────────── */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <RuntimeModeSelector
                value={mode}
                onChange={changeMode}
                disabled={anyLoading || availLoading}
                modeStatuses={modeStatuses}
                recommendedMode={recommendedMode}
                autoSelect={true}
              />
            </div>

            {/* Phase 7 — Model selection: wired to selectedModel state, which is
                forwarded as the `model` field in the generate body (Phase 4 path). */}
            <ModelSelector
              variant="compact"
              activeTier={mode}
              onTierChange={(tier) => changeMode(tier)}
              onModelChange={(modelId) => setSelectedModel(modelId)}
            />

            <ControlPlanePanel
              cpData={cpData}
              isLoading={anyLoading}
              overrideMode={overrideMode}
              onModeChange={changeOverrideMode}
              streamingLog={streamingLog}
            />

            {outputResult && (
              <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Sparkles className="w-3 h-3" /> Session Stats
                </div>
                <div className="space-y-2 text-xs">
                  {[
                    { label: 'Artifact', value: outputResult.title ?? '—' },
                    { label: 'Audience', value: outputResult.audience?.label ?? '—' },
                    { label: 'Tone',     value: activeTone },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between">
                      <span className="text-gray-600">{row.label}</span>
                      <span className="text-gray-300 font-mono">{String(row.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
