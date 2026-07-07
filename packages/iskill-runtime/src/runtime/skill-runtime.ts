/**
 * @brandos/iskill-runtime — runtime/skill-runtime.ts
 *
 * SkillRuntime — production implementation of ISkillRuntime.
 *
 * This is the canonical entry point for all skill execution in BrandOS.
 * It wires together:
 *   - SkillRegistry        (skill registration + discovery)
 *   - BundleRegistry       (ICP bundle registration + capability resolution)
 *   - ExecutionContextBuilder (ISkillExecutionContext assembly)
 *   - SkillLifecycleExecutor  (6-phase governed lifecycle)
 *   - IGovernanceCaller bridge (injected by caller — keeps engine decoupled)
 *
 * INTEGRATION PATTERN (for control-plane → iskill-runtime):
 *
 *   // 1. Build personalization from brand memory
 *   const personalization = buildPersonalizationContext(workspaceId, entries, personaId)
 *
 *   // 2. Build execution context
 *   const context = await runtime.buildExecutionContext({
 *     requestId, userId, workspaceId, runtimeMode, personalization, bundleId
 *   })
 *
 *   // 3. Execute skill
 *   const output = await runtime.executeSkill('carousel-founder', input, context)
 *
 *   // 4. Use output.artifact — governed, compiled, personalized
 *
 * DEPENDENCY RULE: No control-plane internals. No artifact-engine internals.
 * The governance bridge is injected — this file does not import from artifact-engine-layer.
 */

import type { ISkill, ArtifactV2, IGovernanceResult } from '@brandos/contracts'
import type {
  ISkillRuntime,
  ISkillLifecycle,
  ISkillExecutionContext,
  ISkillRuntimeOutput,
  ISkillRepairResult,
  IExecutionContextParams,
  IBundleDefinition,
  IBundleCapabilities,
  ISkillRuntimeEntry,
  ISkillRuntimeMetadata,
} from '../contracts'
import { SkillRegistry } from '../registry/skill-registry'
import { BundleRegistry } from '../registry/bundle-registry'
import { ExecutionContextBuilder } from '../execution/context-builder'
import { SkillLifecycleExecutor, type IGovernanceCaller } from '../lifecycle/executor'

// ─── SkillRuntime ─────────────────────────────────────────────────────────────

export class SkillRuntime implements ISkillRuntime {
  private readonly skillRegistry: SkillRegistry
  private readonly bundleRegistry: BundleRegistry
  private readonly contextBuilder: ExecutionContextBuilder
  private readonly executor: SkillLifecycleExecutor

  constructor(governanceCaller: IGovernanceCaller) {
    this.skillRegistry = new SkillRegistry()
    this.bundleRegistry = new BundleRegistry(this.skillRegistry)
    this.contextBuilder = new ExecutionContextBuilder(this.bundleRegistry)
    this.executor = new SkillLifecycleExecutor(governanceCaller)
  }

  // ── Registration ─────────────────────────────────────────────────────────

  registerSkill(skill: ISkill, lifecycle: ISkillLifecycle): void {
    this.skillRegistry.register(skill, lifecycle)
  }

  registerBundle(bundle: IBundleDefinition): void {
    this.bundleRegistry.register(bundle)
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  async executeSkill<TInput = unknown, TOutput extends ArtifactV2 = ArtifactV2>(
    skillId: string,
    input: TInput,
    context: ISkillExecutionContext,
    callLLM?: (prompt: string) => Promise<string>,
  ): Promise<ISkillRuntimeOutput<TOutput>> {
    const entry = this.skillRegistry.get(skillId)
    if (!entry) {
      return {
        success: false,
        skillId,
        requestId: context.requestId,
        repaired: false,
        repairAttempts: 0,
        totalDurationMs: 0,
        lifecycleDurations: {
          validateMs: 0, prepareMs: 0, executeMs: 0,
          governMs: 0, repairMs: 0, finalizeMs: 0, exportMs: 0,
        },
        personalizationSnapshot: context.personalization.toSnapshot(),
        error: {
          code: 'SKILL_NOT_FOUND',
          message: `Skill "${skillId}" not found. Registered: [${this.skillRegistry.list().map(m => m.id).join(', ')}]`,
          phase: 'validate',
          recoverable: false,
        },
      }
    }

    // Permission check
    const permissionError = this.checkPermissions(entry, context)
    if (permissionError) {
      return {
        success: false,
        skillId,
        requestId: context.requestId,
        repaired: false,
        repairAttempts: 0,
        totalDurationMs: 0,
        lifecycleDurations: {
          validateMs: 0, prepareMs: 0, executeMs: 0,
          governMs: 0, repairMs: 0, finalizeMs: 0, exportMs: 0,
        },
        personalizationSnapshot: context.personalization.toSnapshot(),
        error: {
          code: 'PERMISSION_DENIED',
          message: permissionError,
          phase: 'validate',
          recoverable: false,
        },
      }
    }

    // Default callLLM no-op (callers always provide it; this prevents crashes in tests)
    const llmCaller = callLLM ?? (() => Promise.reject(new Error('No LLM caller provided')))

    return this.executor.execute<TInput, TOutput>(entry, input, context, llmCaller)
  }

  async repairSkillArtifact<TOutput extends ArtifactV2 = ArtifactV2>(
    skillId: string,
    artifact: TOutput,
    governanceResult: IGovernanceResult<TOutput>,
    context: ISkillExecutionContext,
    callLLM: (prompt: string) => Promise<string>,
  ): Promise<ISkillRepairResult<TOutput>> {
    const entry = this.skillRegistry.get(skillId)
    if (!entry) {
      throw new Error(`[SkillRuntime] Skill "${skillId}" not found for repair`)
    }

    const lifecycle = entry.lifecycle as { repair?: ISkillLifecycle['repair'] }
    if (!lifecycle.repair) {
      throw new Error(`[SkillRuntime] Skill "${skillId}" has no repair contract`)
    }

    const repairStart = Date.now()
    const result = await lifecycle.repair(
      artifact as ArtifactV2,
      governanceResult as IGovernanceResult<ArtifactV2>,
      context,
      callLLM,
    )

    return result as ISkillRepairResult<TOutput>
  }

  // ── Context Building ──────────────────────────────────────────────────────

  async buildExecutionContext(params: IExecutionContextParams): Promise<ISkillExecutionContext> {
    return this.contextBuilder.build(params)
  }

  // ── Bundle Resolution ─────────────────────────────────────────────────────

  resolveBundleCapabilities(bundleId: string): IBundleCapabilities {
    return this.bundleRegistry.resolveCapabilities(bundleId)
  }

  getBundleSkills(bundleId: string): ISkillRuntimeEntry[] {
    return this.bundleRegistry.getBundleSkills(bundleId)
  }

  // ── Discovery ─────────────────────────────────────────────────────────────

  getSkillMetadata(skillId: string): ISkillRuntimeMetadata | undefined {
    return this.skillRegistry.get(skillId)?.metadata
  }

  listSkills(): ISkillRuntimeMetadata[] {
    return this.skillRegistry.list()
  }

  listBundles(): IBundleDefinition[] {
    return this.bundleRegistry.list()
  }

  // ── Versioning ────────────────────────────────────────────────────────────

  getSkillVersion(skillId: string): string | undefined {
    return this.skillRegistry.getVersion(skillId)
  }

  checkCompatibility(skillId: string, requiredVersion: string): boolean {
    return this.skillRegistry.checkCompatibility(skillId, requiredVersion)
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private checkPermissions(entry: ISkillRuntimeEntry, context: ISkillExecutionContext): string | null {
    const required = entry.metadata.permissions ?? []
    if (required.length === 0) return null

    // Permissions are in context.metadata.granted_permissions or context.metadata
    const granted = (context.metadata['granted_permissions'] as string[] | undefined) ?? []
    const missing = required.filter(p => !granted.includes(p))
    if (missing.length > 0) {
      return `Skill "${entry.metadata.id}" requires permissions: [${missing.join(', ')}]`
    }
    return null
  }
}


