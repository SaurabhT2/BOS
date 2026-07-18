/**
 * @brandos/contracts — identity-types.ts
 *
 * Canonical identity type definitions — promoted from @brandos/identity-layer v1.1.
 *
 * ARCHITECTURAL RULES:
 *   - This file has ZERO imports from @brandos/identity-layer.
 *   - It is the single source of truth. identity-layer imports FROM here.
 *   - No implementation logic. Pure interfaces and type aliases only.
 *
 * CONSUMER IMPORT PATTERN:
 *   import type { ISemanticIdentity, IVisualIdentity } from '@brandos/contracts'
 */

// ─────────────────────────────────────────────────────────────────────────────
// IDENTITY DIMENSIONS
// ─────────────────────────────────────────────────────────────────────────────

export type SemanticIdentityDimension =
  | 'tonePatterns'
  | 'hookStyle'
  | 'ctaPatterns'
  | 'phraseLibrary'
  | 'formatPreferences'
  | 'narrativePatterns'
  | 'executiveCadence'
  | 'argumentationStyle'
  | 'evidencePatterns'
  | 'vocabularySophistication'
  | 'visualDensity'
  // Phase 2 — Intellectual Identity
  | 'recurringThemes'
  | 'signatureFrameworks'
  | 'corePositions'
  | 'marketNarratives'

export type VisualIdentityDimension =
  | 'colorSystem'
  | 'typographySystem'
  | 'spacingSystem'
  | 'layoutPhilosophy'
  | 'surfaceStyle'
  | 'componentStyle'
  | 'visualHierarchy'
  | 'motionPersonality'
  | 'illustrationStyle'
  | 'brandMood'
  | 'interactionDensity'

export type IdentityDimension = SemanticIdentityDimension | VisualIdentityDimension

export const SEMANTIC_DIMENSIONS: SemanticIdentityDimension[] = [
  'tonePatterns','hookStyle','ctaPatterns','phraseLibrary','formatPreferences',
  'narrativePatterns','executiveCadence','argumentationStyle','evidencePatterns',
  'vocabularySophistication','visualDensity',
  // Phase 2 — Intellectual Identity
  'recurringThemes','signatureFrameworks','corePositions','marketNarratives',
]

export const VISUAL_DIMENSIONS: VisualIdentityDimension[] = [
  'colorSystem','typographySystem','spacingSystem','layoutPhilosophy','surfaceStyle',
  'componentStyle','visualHierarchy','motionPersonality','illustrationStyle',
  'brandMood','interactionDensity',
]

export const ALL_DIMENSIONS: IdentityDimension[] = [
  ...SEMANTIC_DIMENSIONS,
  ...VISUAL_DIMENSIONS,
]

export function isVisualDimension(dim: IdentityDimension): dim is VisualIdentityDimension {
  return (VISUAL_DIMENSIONS as string[]).includes(dim)
}

export function isSemanticDimension(dim: IdentityDimension): dim is SemanticIdentityDimension {
  return (SEMANTIC_DIMENSIONS as string[]).includes(dim)
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL MODEL
// ─────────────────────────────────────────────────────────────────────────────

export type SignalType =
  | 'phrase' | 'tone_pattern' | 'hook_style' | 'cta_pattern' | 'format_preference'
  | 'narrative_pattern' | 'executive_cadence' | 'argumentation_style'
  | 'evidence_pattern' | 'vocabulary_marker'
  | 'color_system' | 'typography_system' | 'spacing_system' | 'layout_philosophy'
  | 'surface_style' | 'component_style' | 'visual_hierarchy' | 'motion_personality'
  | 'illustration_style' | 'brand_mood' | 'interaction_density'

export interface IdentitySignal {
  readonly id: string
  readonly workspaceId: string
  readonly personaId?: string
  readonly dimension: IdentityDimension
  readonly type: SignalType
  readonly value: string
  readonly rawConfidence: number
  readonly frequency: number
  readonly weightedConfidence: number
  readonly status: 'active' | 'pending_review' | 'suppressed' | 'rejected'
  readonly createdAt: string
  readonly lastReinforcedAt?: string
  readonly sourceRequestId?: string
  readonly sourceArtifactScore?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// VISUAL IDENTITY PROFILE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface VisualIdentityColorProfile {
  readonly preferredContrast: string
  readonly paletteStyle: string
  readonly surfaceTone: string
}

export interface VisualIdentityTypographyProfile {
  readonly headingStyle: string
  readonly paragraphDensity: string
  readonly fontPersonality: string
}

export interface VisualIdentityLayoutProfile {
  readonly structure: string
  readonly whitespaceUsage: string
  readonly contentDensity: string
}

// ─────────────────────────────────────────────────────────────────────────────
// ARTIFACT VISUAL METADATA
// ─────────────────────────────────────────────────────────────────────────────

export interface ArtifactVisualMetadata {
  readonly artifactLayout: 'deck' | 'document' | 'website' | 'carousel' | 'dashboard' | 'report' | 'generic'
  readonly sectionCount?: number
  readonly headingCount?: number
  readonly wordCount?: number
  readonly usesCards?: boolean
  readonly usesDataViz?: boolean
  readonly usesImagery?: boolean
  readonly avgWordsPerSection?: number
  readonly bulletCount?: number
  readonly usesSequentialStructure?: boolean
  readonly rendererHints?: Readonly<Record<string, string>>
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLVED SEMANTIC IDENTITY
// ─────────────────────────────────────────────────────────────────────────────

export interface IdentitySnapshot {
  workspaceId: string
  personaId?: string
  version: number
  resolvedAt?: string
  snapshotAt?: string
  tonePatterns: readonly string[]
  hookStyle?: string
  ctaPatterns: readonly string[]
  phraseLibrary: readonly string[]
  formatPreferences: readonly string[]
  narrativePatterns: readonly string[]
  executiveCadence?: string
  argumentationStyle?: string
  evidencePatterns: readonly string[]
  // Phase 2 — Intellectual Identity
  recurringThemes: readonly string[]
  signatureFrameworks: readonly string[]
  corePositions: readonly string[]
  marketNarratives: readonly string[]
  confidenceMap: Readonly<Record<string, number>>
  signalCount: number
  visualSnapshot?: VisualIdentitySnapshot
}

export interface ISemanticIdentity {
  readonly workspaceId: string
  readonly personaId?: string
  readonly resolvedAt: string
  readonly version: number
  readonly hasSubstantialIdentity: boolean
  readonly tonePatterns: readonly string[]
  readonly hookStyle: string | undefined
  readonly ctaPatterns: readonly string[]
  readonly phraseLibrary: readonly string[]
  readonly formatPreferences: readonly string[]
  readonly narrativePatterns: readonly string[]
  readonly executiveCadence: string | undefined
  readonly argumentationStyle: string | undefined
  readonly evidencePatterns: readonly string[]
  // Phase 2 — Intellectual Identity
  readonly recurringThemes: readonly string[]
  readonly signatureFrameworks: readonly string[]
  readonly corePositions: readonly string[]
  readonly marketNarratives: readonly string[]
  readonly confidenceMap: Readonly<Record<string, number>>
  toContextFragment(): string
  toSnapshot(): IdentitySnapshot
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLVED VISUAL IDENTITY
// ─────────────────────────────────────────────────────────────────────────────

export interface VisualIdentitySnapshot {
  workspaceId: string
  personaId?: string
  version: number
  resolvedAt: string
  visualSignalCount: number
  confidenceMap: Record<VisualIdentityDimension, number>
  colorSystem?: VisualIdentityColorProfile
  typographySystem?: VisualIdentityTypographyProfile
  layoutPhilosophy?: VisualIdentityLayoutProfile
  surfaceStyle?: string
  componentStyle?: string
  visualHierarchy?: string
  motionPersonality?: string
  illustrationStyle?: string
  brandMood?: string
  interactionDensity?: string
  spacingSystem?: string
}

export interface IVisualIdentity {
  readonly workspaceId: string
  readonly personaId?: string
  readonly resolvedAt: string
  readonly version: number
  readonly hasSubstantialVisualIdentity: boolean
  readonly confidenceMap: Readonly<Record<VisualIdentityDimension, number>>
  readonly colorSystem: VisualIdentityColorProfile | undefined
  readonly typographySystem: VisualIdentityTypographyProfile | undefined
  readonly layoutPhilosophy: VisualIdentityLayoutProfile | undefined
  readonly surfaceStyle: string | undefined
  readonly componentStyle: string | undefined
  readonly visualHierarchy: string | undefined
  readonly motionPersonality: string | undefined
  readonly illustrationStyle: string | undefined
  readonly brandMood: string | undefined
  readonly interactionDensity: string | undefined
  readonly spacingSystem: string | undefined
  toVisualContextFragment(): string
  toVisualSnapshot(): VisualIdentitySnapshot
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVATION EVENT
// ─────────────────────────────────────────────────────────────────────────────

export interface IObservationEvent {
  readonly requestId: string
  readonly workspaceId: string
  readonly personaId?: string
  readonly artifactType: string
  readonly artifactText: string
  readonly artifactScore: number
  /** V2: raw topic string used to compute source_topic_hash. Not stored. */
  readonly topic?: string
  readonly wasRepaired: boolean
  readonly observedAt: string
  readonly visualMetadata?: ArtifactVisualMetadata
  /**
   * Cognitive Platform Evolution Program, Milestone 3 (Experience Loop),
   * EM-3.4/EM-3.5 — added here (not just on ObservationInput) after a live
   * end-to-end run showed these fields reaching IntelligenceOS as
   * `undefined` on the observation that actually survives Brand Memory's
   * Gate 1 score threshold and gets processed by the Learning Pipeline.
   * Root cause: `recordBrandMemoryAfterPipeline()`
   * (control-plane-layer/src/artifact-pipeline.ts) reports the REAL,
   * post-governance-repair score through THIS type — the orchestrator's
   * own `observe()` call (which EM-3.4 originally enriched) fires with
   * score=0 and is explicitly documented as "redundant but harmless"
   * because Brand Memory's Gate 1 drops anything below its score
   * threshold. Enriching only `ObservationInput`/`orchestrator.ts` missed
   * the call site that actually matters. See
   * `normalizeObservationInput()` below and
   * `recordBrandMemoryAfterPipeline()`'s updated call.
   */
  readonly providerId?: string
  readonly modelId?: string
  readonly routingHint?: string
  readonly tokenUsage?: {
    readonly promptTokens?: number
    readonly completionTokens?: number
    readonly totalTokens?: number
  }
  readonly outcome?: 'success' | 'failure'
  readonly failureReason?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// IDENTITY PROJECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IIdentityProjection — a resolved, confidence-gated view of a single dimension.
 *
 * Built from IdentitySignal aggregation. Skills consume projections via
 * ISkillPersonalizationContext.getProjection().
 *
 * Canonical source of truth for dimension-level confidence.
 */
export interface IIdentityProjection {
  readonly dimension: IdentityDimension
  readonly values: readonly string[]
  /** 0–1, computed from signal weights + recency decay */
  readonly confidence: number
  readonly resolvedAt: string
  readonly entryCount: number
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSONALIZATION SNAPSHOT
// ─────────────────────────────────────────────────────────────────────────────

export interface IPersonalizationSnapshot {
  workspaceId: string
  personaId?: string
  resolvedAt: string
  dimensionCount: number
  highConfidenceDimensions: IdentityDimension[]
  lowConfidenceDimensions: IdentityDimension[]
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSONALIZATION CONTEXT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface VisualPersonalizationContext {
  readonly recommendedVisualDensity: string | undefined
  readonly recommendedTypography: string | undefined
  readonly recommendedLayoutStyle: string | undefined
  readonly recommendedSurfaceStyle: string | undefined
  readonly recommendedBrandMood: string | undefined
  readonly recommendedColorProfile: string | undefined
  readonly confidence: number
  readonly isPersonalized: boolean
  toVisualPromptSection(): string
}

export type SkillType =
  | 'carousel' | 'post' | 'newsletter' | 'thought_leadership'
  | 'strategy_memo' | 'deck' | 'generic'

/**
 * ISkillPersonalizationContext — unified projection-based personalization context.
 *
 * CANONICAL MODEL (v1.2 — replaces flat dimensions/dimensionWeights shape):
 *   - Core: workspaceId, personaId, resolvedAt, projections, getProjection(), toSnapshot()
 *   - Optional skill metadata: skillType, dimensionWeights, visualPersonalization
 *     (populated by identity-layer builder; undefined in raw iskill-runtime builds)
 *
 * IMPLEMENTATION SOURCES:
 *   - iskill-runtime SkillPersonalizationContext: builds from IRawBrandMemoryEntry[];
 *     skillType is undefined at this level.
 *   - identity-layer ISkillPersonalizationContextImpl: builds from ISemanticIdentity +
 *     SkillType; skillType is always set.
 *
 * MIGRATION NOTE: The previous flat interface (skillType, dimensions, dimensionWeights,
 * confidence, isPersonalized) is superseded. identity-layer implementations must add
 * the projections/getProjection/toSnapshot surface. See MIGRATION_GUIDE.md §6.
 */
export interface ISkillPersonalizationContext {
  readonly workspaceId: string
  readonly personaId?: string
  readonly resolvedAt: string
  /** Projection map — per-dimension confidence-gated values */
  readonly projections: Readonly<Partial<Record<IdentityDimension, IIdentityProjection>>>
  /** Skill type context — set by identity-layer builder, undefined in raw runtime builds */
  readonly skillType?: SkillType
  /** Dimension importance weights — set by identity-layer builder */
  readonly dimensionWeights?: Readonly<Partial<Record<IdentityDimension, number>>>
  /** Visual personalization — set when visual identity is available */
  readonly visualPersonalization?: VisualPersonalizationContext
  /** Retrieve values for a dimension, returning [] if below confidence threshold */
  getProjection(dimension: IdentityDimension, confidenceThreshold?: number): string[]
  /** Export snapshot for telemetry and tracing */
  toSnapshot(): IPersonalizationSnapshot
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACTION + MERGE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractionResult {
  readonly workspaceId: string
  readonly personaId?: string
  readonly requestId: string
  readonly signals: readonly IdentitySignal[]
  readonly extractedAt: string
  readonly artifactScore: number
}

export type MergeStrategy = 'reinforce' | 'add' | 'suppress' | 'ignore'

export interface MergeDecision {
  signal: IdentitySignal
  strategy: MergeStrategy
  reason: string
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT PERSONALIZATION
// ─────────────────────────────────────────────────────────────────────────────

export interface PromptPersonalizationContext {
  readonly tone: string
  readonly preferredPhrases: readonly string[]
  readonly avoidPhrases: readonly string[]
  readonly ctaStyle: string | undefined
  readonly hookStyle: string | undefined
  readonly structurePreferences: readonly string[]
  readonly cadenceGuidance: string | undefined
  readonly narrativeFrame: string | undefined
  readonly confidence: number
  readonly isPersonalized: boolean
  toPromptSection(): string
}

// ─────────────────────────────────────────────────────────────────────────────
// VERSIONING + PROFILE
// ─────────────────────────────────────────────────────────────────────────────

export interface IdentityVersionRecord {
  readonly workspaceId: string
  readonly personaId?: string
  readonly version: number
  readonly snapshot: IdentitySnapshot
  readonly createdAt: string
  readonly triggerRequestId?: string
  readonly signalDelta: number
}

export interface IdentityProfile {
  readonly workspaceId: string
  readonly personaId?: string
  readonly currentVersion: number
  readonly currentSnapshot: IdentitySnapshot
  readonly signals: readonly IdentitySignal[]
  readonly versionHistory: readonly IdentityVersionRecord[]
  readonly createdAt: string
  readonly updatedAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export interface IdentityLayerConfig {
  readonly signalScoreThreshold: number
  readonly confidenceThreshold: number
  readonly recencyDecayRate: number
  readonly maxSignalsPerDimension: number
  readonly requireReview: boolean
}

export const DEFAULT_IDENTITY_CONFIG: IdentityLayerConfig = {
  signalScoreThreshold: 65,
  confidenceThreshold: 0.4,
  recencyDecayRate: 0.95,
  maxSignalsPerDimension: 10,
  requireReview: false,
}


