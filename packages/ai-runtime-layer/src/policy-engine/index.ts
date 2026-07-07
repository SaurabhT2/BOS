// ============================================================
// packages/ai-runtime-layer/src/policy-engine/index.ts
//
// POLICY ENGINE — Governance Rule Enforcement
//
// Stateless. Validates InvocationRequests against a set of runtime
// policy rules. The same PolicyEngine instance is safe to share across
// all requests.
//
// POLICY RULES (in check order):
//   1. local_only           — request must use 'local' mode only
//   2. no_external_providers— request must not go to a non-local provider
//   3. blocked_providers    — specific providers are always rejected
//   4. allowed_modes        — only listed modes are permitted (auto exempt)
//   5. max_cost_per_request — request's max_cost_usd must not exceed policy limit
//
// RULE SOURCE:
//   Policy rules come from AIRuntimeConfig.policy, which is set by:
//     - Environment variables (AIRUNTIME_BLOCKED_PROVIDERS, AIRUNTIME_MAX_COST)
//     - Admin settings injected via configProvider (governance-layer policies)
//
// THIS ENGINE DOES NOT OWN policy rule authoring or storage.
// Policy storage is governance-layer's responsibility.
// This engine only enforces the rules it is given.
//
// RETURNS:
//   null         — request is permitted
//   AIRuntimeError — request is blocked (retryable: false always)
// ============================================================

import {
  AIRuntimeError,
  AIRuntimePolicy,
  ErrorCode,
  ExecutionMode,
  IPolicyEngine,
  InvocationRequest,
  ProviderName,
  isLocalProvider,
} from '@brandos/contracts'

export class PolicyEngine implements IPolicyEngine {
  constructor(private readonly policy: AIRuntimePolicy) {}

  /**
   * Validate a request against the configured policy rules.
   *
   * Called by ExecutionEngine before invoking a provider.
   * If this returns a non-null error, the provider is skipped.
   *
   * @param request          - The InvocationRequest to validate.
   * @param selectedMode     - The execution mode selected by RouterEngine.
   * @param selectedProvider - The provider selected by RouterEngine.
   * @returns null if permitted; AIRuntimeError if blocked.
   */
  validate(
    request:          InvocationRequest,
    selectedMode:     ExecutionMode,
    selectedProvider: ProviderName,
  ): AIRuntimeError | null {

    // Rule 1: local_only — only 'local' mode is permitted.
    if (this.policy.local_only && selectedMode !== 'local') {
      return this.deny(
        'POLICY_VIOLATION',
        `Policy requires local_only; attempted mode: ${selectedMode}`,
        'This request cannot be processed using external services.',
      )
    }

    // Rule 2: no_external_providers — only local providers are permitted.
    if (
      this.policy.no_external_providers &&
      !isLocalProvider(selectedProvider)
    ) {
      return this.deny(
        'POLICY_VIOLATION',
        `Policy blocks external providers; attempted: ${selectedProvider}`,
        'This request cannot be sent to external AI providers.',
      )
    }

    // Rule 3: blocked_providers — specific providers always rejected.
    if (this.policy.blocked_providers?.includes(selectedProvider)) {
      return this.deny(
        'POLICY_VIOLATION',
        `Provider ${selectedProvider} is blocked by policy`,
        'This AI provider is not permitted in your current configuration.',
      )
    }

    // Rule 4: allowed_modes — only listed modes are permitted.
    // 'auto' is always exempt from this check (it's the runtime's internal mode).
    if (
      this.policy.allowed_modes &&
      !this.policy.allowed_modes.includes(selectedMode) &&
      selectedMode !== 'auto'
    ) {
      return this.deny(
        'POLICY_VIOLATION',
        `Mode ${selectedMode} not in allowed_modes: ${this.policy.allowed_modes.join(', ')}`,
        'The selected execution mode is not permitted.',
      )
    }

    // Rule 5: max_cost_per_request_usd — request cost must not exceed limit.
    if (
      this.policy.max_cost_per_request_usd !== undefined &&
      request.max_cost_usd !== undefined &&
      request.max_cost_usd > this.policy.max_cost_per_request_usd
    ) {
      return this.deny(
        'BUDGET_EXCEEDED',
        `Request max_cost_usd ${request.max_cost_usd} exceeds policy limit ${this.policy.max_cost_per_request_usd}`,
        'This request exceeds your configured cost limit.',
      )
    }

    return null
  }

  /** Build a policy denial error. Always retryable: false. */
  private deny(
    code:         ErrorCode,
    message:      string,
    user_message: string,
  ): AIRuntimeError {
    return { code, message, user_message, retryable: false }
  }
}


