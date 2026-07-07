/**
 * BrandOS — Policy Admin Service
 *
 * GOVERNANCE MIGRATION COMPLETE:
 *   - PolicyConfig type now imported from @brandos/governance-config (canonical)
 *   - DEFAULT_POLICY_CONFIG imported from @brandos/governance-config
 *   - validatePolicy() now delegates to validatePolicyPatch() + validateModelGovernanceConsistency()
 *     from @brandos/governance-config — no more duplicated validation logic
 *   - isModelAllowed() field references updated to camelCase (canonical schema)
 *   - snake_case CPL-local PolicyConfig type has been deleted from types.ts
 */

import type { PolicyConfig } from '@brandos/governance-config'
import {
  DEFAULT_POLICY_CONFIG,
  validatePolicyPatch,
  validateModelGovernanceConsistency,
} from '@brandos/governance-config'

// ─── In-memory store ──────────────────────────────────────────────────────────

interface StoredPolicy extends PolicyConfig {
  id: string
  workspace_id: string
}

const policyStore = new Map<string, StoredPolicy>()

function getDefaultPolicy(workspaceId: string): StoredPolicy {
  return {
    ...DEFAULT_POLICY_CONFIG,
    id: `policy_${workspaceId}`,
    workspace_id: workspaceId,
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class PolicyAdminService {
  async getPolicy(workspaceId: string): Promise<StoredPolicy> {
    return policyStore.get(workspaceId) ?? getDefaultPolicy(workspaceId)
  }

  async savePolicy(
    workspaceId: string,
    patch: Partial<PolicyConfig>,
    updatedBy: string,
  ): Promise<StoredPolicy> {
    const existing = await this.getPolicy(workspaceId)
    const updated: StoredPolicy = {
      ...existing,
      ...patch,
      workspace_id: workspaceId,
      updatedAt: new Date().toISOString(),
      updatedBy,
    }
    policyStore.set(workspaceId, updated)
    return updated
  }

  async resetPolicy(workspaceId: string, updatedBy: string): Promise<StoredPolicy> {
    const reset = getDefaultPolicy(workspaceId)
    reset.updatedBy = updatedBy
    policyStore.set(workspaceId, reset)
    return reset
  }

  /**
   * validatePolicy — delegates to governance-config canonical validators.
   * Replaces the duplicated validation logic that previously lived here.
   */
  validatePolicy(config: Partial<PolicyConfig>): { valid: boolean; errors: string[] } {
    const patchResult = validatePolicyPatch(config)
    if (!patchResult.valid) return patchResult

    // Check model governance consistency when present
    if (config.modelGovernance) {
      const mgResult = validateModelGovernanceConsistency(config.modelGovernance)
      if (!mgResult.valid) return mgResult
    }

    return { valid: true, errors: [] }
  }

  /**
   * isModelAllowed — checks provider/model against canonical PolicyConfig.
   * Updated to use camelCase field names from governance-config schema.
   */
  isModelAllowed(policy: StoredPolicy, provider: string, modelId: string): boolean {
    const mg = policy.modelGovernance

    if (mg.deniedModels.includes(modelId))  return false

    const isLocal = provider === 'ollama' || provider === 'lmstudio'
    if (mg.cloudProvidersOnly && isLocal)   return false
    if (mg.localModelsOnly && !isLocal)     return false

    if (mg.allowedProviders.length > 0 && !mg.allowedProviders.includes(provider)) return false

    return true
  }
}

export const globalPolicyAdminService = new PolicyAdminService()


