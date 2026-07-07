/**
 * @brandos/output-control-layer — contract-assembler/contributors/IdentityContributor.ts
 *
 * PLATFORM SPLIT: this contributor no longer calls
 * BrandIntelligenceRuntime.resolveIdentityContribution() — that method, and
 * the package it lived in, are deleted. IdentityContributor is now a pure
 * field-read from the CognitionContext already resolved by CPLOrchestrator
 * before contract assembly began, exactly matching PersonaContributor's
 * pattern (see PersonaContributor.ts).
 *
 * This contributor:
 *   1. Reads context.cognitionContext.identity (already-resolved, already
 *      gated by IntelligenceOS — a null value here means IntelligenceOS
 *      decided there was nothing worth contributing, not a failure)
 *   2. Maps it 1:1 onto IIdentityContribution's field names
 *   3. Never calls back into IntelligenceOS
 *   4. Never calculates identity policy
 *   5. Never applies its own confidence gate (see mapping note below)
 *   6. Never filters by topic
 */

import type {
  IContractContributor,
  ContributorContext,
  IIdentityContribution,
} from '@brandos/contracts';

export class IdentityContributor implements IContractContributor<IIdentityContribution> {
  readonly contributorId = 'identity';

  async contribute(context: ContributorContext): Promise<IIdentityContribution | null> {
    if (context.applyBrandMemory === false) return null;

    const identity = context.cognitionContext?.identity;
    if (!identity) {
      // Absence IS the gate: IntelligenceOS returns identity: null when it
      // has decided there is nothing substantial enough to contribute.
      // BrandOS does not second-guess that decision with a numeric
      // threshold of its own (COGNITION_CONTRACT_SPEC.md §2 rule 3).
      return null;
    }

    return {
      // PLATFORM SPLIT: `confidence` was previously a 0–100 score BrandOS
      // thresholded against (`identity.confidence >= 20` in
      // compilePromptFromContract.ts). That gate has moved upstream into
      // IntelligenceOS's decision to return identity: null vs a populated
      // object. This value is retained on the interface only as a
      // human-readable diagnostic for logs/telemetry — derived from the
      // coarse CognitionContext.confidence enum, never used for gating.
      confidence: cognitionConfidenceToDiagnosticScore(context.cognitionContext?.confidence),

      hookStyle: identity.hookStyle,
      ctaPatterns: identity.ctaIntent ? [identity.ctaIntent] : undefined,
      ctaIntent: identity.ctaIntent,
      // V2: no verbatim phrases are ever injected — matches prior behavior,
      // where phraseLibrary was always populated as [] as well.
      phraseLibrary: [],
      narrativePatterns: identity.narrativeArcs.length > 0 ? [...identity.narrativeArcs] : undefined,
      narrativeArc: identity.narrativeArcs[0],
      executiveCadence: identity.executiveCadence,
      argumentationStyle: identity.argumentationStyle ?? undefined,
      evidencePatterns: identity.evidencePatterns ? [...identity.evidencePatterns] : undefined,
      titlePatterns: identity.titlePatterns ? [...identity.titlePatterns] : undefined,
      hookPatterns: identity.hookPatterns ? [...identity.hookPatterns] : undefined,
      valueFrames: identity.valueFrames ? [...identity.valueFrames] : undefined,
      structuralArcs: identity.structuralArcs ? [...identity.structuralArcs] : undefined,
      preferredLength: identity.preferredLength,
      // Class C topic fields (recurringThemes, signatureFrameworks,
      // corePositions, marketNarratives) are structurally absent from
      // CognitionContext.identity by design — see
      // COGNITION_CONTRACT_SPEC.md §4. Left undefined here, matching the
      // pre-split behavior (these were always undefined in practice even
      // before the split — see AGENT_CONTEXT.md).
      visual: context.cognitionContext?.visualIdentity
        ? {
            primaryColor: context.cognitionContext.visualIdentity.primaryColor,
            fontStyle: context.cognitionContext.visualIdentity.fontStyle,
            layoutDensity: context.cognitionContext.visualIdentity.layoutDensity,
          }
        : undefined,
    };
  }
}

/**
 * Maps the coarse CognitionContext.confidence enum to a display-only number
 * for diagnostics/telemetry, matching the numeric range the old field used
 * (0–100) so existing dashboards/log parsers keep working. This is NOT a
 * re-derivation of confidence — it's a fixed, arbitrary display mapping.
 */
function cognitionConfidenceToDiagnosticScore(
  confidence: 'high' | 'medium' | 'low' | 'degraded' | undefined
): number {
  switch (confidence) {
    case 'high': return 90;
    case 'medium': return 60;
    case 'low': return 30;
    case 'degraded':
    default: return 0;
  }
}
