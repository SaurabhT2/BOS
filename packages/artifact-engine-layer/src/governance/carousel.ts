/**
 * @brandos/artifact-engine-layer — governance/carousel.ts
 *
 * CarouselGovernanceAdapter — IGovernanceAdapter<CarouselArtifact> implementation.
 *
 * WHAT IT DOES:
 *   Bridges the @brandos/governance-layer's functional API into the
 *   IGovernanceAdapter<CarouselArtifact> interface that ArtifactEngine.govern() expects.
 *
 * WHY THIS ADAPTER EXISTS:
 *   @brandos/governance-layer exports standalone functions:
 *     validateCarouselArtifact(artifact) → SemanticValidationOutcome
 *     runCarouselSemanticGovernance(...) → GovernanceResult<CarouselArtifact>
 *   ArtifactEngine dispatches via IGovernanceAdapter (class-based, interface-bound).
 *   This adapter bridges the gap without modifying either package's API.
 *
 * VALIDATE() SEMANTICS:
 *   - Pure. No LLM. Wraps validateCarouselArtifact() from governance-layer.
 *   - Maps SemanticValidationOutcome → IGovernanceResult<CarouselArtifact>.
 *   - On success: { success: true, artifact, repaired: false, attempts: 0, passed: true }
 *   - On failure: { success: false, violations: [...], finalRejection: '...' }
 *
 * REPAIR() SEMANTICS:
 *   - LLM-powered. Wraps runCarouselSemanticGovernance() from governance-layer.
 *   - The callLLM callback is injected by the engine — carousel adapter NEVER calls LLMs directly.
 *   - The recompile callback is injected by the engine — ensures OCL re-entry after repair.
 *   - Maps GovernanceResult<CarouselArtifact> → IGovernanceResult<CarouselArtifact>.
 *     GovernanceResult has `validationOutcome` (dropped in mapping — not in IGovernanceResult).
 *
 * VIOLATIONS MAPPING:
 *   - IGovernanceResult.violations: string[] of individual rule failures.
 *   - Sourced from SemanticValidationOutcome.details (the array of violation descriptions).
 *   - On validate() failure: taken from the invalid outcome.details.
 *   - On repair() failure: taken from repairResult.validationOutcome.details (if available).
 *
 * REGISTRATION:
 *   Called from bootstrap.ts:
 *     globalArtifactRegistry.registerGovernance(new CarouselGovernanceAdapter())
 */

import type { CarouselArtifact, IGovernanceResult } from '@brandos/contracts'
import type { IGovernanceAdapter } from '../interfaces'
import {
  validateCarouselArtifact,
  runCarouselSemanticGovernance,
} from '@brandos/governance-layer'

export class CarouselGovernanceAdapter implements IGovernanceAdapter<CarouselArtifact> {
  /**
   * Discriminant for registry lookup.
   * Must match the 'carousel' literal in the ArtifactType union from @brandos/contracts.
   */
  readonly artifactType = 'carousel' as const

  /**
   * Validate a compiled CarouselArtifact against semantic business rules.
   *
   * RULES ENFORCED (by validateCarouselArtifact in governance-layer):
   *   - Must have 5–10 slides (exact bounds defined in governance-layer).
   *   - First slide must have role === 'hook'.
   *   - Last slide must have role === 'cta'.
   *   - Each slide must have at least one bullet (if role allows bullets).
   *   - Bullets must not exceed character limits.
   *   - SemanticTheme fields must be populated.
   *
   * NOTE: This list may be stale — the authoritative rules are in governance-layer.
   * This adapter does not duplicate rule logic; it only maps the result.
   *
   * @param artifact - A compiled, $schema-stamped CarouselArtifact.
   * @returns IGovernanceResult<CarouselArtifact>
   */
  async validate(artifact: CarouselArtifact): Promise<IGovernanceResult<CarouselArtifact>> {
    const outcome = validateCarouselArtifact(artifact)

    if (outcome.valid) {
      return {
        success:  true,
        artifact,
        repaired: false,
        attempts: 0,
        passed:   true,
      }
    }

    // outcome.valid === false — narrow to the invalid discriminant to access reason + details
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
   * Attempt LLM-powered repair of a failing CarouselArtifact.
   *
   * FLOW (delegated to runCarouselSemanticGovernance in governance-layer):
   *   1. governance-layer builds a repair prompt from the artifact + violations.
   *   2. callLLM(prompt) → raw LLM repair output string.
   *   3. recompile(rawOutput, topic) → re-enters ICompiler (OCL re-entry law).
   *   4. validateCarouselArtifact(recompiledArtifact) → validates the repair.
   *   5. Returns GovernanceResult<CarouselArtifact> with success/failure.
   *
   * MAPPING GovernanceResult → IGovernanceResult:
   *   - GovernanceResult.validationOutcome is dropped (not in IGovernanceResult).
   *   - violations: sourced from validationOutcome.details if repair failed.
   *   - All other fields are 1:1.
   *
   * @param artifact   - The failing CarouselArtifact to repair.
   * @param topic      - The generation topic (for repair prompt context).
   * @param callLLM    - Engine-injected LLM wrapper. Never call LLMs directly.
   * @param requestId  - Trace ID for correlation in repair prompt + error logs.
   * @param recompile  - Engine-injected OCL re-entry. MUST be called on LLM output.
   * @returns IGovernanceResult<CarouselArtifact>
   */
  async repair(
    artifact: CarouselArtifact,
    topic: string,
    callLLM: (prompt: string) => Promise<string>,
    requestId: string,
    recompile: (raw: unknown, topic: string) => CarouselArtifact,
  ): Promise<IGovernanceResult<CarouselArtifact>> {
    const govResult = await runCarouselSemanticGovernance(
      artifact,
      topic,
      callLLM,
      requestId,
      // Bridge: governance-layer's recompile signature → engine's recompile callback.
      // The engine's recompile wraps ICompiler.compile() + assertCompiledArtifact().
      (raw: unknown, t: string) => recompile(raw, t),
    )

    // Map GovernanceResult<CarouselArtifact> → IGovernanceResult<CarouselArtifact>
    // Drop validationOutcome (governance-layer internal field, not in IGovernanceResult).
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


