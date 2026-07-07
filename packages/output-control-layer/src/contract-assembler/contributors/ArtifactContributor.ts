/**
 * @brandos/output-control-layer — contract-assembler/contributors/ArtifactContributor.ts
 *
 * Provides the IArtifactContribution slice — schema version, required roles,
 * min/max slides, and the canonical schemaInstruction string for the LLM prompt.
 *
 * ─── CONSTRAINT DERIVATION (Law 6) ──────────────────────────────────────────
 *
 * ALL structural constraints (minSlides, maxSlides, requiredRoles) are derived
 * from @brandos/contracts (CAROUSEL/DECK/REPORT_STRUCTURAL_CONSTRAINTS).
 *
 * Do NOT hardcode constraint values here. If a value needs to change, change it
 * in governance-config — this file derives automatically.
 *
 * BEFORE (hardcoded, Sprint 1 violation):
 *   carousel → minSlides: 5, maxSlides: 10, requiredRoles: ['hook', 'CTA']
 *   deck     → minSlides: 7, maxSlides: 14, requiredRoles: ['cover', 'closing']
 *   report   → minSlides: 4, maxSlides: 10, requiredRoles: ['cover', 'closing']
 *
 * AFTER (derived):
 *   carousel → CAROUSEL_STRUCTURAL_CONSTRAINTS.{minSlides, maxSlides, requiredRoles}
 *   deck     → DECK_STRUCTURAL_CONSTRAINTS.{minSlides, maxSlides, requiredRoles}
 *   report   → REPORT_STRUCTURAL_CONSTRAINTS.{minSections, maxSections, requiredSectionIds}
 */

import type {
  IContractContributor,
  ContributorContext,
  IArtifactContribution,
} from '@brandos/contracts';
import { CAROUSEL_SCHEMA_INSTRUCTION, DECK_SCHEMA_INSTRUCTION, REPORT_SCHEMA_INSTRUCTION } from '@brandos/contracts';
import {
  CAROUSEL_STRUCTURAL_CONSTRAINTS,
  DECK_STRUCTURAL_CONSTRAINTS,
  REPORT_STRUCTURAL_CONSTRAINTS,
} from '@brandos/contracts';

// ---------------------------------------------------------------------------
// ArtifactContributor
// ---------------------------------------------------------------------------

export class ArtifactContributor implements IContractContributor<IArtifactContribution> {
  readonly contributorId = 'artifact';

  async contribute(
    context: ContributorContext
  ): Promise<IArtifactContribution | null> {
    const taskType = context.taskType;

    if (taskType === 'carousel') {
      const C = CAROUSEL_STRUCTURAL_CONSTRAINTS;
      return {
        schema: 'artifact-json@2.0',
        requiredRoles: [...C.requiredRoles],
        minSlides: C.minSlides,
        maxSlides: C.maxSlides,
        schemaInstruction: CAROUSEL_SCHEMA_INSTRUCTION,
        qualityThreshold: 65,
      };
    }

    if (taskType === 'deck') {
      const D = DECK_STRUCTURAL_CONSTRAINTS;
      return {
        schema: 'artifact-json@2.0',
        requiredRoles: [...D.requiredRoles],
        minSlides: D.minSlides,
        maxSlides: D.maxSlides,
        schemaInstruction: DECK_SCHEMA_INSTRUCTION,
        qualityThreshold: 65,
      };
    }

    if (taskType === 'report') {
      const R = REPORT_STRUCTURAL_CONSTRAINTS;
      return {
        schema: 'artifact-json@2.0',
        requiredRoles: [...R.requiredSectionIds],
        minSlides: R.minSections,
        maxSlides: R.maxSections,
        schemaInstruction: REPORT_SCHEMA_INSTRUCTION,
        qualityThreshold: 65,
      };
    }

    // Unknown task type — return null, ContractAssembler uses default
    return null;
  }
}
