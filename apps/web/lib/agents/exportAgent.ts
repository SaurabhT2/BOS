/**
 * Export Agent — Feature 7
 * Takes one generated asset and converts it to multiple channel formats.
 * Structured for Claude API plug-in.
 */

export type ExportChannel = 'linkedin_post' | 'x_thread' | 'newsletter' | 'deck_outline'

export interface ExportRequest {
  sourceContent: string
  sourceFormat: string
  userStyle: Record<string, any>
  channels: ExportChannel[]
}

export interface ExportOutput {
  channel: ExportChannel
  label: string
  content: string
  word_count: number
  icon: string
}

export interface ExportResult {
  source_title: string
  outputs: ExportOutput[]
  generated_at: string
}

const CHANNEL_META: Record<ExportChannel, { label: string; icon: string }> = {
  linkedin_post: { label: 'LinkedIn Post', icon: '💼' },
  x_thread: { label: 'X Thread', icon: '🧵' },
  newsletter: { label: 'Newsletter Section', icon: '📰' },
  deck_outline: { label: 'Deck Outline', icon: '📊' },
}

function toLinkedIn(source: string, style: Record<string, any>): string {
  const domain = style?.semantic_profile?.primary_domain || 'AI'
  const lines = source.split('\n').filter(l => l.trim().length > 30).slice(0, 3)
  const core = lines[0]?.trim() || `${domain} architecture requires intentional design.`

  return `${core}

Here's the pattern I keep seeing across enterprise ${domain} deployments:

→ Teams optimize capability before establishing control
→ Observability is treated as an afterthought
→ Governance is delegated to vendors instead of owned internally

The organizations that get this right aren't the ones with the most models.

They're the ones who built the operating model first.

Architecture is the moat. Everything else is execution.

What's your governance posture today?

#${domain.replace(/\s+/g, '')} #EnterpriseAI #Architecture`
}

function toXThread(source: string, style: Record<string, any>): string {
  const domain = style?.semantic_profile?.primary_domain || 'AI'
  const subdomains: string[] = style?.semantic_profile?.subdomains || ['Architecture']
  const paragraphs = source.split('\n\n').filter(p => p.trim().length > 40).slice(0, 7)

  const tweets = [
    `[1/8] Most ${domain} platforms aren't failing because of bad models.\n\nThey're failing because of missing architecture.\n\nA thread on what actually matters: 🧵`,
    `[2/8] The core problem:\n\nTeams race to deploy capabilities without establishing ${subdomains[0]?.toLowerCase() || 'governance'}.\n\nThe result: technical debt that compounds at AI speed.`,
    ...paragraphs.slice(0, 4).map((p, i) => `[${i + 3}/8] ${p.slice(0, 200).trim()}${p.length > 200 ? '...' : ''}`),
    `[7/8] The pattern in every successful ${domain} deployment I've reviewed:\n\n1. Governance before capability\n2. Observability from day one\n3. Architecture as competitive moat`,
    `[8/8] The teams winning this decade won't win because of model access.\n\nThey'll win because of architectural clarity.\n\n→ Follow for weekly ${domain} frameworks\n→ Save this thread\n\n#${domain.replace(/\s+/g, '')} #EnterpriseAI`,
  ]

  return tweets.join('\n\n---\n\n')
}

function toNewsletter(source: string, style: Record<string, any>): string {
  const domain = style?.semantic_profile?.primary_domain || 'AI'
  const user = style?.user || 'Author'
  const audience = style?.semantic_profile?.audience || 'Enterprise Leaders'
  const preview = source.slice(0, 400).trim()

  return `SUBJECT LINE OPTIONS:
A) "The ${domain} architecture decision nobody is talking about"
B) "What I keep seeing in enterprise ${domain} deployments"
C) "The framework that changes how you think about ${domain} scale"

─────────────────────────────────────────

OPENING:

If you're building at enterprise scale, you already know that ${domain} is not a feature decision.

It's a systems decision.

Most teams get this wrong in the same predictable way.

Here's the pattern — and the fix.

─────────────────────────────────────────

MAIN CONTENT:

${preview}

[Continue with your full insight here — the above is extracted from your source document]

─────────────────────────────────────────

FRAMEWORK CALLOUT:

The operating model that works:
1. Governance first — not as a gate, but as a foundation
2. Observability built in — not bolted on
3. Feedback architecture — closed loops from day one

─────────────────────────────────────────

CLOSE:

The teams that win this decade will win on architecture, not access.

Until next week —
${user}

P.S. Reply with the ${domain} challenge you're working through right now. I read every response.

─────────────────────────────────────────
Governing Scaled Intelligence · Unsubscribe`
}

function toDeckOutline(source: string, style: Record<string, any>): string {
  const domain = style?.semantic_profile?.primary_domain || 'AI'
  const subdomains: string[] = style?.semantic_profile?.subdomains || ['Architecture', 'Governance']
  const authority = style?.semantic_profile?.authority_level || 'Executive'

  const slides = [
    { n: 1, title: 'Executive Summary', note: 'Single most important insight. ≤40 words. No bullets.' },
    { n: 2, title: 'The Problem', note: `Why ${domain} without ${subdomains[0]?.toLowerCase() || 'architecture'} creates structural risk.` },
    { n: 3, title: `${subdomains[0] || 'Architecture'} Framework`, note: 'Your core model. Visual diagram strongly recommended.' },
    { n: 4, title: `${subdomains[1] || 'Governance'} Layer`, note: 'How control is enforced. Policy-first framing.' },
    { n: 5, title: 'Implementation Pathway', note: '90-day sequenced plan. Timeline or table visual.' },
    { n: 6, title: 'Risk & Mitigation', note: `${authority}-level framing. What can go wrong and how it's contained.` },
    { n: 7, title: 'Success Metrics', note: '5–7 KPIs. Split: technical and business outcomes.' },
    { n: 8, title: 'The Ask', note: 'Clear recommendation. Cost-justified. Sequenced next steps.' },
  ]

  return slides.map(s =>
    `SLIDE ${s.n}: ${s.title.toUpperCase()}\n` +
    `Content guidance: ${s.note}\n` +
    `Design note: ${s.n === 1 ? 'Full bleed, minimal text, high contrast' : 'Max 4 points, breathing room'}\n`
  ).join('\n')
}

export async function runExportAgent(req: ExportRequest): Promise<ExportResult> {
  const { sourceContent, sourceFormat, userStyle, channels } = req

  const outputs: ExportOutput[] = channels.map(channel => {
    const meta = CHANNEL_META[channel]
    let content = ''

    switch (channel) {
      case 'linkedin_post': content = toLinkedIn(sourceContent, userStyle); break
      case 'x_thread':      content = toXThread(sourceContent, userStyle); break
      case 'newsletter':    content = toNewsletter(sourceContent, userStyle); break
      case 'deck_outline':  content = toDeckOutline(sourceContent, userStyle); break
    }

    return {
      channel,
      label: meta.label,
      content,
      word_count: content.split(/\s+/).filter(Boolean).length,
      icon: meta.icon,
    }
  })

  return {
    source_title: `Exported from: ${sourceFormat}`,
    outputs,
    generated_at: new Date().toISOString(),
  }
}


