/**
 * @brandos/artifact-engine-layer — governance/report.ts
 *
 * ReportGovernanceAdapter — IGovernanceAdapter<ReportArtifact> implementation.
 *
 * WHAT IT DOES:
 *   Bridges governance-layer's validateReportArtifact() and runReportSemanticGovernance()
 *   into the IGovernanceAdapter<ReportArtifact> interface.
 *
 * ARCHITECTURE NOTE:
 *   Mirror of CarouselGovernanceAdapter — same adapter pattern, different types.
 *   See governance/carousel.ts for full adapter documentation.
 *
 * VALIDATE() RULES (enforced by validateReportArtifact in governance-layer):
 *   - Must have at least 2 sections (e.g., intro + at least one body section).
 *   - All section `id` values must be unique within the report.
 *   - All section `heading` values must be non-empty strings.
 *   - Section body content must not be empty (governance-layer checks minimum length).
 *
 * NOTE: Authoritative rules are in governance-layer. This list may drift.
 *
 * REGISTRATION:
 *   Called from bootstrap.ts:
 *     globalArtifactRegistry.registerGovernance(new ReportGovernanceAdapter())
 */

import type { ReportArtifact, IGovernanceResult } from '@brandos/contracts'
import type { IGovernanceAdapter } from '../interfaces'
import { validateReportArtifact, runReportSemanticGovernance } from '@brandos/governance-layer'

export class ReportGovernanceAdapter implements IGovernanceAdapter<ReportArtifact> {
  /**
   * Discriminant for registry lookup.
   * Must match the 'report' literal in the ArtifactType union from @brandos/contracts.
   */
  readonly artifactType = 'report' as const

  /**
   * Validate a compiled ReportArtifact against semantic business rules.
   *
   * @param artifact - A compiled, $schema-stamped ReportArtifact.
   * @returns IGovernanceResult<ReportArtifact>
   */
  async validate(artifact: ReportArtifact): Promise<IGovernanceResult<ReportArtifact>> {
    const outcome = validateReportArtifact(artifact)

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
   * Attempt LLM-powered repair of a failing ReportArtifact.
   *
   * Delegates to runReportSemanticGovernance() from @brandos/governance-layer.
   * See CarouselGovernanceAdapter.repair() for full documentation of the pattern.
   *
   * @param artifact   - The failing ReportArtifact to repair.
   * @param topic      - The generation topic (for repair prompt context).
   * @param callLLM    - Engine-injected LLM wrapper. Never call LLMs directly.
   * @param requestId  - Trace ID for correlation.
   * @param recompile  - Engine-injected OCL re-entry. MUST be called on LLM output.
   * @returns IGovernanceResult<ReportArtifact>
   */
  async repair(
    artifact: ReportArtifact,
    topic: string,
    callLLM: (prompt: string) => Promise<string>,
    requestId: string,
    recompile: (raw: unknown, topic: string) => ReportArtifact,
  ): Promise<IGovernanceResult<ReportArtifact>> {
    const govResult = await runReportSemanticGovernance(
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


