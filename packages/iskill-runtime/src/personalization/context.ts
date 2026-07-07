/**
 * @brandos/iskill-runtime — personalization/context.ts
 *
 * ISkillPersonalizationContext implementation.
 *
 * Converts raw brand memory entries into typed, confidence-gated
 * identity projections. Skills consume projections via getProjection(),
 * which enforces the confidence threshold (default 0.4).
 *
 * RULES:
 *   - No LLM calls. Pure data transformation.
 *   - Confidence-gating is enforced here, not in each skill.
 *   - Persona isolation enforced at construction (workspaceId + personaId scope).
 *   - Recency weighting: entries decayed by 0.95^days_since_creation.
 */

import type {
  IdentityDimension,
  IIdentityProjection,
  ISkillPersonalizationContext,
  IPersonalizationSnapshot,
  SkillType,
  VisualPersonalizationContext,
} from '../contracts'

// ─── Default confidence threshold ─────────────────────────────────────────────

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.4

// ─── Raw brand memory entry (imported shape from control-plane) ───────────────
// NOTE: We define a minimal interface here so iskill-runtime doesn't import
// from control-plane-layer. Callers must map their BrandMemoryEntry to this.

export interface IRawBrandMemoryEntry {
  type: string
  content: string
  status: 'active' | 'archived' | 'pending'
  createdAt: string           // ISO timestamp
  weight?: number             // pre-computed weight (optional)
}

// ─── Dimension mapping ────────────────────────────────────────────────────────

/**
 * Maps brand memory entry types to identity dimensions.
 * Add new entries here as new dimension types emerge.
 *
 * MIGRATION NOTES:
 *   - 'visual_identity' (legacy catch-all) → 'brandMood' (closest visual equivalent)
 *   - 'audience_voice' (legacy label) → 'tonePatterns' (semantic equivalent)
 *   These legacy entry types are remapped rather than dropped to preserve signal value.
 */
const ENTRY_TYPE_TO_DIMENSION: Record<string, IdentityDimension> = {
  phrase:              'phraseLibrary',
  tone_pattern:        'tonePatterns',
  hook_style:          'hookStyle',
  cta_pattern:         'ctaPatterns',
  format_preference:   'formatPreferences',
  narrative_pattern:   'narrativePatterns',
  argumentation_style: 'argumentationStyle',
  evidence_pattern:    'evidencePatterns',
  executive_cadence:   'executiveCadence',
  visual_identity:     'brandMood',      // was 'visualIdentity' (invalid) — remapped
  audience_voice:      'tonePatterns',   // was 'audienceVoice' (invalid) — remapped
  // Phase 2 — Intellectual Identity
  recurring_theme:     'recurringThemes',
  framework:           'signatureFrameworks',
  position:            'corePositions',
  market_narrative:    'marketNarratives',
}

// ─── Recency weight calculation ───────────────────────────────────────────────

const RECENCY_DECAY = 0.95
const RECENCY_ACTIVE_DAYS = 90

function computeRecencyWeight(createdAt: string, precomputedWeight?: number): number {
  if (precomputedWeight !== undefined) return precomputedWeight
  const daysSince = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)
  return Math.pow(RECENCY_DECAY, daysSince)
}

// ─── Confidence calculation ───────────────────────────────────────────────────

function computeConfidence(entries: IRawBrandMemoryEntry[]): number {
  if (entries.length === 0) return 0
  const weights = entries.map(e => computeRecencyWeight(e.createdAt, e.weight))
  const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length
  // Scale: more entries + higher avg weight = higher confidence, capped at 1
  const entryFactor = Math.min(entries.length / 5, 1) // 5 entries = max contribution from count
  return Math.min(avgWeight * 0.6 + entryFactor * 0.4, 1)
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class SkillPersonalizationContext implements ISkillPersonalizationContext {
  readonly workspaceId: string
  readonly personaId?: string
  readonly resolvedAt: string
  readonly projections: Partial<Record<IdentityDimension, IIdentityProjection>>
  // Optional skill-type metadata — undefined at this level (raw brand memory build)
  readonly skillType?: SkillType = undefined
  readonly dimensionWeights?: Readonly<Partial<Record<IdentityDimension, number>>> = undefined
  readonly visualPersonalization?: VisualPersonalizationContext = undefined

  constructor(
    workspaceId: string,
    entries: IRawBrandMemoryEntry[],
    personaId?: string,
  ) {
    this.workspaceId = workspaceId
    this.personaId = personaId
    this.resolvedAt = new Date().toISOString()

    // Group entries by dimension
    const byDimension: Partial<Record<IdentityDimension, IRawBrandMemoryEntry[]>> = {}

    for (const entry of entries) {
      if (entry.status !== 'active') continue

      const dimension = ENTRY_TYPE_TO_DIMENSION[entry.type]
      if (!dimension) continue

      if (!byDimension[dimension]) {
        byDimension[dimension] = []
      }
      byDimension[dimension]!.push(entry)
    }

    // Build projections
    const projections: Partial<Record<IdentityDimension, IIdentityProjection>> = {}

    for (const [dim, dimEntries] of Object.entries(byDimension)) {
      const dimension = dim as IdentityDimension
      const confidence = computeConfidence(dimEntries)

      projections[dimension] = {
        dimension,
        values: dimEntries.map(e => e.content).slice(0, 5),
        confidence,
        resolvedAt: this.resolvedAt,
        entryCount: dimEntries.length,
      }
    }

    this.projections = projections
  }

  getProjection(
    dimension: IdentityDimension,
    confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
  ): string[] {
    const projection = this.projections[dimension]
    if (!projection) return []
    if (projection.confidence < confidenceThreshold) return []
    return [...projection.values]
  }

  toSnapshot(): IPersonalizationSnapshot {
    const dimensions = Object.entries(this.projections) as [IdentityDimension, IIdentityProjection][]
    return {
      workspaceId: this.workspaceId,
      personaId: this.personaId,
      resolvedAt: this.resolvedAt,
      dimensionCount: dimensions.length,
      highConfidenceDimensions: dimensions
        .filter(([, p]) => p.confidence >= DEFAULT_CONFIDENCE_THRESHOLD)
        .map(([d]) => d),
      lowConfidenceDimensions: dimensions
        .filter(([, p]) => p.confidence < DEFAULT_CONFIDENCE_THRESHOLD)
        .map(([d]) => d),
    }
  }
}

// ─── Empty context (for workspaces with no brand memory) ──────────────────────

export class EmptyPersonalizationContext implements ISkillPersonalizationContext {
  readonly workspaceId: string
  readonly personaId?: string
  readonly resolvedAt: string
  readonly projections: Partial<Record<IdentityDimension, IIdentityProjection>> = {}
  readonly skillType?: SkillType = undefined
  readonly dimensionWeights?: Readonly<Partial<Record<IdentityDimension, number>>> = undefined
  readonly visualPersonalization?: VisualPersonalizationContext = undefined

  constructor(workspaceId: string, personaId?: string) {
    this.workspaceId = workspaceId
    this.personaId = personaId
    this.resolvedAt = new Date().toISOString()
  }

  getProjection(_dimension: IdentityDimension, _threshold?: number): string[] {
    return []
  }

  toSnapshot(): IPersonalizationSnapshot {
    return {
      workspaceId: this.workspaceId,
      personaId: this.personaId,
      resolvedAt: this.resolvedAt,
      dimensionCount: 0,
      highConfidenceDimensions: [],
      lowConfidenceDimensions: [],
    }
  }
}

// ─── Builder function ─────────────────────────────────────────────────────────

/**
 * buildPersonalizationContext
 *
 * Factory for constructing ISkillPersonalizationContext from raw brand
 * memory entries. Call this at the execution boundary (control-plane side)
 * before building ISkillExecutionContext.
 */
export function buildPersonalizationContext(
  workspaceId: string,
  entries: IRawBrandMemoryEntry[],
  personaId?: string,
): ISkillPersonalizationContext {
  if (entries.length === 0) {
    return new EmptyPersonalizationContext(workspaceId, personaId)
  }
  return new SkillPersonalizationContext(workspaceId, entries, personaId)
}


