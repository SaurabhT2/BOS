/**
 * @brandos/iskill-runtime — skills/carousel-founder.ts
 *
 * CarouselFounderSkill — the FIRST concrete ISkill implementation.
 *
 * This is the Week 1–4 deliverable from the architecture direction:
 * "Build CarouselFounderSkill (first concrete ISkill). Wire through
 * ArtifactEngine. This is the prerequisite for everything else."
 *
 * IDENTITY DIMENSIONS CONSUMED:
 *   - hookStyle       — how the hook slide opens
 *   - ctaPatterns     — CTA framing for the final slide
 *   - tonePatterns    — voice and tone throughout
 *   - phraseLibrary   — brand-specific phrases to weave in
 *
 * LIFECYCLE:
 *   validate()  → checks topic is present and valid
 *   prepare()   → builds personalized prompt from identity projections
 *   execute()   → calls LLM, returns (artifact via callLLM + compile contract)
 *   repair()    → carousel-specific repair with governance violation context
 *   finalize()  → adds generation trace metadata
 *
 * NOTE: This skill does NOT own compilation. It returns the raw LLM string
 * and declares artifactType: 'carousel'. The runtime passes it to the
 * ArtifactEngine compiler via the governance bridge.
 *
 * COMPILATION CONTRACT:
 *   The runtime calls IGovernanceCaller.govern(artifact, ...) which expects
 *   a pre-compiled ArtifactV2. Skills must compile their own output.
 *   For carousel, this means: callLLM → compileCarouselArtifact → return.
 *
 *   The compile call is injected via a compileRaw callback in the execution
 *   context metadata. This keeps the skill decoupled from OCL internals.
 */

import type { CarouselArtifact, IGovernanceResult, SkillResult } from '@brandos/contracts'
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
import { globalRepairRegistry } from '../repair/repair-registry'
import { CAROUSEL_STRUCTURAL_CONSTRAINTS } from '@brandos/governance-config';

// ─── Input / Output types ─────────────────────────────────────────────────────

export interface CarouselFounderInput {
  topic: string
  tone?: string
  targetAudience?: string
  slideCount?: number
  ctaOverride?: string
}

// ─── ISkill implementation (for registry compatibility) ───────────────────────

export const CarouselFounderSkillDef = {
  metadata: {
    id: 'carousel-founder',
    name: 'Carousel Founder Skill',
    version: '1.0.0',
    category: 'generate' as const,
    description: 'Generates governed LinkedIn carousels with founder-voice personalization',
    inputType: 'CarouselFounderInput',
    outputType: 'CarouselArtifact',
    requiredCapabilities: [],
    permissions: [],
  },
  execute: async (input: CarouselFounderInput, context: import('@brandos/contracts').SkillContext) => {
    // This path is for legacy SkillContext compatibility only.
    // Prefer SkillRuntime.executeSkill() for the full lifecycle.
    return {
      success: false,
      skillId: 'carousel-founder',
      durationMs: 0,
      error: 'CarouselFounderSkill must be executed through ISkillRuntime.executeSkill()',
    }
  },
  validate: (input: CarouselFounderInput) => {
    return typeof input?.topic === 'string' && input.topic.trim().length > 0
  },
}

// ─── Lifecycle implementation ─────────────────────────────────────────────────

export class CarouselFounderLifecycle implements ISkillLifecycle<CarouselFounderInput, CarouselArtifact> {
  readonly artifactContract: ISkillArtifactContract<CarouselArtifact> = {
    artifactType: 'carousel',
    supportedFormats: ['pptx', 'pdf', 'json'],
    governanceDefaults: {
      minRichnessScore: 0.6,
      minSlides: CAROUSEL_STRUCTURAL_CONSTRAINTS.minSlides,
      maxSlides: CAROUSEL_STRUCTURAL_CONSTRAINTS.maxSlides,
    },
  }

  readonly repairContract: ISkillRepairContract = {
    maxAttempts: 2,
    buildRepairPrompt: (artifactType, violationReason, topic) =>
      globalRepairRegistry.resolve(artifactType, violationReason, topic),
    repairStrategy: 'compiler-only',
  }

  readonly consumedDimensions: IdentityDimension[] = [
    'hookStyle',
    'ctaPatterns',
    'tonePatterns',
    'phraseLibrary',
  ]

  // ── PHASE 1: validate ──────────────────────────────────────────────────────

  validate(input: CarouselFounderInput): ISkillValidationResult {
    const errors = []

    if (!input?.topic || typeof input.topic !== 'string') {
      errors.push({ field: 'topic', message: 'topic is required and must be a string', code: 'REQUIRED' })
    } else if (input.topic.trim().length < 5) {
      errors.push({ field: 'topic', message: 'topic must be at least 5 characters', code: 'TOO_SHORT' })
    } else if (input.topic.length > 500) {
      errors.push({ field: 'topic', message: 'topic must be under 500 characters', code: 'TOO_LONG' })
    }

    if (input?.slideCount !== undefined && (input.slideCount < 3 || input.slideCount > 15)) {
      errors.push({ field: 'slideCount', message: 'slideCount must be between 3 and 15', code: 'OUT_OF_RANGE' })
    }

    return { valid: errors.length === 0, errors }
  }

  // ── PHASE 2: prepare ───────────────────────────────────────────────────────

  async prepare(
    input: CarouselFounderInput,
    context: ISkillExecutionContext,
  ): Promise<ISkillExecutionPlan<CarouselFounderInput>> {
    const p = context.personalization
    const hookStyles = p.getProjection('hookStyle')
    const ctaPatterns = p.getProjection('ctaPatterns')
    const tonePatterns = p.getProjection('tonePatterns')
    const phrases = p.getProjection('phraseLibrary')

    const slideCount = input.slideCount ?? 7
    const tone = input.tone ?? (tonePatterns[0] ?? 'professional and direct')

    const prompt = buildCarouselPrompt({
      topic: input.topic,
      tone,
      targetAudience: input.targetAudience,
      slideCount,
      hookStyle: hookStyles[0],
      ctaPattern: input.ctaOverride ?? ctaPatterns[0],
      phrases,
    })

    return {
      skillId: 'carousel-founder',
      requestId: context.requestId,
      input,
      prompt,
      personalizationSnapshot: p.toSnapshot(),
      topic: input.topic,
      tone,
      artifactType: 'carousel',
      planMetadata: {
        hookStyleApplied: hookStyles[0],
        ctaPatternApplied: input.ctaOverride ?? ctaPatterns[0],
        tonePatternApplied: tonePatterns[0],
        phraseCount: phrases.length,
        slideCount,
      },
      builtAt: new Date().toISOString(),
    }
  }

  // ── PHASE 3: execute ───────────────────────────────────────────────────────

  async execute(
    plan: ISkillExecutionPlan<CarouselFounderInput>,
    context: ISkillExecutionContext,
    callLLM: (prompt: string) => Promise<string>,
  ): Promise<ISkillExecutionResult<CarouselArtifact>> {
    const execStart = Date.now()

    // Call LLM
    const rawOutput = await callLLM(plan.prompt)

    // Compile via injected compile callback
    // Callers inject compileCarousel via context.metadata.compileCarousel
    const compileRaw = context.metadata['compileCarousel'] as
      | ((raw: string, topic: string, tone?: string) => CarouselArtifact)
      | undefined

    if (!compileRaw) {
      throw new Error(
        '[CarouselFounderLifecycle] context.metadata.compileCarousel not provided. ' +
        'The caller must inject the OCL compiler via context.metadata.',
      )
    }

    const compileStart = Date.now()
    const artifact = compileRaw(rawOutput, plan.topic, plan.tone)
    const compileDurationMs = Date.now() - compileStart

    return {
      artifact,
      rawLLMOutput: rawOutput,
      durationMs: Date.now() - execStart,
      compileDurationMs,
    }
  }

  // ── PHASE 4: repair ────────────────────────────────────────────────────────

  async repair(
    artifact: CarouselArtifact,
    governanceResult: IGovernanceResult<CarouselArtifact>,
    context: ISkillExecutionContext,
    callLLM: (prompt: string) => Promise<string>,
  ): Promise<ISkillRepairResult<CarouselArtifact>> {
    const repairStart = Date.now()

    const violations = governanceResult.violations ?? []
    const primaryViolation = violations[0] ?? 'insufficient content richness'
    const topic = context.metadata['topic'] as string | undefined ?? 'the requested topic'

    const repairPrompt = this.repairContract.buildRepairPrompt('carousel', primaryViolation, topic)
    const repairOutput = await callLLM(repairPrompt)

    const compileRaw = context.metadata['compileCarousel'] as
      | ((raw: string, topic: string, tone?: string) => CarouselArtifact)
      | undefined

    if (!compileRaw) {
      throw new Error('[CarouselFounderLifecycle] compileCarousel not in context.metadata')
    }

    const repairedArtifact = compileRaw(repairOutput, topic)

    return {
      artifact: repairedArtifact,
      repairPromptUsed: repairPrompt,
      durationMs: Date.now() - repairStart,
      attemptNumber: 1,
    }
  }

  // ── PHASE 5: finalize ──────────────────────────────────────────────────────

  async finalize(
    artifact: CarouselArtifact,
    context: ISkillExecutionContext,
  ): Promise<CarouselArtifact> {
    // Enrich generation trace with skill + personalization metadata
    const snap = context.personalization.toSnapshot()
    return {
      ...artifact,
      metadata: {
        ...artifact.metadata,
        skill_id: 'carousel-founder',
        skill_version: '1.0.0',
        bundle_id: context.bundleId,
        personalization_dimension_count: snap.dimensionCount,
        workspace_id: context.workspaceId,
        persona_id: context.personaId,
        finalized_at: new Date().toISOString(),
      },
    }
  }
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

interface CarouselPromptParams {
  topic: string
  tone: string
  targetAudience?: string
  slideCount: number
  hookStyle?: string
  ctaPattern?: string
  phrases: string[]
}

function buildCarouselPrompt(params: CarouselPromptParams): string {
  const {
    topic, tone, targetAudience, slideCount,
    hookStyle, ctaPattern, phrases,
  } = params

  const audienceContext = targetAudience
    ? `Target audience: ${targetAudience}`
    : 'Target audience: B2B founders, operators, and GTM leaders on LinkedIn'

  const hookGuidance = hookStyle
    ? `Hook style: ${hookStyle}`
    : 'Hook style: provocative statement or counterintuitive insight'

  const ctaGuidance = ctaPattern
    ? `CTA pattern: ${ctaPattern}`
    : 'CTA pattern: direct next step or question that drives engagement'

  const phraseGuidance = phrases.length > 0
    ? `Weave in these brand phrases naturally: ${phrases.join(', ')}`
    : ''

  return `
You are creating a LinkedIn carousel for a B2B founder.

Topic: ${topic}
${audienceContext}
Tone: ${tone}
${hookGuidance}
${ctaGuidance}
${phraseGuidance}

Create a ${slideCount}-slide LinkedIn carousel with this structure:
1. Hook slide — ${hookStyle ?? 'bold counterintuitive statement that stops the scroll'}
2-${slideCount - 2}. Value slides — concrete insights, frameworks, or data points (2-3 bullets each)
${slideCount - 1}. Evidence slide — specific stats, case examples, or proof points
${slideCount}. CTA slide — ${ctaPattern ?? 'clear single action for the reader'}

Requirements for each slide:
- headline: compelling, under 10 words
- body: 2-3 punchy bullet points with concrete insight (no fluff)
- Optional: stat with value + label, or visual_direction hint

Return ONLY a valid JSON object in this exact structure:
{
  "slides": [
    {
      "role": "hook|value|evidence|cta",
      "headline": "...",
      "body": "...",
      "bullets": ["...", "..."],
      "stat": { "value": "...", "label": "..." },
      "visual_direction": "..."
    }
  ],
  "topic": "${topic}",
  "tone": "${tone}"
}
`.trim()
}


