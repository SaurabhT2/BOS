/**
 * Planner Agent — BrandOS
 * v2: Routes through Control Plane instead of calling ai-runtime-layer directly.
 * Removed: import { callWithMode, isUnavailable } from '@brandos/ai-runtime-layer'
 *
 * PHASE 1 FIX (1.5): Replaced raw semantic_profile.audience reads with a resolved
 * IBrandCognitionContext fetched via Brand Intelligence. The hardcoded
 * 'Enterprise Leaders' fallback string is removed — audience resolution is BI's
 * responsibility, not the agent's.
 *
 * Cleanup Sprint 2: replaced getGlobalBrandIntelligenceRuntime with
 * resolveBrandCognitionContext from @brandos/control-plane-layer.
 */

import { runControlPlane, resolveBrandCognitionContext } from '@brandos/control-plane-layer'
import { v4 as uuidv4 } from 'uuid'

export interface ContentIdea {
  id: string
  day: string
  format: 'linkedin_post' | 'carousel' | 'newsletter' | 'x_thread' | 'article'
  title: string
  hook: string
  angle: string
  why_now: string
  format_label: string
  color: string
}

export interface PlannerResult {
  week_theme: string
  ideas: ContentIdea[]
  generated_at: string
  context_signals: string[]
}

const FORMAT_META: Record<ContentIdea['format'], { label: string; color: string }> = {
  linkedin_post: { label: 'LinkedIn Post', color: 'cyan' },
  carousel: { label: 'Carousel', color: 'purple' },
  newsletter: { label: 'Newsletter', color: 'green' },
  x_thread: { label: 'X Thread', color: 'blue' },
  article: { label: 'Article', color: 'amber' },
}

/**
 * Resolve brand context via IntelligenceOS's CognitionProvider.
 * Returns resolved audience, domain, and tone from CognitionContext.voice.
 * Falls back to raw semantic_profile fields only when IntelligenceOS is
 * unavailable (resolveBrandCognitionContext degrades gracefully rather
 * than throwing, but this catch remains as defense in depth).
 */
async function resolveBrandContext(
  userStyle: Record<string, any>,
  workspaceId: string
): Promise<{
  domain: string
  subdomains: string[]
  audience: string
  keywords: string[]
  tone: string
}> {
  try {
    const cognitionContext = await resolveBrandCognitionContext({ workspaceId })
    const { voice } = cognitionContext
    // `identity` is always null under the current CognitionProvider contract
    // (ContextBuilder only resolves workspace-scoped data; identity/visual
    // features are userId-scoped and not yet wired — see
    // packages/cognition-contract/README.md, "Known contract gaps").
    // subdomains/keywords have no current source; kept empty rather than
    // invented, same as the BI-unavailable fallback below already does for
    // its own empty-array cases.

    return {
      domain: voice.domain || 'Technology',
      subdomains: [],
      audience: voice.audienceType || '',
      keywords: [],
      tone: voice.tone || 'professional',
    }
  } catch {
    // BI unavailable — fall back to raw semantic_profile without hardcoded audience
    const semantic = userStyle?.semantic_profile || {}
    return {
      domain: semantic.primary_domain || 'Technology',
      subdomains: semantic.subdomains || [],
      // No 'Enterprise Leaders' default — leave empty and let the LLM infer
      audience: semantic.audience || semantic.target_audience || '',
      keywords: semantic.top_keywords || [],
      tone: 'professional',
    }
  }
}

function buildPlannerPrompt(
  domain: string,
  subdomains: string[],
  audience: string,
  tone: string,
  keywords: string[],
  recentOutputs: string[]
): string {
  const recentContext = recentOutputs.length > 0
    ? `Recent content topics (avoid repeating): ${recentOutputs.slice(0, 5).join('; ')}`
    : ''

  const audienceLine = audience
    ? `- Target audience: ${audience}`
    : '- Target audience: infer from domain and content'

  return `You are a world-class LinkedIn content strategist.

Create a 3-idea weekly content plan for a ${domain} thought leader.

AUTHOR PROFILE:
- Domain: ${domain}
- Subdomains: ${subdomains.join(', ') || 'not specified'}
${audienceLine}
- Tone: ${tone}
- Keywords: ${keywords.join(', ') || 'not specified'}
${recentContext}

Return a JSON object with this EXACT structure, no markdown, no commentary:
{
  "week_theme": "one compelling theme for the week",
  "context_signals": ["signal1", "signal2", "signal3"],
  "ideas": [
    {
      "day": "Monday",
      "format": "linkedin_post",
      "title": "compelling post title or topic",
      "hook": "the exact opening line or hook to grab attention",
      "angle": "the strategic angle and narrative approach",
      "why_now": "why this topic is timely and relevant right now"
    },
    {
      "day": "Wednesday",
      "format": "carousel",
      "title": "...",
      "hook": "...",
      "angle": "...",
      "why_now": "..."
    },
    {
      "day": "Friday",
      "format": "newsletter",
      "title": "...",
      "hook": "...",
      "angle": "...",
      "why_now": "..."
    }
  ]
}

Requirements:
- Each idea must be original and specific to this author's domain and audience
- Hooks must be provocative and concrete
- No generic business advice platitudes
- Tone must match: ${tone}

Return ONLY the JSON object.`
}

function buildFallbackResult(domain: string): PlannerResult {
  return {
    week_theme: 'Content plan unavailable',
    ideas: [
      {
        id: `idea-${Date.now()}-0`,
        day: 'Monday',
        format: 'linkedin_post',
        title: 'Configure an API key to generate your content plan',
        hook: 'Add ANTHROPIC_API_KEY, GROQ_API_KEY, or enable Bespoke mode to get AI-crafted content ideas.',
        angle: 'Go to Settings and configure a generation engine.',
        why_now: 'AI generation is currently unavailable.',
        format_label: FORMAT_META.linkedin_post.label,
        color: FORMAT_META.linkedin_post.color,
      },
    ],
    generated_at: new Date().toISOString(),
    context_signals: [domain].filter(Boolean),
  }
}

function parseAndBuildResult(raw: string, domain: string, subdomains: string[]): PlannerResult {
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)

  const ideas: ContentIdea[] = (parsed.ideas ?? []).map((idea: any, i: number) => {
    const format = (idea.format ?? 'linkedin_post') as ContentIdea['format']
    const meta = FORMAT_META[format] ?? FORMAT_META.linkedin_post
    return {
      id: `idea-${Date.now()}-${i}`,
      day: idea.day ?? ['Monday', 'Wednesday', 'Friday'][i] ?? 'Monday',
      format,
      title: idea.title ?? 'Untitled',
      hook: idea.hook ?? '',
      angle: idea.angle ?? '',
      why_now: idea.why_now ?? '',
      format_label: meta.label,
      color: meta.color,
    }
  })

  return {
    week_theme: parsed.week_theme ?? `${domain} thought leadership`,
    ideas,
    generated_at: new Date().toISOString(),
    context_signals: parsed.context_signals ?? [domain, ...subdomains.slice(0, 2)].filter(Boolean),
  }
}

export async function runPlannerAgent(
  userStyle: Record<string, any>,
  tone: string = 'executive',
  recentOutputs: string[] = [],
  supabase?: any
): Promise<PlannerResult> {
  // P0 — Implementation Wave 1A: userId and workspaceId are now distinct,
  // both supplied by app/api/planner/route.ts (via requireUser()). The prior
  // `(userStyle as any)?._user_id ?? 'planner'` fallback conflated the two
  // and could fall back to the literal string 'planner' — that fallback is
  // removed. Both _user_id and _workspace_id are required inputs from the
  // route; if either is missing, this throws rather than silently using a
  // placeholder workspace.
  const userId = (userStyle as any)?._user_id
  const workspaceId = (userStyle as any)?._workspace_id
  if (!userId || !workspaceId) {
    throw new Error(
      '[plannerAgent] userStyle._user_id and userStyle._workspace_id are required ' +
      '(resolved by requireUser() in app/api/planner/route.ts)'
    )
  }

  // PHASE 1 FIX (1.5): Resolve brand context via BI rather than reading raw
  // semantic_profile fields. No hardcoded audience fallback strings.
  const { domain, subdomains, audience, keywords, tone: resolvedTone } =
    await resolveBrandContext(userStyle, workspaceId)

  const effectiveTone = tone !== 'executive' ? tone : resolvedTone

  const prompt = buildPlannerPrompt(domain, subdomains, audience, effectiveTone, keywords, recentOutputs)

  try {
    // Route through control plane — never call ai-runtime-layer directly
    const cpResponse = await runControlPlane(
      {
        request_id: uuidv4(),
        user_id: userId,
        workspace_id: workspaceId,
        user_prompt: prompt,
        task_type: 'post',
        tone: effectiveTone,
        format: 'linkedin_post',
        override_mode: 'standard',
      },
      'cloud',
      supabase ?? null
    )

    const raw = typeof cpResponse.output === 'string'
      ? cpResponse.output
      : JSON.stringify(cpResponse.output ?? '')

    if (raw && raw.includes('"ideas"')) {
      return parseAndBuildResult(raw, domain, subdomains)
    }

    console.warn('[PlannerAgent] Unexpected control plane output format')
    return buildFallbackResult(domain)
  } catch (err) {
    console.error('[PlannerAgent] Control plane call failed:', (err as Error).message)
    return buildFallbackResult(domain)
  }
}
