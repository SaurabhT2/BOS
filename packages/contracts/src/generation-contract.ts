/**
 * @brandos/contracts — generation-contract.ts
 *
 * ARCHITECTURAL ROLE:
 *   ResolvedGenerationContract is the typed prompt-assembly contract.
 *   It replaces the implicit string-concatenation approach that was used
 *   in compilePrompt() (Evaluation Report §4.2, §5 Step 6).
 *
 *   Each contributor owns one typed slice. IContractAssembler wires
 *   all registered contributors together and produces the full contract.
 *   compilePrompt() serialises the full struct — no more ad-hoc fragments.
 *
 * CONTRIBUTOR MAP:
 *   Slot         Owner layer                          Active?
 *   ─────────────────────────────────────────────────────────────────
 *   identity     identity-layer (IdentityRuntime)     Yes — flows as identityFragment
 *   persona      control-plane-layer (brand-merge.ts) Yes — flows as brandFragment
 *   intent       control-plane-layer (intake.ts)      Yes — implicit in taskType routing
 *   artifact     artifact-engine-layer (ICompiler)    Yes — schema inlined in compilePrompt()
 *   runtime      control-plane-layer (router.ts)      Yes — implicit in retry/routing logic
 *   skill        iskill-runtime                       No  — Phase 2, gated by feature flag
 *
 * RULES:
 *   - Additive only: never remove an existing contributor interface.
 *   - All fields are optional except intent.taskType and runtime.*
 *     (graceful degradation when a contributor is unavailable).
 *   - ContractAssembler implementation lives in @brandos/output-control-layer.
 *     Only the interface is defined here.
 *   - This file has zero imports from @brandos/* packages.
 */

// ---------------------------------------------------------------------------
// IIdentityContribution
// Owned by: identity-layer (IdentityRuntime → ISemanticIdentity + IVisualIdentity)
// Active:   Yes — currently flows as a flat identityFragment string.
//           When this typed interface is wired, the flat string is eliminated.
// ---------------------------------------------------------------------------
/**
 * Cognitive Platform Evolution Program, Milestone 4 (Identity Evolution),
 * EM-4.1 (Knowledge/Reasoning/Positioning Contributors).
 *
 * Surfaces CognitionContext's ADR-004 (Cognitive Consolidation) sections —
 * `knowledge`, `reasoning`, `positioning` — which BrandOS's contract copy
 * gained in EM-1.1 but which nothing read until this contribution slot
 * existed. IntelligenceOS was already synthesizing this content from both
 * uploaded Knowledge and corroborated Experience; it reached this far and
 * then went unused (see the audit's §1.2).
 *
 * Combines all three CognitionContext sections into one contribution
 * (rather than three separate slots/contributors) — they share an
 * identical shape (an item list + confidence + hasConflict) and a common
 * origin (ADR-004's single consolidation pass), and the prompt compiler
 * renders them as one section. A future need to treat them independently
 * (different confidence gates, different prompt placement) would be a
 * reason to split this back apart — not anticipated speculatively here.
 */
export interface IKnowledgeContribution {
  /** From CognitionContext.knowledge — recurring themes across uploaded/learned material. */
  themes?: { name: string; description: string }[]
  /** From CognitionContext.reasoning — conclusions reached beyond direct recall. */
  conclusions?: string[]
  /** From CognitionContext.positioning — market/category standing statements. */
  positioningStatements?: string[]
  /**
   * Diagnostic only, same convention as IIdentityContribution.confidence —
   * never used for gating (IntelligenceOS's null-vs-populated decision on
   * each section IS the gate). The lowest of the three sections' reported
   * confidence, when more than one section is present.
   */
  confidence: number
  /** True if any of the three sections reported hasConflict. Surfaced so a future prompt/UI treatment can hedge language accordingly — not acted on by the compiler itself yet. */
  hasConflict?: boolean
}

export interface IIdentityContribution {
  /**
   * Preferred narrative hook approach learned from past successful content.
   * Examples: 'contrarian', 'story', 'data-led', 'question', 'bold-claim'
   * Used to bias the LLM hook generation style.
   */
  hookStyle?: string

  /**
   * Curated CTA phrase patterns from the user's brand voice.
   * Examples: ['Save this', 'Try this framework', 'DM me TEMPLATE']
   * Injected verbatim into the prompt as approved CTA vocabulary.
   */
  ctaPatterns?: string[]

  /**
   * Topic domains the user frequently creates content in.
   * Examples: ['AI', 'enterprise', 'leadership', 'fintech']
   * Used to ensure generated content stays within the user's expertise domain.
   */
  domains?: string[]

  /**
   * Curated phrase library for brand voice consistency.
   * Words and phrases that the user consistently uses (or avoids).
   * High-confidence phrases are injected as examples; low-confidence are filtered.
   */
  phraseLibrary?: string[]

  /**
   * Confidence score 0–100 from the identity resolution engine.
   * EDGE CASE: Scores below ~40 indicate insufficient signal — the prompt
   * compiler may choose to omit this contribution rather than inject
   * low-quality personalization that could degrade output.
   */
  confidence: number

  /**
   * Preferred post length detected from historical content patterns.
   * Maps to min/max slide count guidance in the artifact contribution.
   */
  preferredLength?: 'short' | 'medium' | 'long'

  /**
   * Structural arc patterns detected across past successful content.
   * Examples: 'Problem → solution arc', 'Contrarian reframe', 'List-insight structure'
   * Injected as narrative framing guidance in the prompt.
   */
  narrativePatterns?: string[]

  /**
   * Sentence-density and pacing style learned from past artifacts.
   * Examples: 'Punchy short-sentence cadence', 'Staccato-then-elaboration pacing'
   * Used to guide prose rhythm in generation.
   */
  executiveCadence?: string

  /**
   * Primary mode of claim substantiation detected across past content.
   * Examples: 'Data-led argumentation', 'First-person experience led'
   * Injected as a stylistic constraint on how arguments are constructed.
   */
  argumentationStyle?: string

  /**
   * Evidence vocabulary the author consistently employs.
   * Examples: 'Quantitative data and statistics', 'Concrete examples', 'Personal experience'
   * Used to ensure generated content matches the user's established credibility style.
   */
  evidencePatterns?: string[]

  // ── V2 fields (from IStyleProjection) ─────────────────────────────────────

  /**
   * V2: Single CTA intent string (replaces ctaPatterns[0] as canonical).
   * Examples: 'Follow for more', 'Save this', 'DM me TEMPLATE'
   */
  ctaIntent?: string

  /**
   * V2: Narrative arc label from Class A signals.
   * Examples: 'Problem → Stakes → Solution → Proof', 'Contrarian open → Evidence → Flip'
   */
  narrativeArc?: string

  /**
   * V2 Class B: Title/headline structural templates.
   * Shapes only — not verbatim content.
   * Examples: '[Number] [Adjective] Ways to [Verb]', 'The [Noun] Problem (And How to Fix It)'
   */
  titlePatterns?: string[]

  /**
   * V2 Class B: Opening-line structural templates.
   * Applied as structural shapes, not verbatim copies.
   */
  hookPatterns?: string[]

  /**
   * V2 Class B: Value proposition structural templates.
   * Fill with current topic — never copied verbatim.
   */
  valueFrames?: string[]

  /**
   * V2 Class B: Structural arc labels.
   * Examples: 'Problem → Solution arc', 'Contrarian reframe'
   */
  structuralArcs?: string[]

  /**
   * Topics the author repeatedly discusses across artifacts.
   * Discovered from corpus — not hardcoded categories.
   * Examples: 'Enterprise AI', 'product strategy', 'go-to-market motion'
   * Injected to keep generated content within the user's established topic territory.
   */
  recurringThemes?: string[]

  /**
   * Mental models, stage progressions, maturity models, or operating models
   * the author repeatedly uses to explain ideas.
   * Discovered from structural signals in content — not hardcoded frameworks.
   * Examples: 'Adoption Maturity Model', '4-stage progression', 'three-pillar governance framework'
   * Injected to encourage generation of structured, framework-style reasoning.
   */
  signatureFrameworks?: string[]

  /**
   * Repeated viewpoints, convictions, and recommendations the author holds.
   * Discovered from opinion/stance language — not hardcoded positions.
   * Examples: 'governance before scale', 'product over technology', 'must build trust first'
   * Injected to ensure generated content reflects the user's known point of view.
   */
  corePositions?: string[]

  /**
   * Strategic stories the author tells about change, disruption, or market evolution.
   * Discovered from transition/narrative language — not hardcoded narratives.
   * Examples: 'Shift from on-premise to cloud', 'AI is disrupting knowledge work'
   * Injected to align generated content with the user's market framing.
   */
  marketNarratives?: string[]

  /**
   * Visual identity signals — only meaningful for carousel and deck artifacts.
   * Injected into the renderer, not the LLM prompt.
   */
  visual?: {
    /** 6-char hex color without '#', e.g. 'ff5533' */
    primaryColor?: string
    fontStyle?: string
    /** Controls whitespace vs content density in the renderer layout engine */
    layoutDensity?: 'compact' | 'balanced' | 'spacious'
  }
}

// ---------------------------------------------------------------------------
// IPersonaContribution
// Owned by: control-plane-layer (brand-merge.ts → BrandContext + persona record)
// Active:   Yes — currently flows as a flat brandFragment string.
// ---------------------------------------------------------------------------
export interface IPersonaContribution {
  /**
   * Brand/persona tone. Injected as a direct LLM instruction.
   * Examples: 'executive', 'conversational', 'technical', 'thought-leadership'
   */
  tone: string

  /**
   * Brand voice descriptor. Qualifies the tone.
   * Examples: 'strategic', 'direct', 'empathetic', 'data-driven'
   */
  voice: string

  /**
   * Primary audience positioning — who the brand speaks TO.
   * Examples: 'C-suite', 'founders', 'developers', 'enterprise procurement'
   * Used in slide audience_profile fields and as an LLM prompt constraint.
   */
  audiencePositioning?: string

  /**
   * Brand name included in prompt attribution lines.
   * Example: 'Acme Corp' → "Write content for Acme Corp, a brand that…"
   * Omitted from prompt when undefined.
   */
  brandName?: string
}

// ---------------------------------------------------------------------------
// IIntentContribution
// Owned by: control-plane-layer (intake.ts → analyzeIntent() → IntentAnalysis)
// Active:   Yes — currently implicit in taskType routing.
// REQUIRED: intent and runtime are the two non-optional slots in the contract.
// ---------------------------------------------------------------------------
export interface IIntentContribution {
  /**
   * Detected task type string. Matches TaskType union in index.ts.
   * Typed as string (not TaskType directly) to avoid a circular dependency
   * between this file and index.ts.
   * Valid values: 'carousel' | 'deck' | 'report' | 'campaign' | 'post' |
   *               'remix' | 'export' | 'chat' | 'unknown'
   */
  taskType: string

  /**
   * The concrete topic extracted from the user's prompt.
   * Example: "5 productivity mistakes senior engineers make"
   * Used as the carousel/deck title and as the primary subject constraint
   * in the LLM prompt.
   */
  topic: string

  /**
   * Intent detection confidence 0–1.
   * Below ~0.5 → ambiguity_level is 'high', and the router may request
   * clarification before generating rather than producing a wrong artifact type.
   */
  confidence: number

  /**
   * Ambiguity level from intent analysis.
   * 'none' → clean intent, proceed directly
   * 'low'  → proceed with the best guess, note in telemetry
   * 'high' → consider surfacing a clarification prompt to the user
   */
  ambiguityLevel: 'none' | 'low' | 'high'

  /**
   * The raw, verbatim user prompt. Preserved here so compilePrompt() can
   * include it unmodified — important for creative tasks where paraphrasing
   * the intent loses nuance.
   */
  userPrompt: string
}

// ---------------------------------------------------------------------------
// IArtifactContribution
// Owned by: artifact-engine-layer (ArtifactEngine registry → ICompiler)
// Active:   Yes — schema instructions currently inlined in compilePrompt()
//           AND duplicated in AIRuntimeAdapter (B7 dual-source gap).
//           When wired, this slot eliminates the duplication.
// ---------------------------------------------------------------------------
export interface IArtifactContribution {
  /**
   * Target schema version discriminator.
   * Must match BaseArtifact.$schema — currently 'artifact-json@2.0'.
   * The validator uses this to select the correct JSON schema for post-generation
   * validation (prevents schema drift between the prompt and the validator).
   */
  schema: string

  /**
   * Narrative roles the artifact MUST include.
   * For carousels: ['hook', 'cta'] are the minimum required roles.
   * The validator enforces this — missing required roles trigger repair.
   */
  requiredRoles: string[]

  /** Minimum number of slides or sections. Injected into the LLM schema prompt. */
  minSlides?: number

  /** Maximum number of slides or sections. Prevents unbounded generation. */
  maxSlides?: number

  /**
   * Canonical LLM schema instruction string.
   * SINGLE SOURCE OF TRUTH — eliminates both:
   *   1. The inline schema block in compilePrompt() (carousel.ts / deck.ts)
   *   2. AIRuntimeAdapter's prepended schema injection (B7 dual-source gap fix)
   *
   * For carousels this is CAROUSEL_SCHEMA_INSTRUCTION from artifact-v2.ts.
   * For decks and reports, equivalent instruction strings are maintained by
   * their respective compiler files in artifact-engine-layer.
   */
  schemaInstruction: string

  /**
   * Minimum richness score (0–100) for this artifact type to be considered
   * acceptable without triggering repair.
   * Below this threshold → governance repair cycle is triggered.
   * Typical values: carousel → 60, deck → 55, report → 65.
   */
  qualityThreshold?: number
}

// ---------------------------------------------------------------------------
// IRuntimeContribution
// Owned by: control-plane-layer (router.ts → RoutingHint + AdminSettingsService)
// Active:   Yes — currently implicit in routing and retry logic.
// REQUIRED: must always be present in ResolvedGenerationContract.
// ---------------------------------------------------------------------------
export interface IRuntimeContribution {
  /**
   * Maximum cost budget in USD for this single generation request.
   * Enforced by the cost tracker before provider invocation.
   * undefined → no per-request budget cap (workspace-level budget still applies).
   */
  maxCostUsd?: number

  /**
   * Maximum end-to-end latency budget in milliseconds.
   * If exceeded, the router prefers faster (potentially lower-quality) providers.
   * undefined → no latency constraint.
   */
  maxLatencyMs?: number

  /**
   * Effective quality score threshold — max of:
   *   - task-specific default (e.g. carousel = 60)
   *   - admin-configured floor from AdminSettings
   * The governance layer uses this as the repair trigger threshold.
   */
  qualityThreshold: number

  /**
   * Maximum number of generation attempts (initial + retries).
   * Counts against the workspace's retry budget. Typical value: 3.
   * On reaching this limit, the last output is returned with degraded_success
   * status regardless of quality score.
   */
  maxAttempts: number

  /**
   * Whether to automatically regenerate when the quality score falls below
   * qualityThreshold. When false, the raw output is returned with flags.
   */
  autoRegenerate: boolean

  /**
   * Current attempt number (1-based).
   * STRICT MODE ESCALATION: on attempt > 1, the prompt compiler adds an
   * explicit "previous attempt failed validation, ensure…" prefix to the
   * user prompt. This has been shown to reduce repair cycles by ~40%.
   */
  attempt: number

  /**
   * Generation mode: 'local' | 'cloud'.
   * Matches RuntimeMode from airuntime-types.ts.
   * Typed as string here to avoid a circular import; validated at runtime boundaries.
   * 'local' → only Ollama/LM Studio providers; explicit failure if none available.
   * 'cloud' → only cloud providers; explicit failure if none enabled/healthy.
   */
  runtimeMode: string

  /**
   * Attempt history from all previous governance evaluations for this request.
   * Undefined on the first attempt. Populated by ArtifactPipeline and forwarded
   * into every subsequent ContractAssembler.assemble() call so the Prompt Compiler
   * can produce progressively stronger prompts based on prior failures.
   *
   * The RuntimeContributor copies this from ContributorContext.attemptHistory.
   */
  attemptHistory?: import('./governance-feedback').IAttemptHistory

  /**
   * TOPIC-DRIFT-FIX-004: Repair context from governance failure.
   * When present, the Prompt Compiler appends this to the governance feedback
   * section of the system prompt so the LLM understands what to fix.
   * Never injected as the user message — userPrompt always carries the original topic.
   */
  repairContext?: string
}

// ---------------------------------------------------------------------------
// ISkillContribution
// Phase 2.6 — ISkill path, ACTIVE in production (human gate-lift 2026-06-21).
// Owned by: iskill-runtime (CarouselFounderLifecycle)
// Contributor: output-control-layer SkillContributor, registered in
//   ContractAssemblerFactory's 'default' set.
// Gate: globalThis.__brandos_iskill_contract_contributor === true
//   (set in apps/web/instrumentation.ts after bootstrapSkillRuntime() succeeds)
//
// IMPORTANT: Do not remove this interface. See ISkill JSDoc in index.ts for
// the activation history and current scope (carousel-founder only).
// ---------------------------------------------------------------------------
export interface ISkillContribution {
  /**
   * Ordered workflow stages for this skill execution.
   * Injected as narrative structure guidance into the LLM prompt.
   * Example: ['hook', 'problem', 'framework', 'evidence', 'CTA']
   */
  workflow: string[]

  /**
   * Identifier for the validation strategy to apply post-generation.
   * Maps to a registered IValidatorEngine configuration.
   * undefined → use the default task-type validator.
   */
  validationStrategy?: string

  /**
   * Human-readable success criteria for this skill execution.
   * Logged in SkillExecutionTelemetry for eval and debugging.
   * Example: ['all 5 slides populated', 'richness_score >= 70', 'cta is specific']
   */
  successCriteria?: string[]

  /** ISkill identifier — correlates with SkillMetadata.id */
  skillId: string
}

// ---------------------------------------------------------------------------
// ResolvedGenerationContract
//
// The fully assembled typed contract passed to compilePrompt().
// Built by IContractAssembler from all registered contributors.
//
// REQUIRED SLOTS: intent, runtime
// OPTIONAL SLOTS: identity, persona, artifact, skill
//
// An optional slot that returns null from its contributor uses a
// typed fallback value — the assembler never throws on partial availability.
// This ensures backward compatibility when new contributors are added.
// ---------------------------------------------------------------------------
export interface ResolvedGenerationContract {
  /**
   * Identity personalisation signals.
   * Optional — degrades gracefully when the identity layer is unavailable
   * or has insufficient signal (confidence < threshold).
   */
  identity?: IIdentityContribution

  /**
   * Persona / brand voice configuration.
   * Optional — when absent, the prompt compiler uses the platform default
   * tone ('professional') with no brand-specific augmentation.
   */
  persona?: IPersonaContribution

  /**
   * Intent and task context.
   * REQUIRED — generation cannot proceed without knowing what to create.
   */
  intent: IIntentContribution

  /**
   * Artifact schema and structural requirements.
   * Optional — when absent, the prompt compiler falls back to the default
   * schema instruction for the task type detected in intent.taskType.
   */
  artifact?: IArtifactContribution

  /**
   * Runtime execution constraints.
   * REQUIRED — routing and retry logic depend on these values.
   */
  runtime: IRuntimeContribution

  /**
   * ISkill workflow contribution.
   * Optional — Phase 2.6, ACTIVE. Present for taskType === 'carousel' on every
   * generation request now that the gate is lifted; null/absent for all other
   * task types (SkillContributor only branches on the registered
   * carousel-founder skill today).
   */
  skill?: ISkillContribution

  /**
   * Cognitive Platform Evolution Program, EM-4.1. Consolidated
   * knowledge/reasoning/positioning content (ADR-004). Optional — absent
   * when the workspace has no cognition history rich enough for
   * IntelligenceOS to have synthesized any of the three sections yet
   * (see IKnowledgeContribution's docblock); the prompt compiler must
   * degrade gracefully to no section, not a placeholder.
   */
  knowledge?: IKnowledgeContribution

  /**
   * PLATFORM SPLIT: styleProjection removed. Raw IStyleProjection (Class A+B
   * signals) never crosses the BrandOS boundary under the new architecture —
   * it is IntelligenceOS-internal state, never a cross-platform outcome. See
   * COGNITION_CONTRACT_SPEC.md §4, "raw or unconsolidated signals." The
   * `identity` slot above (IIdentityContribution, populated from
   * CognitionContext.identity) is now the ONLY identity-personalization
   * path into the Prompt Compiler — see compilePromptFromContract.ts.
   */
}

// ---------------------------------------------------------------------------
// IContractContributor<T>
//
// Every subsystem that contributes to a ResolvedGenerationContract implements
// this interface where T is the slice type it owns.
//
// CONTRACT: contribute() must NEVER throw. Return null on any failure.
// The assembler treats null as "contributor unavailable" and applies a
// typed fallback. Throwing breaks the entire generation pipeline.
// ---------------------------------------------------------------------------
export interface IContractContributor<T> {
  /**
   * Unique contributor identifier.
   * Used by IContractAssembler to log which contributors succeeded/failed.
   * Examples: 'identity', 'persona', 'intent', 'artifact', 'runtime', 'skill'
   */
  readonly contributorId: string

  /**
   * Produce the contributor's typed slice from the request context.
   * MUST never throw — exceptions must be caught internally and null returned.
   * Returning null signals graceful degradation; the assembler applies the
   * appropriate typed fallback for this slot.
   */
  contribute(context: ContributorContext): Promise<T | null>
}

/**
 * Context passed to every contributor during contract assembly.
 * Carries everything a contributor may need to produce its slice.
 *
 * IMPORTANT: Only the fields needed by a specific contributor should be
 * accessed. Contributors must not mutate this object.
 */
export interface ContributorContext {
  /**
   * The user making the request — used for identity and persona lookup.
   *
   * P0 — Implementation Wave 1A: this is the real authenticated user id
   * (public.users.id), distinct from `workspaceId` below. Prior to P0 these
   * were the same string by construction (workspaceId was a synonym for
   * userId); they are now independent fields. Optional because not every
   * caller has a user id available (e.g. system/background generation) —
   * contributors that read this for telemetry attribution
   * (e.g. callWithMode's userId option) should treat `undefined` as "omit",
   * not fall back to workspaceId.
   */
  userId?: string

  /**
   * FK → workspaces.id — the workspace this generation is scoped to.
   *
   * P0 — Implementation Wave 1A: NEW typed field. Brand-cognition lookups
   * (IdentityContributor → BrandIntelligenceRuntime.resolveIdentityContribution)
   * are keyed on this value. Previously IdentityContributor read
   * `(context as any).workspaceId` (untyped, always undefined in practice,
   * falling back to `bi.semanticIdentity.workspaceId ?? 'default'`). This
   * field makes that lookup a normal typed read with no `as any` cast and
   * no `'default'` fallback needed.
   */
  workspaceId: string

  /** Trace ID for this request — used for telemetry correlation */
  requestId: string

  /** The raw user prompt exactly as received — do not sanitise here */
  userPrompt: string

  /**
   * Detected task type string (matches TaskType union in index.ts).
   * Available at ContributorContext level so contributors don't re-analyse.
   */
  taskType: string

  /**
   * Active runtime mode: 'local' | 'cloud'.
   * Needed by IRuntimeContributor to build the IRuntimeContribution slice.
   */
  runtimeMode: string

  /**
   * Current attempt number (1-based).
   * On attempt > 1 the prompt compiler adds a repair prefix.
   * Contributors may adjust their slice based on this (e.g. increase qualityThreshold).
   */
  attempt: number

  /**
   * Supabase client for contributors that need DB access.
   * Typed as unknown to avoid importing the Supabase client type here
   * (would introduce a runtime dependency). Contributors cast to their
   * specific client type in their own layer.
   */
  supabase?: unknown

  /**
   * Persona record fetched by the route handler before assembling the contract.
   * Forwarded here so the PersonaContributor doesn't re-query.
   * Typed as unknown — PersonaContributor casts to its known shape.
   */
  persona?: unknown

  /**
   * Override mode from the request (e.g. 'strict', 'fast', 'premium').
   * Used by the RuntimeContributor to select quality thresholds and timeouts.
   */
  overrideMode?: string

  /**
   * Pre-resolved semantic identity — forwarded by the orchestrator after
   * identity resolution (step 3.5 in the generation pipeline).
   * Consumed by IdentityContributor to populate the identity slot WITHOUT
   * re-querying the identity runtime (avoids a redundant latency hit).
   * undefined when identity-layer is unavailable or resolution failed.
   */
  resolvedSemanticIdentity?: import('./identity-types').ISemanticIdentity

  /**
   * Pre-resolved visual identity — forwarded alongside resolvedSemanticIdentity.
   * Only populated for visual artifact types (carousel, deck) when visual
   * identity resolution succeeded.
   * undefined for text-only artifacts (report, post) even when visual
   * identity exists — keeps the contract scope minimal.
   */
  resolvedVisualIdentity?: import('./identity-types').IVisualIdentity

  /**
   * Attempt history from all previous governance evaluations for this request.
   * Undefined on the first attempt (no history yet).
   * Populated by ArtifactPipeline after each governance pass and forwarded
   * into the next ContractAssembler.assemble() call.
   *
   * Consumed by:
   *   - RuntimeContributor  → sets attempt, qualityThreshold escalation
   *   - compilePromptFromContract() → evolves the prompt based on prior failures
   */
  attemptHistory?: import('./governance-feedback').IAttemptHistory

  /**
   * TOPIC-DRIFT-FIX-004: Repair context from governance failure.
   * Populated only on repair calls — contains the governance violation description.
   * Forwarded to RuntimeContributor → IRuntimeContribution → Prompt Compiler so
   * it can be appended to the governance feedback section of the system prompt.
   * This keeps userPrompt as the original user topic on ALL calls including repairs.
   */
  repairContext?: string

  /**
   * Whether Brand Memory (persona, identity, audience, tone, keywords, brand profile)
   * should be injected into the generation contract.
   *
   * When false:
   *   - PersonaContributor returns null  → no persona/brand-voice injection
   *   - IdentityContributor returns null → no identity/semantic injection
   *   - Prompt Compiler emits: persona:NO identity:NO
   *   - CPLOrchestrator logs: brandMemoryApplied=false
   *
   * Defaults to true when undefined (backward-compatible for existing users).
   * New users receive false as default per product spec.
   */
  applyBrandMemory?: boolean

  /**
   * PLATFORM SPLIT: the resolved CognitionContext for this request, forwarded
   * by CPLOrchestrator after calling @brandos/cognition-client (Step 1 in the
   * orchestrator pipeline). This REPLACES the former `brandIntelligence` data
   * field and `brandIntelligenceRuntime` callback field.
   *
   * Contains voice, identity, and visualIdentity — already-resolved outcomes.
   * There is no runtime/callback counterpart anymore: IntelligenceOS resolves
   * a CognitionContext once, synchronously, before contract assembly begins.
   * Contributors read fields directly off this object; they never call back
   * into IntelligenceOS during contribute() (COGNITION_CONTRACT_SPEC.md §2).
   *
   * IdentityContributor reads: cognitionContext.identity
   * PersonaContributor reads:  cognitionContext.voice (legacy fallback only)
   *
   * Ownership: IntelligenceOS resolved this — OCL/CPL must not modify it.
   */
  cognitionContext?: import('@platform/cognition-contract').CognitionContext
}

// ---------------------------------------------------------------------------
// IContractAssembler
//
// Wires all registered IContractContributor<T> instances and produces a
// ResolvedGenerationContract by invoking them in parallel.
//
// IMPLEMENTATION NOTE: ContractAssembler class and getContractAssembler()
// factory live in @brandos/output-control-layer. Only the interface is here.
// ---------------------------------------------------------------------------
export interface IContractAssembler {
  /**
   * Register a contributor for a given contract slot.
   * If a contributor is already registered for the slot, it is replaced.
   * Order of registration does not affect assembly — all contributors are
   * invoked in parallel (Promise.allSettled semantics).
   */
  register<T>(
    slot: keyof ResolvedGenerationContract,
    contributor: IContractContributor<T>
  ): void

  /**
   * Assemble the full contract by invoking all registered contributors.
   * Contributors that return null receive a typed fallback value.
   * This method MUST NOT throw — all errors are caught and produce fallbacks.
   *
   * Post-conditions:
   *   - result.intent is always populated (required slot; throws only if absent)
   *   - result.runtime is always populated (required slot)
   *   - Optional slots may be undefined if no contributor is registered
   */
  assemble(context: ContributorContext): Promise<ResolvedGenerationContract>
}

// NOTE: IdentityContributor class was moved to @brandos/output-control-layer.
// Import from '@brandos/output-control-layer' — not from here.


