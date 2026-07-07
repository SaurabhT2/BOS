/**
 * @brandos/iskill-runtime — lifecycle/executor.ts
 *
 * SkillLifecycleExecutor — orchestrates the canonical 6-phase lifecycle:
 *
 *   validate → prepare → execute → govern → repair* → finalize → export
 *
 * This is the runtime heart of @brandos/iskill-runtime.
 *
 * ARCHITECTURAL LAWS:
 *   1. validate() runs first. A validation failure throws immediately.
 *   2. prepare() is always called before execute(). Execution uses the plan.
 *   3. execute() produces a compiled artifact (not raw LLM string).
 *   4. Governance runs on the compiled artifact ONLY.
 *   5. repair() re-enters COMPILE via lifecycle.execute() before re-governance.
 *   6. MAX_REPAIR_ATTEMPTS caps the repair loop (default 2; overridable per skill/bundle).
 *   7. finalize() and export() run after governance passes.
 *   8. All phases are timed. Durations reported in ISkillRuntimeOutput.
 *
 * DEPENDENCY RULE:
 *   - Imports only from @brandos/contracts and ../contracts.
 *   - No artifact-engine-layer internals.
 *   - No control-plane internals.
 *   - callLLM is injected by the caller — no provider logic here.
 *   - govern() is injected by the caller — no governance implementation here.
 */

import type { ArtifactV2, IGovernanceResult, SkillResult } from '@brandos/contracts'
import type {
  ISkillLifecycle,
  ISkillExecutionContext,
  ISkillRuntimeOutput,
  ILifecycleDurations,
  ISkillRuntimeError,
  SkillRuntimeErrorCode,
  ISkillExecutionPlan,
} from '../contracts'
import type { ISkillRuntimeEntry } from '../contracts'

const DEFAULT_MAX_REPAIR_ATTEMPTS = 2

// ─── Governance caller interface ──────────────────────────────────────────────

/**
 * IGovernanceCaller — injected by SkillRuntime.
 *
 * The lifecycle executor does not own governance. It calls this interface.
 * The runtime wires it to ArtifactEngine.govern() via the governance bridge.
 */
export interface IGovernanceCaller {
  govern<TArtifact extends ArtifactV2>(
    artifact: TArtifact,
    context: ISkillExecutionContext,
    callLLM?: (prompt: string) => Promise<string>,
  ): Promise<IGovernanceResult<TArtifact>>
}

// ─── Executor ─────────────────────────────────────────────────────────────────

export class SkillLifecycleExecutor {
  constructor(private readonly governanceCaller: IGovernanceCaller) {}

  async execute<TInput = unknown, TOutput extends ArtifactV2 = ArtifactV2>(
    entry: ISkillRuntimeEntry,
    input: TInput,
    context: ISkillExecutionContext,
    callLLM: (prompt: string) => Promise<string>,
  ): Promise<ISkillRuntimeOutput<TOutput>> {
    const lifecycle = entry.lifecycle as unknown as ISkillLifecycle<TInput, TOutput>
    const durations: ILifecycleDurations = {
      validateMs: 0,
      prepareMs: 0,
      executeMs: 0,
      governMs: 0,
      repairMs: 0,
      finalizeMs: 0,
      exportMs: 0,
    }
    const startTotal = Date.now()

    const maxRepairs =
      context.governanceOverrides?.repairAttempts ??
      lifecycle.repairContract?.maxAttempts ??
      DEFAULT_MAX_REPAIR_ATTEMPTS

    // ── PHASE 1: validate ────────────────────────────────────────────────────
    const validateStart = Date.now()
    let validationResult
    try {
      validationResult = lifecycle.validate(input)
    } catch (err) {
      return this.error(
        entry.metadata.id,
        context.requestId,
        'validate',
        'VALIDATION_FAILED',
        err,
        durations,
        startTotal,
        context.personalization.toSnapshot(),
      )
    }
    durations.validateMs = Date.now() - validateStart

    if (!validationResult.valid) {
      return {
        success: false,
        skillId: entry.metadata.id,
        requestId: context.requestId,
        repaired: false,
        repairAttempts: 0,
        totalDurationMs: Date.now() - startTotal,
        lifecycleDurations: durations,
        personalizationSnapshot: context.personalization.toSnapshot(),
        error: {
          code: 'VALIDATION_FAILED',
          message: validationResult.errors.map(e => e.message).join('; '),
          phase: 'validate',
          recoverable: false,
          details: { errors: validationResult.errors },
        },
      }
    }

    // ── PHASE 2: prepare ─────────────────────────────────────────────────────
    const prepareStart = Date.now()
    let plan: ISkillExecutionPlan<TInput>
    try {
      plan = await lifecycle.prepare(input, context)
    } catch (err) {
      return this.error(
        entry.metadata.id,
        context.requestId,
        'prepare',
        'PREPARE_FAILED',
        err,
        durations,
        startTotal,
        context.personalization.toSnapshot(),
      )
    }
    durations.prepareMs = Date.now() - prepareStart

    // ── PHASE 3: execute ─────────────────────────────────────────────────────
    const executeStart = Date.now()
    let executionResult
    try {
      executionResult = await lifecycle.execute(plan, context, callLLM)
    } catch (err) {
      return this.error(
        entry.metadata.id,
        context.requestId,
        'execute',
        'EXECUTION_FAILED',
        err,
        durations,
        startTotal,
        context.personalization.toSnapshot(),
      )
    }
    durations.executeMs = Date.now() - executeStart

    let artifact = executionResult.artifact
    let repaired = false
    let repairAttempts = 0

    // ── PHASE 4: govern + repair loop ────────────────────────────────────────
    const governStart = Date.now()
    let governanceResult: IGovernanceResult<TOutput>

    try {
      governanceResult = await this.governanceCaller.govern(artifact, context, callLLM)
    } catch (err) {
      return this.error(
        entry.metadata.id,
        context.requestId,
        'govern',
        'GOVERNANCE_FAILED',
        err,
        durations,
        startTotal,
        context.personalization.toSnapshot(),
      )
    }
    durations.governMs = Date.now() - governStart

    // ── PHASE 4a: repair loop ────────────────────────────────────────────────
    if (!governanceResult.passed && lifecycle.repair) {
      const repairStart = Date.now()

      while (!governanceResult.passed && repairAttempts < maxRepairs) {
        repairAttempts++

        try {
          const repairResult = await lifecycle.repair(
            artifact,
            governanceResult,
            context,
            callLLM,
          )
          artifact = repairResult.artifact
          repaired = true
        } catch (err) {
          // Repair itself failed — break the loop, report governance failure
          console.error(
            `[SkillLifecycleExecutor] Repair attempt ${repairAttempts} threw: ${err}`,
          )
          break
        }

        // Re-govern after repair (ARCHITECTURAL LAW: compile before govern)
        try {
          governanceResult = await this.governanceCaller.govern(artifact, context, callLLM)
        } catch (err) {
          console.error(`[SkillLifecycleExecutor] Re-governance after repair threw: ${err}`)
          break
        }
      }

      durations.repairMs = Date.now() - repairStart

      if (!governanceResult.passed) {
        return {
          success: false,
          skillId: entry.metadata.id,
          requestId: context.requestId,
          artifact,
          governanceResult,
          repaired,
          repairAttempts,
          totalDurationMs: Date.now() - startTotal,
          lifecycleDurations: durations,
          personalizationSnapshot: context.personalization.toSnapshot(),
          error: {
            code: 'REPAIR_EXHAUSTED',
            message: `Governance failed after ${repairAttempts} repair attempt(s): ${governanceResult.violations?.join(', ')}`,
            phase: 'repair',
            recoverable: false,
            details: { violations: governanceResult.violations },
          },
        }
      }
    } else if (!governanceResult.passed) {
      // No repair contract — governance failure is terminal
      return {
        success: false,
        skillId: entry.metadata.id,
        requestId: context.requestId,
        artifact,
        governanceResult,
        repaired: false,
        repairAttempts: 0,
        totalDurationMs: Date.now() - startTotal,
        lifecycleDurations: durations,
        personalizationSnapshot: context.personalization.toSnapshot(),
        error: {
          code: 'GOVERNANCE_FAILED',
          message: `Governance failed (no repair contract): ${governanceResult.violations?.join(', ')}`,
          phase: 'govern',
          recoverable: false,
          details: { violations: governanceResult.violations },
        },
      }
    }

    // ── PHASE 5: finalize ────────────────────────────────────────────────────
    if (lifecycle.finalize) {
      const finalizeStart = Date.now()
      try {
        artifact = await lifecycle.finalize(artifact, context)
      } catch (err) {
        return this.error(
          entry.metadata.id,
          context.requestId,
          'finalize',
          'FINALIZE_FAILED',
          err,
          durations,
          startTotal,
          context.personalization.toSnapshot(),
        )
      }
      durations.finalizeMs = Date.now() - finalizeStart
    }

    // ── PHASE 6: export ──────────────────────────────────────────────────────
    let exportResult: SkillResult<TOutput> | undefined
    if (lifecycle.export) {
      const exportStart = Date.now()
      try {
        exportResult = await lifecycle.export(artifact, context)
      } catch (err) {
        return this.error(
          entry.metadata.id,
          context.requestId,
          'export',
          'EXPORT_FAILED',
          err,
          durations,
          startTotal,
          context.personalization.toSnapshot(),
        )
      }
      durations.exportMs = Date.now() - exportStart
    }

    return {
      success: true,
      skillId: entry.metadata.id,
      requestId: context.requestId,
      artifact: exportResult?.output ?? artifact,
      governanceResult,
      repaired,
      repairAttempts,
      totalDurationMs: Date.now() - startTotal,
      lifecycleDurations: durations,
      personalizationSnapshot: context.personalization.toSnapshot(),
    }
  }

  // ─── Error helper ─────────────────────────────────────────────────────────

  private error<TOut extends ArtifactV2 = ArtifactV2>(
    skillId: string,
    requestId: string,
    phase: ISkillRuntimeError['phase'],
    code: SkillRuntimeErrorCode,
    err: unknown,
    durations: ILifecycleDurations,
    startTotal: number,
    personalizationSnapshot: ReturnType<ISkillExecutionContext['personalization']['toSnapshot']>,
  ): ISkillRuntimeOutput<TOut> {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[SkillLifecycleExecutor][${skillId}] ${phase} failed: ${message}`)
    return {
      success: false,
      skillId,
      requestId,
      repaired: false,
      repairAttempts: 0,
      totalDurationMs: Date.now() - startTotal,
      lifecycleDurations: durations,
      personalizationSnapshot,
      error: {
        code,
        message,
        phase,
        recoverable: phase === 'govern' || phase === 'repair',
      },
    }
  }
}


