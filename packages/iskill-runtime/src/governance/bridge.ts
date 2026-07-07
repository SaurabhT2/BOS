/**
 * @brandos/iskill-runtime — governance/bridge.ts
 *
 * GovernanceBridge — integration adapter between ISkillRuntime and ArtifactEngine.govern().
 */

import type { ArtifactV2, IGovernanceResult } from '@brandos/contracts'
import type { IGovernanceCaller }             from '../lifecycle/executor'
import type { ISkillExecutionContext }         from '../contracts'

export interface IArtifactEngineGovernable {
  govern(
    artifact: ArtifactV2,
    context: { requestId: string; userId: string; workspaceId?: string },
    repairLLM?: (prompt: string) => Promise<string>,
  ): Promise<IGovernanceResult<ArtifactV2>>
}

/**
 * createGovernanceBridge — wraps ArtifactEngine as IGovernanceCaller.
 * Call once at bootstrap time (outside iskill-runtime).
 */
export function createGovernanceBridge(artifactEngine: IArtifactEngineGovernable): IGovernanceCaller {
  return {
    async govern<TArtifact extends ArtifactV2>(
      artifact: TArtifact,
      context: ISkillExecutionContext,
      callLLM?: (prompt: string) => Promise<string>,
    ): Promise<IGovernanceResult<TArtifact>> {
      const result = await artifactEngine.govern(
        artifact as ArtifactV2,
        { requestId: context.requestId, userId: context.userId, workspaceId: context.workspaceId },
        callLLM,
      )
      return result as IGovernanceResult<TArtifact>
    },
  }
}

/**
 * createTestOnlyGovernanceBridge — canonical name for the no-op test bridge.
 *
 * PRODUCTION GUARD: throws immediately if NODE_ENV is 'production'.
 * This prevents accidental wiring in production bootstrap.
 *
 * Use in test setup files:
 *   const bridge = createTestOnlyGovernanceBridge()
 *   bootstrapSkillRuntime({ governanceCaller: bridge })
 */
export function createTestOnlyGovernanceBridge(): IGovernanceCaller {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[iskill-runtime] createTestOnlyGovernanceBridge() cannot be used in production. ' +
      'Wire createGovernanceBridge(globalArtifactEngine) instead.'
    )
  }
  return {
    async govern<TArtifact extends ArtifactV2>(artifact: TArtifact): Promise<IGovernanceResult<TArtifact>> {
      return { success: true, passed: true, violations: [], artifact, repaired: false, attempts: 0 }
    },
  }
}



