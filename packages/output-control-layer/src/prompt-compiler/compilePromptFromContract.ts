/**
 * @brandos/output-control-layer — prompt-compiler/compilePromptFromContract.ts
 *
 * Canonical prompt compilation — single source of truth.
 *
 * Responsibilities:
 *   ✓ Deterministic prompt assembly from ResolvedGenerationContract
 *   ✓ Generation contract transformation (persona, identity, artifact, skill, runtime)
 *   ✓ Schema instruction application
 *   ✓ Formatting composition
 *   ✓ Attempt-aware progressive prompt strengthening (closed-loop governance feedback)
 *
 * Forbidden:
 *   ✗ LLM calls
 *   ✗ Runtime routing
 *   ✗ Retry logic
 *   ✗ Policy execution
 *   ✗ Governance execution
 *   ✗ DB access / Supabase access
 *   ✗ Telemetry
 *   ✗ Provider selection
 *   ✗ Normalization
 *   ✗ Artifact compilation
 *   ✗ Contributor execution
 *
 * CLOSED-LOOP FEEDBACK (new):
 *   When runtime.attemptHistory is populated (attempt >= 2), the prompt
 *   compiler reads prior governance violations and recommendations and
 *   injects targeted corrective instructions. Prompt strength escalates
 *   systematically with each attempt:
 *
 *   Attempt 1 → Normal prompt (no history)
 *   Attempt 2 → Targeted repair: violations + recommendations injected
 *   Attempt 3 → Prescriptive mode: violations become explicit prohibitions;
 *               persistent violations get stronger language; score target named
 *   Attempt 4+ → Maximum specificity: each violation becomes a named constraint
 *
 *   The escalation is CONTRACT-DRIVEN and ARTIFACT-TYPE AGNOSTIC.
 *   No carousel/deck/report branching anywhere in this file.
 */

import type { ResolvedGenerationContract, IAttemptHistory, IGovernanceViolationDetail } from '@brandos/contracts';
import { CAROUSEL_SCHEMA_INSTRUCTION, DECK_SCHEMA_INSTRUCTION, REPORT_SCHEMA_INSTRUCTION, NEWSLETTER_SCHEMA_INSTRUCTION } from '@brandos/contracts';

// Re-export so existing consumers of this module continue to resolve.
export { CAROUSEL_SCHEMA_INSTRUCTION };

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------
export interface CompiledPrompt {
  system: string;
  user: string;
  /** Which prompt version was generated — 'v1', 'v2-targeted', 'v3-prescriptive', etc. */
  promptVersion: string;
}

// ---------------------------------------------------------------------------
// ARTIFACT_TASK_PROMPTS — system prompt overrides per invocation type.
// All three artifact types now use canonical schema instructions as single source of truth.
// ---------------------------------------------------------------------------
export const ARTIFACT_TASK_PROMPTS: Readonly<Partial<Record<string, string>>> = {
  generate_deck:       DECK_SCHEMA_INSTRUCTION,
  generate_carousel:   CAROUSEL_SCHEMA_INSTRUCTION,
  generate_report:     REPORT_SCHEMA_INSTRUCTION,
  generate_newsletter: NEWSLETTER_SCHEMA_INSTRUCTION,
} as const;

// ---------------------------------------------------------------------------
// Contract-based compilation — canonical and only path
// ---------------------------------------------------------------------------

export function compilePromptFromContract(
  contract: ResolvedGenerationContract
): CompiledPrompt {
  const { identity, persona, intent, artifact, runtime, skill } = contract;

  const sections: string[] = [];
  const diagnostics: string[] = [];  // FIX-LOG-001: forensic prompt diagnostics

  // ── TOPIC-DRIFT-FIX-003: Explicit topic anchor ───────────────────────────
  // The user's prompt is the authoritative topic. It is placed first in the
  // system prompt so all subsequent instructions (persona, identity, schema)
  // are subordinate to it. No other layer may replace this topic.
  //
  // Precedence enforced here (highest → lowest):
  //   1. User topic (intent.topic / intent.userPrompt)
  //   2. Explicit audience (from persona, only if persona is set)
  //   3. Persona style (tone, voice)
  //   4. Identity enrichment (voice/style ONLY — never topic)
  //
  // Identity fields that historically named topics (recurringThemes,
  // corePositions, marketNarratives, signatureFrameworks) are now emitted
  // as stylistic framing hints ONLY — clearly scoped to "if relevant to the
  // topic the user requested". They may never override or replace user topic.
  sections.push(buildTopicAnchorSection(intent.topic, intent.userPrompt));
  diagnostics.push(`topic:ANCHORED("${intent.topic.slice(0, 40)}")`);

  // 1. Persona / brand voice
  if (persona) {
    sections.push(buildPersonaSection(persona));
    diagnostics.push(`persona:YES(tone=${persona.tone},audience=${persona.audiencePositioning ?? 'none'})`);
  } else {
    diagnostics.push('persona:NO');
  }

  // 2. Identity personalization.
  // PLATFORM SPLIT: the raw IStyleProjection path is removed — Class A+B
  // signals never cross the BrandOS boundary anymore (they are
  // IntelligenceOS-internal state). IIdentityContribution, populated by
  // IdentityContributor from CognitionContext.identity, is now the ONLY
  // identity path. Its presence/absence already reflects IntelligenceOS's
  // own confidence gate — no BrandOS-side numeric threshold is applied.
  if (identity) {
    sections.push(buildIdentitySection(identity));
    diagnostics.push(
      `identity:YES(confidence=${identity.confidence},hookStyle=${identity.hookStyle ?? 'none'})`
    );
  } else {
    diagnostics.push('identity:NO');
  }

  // 3. Artifact schema instruction — SINGLE source via CAROUSEL_SCHEMA_INSTRUCTION
  if (artifact?.schemaInstruction) {
    sections.push(artifact.schemaInstruction);
    diagnostics.push('schema:YES');
  }

  // 4. ISkill workflow (Phase 2 — only when skill contributor is wired)
  if (skill) {
    sections.push(buildSkillSection(skill));
    diagnostics.push(`skill:YES(${skill.skillId})`);
  }

  // 5. Governance feedback loop — attempt-aware prompt escalation
  //    Attempt 1: no history yet, normal prompt
  //    Attempt 2+: inject targeted corrections from prior governance failures
  const attemptHistory = runtime.attemptHistory;
  const attempt = runtime.attempt;
  let promptVersion = 'v1';

  if (attempt > 1 && attemptHistory && attemptHistory.records.length > 0) {
    const feedbackSection = buildGovernanceFeedbackSection(attempt, attemptHistory);
    if (feedbackSection) {
      sections.push(feedbackSection);
      promptVersion = attempt === 2 ? 'v2-targeted' : `v${attempt}-prescriptive`;
      diagnostics.push(
        `govFeedback:YES(attempt=${attempt},failures=${attemptHistory.totalFailures},` +
        `persistent=${attemptHistory.persistentViolationCodes.join('+')||'none'})`
      );
    }
  } else if (attempt > 1) {
    // Legacy path: no history but still a retry — use the old simple escalation
    sections.push(
      `STRICT MODE: This is retry attempt ${attempt}. ` +
      `Be especially precise with structure, schema compliance, and content quality. ` +
      `Quality threshold: ${runtime.qualityThreshold}.`
    );
    promptVersion = `v${attempt}-legacy-retry`;
    diagnostics.push(`retry:YES(attempt=${attempt},noHistory)`);
  }

  // TOPIC-DRIFT-FIX-004: Repair context — governance failure description forwarded
  // from the repair LLM callback. Injected into the SYSTEM prompt as an additional
  // correction directive. NEVER placed in the user message — intent.userPrompt
  // (the user's original topic) is the ONLY content of the user message.
  // This fires independently of attemptHistory so it applies even on the legacy path.
  if (runtime.repairContext) {
    sections.push(
      `[Repair Directive]\n` +
      `The previous generation failed validation. Address the following issue:\n` +
      `${runtime.repairContext}`
    );
    diagnostics.push(`repairContext:YES`);
  }

  const system = sections.filter(Boolean).join('\n\n');
  const user = intent.userPrompt;

  // TOPIC-DRIFT-FIX-003/004: Runtime diagnostics — topic anchor and repair state visible in logs
  const tokenEstimate = Math.ceil((system.length + user.length) / 4);
  console.info(
    `[PromptCompiler] compiled prompt — version=${promptVersion} sections=[${diagnostics.join(' | ')}] ` +
    `systemChars=${system.length} tokenEstimate=${tokenEstimate}`
  );
  console.info(
    `[PromptCompiler] topic-intent-guard — ` +
    `originalPrompt="${intent.userPrompt.slice(0, 80)}" ` +
    `compiledTopic="${intent.topic.slice(0, 80)}" ` +
    `resolvedAudience="${persona?.audiencePositioning ?? 'none'}" ` +
    `resolvedPersona="${persona?.tone ?? 'none'}" ` +
    `repairContext=${runtime.repairContext ? 'YES' : 'NO'}`
  );

  return { system, user, promptVersion };
}

// ---------------------------------------------------------------------------
// Governance feedback section builder — the core of the closed-loop refactor
// ---------------------------------------------------------------------------

/**
 * buildGovernanceFeedbackSection — generates the corrective prompt section
 * based on prior governance failures.
 *
 * The section scales in specificity with the attempt number:
 *   Attempt 2 → targeted: lists violations and recommendations clearly
 *   Attempt 3 → prescriptive: violations become explicit prohibitions
 *   Attempt 4+ → maximum specificity: each violation gets its own instruction block
 *
 * DESIGN: artifact-type agnostic. Works for carousel, deck, report, post, etc.
 * No artifact-specific logic anywhere in this function.
 */
function buildGovernanceFeedbackSection(
  attempt: number,
  history: IAttemptHistory
): string {
  const lastRecord = history.records[history.records.length - 1];
  if (!lastRecord) return '';

  const { governanceFeedback } = lastRecord;
  const { violations, recommendations, flagsRemaining, score } = governanceFeedback;
  const isPrescriptive = attempt >= 3;
  const isMaximum = attempt >= 4;

  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────
  if (isMaximum) {
    lines.push(
      `═══ MAXIMUM CORRECTION MODE — Attempt ${attempt} ═══`,
      `Previous ${history.totalFailures} attempt(s) failed governance (last score: ${score}/100).`,
      `The following constraints are MANDATORY. Violating any of them will cause rejection.`
    );
  } else if (isPrescriptive) {
    lines.push(
      `⚠ PRESCRIPTIVE REPAIR MODE — Attempt ${attempt}`,
      `Previous attempt scored ${score}/100 and failed governance validation.`,
      `You MUST fix ALL of the issues listed below. They are not suggestions.`
    );
  } else {
    lines.push(
      `[Governance Repair — Attempt ${attempt}]`,
      `The previous attempt scored ${score}/100 and did not pass quality validation.`,
      `Fix the following issues in this generation:`
    );
  }

  // ── Violations block ─────────────────────────────────────────────────────
  if (violations.length > 0) {
    lines.push('');
    if (isPrescriptive) {
      lines.push('PROHIBITED — these patterns were found and MUST NOT appear:');
    } else {
      lines.push('Issues to fix:');
    }

    // Sort: CRITICAL first, then HIGH, MEDIUM, LOW
    const sorted = [...violations].sort((a, b) => {
      const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
    });

    for (const v of sorted) {
      const instruction = buildViolationInstruction(v, isPrescriptive, isMaximum);
      if (instruction) lines.push(instruction);
    }
  }

  // ── Persistent violations (recurring failures) ────────────────────────────
  if (history.persistentViolationCodes.length > 0 && attempt >= 3) {
    lines.push('');
    lines.push(
      `RECURRING FAILURES (appeared in multiple attempts — requires extra attention):`
    );
    for (const code of history.persistentViolationCodes) {
      const persistentInstruction = buildPersistentViolationInstruction(code);
      if (persistentInstruction) lines.push(`  !! ${persistentInstruction}`);
    }
  }

  // ── Recommendations block ─────────────────────────────────────────────────
  if (recommendations.length > 0) {
    lines.push('');
    lines.push(isPrescriptive ? 'Required improvements:' : 'Recommendations:');

    // Only top-impact recommendations at higher attempts to keep prompt focused
    const maxRecs = isMaximum ? 3 : isPrescriptive ? 5 : 8;
    const topRecs = [...recommendations]
      .sort((a, b) => (b.estimatedScoreDelta ?? 0) - (a.estimatedScoreDelta ?? 0))
      .slice(0, maxRecs);

    for (const rec of topRecs) {
      lines.push(`  → ${rec.instruction}`);
    }
  }

  // ── Remaining flags ───────────────────────────────────────────────────────
  if (flagsRemaining && flagsRemaining.length > 0) {
    lines.push('');
    lines.push('Additional quality flags to address:');
    for (const flag of flagsRemaining) {
      lines.push(`  • ${flag}`);
    }
  }

  // ── Score target ──────────────────────────────────────────────────────────
  if (isPrescriptive) {
    const priorScores = history.records.map(r => r.governanceFeedback.score);
    const trend = priorScores.length >= 2
      ? priorScores[priorScores.length - 1] - priorScores[priorScores.length - 2]
      : 0;
    lines.push('');
    lines.push(
      `Score history: [${priorScores.join(' → ')}]. ` +
      `Trend: ${trend >= 0 ? '+' : ''}${trend} points. ` +
      `Target: score ≥ 65 to pass governance.`
    );
  }

  return lines.join('\n');
}

/**
 * Build a targeted correction instruction for a single violation.
 */
function buildViolationInstruction(
  v: IGovernanceViolationDetail,
  prescriptive: boolean,
  maximum: boolean
): string {
  const prefix = maximum ? '  ❌ FORBIDDEN:' : prescriptive ? '  ✗' : '  -';
  const measureStr = (v.actual !== undefined && v.expected !== undefined)
    ? ` (found: ${v.actual}, required: ${v.expected})`
    : '';

  // Code-specific instructions that give the LLM actionable direction
  const codeInstructions: Record<string, string> = {
    WEAK_HOOK:
      'The opening line is too generic. Write a bold, specific, contrarian, or data-backed opening statement. ' +
      'Do NOT start with "In today\'s", "As a", "Have you ever", "Let me share", or "Welcome to".',
    CLICHE_DENSITY:
      'Remove all AI clichés. Do NOT use: "dive into", "delve into", "game-changer", ' +
      '"paradigm shift", "unlock potential", "leveraging the power", "thought leader", "synergy".',
    SCORE_THRESHOLD:
      'Quality score was too low. Every section must contain specific data, named examples, ' +
      'or mechanisms — not generic statements. Replace vague claims with precise evidence.',
    ROBOTIC_SYMMETRY:
      'Paragraph lengths are too uniform. Vary sentence and paragraph length deliberately. ' +
      'Use short punchy sentences for impact, longer sentences for nuance.',
    REPETITIVE_OPENER:
      'Multiple paragraphs start with the same word. Vary how each paragraph and slide begins.',
    GENERIC_VISUAL:
      'Remove generic visual placeholders like "add image here". Describe specific, brand-intentional visuals.',
    BUZZWORD_DENSITY:
      'Replace business buzzwords with precise language. ' +
      '"robust" → "strong", "seamless" → "smooth", "holistic" → "comprehensive", ' +
      '"impactful" → "effective", "cutting-edge" → "advanced".',
    MISSING_ROLE:
      'The required narrative role is missing. Ensure all required roles (hook, CTA, etc.) are present.',
    SLIDE_COUNT:
      `Slide/section count is incorrect${measureStr}. Adjust to meet the required count.`,
    SECTION_COUNT:
      `Section count is incorrect${measureStr}. Adjust the number of sections.`,
    SCHEMA_VIOLATION:
      'The output structure violated the required JSON schema. Follow the schema exactly as specified.',
  };

  const specific = codeInstructions[v.code];
  if (specific) {
    return `${prefix} [${v.code}] ${specific}`;
  }

  // Fallback: use the violation message directly
  return `${prefix} [${v.code}${measureStr}] ${v.message}`;
}

/**
 * Build an extra-strong instruction for a violation that has appeared
 * in 2+ consecutive attempts.
 */
function buildPersistentViolationInstruction(code: string): string {
  const persistentInstructions: Record<string, string> = {
    WEAK_HOOK:
      'Hook has failed multiple times. Your FIRST sentence must be a bold, specific claim ' +
      'with a number, a named company, or a counterintuitive fact. No exceptions.',
    CLICHE_DENSITY:
      'Clichés keep appearing. Read every sentence. If a phrase sounds like ChatGPT wrote it, rewrite it.',
    SCORE_THRESHOLD:
      'Quality score has been too low across multiple attempts. Every sentence must carry ' +
      'specific, verifiable information. Vague assertions cause failure.',
    ROBOTIC_SYMMETRY:
      'Paragraph rhythm has been too uniform. Deliberately use 1–3 sentence paragraphs alongside ' +
      '4–6 sentence paragraphs. Vary consciously.',
    BUZZWORD_DENSITY:
      'Buzzwords keep appearing. Audit every adjective — if it could appear in a generic press ' +
      'release, replace it with a concrete, specific term.',
  };
  return persistentInstructions[code] ?? `${code} has failed in multiple previous attempts — address it explicitly.`;
}

// ---------------------------------------------------------------------------
// Topic Fidelity Filter — prevents identity Phase 2 keywords from becoming topics
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// buildIdentitySection (V2 fallback — from IIdentityContribution)
// Used when styleProjection is unavailable but IIdentityContribution exists.
// No topic filtering — V2 classification boundary already enforces separation.
// Phase 2 topic fields (recurringThemes etc.) are always empty in V2.
// ---------------------------------------------------------------------------

function buildIdentitySection(identity: NonNullable<ResolvedGenerationContract['identity']>): string {
  const lines: string[] = ['[Personalization — Style & Voice Only]'];

  // Class A: Style signals
  if (identity.hookStyle)       lines.push(`Hook style: ${identity.hookStyle}.`);
  if (identity.preferredLength) lines.push(`Content length: ${identity.preferredLength}.`);
  if (identity.ctaIntent)       lines.push(`CTA approach: ${identity.ctaIntent}.`);
  else if (identity.ctaPatterns?.length) {
    lines.push(`Preferred CTA patterns: ${identity.ctaPatterns.slice(0, 2).join(' | ')}.`);
  }

  // P0-1 FIX: Emit phraseLibrary so the LLM echoes the brand's proven language.
  // phraseLibrary contains validated high-performing phrases from the author's corpus.
  // These are style signals, not topic constraints — they shape wording, not subject matter.
  if (identity.phraseLibrary?.length) {
    lines.push(`Brand phrases (use naturally, don't force): ${identity.phraseLibrary.slice(0, 4).join(', ')}.`);
  }

  if (identity.narrativeArc)              lines.push(`Narrative structure: ${identity.narrativeArc}.`);
  else if (identity.narrativePatterns?.length) {
    lines.push(`Narrative structure: ${identity.narrativePatterns.slice(0, 2).join(' or ')}.`);
  }
  if (identity.executiveCadence)          lines.push(`Prose cadence: ${identity.executiveCadence}.`);
  if (identity.argumentationStyle)        lines.push(`Argumentation: ${identity.argumentationStyle}.`);
  if (identity.evidencePatterns?.length)  lines.push(`Evidence style: ${identity.evidencePatterns.slice(0, 2).join(', ')}.`);

  // Class B: Structural patterns (V2 only fields)
  if ((identity as any).titlePatterns?.length) {
    lines.push(`Title templates: ${(identity as any).titlePatterns.slice(0, 2).join(' | ')}.`);
  }
  if ((identity as any).hookPatterns?.length) {
    lines.push(`Opening templates: ${(identity as any).hookPatterns.slice(0, 2).join(' | ')}.`);
  }
  if ((identity as any).structuralArcs?.length) {
    lines.push(`Structural arc: ${(identity as any).structuralArcs.slice(0, 2).join(' or ')}.`);
  }

  // Visual (renderer-only, not LLM topic)
  if (identity.visual) {
    const v = identity.visual;
    if (v.primaryColor)  lines.push(`Visual: primary color ${v.primaryColor}.`);
    if (v.fontStyle)     lines.push(`Visual: font style ${v.fontStyle}.`);
    if (v.layoutDensity) lines.push(`Visual: layout density ${v.layoutDensity}.`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Topic anchor — MUST be the first section in every compiled prompt
// ---------------------------------------------------------------------------

/**
 * buildTopicAnchorSection — establishes the user's requested topic as the
 * authoritative subject for all generation.
 *
 * TOPIC-DRIFT-FIX-003: This section is injected first so that persona,
 * identity, and audience context are all downstream of the topic — they
 * can influence style, voice, and structure but they cannot change the subject.
 *
 * The explicit prohibition prevents identity memory (recurringThemes, etc.)
 * from pulling the LLM toward the author's habitual topics.
 */
function buildTopicAnchorSection(topic: string, userPrompt: string): string {
  // Prefer the full userPrompt when it adds context beyond the extracted topic.
  // If they're effectively the same (topic is just a truncation), use userPrompt.
  const subject = userPrompt.trim().length > 0 ? userPrompt.trim() : topic.trim();
  return [
    `[Content Topic — AUTHORITATIVE]`,
    `The user has requested content about: "${subject}"`,
    `RULE: Generate content exclusively about this topic.`,
    `RULE: Persona, audience, and identity context below may influence style, tone, and structure.`,
    `RULE: They must never change, replace, or expand the subject matter beyond what the user requested.`,
    `RULE: If identity memory references past themes (e.g. AI, leadership, enterprise), ignore them unless the user's topic is explicitly about those subjects.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildPersonaSection(persona: NonNullable<ResolvedGenerationContract['persona']>): string {
  const lines = [
    `You are writing in the voice of ${persona.brandName ?? 'this brand'}.`,
    `Tone: ${persona.tone}.`,
    `Voice: ${persona.voice}.`,
  ];
  if (persona.audiencePositioning) {
    // TOPIC-DRIFT-FIX-005: Do NOT emit "Primary audience: Founders" as a topic-level
    // instruction. It tells the LLM what subject matter to generate (startup/VC/AI topics),
    // not what writing style to use. Instead, emit the audience only as a depth/sophistication
    // calibration — the audience persona influences HOW deeply to write, not WHAT to write about.
    lines.push(
      `Audience sophistication: ${persona.audiencePositioning}. ` +
      `These readers are experienced practitioners. Write at depth — show mechanisms, ` +
      `specific data, and non-obvious framing. Avoid generic statements any reader could predict.`
    );
    lines.push(
      `If the audience is executive-level, they skim first and read only what earns their attention. ` +
      `Put the most important claim at the front of every slide and section.`
    );
  }
  // FIX-INTEL-005: surface banned phrases and executive level from brand context
  if ((persona as any).bannedPhrases?.length) {
    lines.push(`NEVER use these phrases: ${((persona as any).bannedPhrases as string[]).slice(0, 8).join(', ')}.`);
  }
  if ((persona as any).executiveLevel) {
    lines.push('Write at C-suite level: precise, authoritative, no fluff.');
  }
  if ((persona as any).domain) {
    // TOPIC-DRIFT-FIX-005: domain from persona is a writing-context hint, not a topic override.
    // Only emit if the domain is generic/neutral. Specific business domains (e.g. 'Technology',
    // 'AI', 'Enterprise') are suppressed here because they actively bias topic generation.
    const domainVal = String((persona as any).domain).toLowerCase();
    const topicBiasingDomains = ['technology', 'ai', 'enterprise', 'saas', 'fintech', 'b2b'];
    if (!topicBiasingDomains.some(d => domainVal.includes(d))) {
      lines.push(`Domain context: ${(persona as any).domain}.`);
    }
  }

  // Anti-generic mandate — applies to all output regardless of persona
  lines.push(
    `\nANTI-GENERIC QUALITY RULES (apply to all output):`,
    `- Every factual claim must be specific: use named companies, specific percentages, named individuals, specific timeframes or dollar figures. Replace "many companies" with a percentage. Replace "recently" with a quarter or year. Replace "significant improvement" with a measured number.`,
    `- Banned word/phrase patterns: "leverage", "synergies", "game-changer", "paradigm shift", "unlock potential", "in today's fast-paced world", "it's more important than ever", "cutting-edge", "revolutionary", "best-in-class", "holistic approach", "move the needle", "low-hanging fruit".`,
    `- Avoid symmetric bullet lists that carry no evidence or mechanism — each bullet must state a specific insight, a named reference, or a concrete consequence.`,
    `- Avoid rhetorical questions as the primary content of any slide or section.`,
    `- Every slide or section must carry at least one insight the reader could not have written themselves before reading it.`
  );

  return lines.join('\n');
}

function buildSkillSection(skill: NonNullable<ResolvedGenerationContract['skill']>): string {
  const lines = [`[Workflow: ${skill.skillId}]`];
  if (skill.workflow.length) {
    lines.push(`Follow this structure: ${skill.workflow.join(' → ')}.`);
  }
  if (skill.successCriteria?.length) {
    lines.push(`Success criteria:\n${skill.successCriteria.map(c => `  - ${c}`).join('\n')}`);
  }
  return lines.join('\n');
}

