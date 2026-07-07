/**
 * @brandos/iskill-runtime — skills/linkedin-post.ts
 *
 * PHASE B: LinkedInPostSkill — second production ISkill.
 *
 * CONTRACT COMPATIBILITY NOTE:
 *   ArtifactV2 = CarouselArtifact | DeckArtifact | ReportArtifact.
 *   There is no SocialPostArtifact in the contract union.
 *   'social_post' exists in ArtifactType but has no corresponding ArtifactV2 member.
 *
 *   A LinkedIn post is represented as a ReportArtifact (artifact_type: 'report')
 *   with a single section whose body is the post content. The canonical BaseArtifact
 *   fields hook and cta map naturally to the post's opening hook and closing CTA.
 *
 *   When a SocialPostArtifact is added to the ArtifactV2 union, this skill can be
 *   updated by changing TOutput from ReportArtifact and swapping the compile
 *   injection key. No lifecycle logic changes will be required.
 *
 * COMPILE INJECTION PATTERN:
 *   Following the established carousel-founder pattern, the OCL compiler function
 *   is injected via context.metadata['compileReport'] — NOT imported directly.
 *   This keeps @brandos/iskill-runtime free of @brandos/output-control-layer as
 *   a hard dependency. The caller (ISkillRuntime executor) injects the function.
 *
 * GTM RATIONALE:
 *   LinkedIn posts are the highest-frequency content type for the ICP.
 *   This skill applies brand voice identity, governs hook/CTA quality,
 *   enables brand memory learning, and provides a repair loop.
 */

import type { ReportArtifact, IGovernanceResult, SkillContext } from '@brandos/contracts'
import type {
  ISkillLifecycle,
  ISkillExecutionContext,
  ISkillExecutionPlan,
  ISkillExecutionResult,
  ISkillRepairResult,
  ISkillValidationResult,
  ISkillArtifactContract,
  ISkillRepairContract,
  IdentityDimension,
} from '../contracts'

// ─── Input type ───────────────────────────────────────────────────────────────

export interface LinkedInPostInput {
  topic:           string
  tone?:           string
  targetAudience?: string
  ctaOverride?:    string
  /** If true, formats output with single-sentence lines for LinkedIn readability */
  lineBreaks?:     boolean
}

// ─── Compile injection type ───────────────────────────────────────────────────

/** Type of the compile function injected via context.metadata['compileReport'] */
type CompileReportFn = (raw: string, topic: string, tone?: string) => ReportArtifact

// ─── SkillDef (registry compatibility) ───────────────────────────────────────

export const LinkedInPostSkillDef = {
  metadata: {
    id:                   'linkedin-post',
    name:                 'LinkedIn Post Skill',
    version:              '1.0.0',
    category:             'generate' as const,
    description:
      'Generates governed LinkedIn posts represented as ReportArtifacts with brand identity personalization',
    inputType:            'LinkedInPostInput',
    outputType:           'ReportArtifact',
    requiredCapabilities: [],
    permissions:          [],
  },
  execute: async (_input: LinkedInPostInput, _context: SkillContext) => ({
    success:    false,
    skillId:    'linkedin-post',
    durationMs: 0,
    error:      'LinkedInPostSkill must be executed through ISkillRuntime.executeSkill()',
  }),
  validate: (input: LinkedInPostInput) =>
    typeof input?.topic === 'string' && input.topic.trim().length > 0,
}

// ─── Lifecycle implementation ─────────────────────────────────────────────────

export class LinkedInPostLifecycle
  implements ISkillLifecycle<LinkedInPostInput, ReportArtifact>
{
  /**
   * ExportFormat is constrained to 'pptx' | 'html' | 'canva' | 'figma' | 'json' | 'pdf' | 'png'.
   * Posts export to 'html' (for copy/paste into LinkedIn) and 'json' (for persistence).
   */
  readonly artifactContract: ISkillArtifactContract<ReportArtifact> = {
    artifactType: 'report',
    supportedFormats: ['html', 'json'],
    governanceDefaults: {
      minRichnessScore: 0.45,
    },
  }

  /**
   * repairStrategy must be 'full-lifecycle' | 'compiler-only' | undefined.
   * 'compiler-only': re-compile raw LLM repair output without re-entering validate/prepare.
   */
  readonly repairContract: ISkillRepairContract = {
    maxAttempts: 2,
    buildRepairPrompt: (
      _artifactType: import('@brandos/contracts').ArtifactType,
      violationReason: string,
      topic: string,
    ): string => buildPostRepairPrompt(topic, violationReason),
    repairStrategy: 'compiler-only',
  }

  readonly consumedDimensions: IdentityDimension[] = [
    'hookStyle',
    'ctaPatterns',
    'tonePatterns',
    'phraseLibrary',
  ]

  // ── PHASE 1: validate ──────────────────────────────────────────────────────

  validate(input: LinkedInPostInput): ISkillValidationResult {
    const errors: Array<{ field: string; message: string; code: string }> = []

    if (!input?.topic || typeof input.topic !== 'string') {
      errors.push({ field: 'topic', message: 'topic is required', code: 'REQUIRED' })
    } else if (input.topic.trim().length < 5) {
      errors.push({ field: 'topic', message: 'topic must be at least 5 characters', code: 'TOO_SHORT' })
    } else if (input.topic.length > 500) {
      errors.push({ field: 'topic', message: 'topic must be under 500 characters', code: 'TOO_LONG' })
    }

    return { valid: errors.length === 0, errors }
  }

  // ── PHASE 2: prepare ───────────────────────────────────────────────────────

  async prepare(
    input: LinkedInPostInput,
    context: ISkillExecutionContext,
  ): Promise<ISkillExecutionPlan<LinkedInPostInput>> {
    const p = context.personalization

    const hookStyles   = p.getProjection('hookStyle')
    const ctaPatterns  = p.getProjection('ctaPatterns')
    const tonePatterns = p.getProjection('tonePatterns')
    const phrases      = p.getProjection('phraseLibrary')

    const tone       = input.tone ?? tonePatterns[0] ?? 'direct and insightful'
    const hookStyle  = hookStyles[0]  ?? 'bold-claim'
    const ctaPattern = input.ctaOverride ?? ctaPatterns[0] ?? 'Follow for more like this.'

    const prompt = buildLinkedInPostPrompt({
      topic:          input.topic,
      tone,
      targetAudience: input.targetAudience,
      hookStyle,
      ctaPattern,
      phrases,
      lineBreaks:     input.lineBreaks ?? true,
    })

    return {
      skillId:   'linkedin-post',
      requestId: context.requestId,
      input,
      prompt,
      personalizationSnapshot: p.toSnapshot(),
      topic:        input.topic,
      tone,
      artifactType: 'report',
      planMetadata: {
        hookStyleApplied:   hookStyle,
        ctaPatternApplied:  ctaPattern,
        tonePatternApplied: tonePatterns[0],
        phraseCount:        phrases.length,
      },
      builtAt: new Date().toISOString(),
    }
  }

  // ── PHASE 3: execute ───────────────────────────────────────────────────────

  async execute(
    plan: ISkillExecutionPlan<LinkedInPostInput>,
    context: ISkillExecutionContext,
    callLLM: (prompt: string) => Promise<string>,
  ): Promise<ISkillExecutionResult<ReportArtifact>> {
    const execStart = Date.now()

    const rawLLMOutput = await callLLM(plan.prompt)

    // Compile via injected compile callback — same pattern as carousel-founder.
    // Caller injects compileReport via context.metadata['compileReport'].
    const compileRaw = context.metadata['compileReport'] as CompileReportFn | undefined

    if (!compileRaw) {
      throw new Error(
        '[LinkedInPostLifecycle] context.metadata.compileReport not provided. ' +
        'The caller must inject the OCL report compiler via context.metadata.',
      )
    }

    const compileStart    = Date.now()
    const artifact        = compileRaw(rawLLMOutput, plan.topic, plan.tone)
    const compileDurationMs = Date.now() - compileStart

    return {
      artifact,
      rawLLMOutput,
      durationMs: Date.now() - execStart,
      compileDurationMs,
    }
  }

  // ── PHASE 4: repair ────────────────────────────────────────────────────────

  async repair(
    artifact: ReportArtifact,
    governanceResult: IGovernanceResult<ReportArtifact>,
    context: ISkillExecutionContext,
    callLLM: (prompt: string) => Promise<string>,
  ): Promise<ISkillRepairResult<ReportArtifact>> {
    const repairStart = Date.now()

    const violations       = governanceResult.violations ?? []
    const primaryViolation = String(violations[0] ?? 'post lacks compelling hook or CTA')
    const topic            = String(context.metadata['topic'] ?? artifact.title ?? 'this topic')
    const originalContent  = artifact.sections[0]?.body ?? ''

    const repairPrompt = buildPostRepairPrompt(topic, primaryViolation, originalContent)
    const repairOutput = await callLLM(repairPrompt)

    const compileRaw = context.metadata['compileReport'] as CompileReportFn | undefined

    if (!compileRaw) {
      throw new Error('[LinkedInPostLifecycle] compileReport not in context.metadata')
    }

    const repairedArtifact = compileRaw(repairOutput, topic)

    return {
      artifact:         repairedArtifact,
      repairPromptUsed: repairPrompt,
      durationMs:       Date.now() - repairStart,
      attemptNumber:    1,
    }
  }

  // ── PHASE 5: finalize ──────────────────────────────────────────────────────

  async finalize(
    artifact: ReportArtifact,
    context: ISkillExecutionContext,
  ): Promise<ReportArtifact> {
    const snap = context.personalization.toSnapshot()
    return {
      ...artifact,
      metadata: {
        ...artifact.metadata,
        skill_id:                        'linkedin-post',
        skill_version:                   '1.0.0',
        bundle_id:                       context.bundleId,
        personalization_dimension_count: snap.dimensionCount,
        workspace_id:                    context.workspaceId,
        persona_id:                      context.personaId,
        finalized_at:                    new Date().toISOString(),
      },
    }
  }
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

interface PostPromptParams {
  topic:           string
  tone:            string
  targetAudience?: string
  hookStyle:       string
  ctaPattern:      string
  phrases:         string[]
  lineBreaks:      boolean
}

function buildLinkedInPostPrompt(p: PostPromptParams): string {
  const phraseSection = p.phrases.length > 0
    ? `\nNaturally weave in 1-2 of these brand phrases where they fit: ${p.phrases.slice(0, 4).join(', ')}.`
    : ''

  const audienceSection = p.targetAudience
    ? `\nWrite for: ${p.targetAudience}.`
    : ''

  const lineBreakInstruction = p.lineBreaks
    ? 'Use single-sentence lines with blank lines between for LinkedIn readability.'
    : 'Write in standard paragraphs.'

  return `You are a ghostwriter producing a LinkedIn post for a B2B SaaS founder.

TOPIC: ${p.topic}

TONE: ${p.tone}${audienceSection}

STRUCTURE RULES:
1. HOOK (line 1): Use a ${p.hookStyle} hook. Make it impossible to scroll past. Do not start with "I".
2. BODY (lines 2-12): Deliver concrete value - insights, frameworks, or counterintuitive truths. Be specific.
3. CTA (final line): End with: "${p.ctaPattern}"
${lineBreakInstruction}${phraseSection}

CONSTRAINTS:
- 150-400 words
- No hashtags in the body (add 2-3 at the end if relevant)
- No "I'm excited to share" or corporate filler
- Every sentence must earn its place

Write only the post. No title. No explanation. No preamble.`
}

function buildPostRepairPrompt(
  topic: string,
  violation: string,
  originalContent?: string,
): string {
  const originalSection = originalContent
    ? `\nOriginal post (for reference):\n---\n${originalContent.slice(0, 600)}\n---\n`
    : ''

  return `The following LinkedIn post failed governance validation.

TOPIC: ${topic}
VIOLATION: ${violation}${originalSection}

Rewrite the post to fix the violation. Rules:
- Compelling hook on line 1 (do not start with "I")
- Concrete, specific body
- Clear CTA on the final line
- 150-400 words
- No corporate filler

Write only the improved post. No explanation.`
}


