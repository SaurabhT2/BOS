/**
 * @brandos/iskill-runtime — repair/repair-registry.ts
 *
 * RepairPromptRegistry — maps (artifactType, violationReason) to repair prompts.
 *
 * This replaces hardcoded inline repair strings scattered across governance adapters.
 *
 * Skills declare their repairContract.buildRepairPrompt() — if no repair contract
 * is set, the runtime falls back to this registry's defaults.
 *
 * RULES:
 *   - No LLM calls here. This is a lookup and string-building layer.
 *   - Prompts are keyed by (artifactType, violationReason) for maximum specificity.
 *   - Fallback: (artifactType, '*') → any violation for that type.
 *   - Final fallback: ('*', '*') → generic repair prompt.
 */

import type { ArtifactType } from '@brandos/contracts'
import { CAROUSEL_STRUCTURAL_CONSTRAINTS } from '@brandos/governance-config';

export interface IRepairPromptEntry {
  artifactType: ArtifactType | '*'
  violationReason: string | '*'
  buildPrompt: (topic: string, violationReason: string) => string
}

export class RepairPromptRegistry {
  private readonly entries: IRepairPromptEntry[] = []

  register(entry: IRepairPromptEntry): this {
    this.entries.push(entry)
    return this
  }

  resolve(
    artifactType: ArtifactType,
    violationReason: string,
    topic: string,
  ): string {
    // Exact match first
    const exact = this.entries.find(
      e => e.artifactType === artifactType && e.violationReason === violationReason,
    )
    if (exact) return exact.buildPrompt(topic, violationReason)

    // ArtifactType wildcard for violation
    const typeWild = this.entries.find(
      e => e.artifactType === artifactType && e.violationReason === '*',
    )
    if (typeWild) return typeWild.buildPrompt(topic, violationReason)

    // Global wildcard
    const globalWild = this.entries.find(
      e => e.artifactType === '*' && e.violationReason === '*',
    )
    if (globalWild) return globalWild.buildPrompt(topic, violationReason)

    // Final fallback (should never be reached if defaults are registered)
    return buildDefaultRepairPrompt(topic, violationReason)
  }
}

// ─── Default repair prompts ───────────────────────────────────────────────────

function buildDefaultRepairPrompt(topic: string, violationReason: string): string {
  return `
You previously generated content for: "${topic}"

The output failed governance validation with the following violation:
${violationReason}

Please regenerate the content, ensuring you fix the violation.
Be more thorough. Be more specific. Produce richer content.
Return the complete output in the same JSON structure as before.
`.trim()
}

function buildCarouselRichnessRepairPrompt(topic: string, violationReason: string): string {
  return `
You previously generated a LinkedIn carousel for: "${topic}"

The carousel failed semantic governance with this violation:
${violationReason}

Regenerate the FULL carousel with these requirements:
- At least ${CAROUSEL_STRUCTURAL_CONSTRAINTS.minSlides} slides (hook + value slides + evidence + CTA)
- Each slide: compelling headline + 2-3 bullet points of concrete insight
- Hook slide: provocative opening statement, not a generic title
- Evidence slide: specific data points, statistics, or case examples
- CTA slide: clear single action for the reader
- Maintain consistent voice and progression throughout

Return the complete carousel JSON with all slides.
`.trim()
}

// ─── Default registry ─────────────────────────────────────────────────────────

export function createDefaultRepairRegistry(): RepairPromptRegistry {
  return new RepairPromptRegistry()
    .register({
      artifactType: 'carousel',
      violationReason: '*',
      buildPrompt: buildCarouselRichnessRepairPrompt,
    })
    .register({
      artifactType: '*',
      violationReason: '*',
      buildPrompt: buildDefaultRepairPrompt,
    })
}

export const globalRepairRegistry = createDefaultRepairRegistry()


