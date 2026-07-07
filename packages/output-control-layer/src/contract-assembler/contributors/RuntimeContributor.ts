/**
 * @brandos/output-control-layer — contract-assembler/contributors/RuntimeContributor.ts
 *
 * Provides the IRuntimeContribution slice — quality threshold, retry budget,
 * runtime mode, attempt tracking, and governance feedback history.
 *
 * CLOSED-LOOP FEEDBACK (new):
 *   RuntimeContributor now forwards ContributorContext.attemptHistory into
 *   IRuntimeContribution.attemptHistory. This makes the full attempt history
 *   available to compilePromptFromContract() without any additional wiring.
 */

import type {
  IContractContributor,
  ContributorContext,
  IRuntimeContribution,
} from '@brandos/contracts';

// ---------------------------------------------------------------------------
// RuntimeContributor
// ---------------------------------------------------------------------------

export class RuntimeContributor implements IContractContributor<IRuntimeContribution> {
  readonly contributorId = 'runtime';

  async contribute(
    context: ContributorContext
  ): Promise<IRuntimeContribution> {
    return {
      qualityThreshold: 65,
      maxAttempts:      3,
      autoRegenerate:   true,
      attempt:          context.attempt,
      runtimeMode:      context.runtimeMode,
      // Forward attempt history from context so the Prompt Compiler can
      // produce progressively stronger prompts on subsequent attempts.
      // undefined on the first attempt (no history yet).
      attemptHistory:   context.attemptHistory,
      // TOPIC-DRIFT-FIX-004: Forward repair context so the Prompt Compiler
      // can append it to the governance feedback section of the system prompt
      // without displacing the original user topic from the user message.
      repairContext:    context.repairContext,
    };
  }
}

