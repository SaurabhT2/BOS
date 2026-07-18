/**
 * apps/web/lib/asset-classification.ts
 *
 * Cognitive Platform Evolution Program — Milestone 2 (Knowledge Loop),
 * EM-2.3 (Asset Type Classification).
 *
 * Per the Platform Ownership Review's EM-2.3 verdict: this taxonomy
 * (`playbook | framework | methodology | template | reference`) is
 * BrandOS's own content vocabulary, not a generic platform concept — so
 * this classifier is deliberately a BrandOS-local heuristic, not a shared
 * contract addition. IntelligenceOS already accepts any of these five
 * string values; only BrandOS's choice of *which* one to send is changing,
 * from always 'reference' to a real best-effort classification.
 *
 * Deliberately filename/title + lightweight-content heuristic, not an LLM
 * call — keeps this cheap and synchronous at upload time. A future,
 * separate improvement could route through an LLM classifier for higher
 * accuracy; that's a bigger, explicitly out-of-scope change for this EM.
 */

/**
 * Mirrors KnowledgeAssetIngestInput['assetType']
 * (@brandos/cognition-client/src/KnowledgeIngestClient.ts) as a local
 * literal type rather than an import — apps/web is not permitted to import
 * from @brandos/cognition-client at all (even type-only), only through CPL
 * proxies (see scripts/check-boundaries.mjs, RULE-1). Keep these two
 * literal unions in sync by hand if the wire type changes.
 */
export type ClassifiableAssetType =
  | 'playbook'
  | 'framework'
  | 'methodology'
  | 'template'
  | 'reference'
  | 'visual_asset'

const KEYWORD_RULES: { type: ClassifiableAssetType; pattern: RegExp }[] = [
  { type: 'playbook', pattern: /\b(playbook|runbook|run[-\s]?book|how[-\s]?to|step[-\s]?by[-\s]?step|sop)\b/i },
  { type: 'framework', pattern: /\b(framework|model|canvas|matrix|lens|principles?|pillars?)\b/i },
  { type: 'methodology', pattern: /\b(methodology|method|process|approach|system|workflow|protocol)\b/i },
  { type: 'template', pattern: /\b(template|boilerplate|starter|scaffold|format|structure|deck[-\s]?template)\b/i },
  { type: 'visual_asset', pattern: /\b(logo|brand[-\s]?mark|palette|color[-\s]?scheme|typography|font[-\s]?family|visual[-\s]?identity|moodboard|mood[-\s]?board)\b/i },
]

/**
 * Best-effort classification from filename and (optionally) extracted
 * text content. Falls back to 'reference' — the same default this route
 * always used — when nothing matches, so behavior for genuinely
 * ambiguous uploads is unchanged, not regressed.
 */
export function classifyAssetType(filename: string, extractedText?: string): ClassifiableAssetType {
  const haystack = `${filename} ${(extractedText ?? '').slice(0, 500)}`

  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(haystack)) return rule.type
  }

  return 'reference'
}
