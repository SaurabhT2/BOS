/**
 * @brandos/output-control-layer — contract/contributors/IntentContributor.ts
 *
 * Moved from: @brandos/control-plane-layer/src/contributors/index.ts
 * Move reason: runtime behaviour belongs in output-control-layer, not contracts.
 */

import type {
  IContractContributor,
  ContributorContext,
  IIntentContribution,
} from '@brandos/contracts';

// ---------------------------------------------------------------------------
// IntentContributor
// Wraps: intake.ts analyzeIntent() → IntentAnalysis
// ---------------------------------------------------------------------------

export class IntentContributor implements IContractContributor<IIntentContribution> {
  readonly contributorId = 'intent';

  async contribute(
    context: ContributorContext & {
      intentAnalysis?: {
        detected_task: string;
        confidence: number;
        ambiguity_level: string;
      };
    }
  ): Promise<IIntentContribution> {
    const intent = context.intentAnalysis;

    return {
      taskType: intent?.detected_task ?? context.taskType,
      topic: extractTopic(context.userPrompt),
      confidence: intent?.confidence ?? 1,
      ambiguityLevel: (intent?.ambiguity_level as IIntentContribution['ambiguityLevel']) ?? 'none',
      userPrompt: context.userPrompt,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractTopic(prompt: string): string {
  // Simple heuristic: first meaningful phrase up to first punctuation or 60 chars
  return prompt.replace(/^(write|create|make|generate|build)\s+/i, '').slice(0, 60).trim();
}


