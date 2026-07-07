// ============================================================
// @brandos/contracts — artifact-v2.ts
//
// BrandOS Canonical Semantic Artifact Schema (ArtifactV2)
//
// ARCHITECTURE RULES:
//   1. This IS the canonical post-OCL-compilation representation.
//   2. OCL compiles INTO this. Renderer reads FROM this. ISkill governs THIS.
//   3. No runtime dependencies — types only.
//   4. All artifact types extend BaseArtifact.
//   5. No parallel schemas. No v3. Evolution happens here.
// ============================================================

// ─────────────────────────────────────────────────────────────
// SHARED PRIMITIVES
// ─────────────────────────────────────────────────────────────

export interface SemanticTheme {
  /** e.g. "challenger", "authority", "empathetic", "visionary" */
  voice_archetype?: string | undefined;
  /** Primary emotional register the artifact should evoke */
  emotional_register?: 'urgency' | 'inspiration' | 'curiosity' | 'credibility' | 'empathy';
  /** Visual tone preset — maps to renderer theme tokens */
  visual_preset?: 'executive-dark' | 'modern-light' | 'vibrant' | 'minimal' | 'corporate' | 'social';
  primaryColor?: string | undefined;  // 6-char hex, no #
  accentColor?: string | undefined;
  bgColor?: string | undefined;
  fontTitle?: string | undefined;
  fontBody?: string | undefined;
}

export interface AudienceProfile {
  /** Human-readable label: "Series A Founders", "Enterprise CTOs"
   *  Optional — Brand Intelligence owns defaulting. OCL must not invent a value. */
  label?: string;
  /** Sophistication level — affects vocabulary and assumed knowledge */
  sophistication: 'general' | 'practitioner' | 'expert' | 'executive';
  /** Key pain points this artifact addresses */
  pain_points?: string[];
  /** What transformation they should feel after consuming it */
  desired_transformation?: string | undefined;
}

export interface NarrativeArc {
  /** The logical flow structure */
  structure: 'problem-solution' | 'framework' | 'story' | 'data-driven' | 'contrarian' | 'how-to';
  /** One-sentence hook statement */
  hook_statement: string;
  /** Core thesis or central claim */
  thesis: string;
  /** The payoff or resolution */
  resolution: string;
  /** Pacing signal for renderer: how dense each section should feel */
  pacing: 'tight' | 'balanced' | 'expansive';
}

export interface RichnessMetrics {
  /** 0–100: composite semantic density score */
  overall_score: number;
  /** 0–100: word content density per unit */
  density_score: number;
  /** 0–100: evidence and supporting data quality */
  evidence_score: number;
  /** 0–100: persuasion arc completeness */
  persuasion_score: number;
  /** 0–100: CTA specificity and actionability */
  cta_quality_score: number;
  /** 0–100: narrative coherence across units */
  narrative_coherence_score: number;
  /** 0–100: hook strength and attention pull */
  hook_strength_score: number;
  /** 0–100: audience alignment */
  audience_alignment_score: number;
  /** Total word count across all content units */
  total_content_words: number;
  /** Average words per slide/section */
  avg_words_per_unit: number;
}

export interface GenerationTrace {
  /** ISO timestamp of artifact creation */
  generated_at: string;
  /** OCL compilation strategy used */
  ocl_strategy: string;
  /** ISkill governance outcome */
  governance_outcome: 'passed' | 'passed_after_repair' | 'bypassed';
  /** Number of repair attempts made */
  repair_attempts: number;
  /** Provider used for generation */
  provider?: string | undefined;
  /** Generation mode: local | cloud */
  generation_mode?: string | undefined;
  /** OCL input type that was parsed */
  input_type: 'markdown' | 'json' | 'text' | 'unknown';
  /** ISkill violations that were resolved during repair */
  resolved_violations?: string[];
}

export interface ExportMetadata {
  /** Available export formats for this artifact type */
  available_formats: ExportFormat[];
  /** Recommended format for this artifact */
  recommended_format?: ExportFormat;
  /** Estimated export file size in bytes, by format */
  estimated_sizes?: Partial<Record<ExportFormat, number>>;
  /** Whether this artifact has been exported before */
  previously_exported?: boolean;
}

export type ExportFormat = 'pptx' | 'html' | 'canva' | 'figma' | 'json' | 'pdf' | 'png';

// ─────────────────────────────────────────────────────────────
// BASE ARTIFACT — every artifact type extends this
// ─────────────────────────────────────────────────────────────

export interface BaseArtifact {
  /** Schema version discriminator */
  $schema: 'artifact-json@2.0';
  /** Unique artifact ID (UUID) */
  id: string;
  /** Discriminator for the artifact type */
  artifact_type: ArtifactType;
  /** Human-readable title */
  title: string;
  /** One-paragraph summary of the artifact's purpose and content */
  summary: string;
  /** Opening hook — the first thing that grabs attention */
  hook: string;
  /** Primary call to action */
  cta: string;
  /** Semantic theme and visual identity */
  semantic_theme: SemanticTheme;
  /** Target audience profile */
  audience: AudienceProfile;
  /** Narrative arc and structure */
  narrative_arc: NarrativeArc;
  /** Richness and quality metrics computed by OCL/ISkill */
  richness_metrics: RichnessMetrics;
  /** Provenance trace from generation through compilation */
  generation_trace: GenerationTrace;
  /** Export configuration and availability */
  export_metadata: ExportMetadata;
  /** ISO timestamp */
  created_at: string;
  /** Optional arbitrary metadata for downstream consumers */
  metadata?: Record<string, unknown>;
}

export type ArtifactType =
  | 'carousel'
  | 'deck'
  | 'report'
  | 'landing_page'
  | 'social_post'
  | 'newsletter'
  | 'thread';

// ─────────────────────────────────────────────────────────────
// CAROUSEL ARTIFACT
// ─────────────────────────────────────────────────────────────

export const CAROUSEL_ROLES = [
  'hook',
  'problem',
  'reframe',
  'framework',
  'evidence',
  'insight',
  'cta',
] as const;

export type CarouselRole = typeof CAROUSEL_ROLES[number];

// ─── Schema Prompt Constraints ────────────────────────────────────────────────
//
// Structural constraint values embedded in schema instruction prompt strings.
//
// Dependency direction: contracts is a base layer and cannot import from
// governance-config. governance-config imports these constants and asserts they
// match CAROUSEL/DECK/REPORT_STRUCTURAL_CONSTRAINTS, creating a compile-time
// consistency check that prevents drift.
//
// CAROUSEL/DECK/REPORT_SCHEMA_CONSTRAINTS: numeric bounds embedded in prompt
// instructions. Kept minimal (count bounds only) — full structural constraints
// including requiredRoles, char limits, and blocklists live in
// CAROUSEL/DECK/REPORT_STRUCTURAL_CONSTRAINTS below.
//
// governance-config imports SCHEMA_CONSTRAINTS and asserts equality with its
// own STRUCTURAL_CONSTRAINTS, preventing drift between the two shapes.

export const CAROUSEL_SCHEMA_CONSTRAINTS = { minSlides: 6, maxSlides: 10 } as const;
export const DECK_SCHEMA_CONSTRAINTS     = { minSlides: 7, maxSlides: 14 } as const;
export const REPORT_SCHEMA_CONSTRAINTS   = { minSections: 4, maxSections: 10 } as const;

// ─── Structural Constraints (full shape) ─────────────────────────────────────
//
// CANONICAL STRUCTURAL CONSTRAINT INTERFACES for OCL consumers (contributors,
// compilers). These parallel CAROUSEL/DECK/REPORT_SCHEMA_CONSTRAINTS but carry
// the full set of structural fields that compiler and contributor logic needs.
//
// governance-config defines concrete constant objects satisfying these interfaces
// and re-exports them as CAROUSEL/DECK/REPORT_STRUCTURAL_CONSTRAINTS.
// OCL must import from @brandos/contracts (here) — not from @brandos/governance-config
// directly — to preserve the contracts-first dependency direction:
//
//   governance-config → contracts → output-control-layer  ✓
//   governance-config ←→ output-control-layer             ✗
//
// Concrete values are intentionally repeated here (matching governance-config)
// so that @brandos/contracts has no runtime dependency on @brandos/governance-config.
// governance-config's compile-time assertions (AssertEqual) catch any drift.

export interface CarouselStructuralConstraints {
  minSlides:              number
  maxSlides:              number
  requiredRoles:          readonly string[]
  minTitleChars:          number
  minHookChars:           number
  minHookWords:           number
  minCtaChars:            number
  minCtaWords:            number
  minSlideHeadlineChars:  number
  genericCtaPhrases:      readonly string[]
}

export const CAROUSEL_STRUCTURAL_CONSTRAINTS: CarouselStructuralConstraints = {
  minSlides:              6,
  maxSlides:              10,
  requiredRoles:          ['hook', 'cta'] as const,
  minTitleChars:          3,
  minHookChars:           5,
  minHookWords:           4,
  minCtaChars:            3,
  minCtaWords:            3,
  minSlideHeadlineChars:  10,
  genericCtaPhrases:      ['learn more', 'follow me', 'follow us', 'click here', 'get started', 'cta'] as const,
}

export interface DeckStructuralConstraints {
  minSlides:              number
  maxSlides:              number
  requiredRoles:          readonly string[]
  minTitleChars:          number
  minSlideHeadlineChars:  number
}

export const DECK_STRUCTURAL_CONSTRAINTS: DeckStructuralConstraints = {
  minSlides:              7,
  maxSlides:              14,
  requiredRoles:          ['cover', 'closing'] as const,
  minTitleChars:          3,
  minSlideHeadlineChars:  5,
}

export interface ReportStructuralConstraints {
  minSections:            number
  maxSections:            number
  requiredSectionIds:     readonly string[]
  minTitleChars:          number
  minSectionHeadingChars: number
}

export const REPORT_STRUCTURAL_CONSTRAINTS: ReportStructuralConstraints = {
  minSections:            4,
  maxSections:            10,
  requiredSectionIds:     ['executive-summary'] as const,
  minTitleChars:          3,
  minSectionHeadingChars: 5,
}

// ─── Canonical schema instruction — single source of truth ───────────────────
//
// [RepairSchema] schemaSource=packages/contracts/src/artifact-v2.ts schemaVersion=artifact-json@2.0
//
// Both generation (prompt-compiler.ts → IArtifactContribution.schemaInstruction)
// and repair (governance/carousel.ts → buildCarouselRepairPrompt) must import
// this constant so the LLM receives the same schema definition in both paths.
//
// DO NOT duplicate this string. Import it; do not redefine it.
//
// SCHEMA CONTRACT NOTE:
//   This instruction defines every field that CarouselGovernanceAdapter.validate()
//   and validateCarouselArtifact() enforce. If a field is validated, it MUST appear
//   here so the LLM produces it in both generation and repair paths.
//
//   Fields validated at artifact root (BaseArtifact):
//     - title   (validator line ~99: length >= 3)
//     - hook    (validator line ~105: length >= 5, words >= 4, not placeholder)
//     - cta     (validator line ~136: length >= 3, words >= 3, not generic)
//
//   Fields validated at slide level (RichCarouselSlide):
//     - role, headline, body (schema repair section in carousel.ts)
//     - semantic_density_score (computed by OCL — not in prompt, but body content drives it)
//
//   The OCL compiler (carousel-compiler.ts) extracts hook from meta.hook and
//   cta from meta.cta. If those keys are absent from the LLM response, it falls
//   back to slides[0].headline / cta-role slide headline — which are often
//   too short or trivial, causing "missing or too-short hook" on re-validation.
//
export const CAROUSEL_SCHEMA_INSTRUCTION = `STRUCTURAL REQUIREMENTS (MANDATORY — do not deviate, these are checked by governance):
- Minimum ${CAROUSEL_SCHEMA_CONSTRAINTS.minSlides} slides, maximum ${CAROUSEL_SCHEMA_CONSTRAINTS.maxSlides} slides
- First slide role MUST be "hook"
- Last slide role MUST be "cta"
- Every slide MUST have headline and body
- body must be at least 40 words on value slides (problem, insight, framework, evidence, reframe)
- hook slide body: minimum 20 words
- cta slide body: minimum 15 words
- Include subheadline on at least 3 slides
- Include key_takeaway on at least 3 slides
- Include supporting_evidence on the evidence slide (required) and at least one other slide
- layout_hint MUST be present on every slide — use "bullets-primary" for value slides, "data-callout" for framework/evidence, "centered" for hook/cta, "split" for before/after slides
- Do NOT include $schema, $metadata, or any wrapper object
- Return ONLY the JSON object, nothing else

─────────────────────────────────────────────────────
CONTENT QUALITY STANDARD
─────────────────────────────────────────────────────
You are producing a premium LinkedIn carousel. Your output will be read by decision-makers, founders, and senior operators who can immediately tell the difference between generic content and genuine thought leadership. Every slide must earn its place.

QUALITY STANDARD: Write at the level of the best content on LinkedIn — the posts that get 50,000 impressions because they say something true and specific that the reader has never seen said that clearly before. Not motivational filler. Not corporate buzzwords. Real insight, real evidence, real persuasion.

ANTI-GENERIC MANDATE: The following patterns are automatic failures. Do not produce them:
- Vague claims without evidence: "Many companies struggle with X" → WRONG. Write: "73% of Series B companies we surveyed struggled with X in Q3"
- Symmetrical bullet lists that say nothing: "Be proactive. Stay focused. Keep learning." → WRONG
- AI clichés: "leverage", "synergies", "game-changer", "paradigm shift", "unlock potential", "in today's fast-paced world", "it's more important than ever" → BANNED
- Rhetorical questions as hooks: "Have you ever wondered why X?" → WRONG
- Generic CTAs: "Follow for more", "Like and share", "Learn more", "Get started", "Check out our website" → WRONG

SPECIFICITY REQUIREMENT: Every factual claim must be specific. Use named companies, named people, specific percentages, specific timeframes, specific dollar amounts. "Recently" → use a quarter or year. "Many" → use a percentage. "Significantly" → use a number. If you don't have a specific figure, construct a plausible concrete scenario with a named example rather than a vague generality.

NARRATIVE ARC: A carousel is not a list of slides — it is an argument. Build tension from slide 1, escalate it through slides 2–4, resolve it with insight or framework in slides 5–6, prove it with evidence, and close with a call to action that gives the reader a clear next move. The reader should feel pulled through the slides, not cataloguing them.

AUDIENCE INTELLIGENCE: These readers are sophisticated. They have heard every standard take. They will stop reading the moment they recognize a pattern they've seen before. Your job is to show them something they haven't seen framed this way before — a contrarian angle, a non-obvious connection, a principle that explains multiple phenomena at once.

─────────────────────────────────────────────────────
ROLE-BY-ROLE GUIDANCE
─────────────────────────────────────────────────────

HOOK slide — The only job of this slide is to make the reader swipe to slide 2.
Use one of these five proven hook structures:
  TYPE 1 — CONTRARIAN STAT: "91% of B2B founders get their pricing wrong in the same direction."
  TYPE 2 — COUNTERINTUITIVE CLAIM: "The best operators I've worked with all have the same weakness."
  TYPE 3 — RESULTS-FIRST: "We went from 12% to 41% conversion in 6 weeks. Here's every change we made."
  TYPE 4 — UNCOMFORTABLE TRUTH: "Your pipeline problem is not a pipeline problem."
  TYPE 5 — PATTERN BREAK: "Every founder who burned out in 2023 made the same decision 18 months earlier."
The hook field at the artifact root must be 8–15 words — the most scroll-stopping sentence in the piece.

PROBLEM slide — Make the reader feel the pain. Use concrete consequences, not abstract descriptions. Name who specifically suffers from this problem and what it costs them in time, money, or reputation. One sharp headline + 2–3 sentences that escalate the stakes.

INSIGHT slide — Deliver the paradigm shift. The insight should make the reader feel like they've been given a key they didn't have before. It must be specific to this topic, not a general principle that applies to everything. Pair the insight with a subheadline that states the mechanism: why this is true, not just that it's true.

FRAMEWORK slide — Give structure to the insight. A 2-step model, 3-part framework, or 4-quadrant structure is ideal. Name the framework. Label each component with a specific, non-generic descriptor. The framework should feel like intellectual property — something the reader wants to save and use. Use the layout_hint "data-callout" for framework slides.

EVIDENCE slide — This is the credibility slide. Use one of: (a) a specific named company's result, (b) original or cited research data, (c) a named person's experience with outcome details, (d) a before/after case with specific numbers. Evidence without specifics is not evidence. Use the supporting_evidence array to hold the raw proof points, then synthesize them in the body.

REFRAME slide — Challenge the conventional take directly. Name the conventional wisdom first: "Most people believe X." Then dismantle it: "But that's wrong because Y." Then reframe: "The real issue is Z." This structure is highly shareable because it validates the reader's existing frustration while giving them a new explanation.

CTA slide — The CTA must do one of three things: (a) invite a specific action with an asset offer ("DM me FRAMEWORK and I'll send you the full decision matrix"), (b) prompt a reflection that generates comments ("What's the most expensive mistake your team made with X? Comment below"), or (c) point to a specific next step with a stated benefit ("Save this post — run the audit on your team this Friday in 20 minutes"). Never a generic close.

─────────────────────────────────────────────────────
NEGATIVE EXAMPLES — what failure looks like
─────────────────────────────────────────────────────

WEAK HOOK (do not write like this):
{ "headline": "The Importance of Company Culture", "body": "Culture is one of the most important aspects of any organization. Companies that prioritize culture tend to perform better." }
WHY IT FAILS: No tension, no specificity, no originality, nothing the reader hasn't heard 1,000 times.

WEAK INSIGHT SLIDE (do not write like this):
{ "headline": "Communication Is Key", "body": "Great teams communicate effectively. Make sure to have regular check-ins and foster an environment of open feedback." }
WHY IT FAILS: A platitude dressed as insight. No mechanism. No evidence. No new information.

STRONG INSIGHT SLIDE (write like this):
{ "headline": "The bottleneck is never where you think it is", "subheadline": "It's always one step upstream of where the symptom appears", "body": "Every team that told us 'we have a closing problem' actually had a qualification problem. Every team that had a 'communication problem' had a missing decision-rights problem. Fixing the symptom costs 6 months. Fixing the upstream cause costs 6 hours.", "insight": "Symptoms and causes are always separated by exactly one step in the process chain", "supporting_evidence": ["Reviewed 47 post-mortems: 41 misidentified the root cause layer", "Average cost of fixing the symptom before finding the root cause: 4.2 months"] }

─────────────────────────────────────────────────────
JSON SCHEMA — return this exact structure, no markdown, no explanation
─────────────────────────────────────────────────────

{
  "title": "string (5–10 words, declarative not generic — e.g. 'Why Most Pricing Strategies Backfire at Scale')",
  "hook": "string (8–15 words — the most provocative, specific, scroll-stopping sentence in the piece. NOT a question. NOT the title repeated. Must use one of the 5 hook structures above.)",
  "cta": "string (8–18 words — a concrete, specific next step using the asset-offer, reflection-prompt, or next-step patterns above. NOT 'follow for more' or 'like and share'.)",
  "slides": [
    {
      "role": "hook | problem | reframe | framework | evidence | insight | cta",
      "headline": "string (max 12 words — active voice, specific, tension-bearing)",
      "subheadline": "string (optional but strongly recommended — amplifies or contrasts the headline in 8–15 words)",
      "body": "string (3–5 sentences minimum, 50–100 words — substantive content, no filler. Include named examples, specific numbers, or concrete mechanisms.)",
      "bullets": ["string (each bullet minimum 10 words — actionable, evidence-based, or principle-stating. No one-word bullets. No platitudes.)"],
      "insight": "string (optional — the single paradigm-shift idea this slide delivers, stated as a complete sentence)",
      "supporting_evidence": ["string (optional — specific data points, named case studies, or cited research. Each entry must name a source, company, or specific number.)"],
      "key_takeaway": "string (optional but strongly recommended — the one sentence the reader should remember from this slide, distinct from the headline)",
      "layout_hint": "centered | headline-only | bullets-primary | split | data-callout | full-bleed",
      "emphasis_keywords": ["string (2–4 words from the headline or body that deserve visual emphasis in rendering)"],
      "visual_direction": "string (optional — specific creative direction for the slide's visual treatment)"
    }
  ]
}

(See STRUCTURAL REQUIREMENTS at the top of this prompt — repeated there for emphasis.
Return ONLY the JSON object, nothing else.)`;

// ─── Deck schema instruction ──────────────────────────────────────────────────
//
// Canonical schema instruction for deck generation. Mirrors the carousel pattern:
// imported by ArtifactContributor for IArtifactContribution.schemaInstruction,
// and by ARTIFACT_TASK_PROMPTS in prompt-compiler for the generate_deck path.
// DO NOT duplicate — import from here.
//
export const DECK_SCHEMA_INSTRUCTION = `You are producing a boardroom-quality presentation deck. Your audience consists of senior executives, investors, or domain experts who make decisions based on what they read. Every slide must advance an argument — not just present information.

QUALITY STANDARD: Think McKinsey or Sequoia deck quality. Each slide carries a single, defensible claim. The claim is in the title. The body proves the claim. No slide is a container for miscellaneous bullets.

SLIDE TITLE RULE: Every slide title must be a declarative sentence or pointed question — not a topic label.
  WRONG: "Market Overview"
  RIGHT: "The TAM is larger than competitors model — and growing in the wrong direction for incumbents"
  WRONG: "Our Team"
  RIGHT: "The founding team has operated at exactly this scale before"

ANTI-GENERIC MANDATE: Banned patterns:
- Topic-label titles (see above)
- Symmetric bullet lists with no hierarchy or evidence
- Vague claims: "significant growth", "strong demand", "proven technology"
- Buzzwords: "disruptive", "revolutionary", "cutting-edge", "best-in-class"
- Body text that repeats the title

SPECIFICITY REQUIREMENT: Every claim needs a proof point. Use: named companies, specific metrics, timeframes, named individuals, cited studies, dollar figures, percentages. If the spec doesn't provide data, construct a credible concrete framing rather than using vague abstractions.

EXECUTIVE REGISTER: Readers scan first, read later. The title carries 80% of the information load. The first sentence of the body expands the title claim. Subsequent bullets provide evidence and mechanism. Speaker notes provide the spoken narrative.

─────────────────────────────────────────────────────
SLIDE TYPE GUIDANCE
─────────────────────────────────────────────────────

COVER: Title is the deck's thesis in 10–14 words. Subtitle is the one-sentence context. No bullets. Visual direction sets the tone.

AGENDA: List 3–5 section titles. Each section title is a complete phrase that signals what argument the section makes, not just a label.

CONTENT: The workhorse slide. Title = declarative claim. Body = 2–3 sentence proof. Bullets = 3–5 specific evidence points or mechanisms, each at least 12 words. Include at least one stat or named reference per content slide.

STATS: Lead with the number in the title. Use the stats array for the data points (value + label + delta). Body provides context: what this number means for the audience's decision. Use layout_hint "stats-grid".

QUOTE: Named person, full title, company. Body provides the context that makes this quote meaningful now. Only use quotes that are specific and unexpected — not "Innovation is important."

DIVIDER: Section title as a complete phrase. Subtitle previews the argument of the coming section.

CLOSING: The "so what" slide. Restates the thesis, states the specific ask or next step, names the timeline. No vague closes.

─────────────────────────────────────────────────────
JSON SCHEMA — return this exact structure, no markdown, no explanation
─────────────────────────────────────────────────────

{
  "title": "string (the deck's full thesis title, 10–16 words)",
  "slides": [
    {
      "slide": "number (1-based index)",
      "type": "cover | agenda | content | divider | stats | quote | closing",
      "title": "string (declarative sentence or pointed question, max 16 words — NOT a topic label)",
      "subtitle": "string (optional — supporting claim or section preview, 8–14 words)",
      "body": "string (optional — 2–4 sentences for content/stats/closing types. 60–120 words. First sentence must expand or qualify the title claim.)",
      "bullets": ["string (optional — each minimum 12 words, one named reference or specific claim per bullet. Use for content slides only.)"],
      "stats": [{"value": "string (the number/metric)", "label": "string (what it measures)", "delta": "string (optional — YoY or benchmark context)"}],
      "speaker_notes": "string (optional but recommended — the full spoken brief for this slide. 3–5 sentences. Include context, transitions, and emphasis points that do not fit on the slide.)",
      "visual_direction": "string (optional — specific creative direction: chart type, image mood, layout suggestion)",
      "layout_hint": "centered | title-top | two-column | image-left | image-right | stats-grid | big-text"
    }
  ]
}

STRUCTURAL REQUIREMENTS:
- Minimum ${DECK_SCHEMA_CONSTRAINTS.minSlides} slides, maximum ${DECK_SCHEMA_CONSTRAINTS.maxSlides} slides
- First slide type MUST be "cover"
- Last slide type MUST be "closing"
- Every slide MUST have title
- Content slides MUST have body (minimum 60 words) or bullets (minimum 3 bullets of 12+ words each)
- Stats slides MUST use the stats array — minimum 3 data points
- Include speaker_notes on at least 4 slides
- layout_hint MUST be present on every slide
- Do NOT include $schema, $metadata, or any wrapper object
- Return ONLY the JSON object, nothing else`;

// ─── Report schema instruction ────────────────────────────────────────────────
//
// Canonical schema instruction for report generation. Same pattern as carousel
// and deck: single source of truth, imported by ArtifactContributor and
// ARTIFACT_TASK_PROMPTS. DO NOT duplicate — import from here.
//
export const REPORT_SCHEMA_INSTRUCTION = `You are producing a C-suite ready analytical report. Your readers are senior decision-makers who will act on what you write. Every section must deliver analysis, not description.

QUALITY STANDARD: Think Andreessen Horowitz memo, Sequoia market report, or BCG white paper quality. Each section has a declarative heading that states the finding, not the topic. The body proves the finding. Key findings are executive-ready takeaways, not restatements of obvious facts.

SECTION HEADING RULE: Every heading must be a declarative finding, not a topic label.
  WRONG: "Market Analysis"
  RIGHT: "The market is structurally underserved at the mid-market tier — incumbents compete on features, not outcomes"
  WRONG: "Challenges"
  RIGHT: "Three structural barriers prevent incumbents from responding quickly enough to matter"

ANTI-GENERIC MANDATE: Banned patterns:
- Topic-label headings
- Body paragraphs that describe without analyzing ("X is important because it affects Y")
- Vague data: "growing rapidly", "significant share", "notable increase"
- Recommendations without specificity: "companies should invest more in X"
- Executive summaries that bury the lead

SPECIFICITY AND EVIDENCE STANDARD: Every analytical claim must be supported by:
  (a) A specific data point with source or timeframe, OR
  (b) A named company or named individual as a case reference, OR
  (c) A logical mechanism that explains why the claim must be true
If you lack a specific figure, state an informed estimate with its basis rather than using vague language.

ANALYSIS OVER DESCRIPTION: The reader already knows what happened. They need to know what it means and what to do about it. Every section should answer: "So what?" and "Now what?"

─────────────────────────────────────────────────────
SECTION TYPE GUIDANCE
─────────────────────────────────────────────────────

EXECUTIVE SUMMARY (first section): Lead with the single most important finding. Follow with 3–4 key findings as complete declarative sentences. Body is 80–120 words maximum. This section is read standalone — it must be self-contained.

ANALYSIS SECTIONS (body of the report): Each section proves a single thesis. Heading = finding. Subheading = the mechanism or implication. Body = 100–150 words of analysis with embedded evidence. Key findings = 3–4 executive-ready bullet points, each stating a complete, actionable insight. Data points = specific metrics, each with label, value, and source.

CLOSING / IMPLICATIONS section: Do not summarize what was already written. State what the evidence demands the reader do differently. Be specific: name who does what by when. Include 3–5 data_points that serve as supporting evidence for the recommendations.

─────────────────────────────────────────────────────
JSON SCHEMA — return this exact structure, no markdown, no explanation
─────────────────────────────────────────────────────

{
  "title": "string (the report's declarative thesis title, 10–18 words — must signal the core finding, not just the topic)",
  "executive_summary": "string (2–3 sentence overview. Lead with the most important finding. State the stakes. End with the core recommendation.)",
  "sections": [
    {
      "id": "string (kebab-case identifier, e.g. 'market-structure', 'competitive-dynamics')",
      "heading": "string (declarative finding as a complete sentence, max 18 words — NOT a topic label)",
      "subheading": "string (optional — the mechanism or implication behind the heading, 10–16 words)",
      "body": "string (REQUIRED — 100–180 words of analytical prose. First sentence states the finding. Subsequent sentences prove it with evidence and mechanism. Final sentence states the implication for the reader.)",
      "key_findings": ["string (REQUIRED — 3–5 findings per section. Each must be a complete sentence stating a specific, actionable insight. Minimum 15 words each. NOT a restatement of the body — a distillation of its most important implication.)"],
      "data_points": [{"label": "string (what this measures)", "value": "string (specific number, percentage, or metric)", "source": "string (named source, company, study, or timeframe — required for all data_points)"}]
    }
  ]
}

STRUCTURAL REQUIREMENTS:
- Minimum ${REPORT_SCHEMA_CONSTRAINTS.minSections} sections, maximum ${REPORT_SCHEMA_CONSTRAINTS.maxSections} sections
- First section MUST be the executive summary (id: "executive-summary")
- Last section MUST be implications or recommendations
- Every section MUST have body (minimum 100 words)
- Every section MUST have key_findings (minimum 3 entries)
- Include data_points in at least 3 sections — minimum 2 data_points per section that uses them
- All data_points MUST have a source field populated
- Do NOT include $schema, $metadata, or any wrapper object
- Return ONLY the JSON object, nothing else`;

/**
 * Rich canonical slide model.
 * Every field is semantically meaningful — not decorative.
 * Renderer uses these deterministically. ISkill validates these.
 */
export interface RichCarouselSlide {
  /** 1-based slide index */
  slide: number;
  /** Narrative role this slide plays in the arc */
  role: CarouselRole;

  // ── Primary content ──────────────────────────────────────
  /** Main headline — maximum 10 words, punchy */
  headline: string;
  /** Supporting subheadline — amplifies or contrasts the headline */
  subheadline?: string | undefined;
  /** Body paragraph — 2–4 sentences of substantive content */
  body?: string | undefined;

  // ── Structured content ───────────────────────────────────
  /** Bullet points — each minimum 5 words, actionable or evidence-based */
  bullets?: string[];
  /** The core insight being communicated on this slide */
  insight?: string | undefined;
  /** Concrete evidence, data, or proof points supporting the insight */
  supporting_evidence?: string[];

  // ── Takeaway & CTA ──────────────────────────────────────
  /** The one thing readers should remember from this slide */
  key_takeaway?: string | undefined;
  /** Slide-level CTA (for cta role slides; artifact-level cta overrides) */
  cta?: string | undefined;

  // ── Rendering hints ──────────────────────────────────────
  /** Creative direction for visual design / image generation */
  visual_direction?: string | undefined;
  /** Layout hint for renderer — overrides default role layout */
  layout_hint?: 'centered' | 'headline-only' | 'bullets-primary' | 'split' | 'data-callout' | 'full-bleed';

  // ── Semantic signals ─────────────────────────────────────
  /** Keywords to visually emphasize in rendering */
  emphasis_keywords?: string[];
  /** 0–100: how information-dense this slide is */
  semantic_density_score?: number;
  /** 0–100: how persuasive this slide's framing is */
  persuasion_score?: number;

  // ── Production metadata ──────────────────────────────────
  /** Speaker or caption notes — not rendered on slide */
  speaker_notes?: string | undefined;
}

export interface CarouselMeta {
  /** Color palette as hex strings */
  palette: string[];
  /** Typography style label */
  font_style?: string | undefined;
  /** Total slide count */
  slide_count: number;
  /** Estimated read time in seconds */
  estimated_read_seconds?: number;
  /** Platform this is optimized for */
  target_platform?: 'linkedin' | 'instagram' | 'twitter' | 'generic';
}

/**
 * CarouselArtifact — the full canonical carousel representation.
 *
 * This is what OCL compiles into.
 * This is what ISkill validates.
 * This is what the Renderer consumes.
 * This is what gets exported.
 */
export interface CarouselArtifact extends BaseArtifact {
  artifact_type: 'carousel';
  carousel_meta: CarouselMeta;
  slides: RichCarouselSlide[];
}

// ─────────────────────────────────────────────────────────────
// DECK ARTIFACT
// ─────────────────────────────────────────────────────────────

export interface DeckSlide {
  slide: number;
  type: 'cover' | 'agenda' | 'content' | 'divider' | 'stats' | 'quote' | 'closing';
  title: string;
  subtitle?: string | undefined;
  body?: string | undefined;
  bullets?: string[];
  stats?: Array<{ value: string; label: string; delta?: string }>;
  speaker_notes?: string | undefined;
  visual_direction?: string | undefined;
  layout_hint?: 'centered' | 'title-top' | 'two-column' | 'image-left' | 'image-right' | 'stats-grid' | 'big-text';
}

export interface DeckMeta {
  section_count: number;
  slide_count: number;
  estimated_duration_minutes?: number;
  target_venue?: 'boardroom' | 'all-hands' | 'investor' | 'workshop' | 'webinar';
}

export interface DeckArtifact extends BaseArtifact {
  artifact_type: 'deck';
  deck_meta: DeckMeta;
  slides: DeckSlide[];
}

// ─────────────────────────────────────────────────────────────
// REPORT ARTIFACT
// ─────────────────────────────────────────────────────────────

export interface ReportSection {
  id: string;
  heading: string;
  subheading?: string | undefined;
  body: string;
  key_findings?: string[];
  data_points?: Array<{ label: string; value: string; source?: string }>;
  /** Word count for this section */
  word_count?: number;
}

export interface ReportMeta {
  section_count: number;
  word_count: number;
  estimated_read_minutes?: number;
  report_type?: 'analysis' | 'research' | 'executive-brief' | 'case-study' | 'white-paper';
}

export interface ReportArtifact extends BaseArtifact {
  artifact_type: 'report';
  report_meta: ReportMeta;
  sections: ReportSection[];
}

// ─────────────────────────────────────────────────────────────
// NEWSLETTER ARTIFACT
// ─────────────────────────────────────────────────────────────

export interface NewsletterSection {
  /** Section identifier (e.g. 'intro', 'main-story', 'quick-takes', 'cta') */
  id: string;
  /** Section type governs rendering layout */
  type: 'intro' | 'story' | 'quick-takes' | 'callout' | 'cta' | 'sponsor' | 'divider';
  /** Section heading (short, punchy) */
  heading?: string | undefined;
  /** Primary body text — the main content of this section */
  body: string;
  /** 2–5 bulleted quick-take items (for type='quick-takes') */
  bullets?: string[] | undefined;
  /** Pull-quote or highlighted callout text */
  callout?: string | undefined;
  /** Word count for this section */
  word_count?: number | undefined;
}

export interface NewsletterMeta {
  /** Total section count */
  section_count: number;
  /** Total estimated word count */
  word_count: number;
  /** Estimated read time in minutes */
  estimated_read_minutes?: number | undefined;
  /** Target send cadence */
  cadence?: 'daily' | 'weekly' | 'biweekly' | 'monthly' | undefined;
  /** Target list type */
  audience_type?: 'b2b' | 'consumer' | 'internal' | 'community' | undefined;
}

export interface NewsletterArtifact extends BaseArtifact {
  artifact_type: 'newsletter';
  /** Email subject line */
  subject_line: string;
  /** Preview text shown in inbox before opening */
  preview_text: string;
  newsletter_meta: NewsletterMeta;
  sections: NewsletterSection[];
}

export const NEWSLETTER_SCHEMA_CONSTRAINTS = { minSections: 3, maxSections: 8 } as const;

export const NEWSLETTER_SCHEMA_INSTRUCTION = `You are producing a high-quality email newsletter. Your readers chose to subscribe — respect their attention with substantive, scannable content they can't get elsewhere.

QUALITY STANDARD: Think Morning Brew, Not Boring, or Lenny's Newsletter quality. Every section earns its place. No filler. Conversational but expert. Practical, not theoretical.

SUBJECT LINE RULE: Write a subject line that makes the reader open the email. Use one of:
  - NUMBER + PROMISE: "5 things founders get wrong about pricing (and one fix)"
  - INSIDER KNOWLEDGE: "What the best operators do differently (it's not what you think)"
  - CONTRARIAN: "Stop measuring engagement. Here's what actually predicts retention."
  - URGENCY + SPECIFICITY: "The window for this approach closes in Q2 — here's why"
Never: "Our weekly update", "Newsletter #47", "June Edition"

PREVIEW TEXT: 1-2 sentences that add context the subject line doesn't. Not a repetition.

STRUCTURE:
  - Start with a compelling intro (1 paragraph, hook the reader, preview the issue)
  - 1-2 main story sections (your primary content — analysis, framework, case study)
  - 1 quick-takes section (3-5 bullets: curated links, stats, or observations)
  - Optional callout (a pull-quote, featured insight, or sponsor spot)
  - End with CTA (specific, low-friction ask — reply, share, click)

ANTI-GENERIC MANDATE:
  - No vague openers: "This week in tech..." → WRONG
  - No hollow CTAs: "Let us know your thoughts!" → WRONG
  - No filler transitions: "Without further ado..." → WRONG

────────────────────────────────────────────────────────
JSON SCHEMA — return this exact structure, no markdown, no explanation
────────────────────────────────────────────────────────

{
  "subject_line": "string (max 60 chars — the email subject line the reader sees in their inbox)",
  "preview_text": "string (max 140 chars — the preview text shown after the subject line in inbox)",
  "title": "string (internal title for the newsletter, 5-10 words)",
  "hook": "string (8–20 words — the opening sentence that makes the reader keep reading)",
  "cta": "string (10–20 words — the specific, low-friction action you want the reader to take)",
  "sections": [
    {
      "id": "string (kebab-case, e.g. 'intro', 'main-story', 'quick-takes', 'cta')",
      "type": "intro | story | quick-takes | callout | cta",
      "heading": "string (optional — short punchy heading for story/callout sections)",
      "body": "string (REQUIRED for intro/story/cta — minimum 50 words. Conversational, substantive. No filler.)",
      "bullets": ["string (optional — for quick-takes only. Each 10-30 words. Include a concrete fact or link context.)"],
      "callout": "string (optional — for callout sections. 1-2 sentences. Pull-quote style.)"
    }
  ]
}

STRUCTURAL REQUIREMENTS:
- Minimum ${NEWSLETTER_SCHEMA_CONSTRAINTS.minSections} sections, maximum ${NEWSLETTER_SCHEMA_CONSTRAINTS.maxSections} sections
- First section type MUST be "intro"
- Last section type MUST be "cta"
- Every section MUST have body (except quick-takes, which MUST have bullets)
- Do NOT include $schema, $metadata, or any wrapper object
- Return ONLY the JSON object, nothing else`;

// ─────────────────────────────────────────────────────────────
// DISCRIMINATED UNION — the top-level artifact type
// ─────────────────────────────────────────────────────────────

export type ArtifactV2 = CarouselArtifact | DeckArtifact | ReportArtifact | NewsletterArtifact;

// Type guards
export function isCarouselArtifact(a: ArtifactV2): a is CarouselArtifact {
  return a.artifact_type === 'carousel';
}
export function isDeckArtifact(a: ArtifactV2): a is DeckArtifact {
  return a.artifact_type === 'deck';
}
export function isReportArtifact(a: ArtifactV2): a is ReportArtifact {
  return a.artifact_type === 'report';
}
export function isNewsletterArtifact(a: ArtifactV2): a is NewsletterArtifact {
  return a.artifact_type === 'newsletter';
}

// ─── Runtime narrowing guard ───────────────────────────────────────────────────
//
// SPRINT2-CHANGE (F-16): isArtifactV2 — safe runtime narrowing for CampaignRow.content.
//
// WHY THIS EXISTS:
//   CampaignRow.content is typed as Record<string, unknown> because the campaigns
//   table stores two structurally different shapes:
//     1. Structured artifacts (carousel/deck/report/newsletter) — full ArtifactV2 JSON.
//     2. Unstructured formats (post/article/email/twitter) — { format, title, content: string }.
//
//   Callers that read campaigns.content and need to work with ArtifactV2 must
//   verify the schema before casting. This guard replaces all `as unknown as ArtifactV2`
//   casts in the codebase with a runtime-verified narrowing.
//
// IMPLEMENTATION STRATEGY:
//   Checks the structural invariants that every ArtifactV2 shares (the $schema
//   discriminator and artifact_type field), without importing ArtifactV2 itself
//   (which would create a circular dependency — this file IS the ArtifactV2 source).
//   The checks are:
//     1. content is a non-null object
//     2. content.$schema === 'artifact-json@2.0' (schema discriminator)
//     3. content.artifact_type is one of the four concrete ArtifactV2 types
//
// USAGE:
//   const raw: Record<string, unknown> = campaignRow.content
//   if (isArtifactV2(raw)) {
//     // raw is now ArtifactV2 — safe to pass to renderers, exporters, governance
//     const artifact: ArtifactV2 = raw
//   }

const ARTIFACT_V2_TYPES = new Set<string>(['carousel', 'deck', 'report', 'newsletter'])

/**
 * Runtime type guard: narrows `content: unknown` to `ArtifactV2`.
 *
 * Returns true if and only if:
 *   - `content` is a non-null object
 *   - `content.$schema === 'artifact-json@2.0'`
 *   - `content.artifact_type` is one of: 'carousel' | 'deck' | 'report' | 'newsletter'
 *
 * Use this before casting `CampaignRow.content` to `ArtifactV2`.
 * See auth-types.ts `CampaignRow.content` doc comment for details on the
 * two possible shapes stored in that field.
 */
export function isArtifactV2(content: unknown): content is ArtifactV2 {
  if (content === null || typeof content !== 'object') return false;
  const c = content as Record<string, unknown>;
  return (
    c['$schema'] === 'artifact-json@2.0' &&
    typeof c['artifact_type'] === 'string' &&
    ARTIFACT_V2_TYPES.has(c['artifact_type'])
  );
}

// ─────────────────────────────────────────────────────────────
// LEGACY COMPAT — thin bridge for existing CarouselBlueprint consumers
//
// CarouselBlueprint is now deprecated in favor of CarouselArtifact.
// The /api/carousel route returns CarouselArtifact.
// CarouselRenderer is updated to accept CarouselArtifact.
// ─────────────────────────────────────────────────────────────

/** @deprecated Use CarouselArtifact instead. Kept for backward compat during migration. */
export interface LegacyCarouselSlide {
  slide: number;
  role: CarouselRole;
  headline?: string | undefined;
  subtext?: string | undefined;
  visual_direction?: string | undefined;
}

/** @deprecated Use CarouselArtifact instead. */
export interface LegacyCarouselMeta {
  palette: string[];
  font_style?: string | undefined;
}

/** @deprecated Use CarouselArtifact instead. */
export interface CarouselBlueprint {
  slides: LegacyCarouselSlide[];
  carousel_meta: LegacyCarouselMeta;
}

/**
 * Upcast a legacy CarouselBlueprint to a CarouselArtifact.
 * Used during migration — new generation always produces CarouselArtifact directly.
 */
export function upcastCarouselBlueprint(bp: CarouselBlueprint, topic: string): CarouselArtifact {
  const now = new Date().toISOString();
const slides: RichCarouselSlide[] = bp.slides.map(s => ({
  slide: s.slide,
  role: s.role,
  headline: s.headline ?? '',

  ...(s.subtext !== undefined
    ? { body: s.subtext }
    : {}),

  ...(s.visual_direction !== undefined
    ? { visual_direction: s.visual_direction }
    : {}),

  semantic_density_score: 30,
  persuasion_score: 30,
}));

  return {
    $schema: 'artifact-json@2.0',
    id: `legacy-${Date.now()}`,
    artifact_type: 'carousel',
    title: topic,
    summary: topic,
    hook: bp.slides[0]?.headline ?? topic,
    cta: bp.slides.find(s => s.role === 'cta')?.headline ?? '',
    semantic_theme: {
      visual_preset: 'executive-dark',
    },
    audience: {
      label: 'General',
      sophistication: 'practitioner',
    },
    narrative_arc: {
      structure: 'problem-solution',
      hook_statement: bp.slides[0]?.headline ?? topic,
      thesis: topic,
      resolution: bp.slides.find(s => s.role === 'cta')?.headline ?? '',
      pacing: 'balanced',
    },
    richness_metrics: {
      overall_score: 30,
      density_score: 30,
      evidence_score: 0,
      persuasion_score: 30,
      cta_quality_score: 20,
      narrative_coherence_score: 40,
      hook_strength_score: 40,
      audience_alignment_score: 30,
      total_content_words: slides.reduce((acc, s) => acc + (s.headline ? s.headline.split(' ').length : 0), 0),
      avg_words_per_unit: 5,
    },
    generation_trace: {
      generated_at: now,
      ocl_strategy: 'legacy-upcast',
      governance_outcome: 'bypassed',
      repair_attempts: 0,
      input_type: 'unknown',
    },
    export_metadata: {
      available_formats: ['json', 'html'],
    },
    created_at: now,
    carousel_meta: {
  palette: bp.carousel_meta.palette,

  ...(bp.carousel_meta.font_style !== undefined
    ? { font_style: bp.carousel_meta.font_style }
    : {}),

  slide_count: slides.length,
},
    slides,
  };
}


