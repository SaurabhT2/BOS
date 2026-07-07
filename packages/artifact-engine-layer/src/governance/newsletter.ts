/**
 * @brandos/artifact-engine-layer — governance/newsletter.ts
 *
 * NewsletterGovernanceAdapter — IGovernanceAdapter<NewsletterArtifact> implementation.
 *
 * Bridges governance-layer's validateNewsletterArtifact() and
 * runNewsletterSemanticGovernance() into the IGovernanceAdapter interface.
 *
 * REGISTRATION:
 *   Called from bootstrap.ts:
 *     globalArtifactRegistry.registerGovernance(new NewsletterGovernanceAdapter())
 */

import type { NewsletterArtifact, IGovernanceResult } from '@brandos/contracts'
import type { IGovernanceAdapter } from '../interfaces'
import { validateNewsletterArtifact, runNewsletterSemanticGovernance } from '@brandos/governance-layer'

export class NewsletterGovernanceAdapter implements IGovernanceAdapter<NewsletterArtifact> {
  readonly artifactType = 'newsletter' as const

  async validate(artifact: NewsletterArtifact): Promise<IGovernanceResult<NewsletterArtifact>> {
    const outcome = validateNewsletterArtifact(artifact)

    if (outcome.valid) {
      return { success: true, artifact, repaired: false, attempts: 0, passed: true }
    }

    const invalid = outcome as Extract<typeof outcome, { valid: false }>
    return {
      success:        false,
      artifact,
      repaired:       false,
      attempts:       0,
      passed:         false,
      finalRejection: `${invalid.reason}: ${invalid.details.join('; ')}`,
      violations:     invalid.details,
    }
  }

  async repair(
    artifact: NewsletterArtifact,
    topic: string,
    callLLM: (prompt: string) => Promise<string>,
    requestId: string,
    recompile: (raw: unknown, topic: string) => NewsletterArtifact
  ): Promise<IGovernanceResult<NewsletterArtifact>> {
    const result = await runNewsletterSemanticGovernance(
      artifact,
      topic,
      callLLM,
      requestId,
      recompile
    )

    if (result.success) {
      return {
        success:  true,
        artifact: result.artifact,
        repaired: result.repaired ?? false,
        attempts: result.attempts ?? 0,
        passed:   true,
      }
    }

    return {
      success:        false,
      artifact:       result.artifact,
      repaired:       false,
      attempts:       result.attempts ?? 0,
      passed:         false,
      finalRejection: result.finalRejection,
      violations:     [],
    }
  }
}
