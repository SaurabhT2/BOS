/**
 * @brandos/output-control-layer — contract-assembler/contributors/KnowledgeContributor.ts
 *
 * Cognitive Platform Evolution Program, Milestone 4 (Identity Evolution),
 * EM-4.1 (Knowledge/Reasoning/Positioning Contributors).
 *
 * Pure field-read from the already-resolved CognitionContext, exactly
 * matching IdentityContributor's and PersonaContributor's pattern:
 *   1. Reads context.cognitionContext.{knowledge,reasoning,positioning}
 *      (already-resolved, already gated by IntelligenceOS — null on any
 *      of the three means IntelligenceOS decided there was nothing worth
 *      contributing for that section, not a failure)
 *   2. Maps them onto IKnowledgeContribution's field names
 *   3. Never calls back into IntelligenceOS
 *   4. Never infers/synthesizes new conclusions or themes itself
 *   5. Never applies its own confidence gate beyond "is there anything to say"
 */

import type {
  IContractContributor,
  ContributorContext,
  IKnowledgeContribution,
} from '@brandos/contracts';

/**
 * Mirrors CognitionConfidence (@platform/cognition-contract) as a local
 * literal type rather than adding a new package dependency for one type —
 * output-control-layer does not otherwise depend on @platform/cognition-contract
 * directly (it only sees CognitionContext indirectly, typed via
 * @brandos/contracts's ContributorContext.cognitionContext field). Keep in
 * sync by hand if the wire type changes.
 */
type CognitionConfidence = 'high' | 'medium' | 'low' | 'degraded';

const CONFIDENCE_RANK: Record<CognitionConfidence, number> = { high: 3, medium: 2, low: 1, degraded: 0 };

export class KnowledgeContributor implements IContractContributor<IKnowledgeContribution> {
  readonly contributorId = 'knowledge';

  async contribute(context: ContributorContext): Promise<IKnowledgeContribution | null> {
    if (context.applyBrandMemory === false) return null;

    const cc = context.cognitionContext;
    const knowledge = cc?.knowledge ?? null;
    const reasoning = cc?.reasoning ?? null;
    const positioning = cc?.positioning ?? null;

    // Absence of all three IS the gate, same discipline as
    // IdentityContributor: IntelligenceOS returns null for a section when
    // it has decided there is nothing substantial enough yet. BrandOS does
    // not second-guess that with a threshold of its own.
    if (!knowledge && !reasoning && !positioning) return null;

    const confidences = [knowledge?.confidence, reasoning?.confidence, positioning?.confidence]
      .filter((c): c is CognitionConfidence => Boolean(c));
    // Lowest reported confidence wins — a contribution combining three
    // sections is only as trustworthy as its least confident section.
    const lowestConfidence = confidences.length
      ? confidences.reduce((worst, c) =>
          CONFIDENCE_RANK[c] < CONFIDENCE_RANK[worst] ? c : worst
        )
      : undefined;

    return {
      themes: knowledge?.themes?.length ? [...knowledge.themes] : undefined,
      conclusions: reasoning?.conclusions?.length
        ? reasoning.conclusions.map((c) => c.statement)
        : undefined,
      positioningStatements: positioning?.statements?.length
        ? positioning.statements.map((s) => s.statement)
        : undefined,
      confidence: cognitionConfidenceToDiagnosticScore(lowestConfidence),
      hasConflict: Boolean(knowledge?.hasConflict || reasoning?.hasConflict || positioning?.hasConflict),
    };
  }
}

/**
 * Same fixed display-only mapping as IdentityContributor's identically-named
 * helper (duplicated rather than shared — both are small, private, and
 * tied to their own contributor's diagnostic display, not a shared
 * business rule).
 */
function cognitionConfidenceToDiagnosticScore(confidence: CognitionConfidence | undefined): number {
  switch (confidence) {
    case 'high': return 90;
    case 'medium': return 60;
    case 'low': return 30;
    default: return 0;
  }
}
