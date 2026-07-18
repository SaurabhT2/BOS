/**
 * @platform/cognition-contract — CognitionContext.ts
 *
 * THE canonical, cross-repository system contract between BrandOS
 * (Execution Platform) and IntelligenceOS (Cognitive Platform).
 *
 * Governed by, and must be kept consistent with:
 *   - architecture/INTELLIGENCE_PLATFORM_ARCHITECTURE.md
 *   - architecture/COGNITION_CONTRACT_SPEC.md
 *   - architecture/INTELLIGENCE_PLATFORM_IMPLEMENTATION.md §4
 *
 * THIS FILE IS THE ENTIRE COGNITIVE VOCABULARY BRANDOS IS PERMITTED TO HAVE.
 * If a concept does not appear here, BrandOS cannot use it — not because of
 * a missing import, but because it does not exist from BrandOS's point of
 * view (COGNITION_CONTRACT_SPEC.md §4).
 *
 * Every field is a finished cognitive OUTCOME — a judgment IntelligenceOS
 * has already reached. None of it is an INGREDIENT a consumer could
 * recombine into a new conclusion. Before adding a field, check it against
 * COGNITION_CONTRACT_SPEC.md §4 "What is permanently excluded": no raw or
 * unconsolidated signals, no repository/storage references, no extractor or
 * resolver identifiers, no internal confidence calculations, no workspace
 * history beyond what Provenance summarizes.
 *
 * DUPLICATION NOTICE: until both repositories can depend on a single
 * published `@platform/cognition-contract` package from a shared registry,
 * this file is physically duplicated — byte-for-byte — in both the
 * `brandos` and `intelligence-os` repositories, at
 * `packages/cognition-contract/src/CognitionContext.ts`. See this
 * package's README for the tracked follow-up to collapse the duplication.
 * Until that follow-up lands, any change to this file must be applied to
 * both copies in the same change set — this is the one exception the
 * "no duplicated intelligence logic" rule tolerates, because it duplicates
 * a type-only contract, not a capability.
 */

// ─── Confidence ──────────────────────────────────────────────────────────

/**
 * A single, honest signal of how much the rest of a CognitionContext should
 * be trusted. BrandOS may use this to gate stricter governance review; it
 * must never try to recompute, derive, or second-guess it.
 */
export type CognitionConfidence = 'high' | 'medium' | 'low' | 'degraded'

// ─── Voice ───────────────────────────────────────────────────────────────

/**
 * The answer to "how does this brand sound." Prompt-ready expression of
 * tone, cadence, audience, and constraints. This is the section BrandOS's
 * Prompt Compiler leans on most directly — already shaped as writing
 * guidance, not as data about writing.
 */
export interface VoiceProfile {
  readonly tone: string
  readonly cadence: 'short' | 'medium' | 'long' | 'varied'
  readonly audienceType: string
  readonly executiveLevel: boolean
  readonly domain: string
  readonly bannedPhrases: readonly string[]

  // ── Additive fields (minor-version contract evolution) ──────────────────
  // Preserves finished judgments the Prompt Compiler already depended on
  // pre-split (via IBrandVoice / IPersonaContribution). Each is a resolved
  // outcome, not a raw signal — valid under the §4 exclusion list. Added
  // per COGNITION_CONTRACT_SPEC.md §5 "Adding new fields", and to satisfy
  // the migration requirement to keep public BrandOS APIs stable wherever
  // possible.
  readonly brandName?: string
  readonly voiceDescriptor?: string
  readonly audiencePositioning?: string
}

// ─── Identity ────────────────────────────────────────────────────────────

/**
 * The answer to "who is this brand" as it applies to a single generation:
 * the stable, learned expression patterns — narrative habits, argument
 * style, named frameworks — that persist across outputs. Pre-gated by
 * confidence; BrandOS applies these fields as-is and never re-derives them.
 */
export interface IdentityContribution {
  readonly brandName: string | null
  readonly narrativeArcs: readonly string[]
  readonly argumentationStyle: string | null
  readonly namedFrameworks: readonly string[]
  readonly preferredLength: 'short' | 'medium' | 'long'

  // ── Additive fields (minor-version contract evolution) ──────────────────
  // Carries the remaining Class A / Class B style-and-structure outcomes
  // BrandOS's IdentityContributor already consumed pre-split (via
  // IStyleProjection → IIdentityContribution). Every field below is a
  // finished judgment already gated by IntelligenceOS at resolution time —
  // never a raw or unconsolidated signal. See this package's README for
  // the deprecation note tracking eventual consolidation of these fields
  // into the five above.
  readonly hookStyle?: string
  readonly ctaIntent?: string
  readonly evidencePatterns?: readonly string[]
  readonly executiveCadence?: string
  readonly titlePatterns?: readonly string[]
  readonly hookPatterns?: readonly string[]
  readonly valueFrames?: readonly string[]
  readonly structuralArcs?: readonly string[]
}

// ─── Visual Identity ─────────────────────────────────────────────────────

/**
 * The style-relevant visual attributes needed by rendering and
 * presentation — a projection for BrandOS's rendering needs, not a
 * general design system.
 */
export interface VisualIdentityProjection {
  readonly primaryColor?: string
  readonly fontStyle?: string
  readonly layoutDensity?: 'compact' | 'balanced' | 'spacious'
}

// ─── Provenance ──────────────────────────────────────────────────────────

/**
 * Minimal, diagnostic-only metadata for observability and debugging.
 * Never a basis for BrandOS business logic — if a consumer finds itself
 * branching on a Provenance field, the information it needs belongs in a
 * business-facing section instead.
 */
export interface CognitionProvenance {
  readonly signalCount: number
  readonly lastConsolidatedAt: string | null
}

// ─── Knowledge / Reasoning / Positioning (ADR-004) ──────────────────────

/**
 * ADR-004 (Cognitive Consolidation) — recurring themes and named
 * frameworks a workspace's cognition has retained, from both Knowledge
 * (uploaded reference material) and Experience (corroborated behavioral
 * patterns). `confidence`/`hasConflict` are the only synthesis-layer
 * signals that cross this boundary — per-item provenance (which Learning
 * or KnowledgeAsset produced which theme) is an internal implementation
 * detail excluded by this file's own header rule ("no repository/storage
 * references, no extractor or resolver identifiers").
 */
export interface CognitionKnowledgeSection {
  readonly themes: readonly { readonly name: string; readonly description: string }[]
  readonly confidence: CognitionConfidence
  readonly hasConflict: boolean
}

/**
 * ADR-004 (Cognitive Consolidation) — conclusions a workspace's cognition
 * has reached beyond direct recall (analytical/evaluative frameworks,
 * strategic and decision-making patterns), from both Knowledge and
 * Experience.
 */
export interface CognitionReasoningSection {
  readonly conclusions: readonly { readonly statement: string }[]
  readonly confidence: CognitionConfidence
  readonly hasConflict: boolean
}

/**
 * ADR-004 (Cognitive Consolidation) — how a workspace stands relative to
 * its market or category. Experience-sourced only as of this contract
 * version — no Knowledge-side extractor produces competitive/market
 * framing yet (ADR-004 §0.1); this field is not itself narrower for that
 * reason, a future contract version may add Knowledge-sourced statements
 * without a shape change here.
 */
export interface CognitionPositioningSection {
  readonly statements: readonly { readonly statement: string }[]
  readonly confidence: CognitionConfidence
  readonly hasConflict: boolean
}

// ─── CognitionContext ────────────────────────────────────────────────────

/**
 * The complete, immutable cognitive picture of a workspace at the moment
 * of resolution. Every section is the OUTPUT of cognition, never an
 * ingredient BrandOS could recombine into a new judgment — and every
 * section is complete: BrandOS never needs a second call to "finish" what
 * a CognitionContext started.
 *
 * Resolved once, used, and discarded. Never mutated, patched, or merged
 * with local data. If the picture needs to change, request a new
 * resolution — do not edit this one (COGNITION_CONTRACT_SPEC.md §2 rule 5).
 */
export interface CognitionContext {
  readonly contractVersion: string
  readonly workspaceId: string
  readonly resolvedAt: string
  readonly confidence: CognitionConfidence

  readonly voice: VoiceProfile
  readonly identity: IdentityContribution | null
  readonly visualIdentity: VisualIdentityProjection | null
  readonly provenance: CognitionProvenance

  // ── ADR-004 (Cognitive Consolidation) additive fields (minor-version contract evolution) ──
  // Null when the Subject's current profile has nothing synthesized yet
  // for that section — the same honest "nothing learned or declared yet"
  // state `identity` already uses. See ADR-004 §9.
  readonly knowledge: CognitionKnowledgeSection | null
  readonly reasoning: CognitionReasoningSection | null
  readonly positioning: CognitionPositioningSection | null
}

// ─── CognitionRequest ────────────────────────────────────────────────────

/**
 * Input to resolveCognitionContext(). Deliberately narrow: a workspace and
 * an optional task type are the only inputs IntelligenceOS needs, because
 * everything else it uses to resolve a CognitionContext is state
 * IntelligenceOS already owns. BrandOS does not forward persona records,
 * brand-context overrides, or any other raw payload on this call — see
 * this package's README, "Known contract gaps", for the workspace
 * explicit-configuration question this raises.
 */
export interface CognitionRequest {
  readonly workspaceId: string
  readonly taskType?: string
}

// ─── ObservationInput ────────────────────────────────────────────────────

/**
 * A report of what happened — what was generated, how it scored, in what
 * workspace — with no interpretation attached. BrandOS never classifies,
 * scores, or interprets what it observed; it only reports.
 */
export interface ObservationInput {
  readonly workspaceId: string
  readonly requestId: string
  readonly outputText: string
  readonly score: number
  readonly topic?: string
  readonly artifactType?: string
  readonly wasRepaired?: boolean
  readonly observedAt?: string
  // ── Cognitive Platform Evolution Program, Milestone 3 (Experience Loop) ──
  // Additive (contract §5 minor-version rule) — see EM-3.4/EM-3.5. Previously
  // BrandOS resolved provider/model/routing in-process for every generation
  // and discarded it at the end of the request; IntelligenceOS had no way
  // to correlate output quality with generation configuration.
  /** EM-3.4. Which LLM provider served this generation (e.g. 'anthropic', 'openai'). */
  readonly providerId?: string
  /** EM-3.4. Which model served this generation (e.g. 'claude-sonnet-4-6'). */
  readonly modelId?: string
  /** EM-3.4. BrandOS's routing decision that selected providerId/modelId, when one was made explicitly (vs. default). */
  readonly routingHint?: string
  /** EM-3.4. Token accounting, when the provider response exposes it (currently often unavailable — see BrandOS's runtime-config layer). */
  readonly tokenUsage?: {
    readonly promptTokens?: number
    readonly completionTokens?: number
    readonly totalTokens?: number
  }
  /**
   * EM-3.5. Distinguishes a successful generation (the default — omitting
   * this field means 'success', so every existing caller's payloads keep
   * their existing meaning unchanged) from a reported failure. Previously
   * failed generations produced no observe() call at all and were
   * invisible to IntelligenceOS. `outputText`/`score` remain required
   * fields (no contract-breaking change) — callers reporting a failure
   * should send `outputText: ''`/`score: 0`, which `SignalExtractor`'s
   * existing `isMeaningfulScore()` guard already treats as producing no
   * quality-bearing signals, which is the correct behavior for a
   * generation that never produced real output to judge.
   */
  readonly outcome?: 'success' | 'failure'
  /** EM-3.5. Present when outcome is 'failure' — a short, non-sensitive failure reason (e.g. 'provider_timeout', 'provider_error'). Never a raw error message/stack (may contain sensitive request content). */
  readonly failureReason?: string
}

// ─── CognitionSummary ────────────────────────────────────────────────────

/**
 * A display-ready summary of a workspace's cognition, intended for direct
 * presentation in BrandOS UI surfaces (e.g. a brand profile page). Distinct
 * from CognitionContext: shaped for human reading, not for driving
 * generation, and carries no guarantee of matching CognitionContext's shape
 * or freshness.
 */
export interface CognitionSummary {
  readonly preferredTone: string | null
  readonly audience: string | null
  readonly industry: string | null
  readonly positioning: string | null
  readonly keywords: string | null
}

// ─── CognitionAvailability / CognitionHealth ────────────────────────────

/**
 * Whether IntelligenceOS is currently able to serve requests, so BrandOS
 * can apply its own degraded-mode handling. Never returns cognitive
 * content — only availability.
 */
export interface CognitionHealth {
  readonly healthy: boolean
  readonly degradedReason?: string
}

// ─── Contract version ────────────────────────────────────────────────────

/**
 * The current semantic version of THIS contract (independent of either
 * platform's own release versioning). Bump the minor version for additive,
 * backward-compatible changes; the major version only for a breaking
 * change, per COGNITION_CONTRACT_SPEC.md §5.
 *
 * 1.1.0 (Cognitive Platform Evolution Program, EM-1.1): brings this copy's
 * CognitionContext back into parity with IntelligenceOS's — adds the
 * ADR-004 knowledge/reasoning/positioning sections that were previously
 * synthesized by IntelligenceOS but invisible to BrandOS. This copy
 * deliberately still omits `CognitionReviewDecision` and
 * `CognitionProvider.review()` (see CognitionProvider.ts's Option B note
 * and this package's README) — that is a tracked, pending architecture
 * decision (EM-4.5 of the Cognitive Platform Evolution Program), not
 * unintentional drift, and this program does not resolve it unilaterally.
 */
export const COGNITION_CONTRACT_VERSION = '1.1.0'
