/**
 * apps/web/lib/repurpose.ts
 *
 * GTM Critical Item 2 (2026-06-21): shared client-side helpers for Content
 * Repurposing, used by both the Library Content tab drawer and the Create
 * flow's Save step — the two "logical entry points already present" named
 * in the sprint brief.
 *
 * Extracted to a shared module specifically so the two call sites do not
 * each reimplement extractSourceText() — duplicating that logic would mean
 * two places to keep in sync with @brandos/contracts' ArtifactV2 shapes.
 *
 * Does NOT duplicate /api/transform or transformAgent.ts — this module only
 * prepares the sourceText string the existing route already expects.
 */

export const TRANSFORM_MODES: { value: string; label: string; hint: string }[] = [
  { value: 'whitepaper_to_posts', label: 'Social posts', hint: 'A set of standalone posts' },
  { value: 'article_to_carousel', label: 'Carousel',     hint: 'Slide-by-slide carousel' },
  { value: 'notes_to_newsletter', label: 'Newsletter',   hint: 'Email-ready newsletter' },
  { value: 'pdf_to_deck_outline', label: 'Deck outline', hint: 'Slide deck outline' },
]

/**
 * Reduce a campaigns.content payload (any of the shapes it can take) down
 * to plain text suitable for /api/transform's sourceText field.
 *
 * Shapes handled (verified directly against source, not assumed):
 *   - Non-structured generations (post/article/x_thread/newsletter):
 *     { content: '<plain text>', ... } — no artifact_type field.
 *     See apps/web/app/api/generate/route.ts, "Step 3: Non-structured tasks".
 *   - Structured ArtifactV2, discriminated by artifact_type:
 *     'carousel' -> slides[].{headline,subheadline,body,bullets}
 *     'deck'     -> slides[].{title,subtitle,body,bullets}
 *     'report'   -> sections[].{heading,subheading,body,key_findings}
 *     See packages/contracts/src/artifact-v2.ts for the authoritative shapes.
 *   - Output of a prior transform (format: transform_*):
 *     { outputs: [{ label, content }] } — see TransformResult in
 *     apps/web/lib/agents/transformAgent.ts.
 */
export function extractSourceText(content: any): string {
  if (!content || typeof content !== 'object') return ''

  if (typeof content.content === 'string' && !content.artifact_type) {
    return content.content
  }

  switch (content.artifact_type) {
    case 'carousel':
      return (content.slides ?? [])
        .map((s: any) => [s.headline, s.subheadline, s.body, ...(s.bullets ?? [])].filter(Boolean).join('\n'))
        .join('\n\n')
    case 'deck':
      return (content.slides ?? [])
        .map((s: any) => [s.title, s.subtitle, s.body, ...(s.bullets ?? [])].filter(Boolean).join('\n'))
        .join('\n\n')
    case 'report':
      return (content.sections ?? [])
        .map((s: any) => [s.heading, s.subheading, s.body, ...(s.key_findings ?? [])].filter(Boolean).join('\n'))
        .join('\n\n')
    default:
      if (Array.isArray(content.outputs)) {
        return content.outputs.map((o: any) => o.content).filter(Boolean).join('\n\n')
      }
      return [content.title, content.summary].filter(Boolean).join('\n\n')
  }
}

export interface TransformOutput { label: string; content: string; type: string }
export interface TransformResultPayload {
  mode: string
  title: string
  outputs: TransformOutput[]
}

/**
 * POST to /api/transform with already-extracted source text. Throws with
 * the route's own error message on failure (including the named
 * "No brand persona found. Run style analysis first." precondition) so
 * callers can surface it directly rather than a generic failure message.
 */
export async function runRepurpose(opts: {
  mode: string
  sourceText: string
  sourceFilename?: string
}): Promise<TransformResultPayload> {
  const res = await fetch('/api/transform', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error ?? 'Repurpose failed')
  return data.result
}
