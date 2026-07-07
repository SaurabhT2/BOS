/**
 * @brandos/artifact-engine-layer — governance/deck.ts
 *
 * DeckGovernanceAdapter — IGovernanceAdapter<DeckArtifact> implementation.
 *
 * WHAT IT DOES:
 *   Bridges governance-layer's validateDeckArtifact() and runDeckSemanticGovernance()
 *   into the IGovernanceAdapter<DeckArtifact> interface.
 *
 * ARCHITECTURE NOTE:
 *   Mirror of CarouselGovernanceAdapter — same adapter pattern, different types.
 *   See governance/carousel.ts for full adapter documentation.
 *
 * VALIDATE() RULES (enforced by validateDeckArtifact in governance-layer):
 *   - Must have at least 3 slides (title + content + closing).
 *   - First slide must have type === 'title'.
 *   - Title slide must have a non-empty title string.
 *   - No two consecutive slides may have the same type.
 *   - Speaker notes (if present) must not exceed character limit.
 *
 * NOTE: Authoritative rules are in governance-layer. This list may drift.
 *
 * REGISTRATION:
 *   Called from bootstrap.ts:
 *     globalArtifactRegistry.registerGovernance(new DeckGovernanceAdapter())
 */

import type { DeckArtifact, IGovernanceResult } from '@brandos/contracts'
import type { IGovernanceAdapter } from '../interfaces'
import { validateDeckArtifact, runDeckSemanticGovernance } from '@brandos/governance-layer'

export class DeckGovernanceAdapter implements IGovernanceAdapter<DeckArtifact> {
  /**
   * Discriminant for registry lookup.
   * Must match the 'deck' literal in the ArtifactType union from @brandos/contracts.
   */
  readonly artifactType = 'deck' as const

  /**
   * Validate a compiled DeckArtifact against semantic business rules.
   *
   * @param artifact - A compiled, $schema-stamped DeckArtifact.
   * @returns IGovernanceResult<DeckArtifact>
   */
  async validate(artifact: DeckArtifact): Promise<IGovernanceResult<DeckArtifact>> {
    const outcome = validateDeckArtifact(artifact)

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

  /**
   * Attempt LLM-powered repair of a failing DeckArtifact.
   *
   * Delegates to runDeckSemanticGovernance() from @brandos/governance-layer.
   * See CarouselGovernanceAdapter.repair() for full documentation of the pattern.
   *
   * @param artifact   - The failing DeckArtifact to repair.
   * @param topic      - The generation topic (for repair prompt context).
   * @param callLLM    - Engine-injected LLM wrapper. Never call LLMs directly.
   * @param requestId  - Trace ID for correlation.
   * @param recompile  - Engine-injected OCL re-entry. MUST be called on LLM output.
   * @returns IGovernanceResult<DeckArtifact>
   */
  async repair(
    artifact: DeckArtifact,
    topic: string,
    callLLM: (prompt: string) => Promise<string>,
    requestId: string,
    recompile: (raw: unknown, topic: string) => DeckArtifact,
  ): Promise<IGovernanceResult<DeckArtifact>> {
    const govResult = await runDeckSemanticGovernance(
      artifact,
      topic,
      callLLM,
      requestId,
      (raw: unknown, t: string) => recompile(raw, t),
    )

    return {
      success:        govResult.success,
      artifact:       govResult.artifact,
      repaired:       govResult.repaired,
      attempts:       govResult.attempts,
      passed:         govResult.success,
      finalRejection: govResult.success ? undefined : govResult.finalRejection,
      violations:     !govResult.success && govResult.validationOutcome && !govResult.validationOutcome.valid
        ? govResult.validationOutcome.details
        : undefined,
    }
  }
}


