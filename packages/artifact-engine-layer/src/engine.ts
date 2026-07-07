/**
 * @brandos/artifact-engine-layer — engine.ts
 *
 * ArtifactEngine — the canonical horizontal orchestration runtime.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  FOR AGENTS: This file is the core orchestration implementation.        │
 * │  It is DANGEROUS to modify without cross-layer review.                  │
 * │  See AGENT_CONTEXT.md §9 (Safe vs. Dangerous Modification Zones).       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ADDING A NEW ARTIFACT TYPE:
 *   Do NOT touch this file. New artifact types are added via:
 *     1. src/compiler/<type>.ts    → ICompiler<NewArtifact>
 *     2. src/governance/<type>.ts  → IGovernanceAdapter<NewArtifact>
 *     3. src/bootstrap.ts          → registerNewArtifactType() + registerTaskPrompt()
 *
 * ARCHITECTURAL LAWS ENFORCED HERE:
 *
 *   LAW 1 — OCL-first:
 *     assertCompiledArtifact() runs at POST-COMPILE, PRE-GOVERNANCE,
 *     and POST-REPAIR-COMPILE. Governance never sees a raw LLM string.
 *
 *   LAW 2 — Repair re-enters OCL:
 *     The recompile callback injected into IGovernanceAdapter.repair()
 *     calls this.registry.resolveCompiler() + compile() before re-validation.
 *     After recompile, assertCompiledArtifact() is called again (POST-REPAIR-COMPILE).
 *
 *   LAW 3 — No artifact-type branching:
 *     No `if (artifactType === 'carousel')` anywhere in this file.
 *     All artifact-type-specific logic lives exclusively in adapters.
 *
 *   LAW 4 — LLM is injected:
 *     This file never imports or calls any LLM SDK. repairLLM is provided by caller.
 *
 *   LAW 5 — MAX_REPAIR_ATTEMPTS = 3:
 *     Raised from 2 → 3 to match raised governance thresholds (quality initiative).
 *     Further increases require explicit cost/latency analysis.
 *
 *   LAW 6 — compileAndExport() runs governance (Wave 2):
 *     compileAndExport() now calls compileAndGovern() internally, then export().
 *     The pre-Wave-2 "no governance" shortcut is closed. Use compileAndGovern()
 *     + export() separately only when the caller has a specific reason to skip
 *     governance (e.g., internal migration tooling — must be documented at call site).
 *
 * OWNED CAPABILITIES:
 *   artifact.compile    — compile raw LLM output to ArtifactV2
 *   artifact.govern     — semantic validation + repair loop
 *   artifact.export     — format-specific serialization
 *   artifact.render     — server-side rendering (adapter pattern)
 *   artifact.taskprompt — task system prompt registration (bootstrap.ts, not here)
 */

import { v4 as uuidv4 } from 'uuid'
import type {
  ArtifactV2,
  ArtifactType,
  IGovernanceResult,
  ExportFormat,
  ExportResult,
  CompileResult,
  CompileOptions,
  ExportOptions,
  DraftArtifactInput,
  IGovernanceFeedback,
} from '@brandos/contracts'

import { buildGovernanceFeedbackFromEvaluation } from '@brandos/contracts'

import type {
  IArtifactEngine,
  IArtifactRegistry,
  IArtifactExecutionContext,
} from './interfaces'

import { ArtifactEngineRejection } from './interfaces'

// ─── Compile-before-governance guard ──────────────────────────────────────────

function assertCompiledArtifact(
  artifact: unknown,
  requestId: string,
  stage: string
): asserts artifact is ArtifactV2 {
  if (!artifact || typeof artifact !== 'object') {
    throw new Error(
      `[ArtifactEngine][${requestId}] ${stage} GUARD VIOLATION: ` +
      `received non-object (type: ${typeof artifact}). ` +
      `OCL must compile before governance.`
    )
  }
  const a = artifact as Record<string, unknown>
  if (a.$schema !== 'artifact-json@2.0') {
    throw new Error(
      `[ArtifactEngine][${requestId}] ${stage} GUARD VIOLATION: ` +
      `artifact.$schema="${String(a.$schema)}" (expected "artifact-json@2.0"). ` +
      `This means governance received a raw LLM output without OCL compilation. ` +
      `Check the ICompiler implementation for artifactType="${String(a.artifact_type)}". ` +
      `Present keys: [${Object.keys(a).join(', ')}]`
    )
  }
}

// ─── Repair attempt cap ────────────────────────────────────────────────────────

const MAX_REPAIR_ATTEMPTS = 3

// ─── Governance feedback builder ───────────────────────────────────────────────
//
// Translates an IGovernanceResult (which carries string[] violations) into the
// structured IGovernanceFeedback that the Prompt Compiler can consume.
// This is the boundary where raw governance output becomes actionable feedback.

function buildGovernanceFeedbackFromValidation(
  govResult: IGovernanceResult<ArtifactV2>,
  passed: boolean
): IGovernanceFeedback {
  const violations = govResult.violations ?? []
  const recommendations: string[] = []

  // Extract validationOutcome detail if present
  if (govResult.validationOutcome && !govResult.validationOutcome.valid) {
    const outcome = govResult.validationOutcome as { valid: false; reason: string; details: string[]; slideCount: number }
    if (outcome.details?.length) {
      recommendations.push(...outcome.details)
    }
  }

  // Derive a numeric score from the result — IGovernanceResult doesn't carry
  // a numeric score but the richness_metrics field does on the artifact itself.
  // We use 100 for pass, 40 as failure baseline (real score is in the artifact).
  const score = passed ? 100 : 40

  return buildGovernanceFeedbackFromEvaluation({
    passed,
    score,
    violations,
    recommendations,
  })
}

// ─── Governance outcome stamping ──────────────────────────────────────────────
//
// Previously governance_outcome was set to 'bypassed' at compile time and never
// updated on a clean governance pass — only on repair paths. This helper stamps
// the correct outcome on the artifact so the field is always accurate.
//
function applyGovernanceOutcome(
  artifact: ArtifactV2,
  outcome: 'passed' | 'passed_after_repair'
): ArtifactV2 {
  if (!artifact.generation_trace) return artifact
  return {
    ...artifact,
    generation_trace: {
      ...artifact.generation_trace,
      governance_outcome: outcome,
    },
  }
}

// ─── ArtifactEngine ───────────────────────────────────────────────────────────

export class ArtifactEngine implements IArtifactEngine {
  constructor(public readonly registry: IArtifactRegistry) {}

  // ── compile ────────────────────────────────────────────────────────────────

  async compile(
    artifactType: ArtifactType,
    input: string | DraftArtifactInput | object,
    options?: CompileOptions & { requestId?: string; topic?: string; tone?: string }
  ): Promise<CompileResult> {
    const requestId = options?.requestId ?? uuidv4()
    const compiler = this.registry.resolveCompiler(artifactType)
    const result = compiler.compile(input, { ...options, requestId })
    assertCompiledArtifact(result.artifact, requestId, 'POST-COMPILE')
    return result
  }

  // ── govern ─────────────────────────────────────────────────────────────────

  async govern(
    artifact: ArtifactV2,
    context: IArtifactExecutionContext,
    repairLLM?: (prompt: string) => Promise<string>
  ): Promise<IGovernanceResult<ArtifactV2>> {
    assertCompiledArtifact(artifact, context.requestId, 'PRE-GOVERNANCE')

    const govAdapter = this.registry.resolveGovernance(artifact.artifact_type)

    if (!govAdapter) {
      console.warn(
        `[ArtifactEngine][${context.requestId.slice(0, 8)}] No governance adapter registered for ` +
        `artifactType="${artifact.artifact_type}" — bypassing governance. ` +
        `Register an IGovernanceAdapter via registry.registerGovernance() to enforce semantic rules.`
      )
      return {
        success:  true,
        artifact,
        repaired: false,
        attempts: 0,
        passed:   true,
      }
    }

    let govResult = await govAdapter.validate(artifact)

    if (govResult.success) {
      // Stamp governance_outcome on the artifact — previously this stayed 'bypassed'
      // because the engine never wrote back the outcome on a clean pass.
      const passedArtifact = applyGovernanceOutcome(govResult.artifact ?? artifact, 'passed')
      // Attach structured feedback so the pipeline can accumulate attempt history
      const feedback = buildGovernanceFeedbackFromValidation(govResult, true)
      return { ...govResult, artifact: passedArtifact, governanceFeedback: feedback }
    }

    if (!repairLLM || !govAdapter.repair) {
      console.info(
        `[ArtifactEngine][${context.requestId.slice(0, 8)}] Governance failed for ` +
        `artifactType="${artifact.artifact_type}" — no repairLLM or repair() implemented. ` +
        `Violations: ${govResult.violations?.join('; ') ?? 'none reported'}`
      )
      const feedback = buildGovernanceFeedbackFromValidation(govResult, false)
      return { ...govResult, governanceFeedback: feedback }
    }

    let currentArtifact = artifact
    let attempts = 0

    while (attempts < MAX_REPAIR_ATTEMPTS && !govResult.success) {
      attempts++
      console.info(
        `[ArtifactEngine][${context.requestId.slice(0, 8)}] ` +
        `Governance repair attempt ${attempts}/${MAX_REPAIR_ATTEMPTS} for ` +
        `artifactType="${artifact.artifact_type}". ` +
        `Violations: ${govResult.violations?.join('; ') ?? 'unknown'}`
      )

      try {
        const repairResult = await govAdapter.repair(
          currentArtifact as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          currentArtifact.title,
          repairLLM,
          context.requestId,
          (rawRepairOutput: unknown, topic: string) => {
            const compiler = this.registry.resolveCompiler(artifact.artifact_type)
            const compiled = compiler.compile(rawRepairOutput as string | DraftArtifactInput | object, {
              topic,
              requestId: context.requestId,
            })
            assertCompiledArtifact(compiled.artifact, context.requestId, 'POST-REPAIR-COMPILE')
            return compiled.artifact as any // eslint-disable-line @typescript-eslint/no-explicit-any
          }
        )

        // Always re-validate after a repair attempt — even if repair reports
        // partial success — so governance has the full chance to pass.
        const repairedArtifact = (repairResult.artifact ?? currentArtifact) as ArtifactV2
        assertCompiledArtifact(repairedArtifact, context.requestId, 'POST-REPAIR-GOVERNANCE')
        govResult = await govAdapter.validate(repairedArtifact as any) // eslint-disable-line @typescript-eslint/no-explicit-any

        if (govResult.success) {
          console.info(
            `[ArtifactEngine][${context.requestId.slice(0, 8)}] Repair succeeded on attempt ${attempts}/${MAX_REPAIR_ATTEMPTS}`
          )
          const repairedStamped = applyGovernanceOutcome(repairedArtifact, 'passed_after_repair')
          const feedback = buildGovernanceFeedbackFromValidation(govResult, true)
          return {
            ...govResult,
            artifact: repairedStamped,
            repaired:  true,
            attempts,
            governanceFeedback: feedback,
          }
        }

        currentArtifact = repairedArtifact
      } catch (repairErr: unknown) {
        const msg = repairErr instanceof Error ? repairErr.message : String(repairErr)
        console.error(
          `[ArtifactEngine][${context.requestId.slice(0, 8)}] ` +
          `Repair attempt ${attempts}/${MAX_REPAIR_ATTEMPTS} threw an error: ${msg}`
        )
      }
    }

    console.warn(
      `[ArtifactEngine][${context.requestId.slice(0, 8)}] ` +
      `All ${attempts} repair attempt(s) exhausted for artifactType="${artifact.artifact_type}". ` +
      `Final rejection: ${govResult.finalRejection ?? 'unknown'}`
    )

    const finalFeedback = buildGovernanceFeedbackFromValidation(govResult, false)
    return {
      ...govResult,
      artifact:         currentArtifact,
      repaired:         attempts > 0,
      attempts,
      success:          false,
      finalRejection:   govResult.finalRejection ?? 'Artifact failed governance after all repair attempts',
      governanceFeedback: finalFeedback,
    }
  }

  // ── compileAndGovern ───────────────────────────────────────────────────────

  async compileAndGovern(
    artifactType: ArtifactType,
    input: string | DraftArtifactInput | object,
    context: IArtifactExecutionContext,
    options?: CompileOptions,
    repairLLM?: (prompt: string) => Promise<string>
  ): Promise<{ artifact: ArtifactV2; governanceResult: IGovernanceResult<ArtifactV2> }> {
    const compileResult = await this.compile(artifactType, input, {
      ...options,
      requestId: context.requestId,
    })

    const governanceResult = await this.govern(compileResult.artifact, context, repairLLM)

    if (!governanceResult.success) {
      // P3-RECOVERY: pass lastValidArtifact so callers can surface a degraded
      // result instead of showing nothing. governanceResult.artifact is the last
      // compiled artifact from the repair loop (may be the original if no repair ran).
      // It has NOT passed governance — callers must mark it as degraded.
      throw new ArtifactEngineRejection(
        artifactType,
        governanceResult.finalRejection ?? 'Governance failed without a finalRejection message',
        governanceResult.attempts,
        context.requestId,
        governanceResult.artifact, // lastValidArtifact
      )
    }

    return {
      artifact:         governanceResult.artifact,
      governanceResult,
    }
  }

  // ── export ─────────────────────────────────────────────────────────────────

  async export(artifact: ArtifactV2, options: ExportOptions): Promise<ExportResult> {
    const exporter = this.registry.resolveExporter(artifact.artifact_type, options.format)

    if (!exporter) {
      throw new Error(
        `[ArtifactEngine] No exporter registered for ` +
        `artifactType="${artifact.artifact_type}" format="${options.format}". ` +
        `Register an IExporter via registry.registerExporter(). ` +
        `Registered exporters cover: see registry.listArtifactTypes() for introspection.`
      )
    }

    return exporter.export(artifact, options)
  }

  // ── compileAndExport ───────────────────────────────────────────────────────

  /**
   * Compile, govern, and export in one call.
   *
   * WAVE 2 CHANGE (LAW 6):
   *   This method now runs governance between compile and export.
   *   The previous behavior (compile → export, skipping governance) was a documented
   *   design debt and is now closed. Callers that previously depended on
   *   governance-free export must:
   *     - Pass a no-op repairLLM if they want export without LLM repair, OR
   *     - Call compile() + export() directly (no governance, document the intent).
   *
   *   This is a BEHAVIORAL CHANGE. Route-level tests must be run after deployment.
   *
   * THROWS:
   *   - ArtifactEngineRejection: governance ultimately failed.
   *   - Error: no compiler/exporter registered, or $schema guard violation.
   *
   * @param repairLLM - Optional LLM callback for governance repair loop.
   *                    Pass undefined to disable repair (governance-only mode).
   */
  async compileAndExport(
    artifactType: ArtifactType,
    input: string | DraftArtifactInput | object,
    compileOptions: CompileOptions,
    exportOptions: ExportOptions,
    context: IArtifactExecutionContext,
    repairLLM?: (prompt: string) => Promise<string>
  ): Promise<{ compile: CompileResult; export: ExportResult; governanceResult: IGovernanceResult<ArtifactV2> }> {
    // Step 1 + 2: compile + govern (with repair loop). Throws ArtifactEngineRejection on failure.
    const { artifact, governanceResult } = await this.compileAndGovern(
      artifactType,
      input,
      context,
      compileOptions,
      repairLLM
    )

    // Step 3: export the governed artifact
    const exportResult = await this.export(artifact, exportOptions)

    // Return a richer result that includes governanceResult for caller telemetry
    return {
      compile: {
  artifact,
  durationMs: 0,
  inputType: typeof input === 'string'
    ? 'text'
    : typeof input === 'object'
      ? 'json'
      : 'unknown',
  slideCount:
    'slides' in artifact
      ? artifact.slides.length
      : 'sections' in artifact
        ? artifact.sections.length
        : 0
},
      export: exportResult,
      governanceResult,
    }
  }

  // ── remix ──────────────────────────────────────────────────────────────────

  /**
   * Remix an existing artifact with a natural language instruction.
   *
   * STATUS: NOT YET IMPLEMENTED.
   *
   * IMPLEMENTATION PLAN:
   *   1. Add `capabilities?: Record<string, unknown>` to SkillContext in @brandos/contracts.
   *   2. Wire the LLM callback into context.skillContext.capabilities['output.repair'].
   *   3. Implement the remix prompt: serialize artifact + instruction → LLM prompt.
   *   4. Call repairLLM via capabilities['output.repair'](prompt).
   *   5. Re-enter compile() with the LLM output.
   *   6. Run govern() on the recompiled artifact.
   *   7. Return the governed artifact.
   *
   * PREREQUISITE: ISkill production gate removal (Phase 2.6).
   *
   * @throws Error always (not yet implemented).
   */
  async remix(
    _artifact: ArtifactV2,
    _instruction: string,
    _context: IArtifactExecutionContext
  ): Promise<ArtifactV2> {
    throw new Error(
      `[ArtifactEngine] remix() is not yet implemented. ` +
      `Wire LLM callback via IArtifactExecutionContext.skillContext.capabilities['output.repair']. ` +
      `See TODO in engine.ts:remix() for the implementation plan.`
    )
  }

  // ── availableFormats ───────────────────────────────────────────────────────

  availableFormats(_artifactType?: ArtifactType): ExportFormat[] {
    // TODO: Replace with registry.listExporterFormats(artifactType) when implemented.
    const all: ExportFormat[] = ['json', 'html', 'pptx', 'pdf', 'png', 'canva', 'figma']
    return all
  }
}


