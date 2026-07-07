/**
 * Transform Agent
 * Repurposes uploaded document content into multiple content assets.
 * Uses source text + UserStyle profile to generate high-ROI outputs.
 *
 * PHASE 1 FIX (1.5): Replaced raw semantic.audience and semantic.voice reads
 * with resolved IBrandCognitionContext fields from Brand Intelligence.
 * The hardcoded 'Enterprise Leaders' audience fallback is removed — audience
 * resolution is BI's responsibility.
 *
 * Cleanup Sprint 2: replaced getGlobalBrandIntelligenceRuntime with
 * resolveBrandCognitionContext from @brandos/control-plane-layer.
 */

import { resolveBrandCognitionContext } from '@brandos/control-plane-layer'

export type TransformMode =
  | 'whitepaper_to_posts'
  | 'article_to_carousel'
  | 'notes_to_newsletter'
  | 'pdf_to_deck_outline'

export interface TransformRequest {
  mode: TransformMode
  sourceText: string
  userStyle: Record<string, any>
  sourceFilename?: string
}

export interface TransformResult {
  mode: TransformMode
  title: string
  outputs: TransformOutput[]
  metadata: {
    source_words: number
    generated_at: string
    style_applied: string
  }
}

export interface TransformOutput {
  label: string
  content: string
  type: 'post' | 'slide' | 'section' | 'email'
}

// ─── Brand context resolution ──────────────────────────────────────────────────

interface ResolvedBrandContext {
  domain: string
  subdomains: string[]
  audience: string
  voice: string
  authorName: string
  authorityLevel: string
}

/**
 * Resolves brand context via Brand Intelligence.
 * Falls back to raw semantic_profile fields when BI is unavailable.
 * Never injects a hardcoded audience string — audience comes from BI or is left
 * for the LLM to infer from the domain context.
 *
 * P0 — Implementation Wave 1A: requires `style._workspace_id`, set by
 * app/api/transform/route.ts from requireUser()'s resolved workspaceId.
 * Removed the `(style as any)?._user_id ?? (style as any)?.workspace_id ??
 * 'transform'` fallback chain — '_user_id' conflated user and workspace
 * (the exact anti-pattern P0 removes), '.workspace_id' was dead (no caller
 * ever set it), and the 'transform' literal fallback meant every
 * resolveBrandCognitionContext() call from this agent resolved against a
 * nonexistent "transform" workspace, silently degrading to BI's
 * degraded-context fallback for 100% of transform requests.
 */
async function resolveBrandContext(
  style: Record<string, any>
): Promise<ResolvedBrandContext> {
  const workspaceId = (style as any)?._workspace_id

  if (!workspaceId) {
    // No workspace context available — skip BI entirely and use the raw
    // semantic_profile fallback below (same as a BI-unavailable error).
    const semantic = style?.semantic_profile || {}
    return {
      domain: semantic.primary_domain || 'AI',
      subdomains: semantic.subdomains || ['Architecture'],
      audience: semantic.audience || '',
      voice: semantic.voice || 'Strategic',
      authorName: (style as any).user || 'Author',
      authorityLevel: semantic.authorityLevel || 'Executive',
    }
  }

  try {
    const cognitionContext = await resolveBrandCognitionContext({ workspaceId })
    const { voice } = cognitionContext
    // identity is always null under the current CognitionProvider contract
    // (workspace-scoped only) — subdomains/authorityLevel have no current
    // source, so default the same way this function's own BI-unavailable
    // fallback below already does.

    return {
      domain: voice.domain || 'AI',
      subdomains: ['Architecture'],
      audience: voice.audienceType || '',
      voice: voice.tone || 'Strategic',
      authorName: (style as any).user || 'Author',
      authorityLevel: 'Executive',
    }
  } catch {
    // BI unavailable — raw semantic_profile without hardcoded audience
    const semantic = style?.semantic_profile || {}
    return {
      domain: semantic.primary_domain || 'AI',
      subdomains: semantic.subdomains || ['Architecture'],
      // No 'Enterprise Leaders' default — leave empty for LLM inference
      audience: semantic.audience || '',
      voice: semantic.voice || 'Strategic',
      authorName: style?.user || 'Author',
      authorityLevel: semantic.authority_level || 'Executive',
    }
  }
}

// ─── Transform implementations ────────────────────────────────────────────────

function transformWhitepaperToPosts(
  text: string,
  ctx: ResolvedBrandContext
): TransformOutput[] {
  const { domain, voice } = ctx
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 40)
  const sampleSentences = sentences.slice(0, 5)

  return Array.from({ length: 5 }, (_, i) => ({
    type: 'post' as const,
    label: `Post ${i + 1} of 5`,
    content: `${voice} perspective — ${domain} insight #${i + 1}

${sampleSentences[i]?.trim() || `Key insight ${i + 1} from your ${domain} whitepaper`}.

Here's what most leaders miss about this:

→ It's not a technical problem — it's an architectural decision
→ The teams who get this right build systems that compound
→ Late adoption creates structural debt that compounds

What's your read on this?

#${domain.replace(/\s/g, '')} #EnterpriseAI #Leadership`,
  }))
}

function transformArticleToCarousel(
  text: string,
  ctx: ResolvedBrandContext
): TransformOutput[] {
  const { domain, subdomains } = ctx
  const paragraphs = text.split('\n\n').filter(p => p.trim().length > 60)

  const slides = [
    {
      type: 'slide' as const,
      label: 'Slide 1 — Hook',
      content: `HOOK SLIDE\n\nHeadline: "${domain}: What the Playbook Actually Looks Like"\n\nSub: "Swipe for the framework →"\n\nVisual: Bold text on dark bg, accent color on key word`,
    },
    ...paragraphs.slice(0, 5).map((p, i) => ({
      type: 'slide' as const,
      label: `Slide ${i + 2} — Insight ${i + 1}`,
      content: `CONTENT SLIDE ${i + 2}\n\nHeadline: "${subdomains[i % subdomains.length]} Layer ${i + 1}"\n\nCopy extract:\n"${p.slice(0, 120).trim()}..."\n\nVisual: Clean 2-column layout, icon left, copy right`,
    })),
    {
      type: 'slide' as const,
      label: `Slide 7 — CTA`,
      content: `CTA SLIDE\n\nHeadline: "Found this useful?"\n\nCTA: "Follow for weekly ${domain} frameworks"\nSecondary: "Save this post"\n\nVisual: Brand close, signature treatment`,
    },
  ]

  return slides
}

function transformNotesToNewsletter(
  text: string,
  ctx: ResolvedBrandContext
): TransformOutput[] {
  const { domain, audience, authorName } = ctx
  const preview = text.slice(0, 300).trim()

  // audience line: use resolved audience if available, otherwise keep generic
  const audienceLine = audience
    ? `If you're reading this, you're probably one of the ${audience.toLowerCase()} who knows`
    : 'If you\'re reading this, you likely know'

  return [
    {
      type: 'email' as const,
      label: 'Subject Lines (3 variants)',
      content: `Option A: "The ${domain} framework nobody is teaching"\nOption B: "What I learned building at enterprise scale"\nOption C: "This changes how you think about ${domain} architecture"`,
    },
    {
      type: 'email' as const,
      label: 'Opening Hook',
      content: `${audienceLine} that ${domain} is not a feature — it's a system.

Most people building in this space are optimizing the wrong layer.

Here's what actually matters.`,
    },
    {
      type: 'email' as const,
      label: 'Main Content',
      content: `FROM YOUR NOTES — EXPANDED:\n\n${preview}\n\n[Continue with your full insight here]\n\nThe framework I keep returning to:\n\n1. Start with governance, not capability\n2. Build for observability from day one\n3. Treat prompt engineering as systems design\n\nEach of these deserves its own issue. But together, they form the operating model.`,
    },
    {
      type: 'email' as const,
      label: 'Closing + CTA',
      content: `The teams that win this decade won't win because of model access.

They'll win because of architectural clarity.

Until next week —
${authorName}

P.S. Reply with the ${domain} challenge you're dealing with. I read every response.`,
    },
  ]
}

function transformPdfToDeckOutline(
  text: string,
  ctx: ResolvedBrandContext
): TransformOutput[] {
  const { domain, subdomains, authorityLevel } = ctx

  const sections = [
    { title: 'Executive Summary', notes: 'The single most important thing to know. One slide, max 40 words.' },
    { title: 'Problem Framing', notes: `Why ${domain} requires architectural discipline. 2-3 bullet max.` },
    { title: `${subdomains[0]} Layer`, notes: 'The foundational layer. Visual diagram recommended.' },
    { title: `${subdomains[1] || 'Orchestration'} Design`, notes: 'How the components connect. Flow diagram or matrix.' },
    { title: 'Implementation Pathway', notes: '90-day sequenced plan. Table or timeline visual.' },
    { title: 'Risk & Governance', notes: `What can go wrong. Control mechanisms. ${authorityLevel}-level framing.` },
    { title: 'Success Metrics', notes: '5-7 KPIs. Split: technical and business outcomes.' },
    { title: 'Strategic Recommendation', notes: 'The ask. Clear, sequenced, cost-justified.' },
  ]

  return sections.map((s, i) => ({
    type: 'slide' as const,
    label: `Slide ${i + 1}: ${s.title}`,
    content: `SLIDE ${i + 1}: ${s.title.toUpperCase()}\n\nContent guidance:\n${s.notes}\n\nSource text extract:\n"${text.slice(i * 100, i * 100 + 100).trim() || 'Insert your key point here'}..."\n\nDesign note: ${i === 0 ? 'Full bleed, minimal text' : 'Max 4 points per slide'}`,
  }))
}

// ─── Main transform function ──────────────────────────────────────────────────

export async function runTransformAgent(req: TransformRequest): Promise<TransformResult> {
  const { mode, sourceText, userStyle, sourceFilename } = req
  const wordCount = sourceText.split(/\s+/).filter(Boolean).length

  // PHASE 1 FIX (1.5): Resolve brand context via BI — not from raw semantic_profile.
  const ctx = await resolveBrandContext(userStyle)

  let outputs: TransformOutput[] = []
  let title = ''

  switch (mode) {
    case 'whitepaper_to_posts':
      title = `5 LinkedIn Posts from "${sourceFilename || 'your document'}"`
      outputs = transformWhitepaperToPosts(sourceText, ctx)
      break
    case 'article_to_carousel':
      title = `Carousel from "${sourceFilename || 'your article'}"`
      outputs = transformArticleToCarousel(sourceText, ctx)
      break
    case 'notes_to_newsletter':
      title = `Newsletter from "${sourceFilename || 'your notes'}"`
      outputs = transformNotesToNewsletter(sourceText, ctx)
      break
    case 'pdf_to_deck_outline':
      title = `Deck Outline from "${sourceFilename || 'your PDF'}"`
      outputs = transformPdfToDeckOutline(sourceText, ctx)
      break
  }

  return {
    mode,
    title,
    outputs,
    metadata: {
      source_words: wordCount,
      generated_at: new Date().toISOString(),
      style_applied: ctx.voice || 'Professional Premium',
    },
  }
}
