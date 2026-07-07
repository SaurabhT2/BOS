/**
 * @brandos/iskill-runtime — execution/context-builder.ts
 *
 * ISkillExecutionContext builder.
 *
 * Assembles the immutable per-request execution environment from:
 *   - caller-provided parameters (userId, workspaceId, requestId, etc.)
 *   - pre-resolved personalization context
 *   - optional bundle governance overrides
 *
 * Context is read-only during lifecycle execution.
 *
 * RULES:
 *   - No LLM calls.
 *   - No database calls. Callers resolve personalization before calling here.
 *   - Bundle overrides are merged with caller overrides (caller wins on conflict).
 */

import type { SkillContext } from '@brandos/contracts'
import type {
  ISkillExecutionContext,
  IGovernanceOverrides,
  IExecutionContextParams,
} from '../contracts'
import type { BundleRegistry } from '../registry/bundle-registry'

export class ExecutionContextBuilder {
  constructor(private readonly bundleRegistry: BundleRegistry) {}

  /**
   * Build an ISkillExecutionContext from caller params.
   * If bundleId is provided, merges bundle governance overrides.
   */
  async build(params: IExecutionContextParams): Promise<ISkillExecutionContext> {
    let governanceOverrides: IGovernanceOverrides | undefined = params.governanceOverrides

    // Merge bundle governance overrides (bundle defaults, caller overrides win)
    if (params.bundleId && this.bundleRegistry.has(params.bundleId)) {
      const bundle = this.bundleRegistry.get(params.bundleId)!
      if (bundle.governanceOverrides) {
        governanceOverrides = {
          ...bundle.governanceOverrides,   // bundle defaults
          ...params.governanceOverrides,  // caller overrides win
        }
      }
    }

    const context: ISkillExecutionContext = {
      requestId: params.requestId,
      userId: params.userId,
      workspaceId: params.workspaceId,
      personaId: params.personaId,
      runtimeMode: params.runtimeMode,
      personalization: params.personalization,
      bundleId: params.bundleId,
      governanceOverrides,
      metadata: params.metadata ?? {},
      builtAt: new Date().toISOString(),
    }

    return context
  }
}

// ─── SkillContext adapter ─────────────────────────────────────────────────────

/**
 * toSkillContext
 *
 * Adapts ISkillExecutionContext to the @brandos/contracts SkillContext
 * interface, for compatibility with IPlatformPluginRegistry.executeSkill().
 *
 * This is the bridge between iskill-runtime's richer context and the
 * existing SkillContext contract.
 */
export function toSkillContext(
  ctx: ISkillExecutionContext,
  grantedPermissions?: string[],
): SkillContext {
  return {
    requestId: ctx.requestId,
    userId: ctx.userId,
    sessionId: ctx.requestId,   // requestId doubles as sessionId for tracing
    trace_id: ctx.requestId,
    metadata: {
      workspaceId: ctx.workspaceId,
      personaId: ctx.personaId,
      bundleId: ctx.bundleId,
      runtimeMode: ctx.runtimeMode,
      personalizationSnapshot: ctx.personalization.toSnapshot(),
      builtAt: ctx.builtAt,
      ...ctx.metadata,
    },
    granted_permissions: grantedPermissions ?? [],
  }
}


