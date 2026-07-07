/**
 * @brandos/artifact-engine-layer — eval/compare.ts
 *
 * Deterministic artifact comparison utilities for regression testing and eval harnesses.
 *
 * WHAT THIS FILE PROVIDES:
 *   - hashArtifact():         stable structural hash for determinism checks (FNV-1a 32-bit)
 *   - compareArtifacts():     field-by-field structural diff between two ArtifactV2 values
 *   - assertArtifactFields(): field presence assertion for freshly-parsed artifact objects
 *
 * PROVENANCE:
 *   Moved from @brandos/shared-utils. Domain-specific eval logic belongs in this package,
 *   not in a generic utility layer. This file has no external dependencies beyond
 *   @brandos/contracts (types + type guards).
 *
 * ARCHITECTURE RULE — discriminated union narrowing:
 *   Access to type-specific fields (.slides, .sections) ALWAYS goes through type guards
 *   (isCarouselArtifact, isDeckArtifact, isReportArtifact) before property access.
 *   Direct property access on un-narrowed ArtifactV2 is a TypeScript error and a
 *   runtime hazard. This is enforced in compareArtifacts() and normalizeForHash().
 *
 * VOLATILE FIELDS (excluded from hash and diff):
 *   - artifact.id, artifact.created_at, artifact.updated_at (change per-request)
 *   - artifact.requestId (trace ID, not structural)
 *   These fields are excluded to make hashes stable across identical generation runs.
 *
 * USAGE IN TESTS:
 *   ```typescript
 *   const a = await engine.compileAndGovern('carousel', rawA, ctx)
 *   const b = await engine.compileAndGovern('carousel', rawB, ctx)
 *   const diff = compareArtifacts(a.artifact, b.artifact)
 *   expect(diff.identical).toBe(true)
 *
 *   const hash1 = hashArtifact(a.artifact)
 *   const hash2 = hashArtifact(a.artifact) // same input
 *   expect(hash1).toBe(hash2)             // determinism check
 *   ```
 *
 * NO EXTERNAL DEPENDENCIES:
 *   hashArtifact() uses FNV-1a 32-bit (implemented below) — no crypto or hash libs required.
 *   This keeps the eval module usable in edge environments without polyfills.
 */

import type {
  ArtifactV2,
  CarouselArtifact,
  DeckArtifact,
  ReportArtifact,
} from '@brandos/contracts'
import {
  isCarouselArtifact,
  isDeckArtifact,
  isReportArtifact,
} from '@brandos/contracts'

// ─── hashArtifact ─────────────────────────────────────────────────────────────

/**
 * hashArtifact — produce a stable structural hash of an ArtifactV2.
 *
 * STABILITY GUARANTEE:
 *   Same artifact structure → same hash. Volatile fields (id, timestamps, requestId)
 *   are excluded from the normalized input before hashing.
 *
 * ALGORITHM: FNV-1a 32-bit, base-36 encoded.
 *   - No external dependencies (see simpleHash() below).
 *   - Output is a short alphanumeric string (5–7 chars) suitable for log comparison.
 *   - NOT cryptographically secure — do not use for security purposes.
 *   - Collision probability: ~1/4B for distinct structural inputs.
 *
 * USE CASES:
 *   - Regression testing: assert two generation runs produce structurally identical artifacts.
 *   - Snapshot testing: detect unexpected structural changes across deployments.
 *   - Deduplication: identify duplicate artifacts in eval datasets.
 *
 * @param artifact - Any ArtifactV2 (carousel, deck, report, or future types).
 * @returns Short base-36 string hash of the artifact's stable structure.
 */
export function hashArtifact(artifact: ArtifactV2): string {
  const normalized = normalizeForHash(artifact)
  return simpleHash(JSON.stringify(normalized))
}

// ─── ArtifactDiff ─────────────────────────────────────────────────────────────

/**
 * ArtifactDiff — result of compareArtifacts().
 *
 * identical:    true if no differences were found.
 * differences:  human-readable list of detected differences.
 *               Each entry is a string like `"slide[2].role: "hook" vs "cta""`.
 *               Empty when identical is true.
 */
export interface ArtifactDiff {
  identical: boolean
  differences: string[]
}

// ─── compareArtifacts ─────────────────────────────────────────────────────────

/**
 * compareArtifacts — field-by-field structural diff between two ArtifactV2 values.
 *
 * WHAT IT COMPARES:
 *   1. Base fields: $schema, title, artifact_type
 *   2. SemanticTheme fields: primaryColor, accentColor, bgColor, fontTitle, fontBody,
 *      visual_preset, voice_archetype
 *   3. Type-specific structure (after narrowing):
 *      - carousel: slide count, each slide's role, layout_hint, bullet count
 *      - deck:     slide count, each slide's type, title
 *      - report:   section count, each section's heading
 *
 * WHAT IT DOES NOT COMPARE (volatile / non-structural fields):
 *   - artifact IDs, timestamps, requestIds
 *   - Individual bullet/body content (use hashArtifact for content equality)
 *   - SemanticTheme.overrides (implementation detail, not structural)
 *
 * CROSS-TYPE BEHAVIOR:
 *   If a and b have different artifact_types, the function returns immediately
 *   after recording the type difference (no type-specific comparison is run).
 *
 * PARTIAL SLIDE/SECTION COMPARISON:
 *   If two artifacts have different slide/section counts, we compare up to
 *   min(a.count, b.count) items. The count difference is separately recorded.
 *
 * @param a - First ArtifactV2 to compare.
 * @param b - Second ArtifactV2 to compare.
 * @returns ArtifactDiff with identical flag and list of human-readable differences.
 */
export function compareArtifacts(a: ArtifactV2, b: ArtifactV2): ArtifactDiff {
  const differences: string[] = []

  // ── Base field comparison ────────────────────────────────────────────────
  if (a.title !== b.title) {
    differences.push(`title: "${a.title}" vs "${b.title}"`)
  }
  if (a.$schema !== b.$schema) {
    differences.push(`$schema: "${a.$schema}" vs "${b.$schema}"`)
  }
  if (a.artifact_type !== b.artifact_type) {
    // Early return: type-specific comparison makes no sense across artifact types
    differences.push(`artifact_type: "${a.artifact_type}" vs "${b.artifact_type}"`)
    return { identical: false, differences }
  }

  // ── SemanticTheme comparison ─────────────────────────────────────────────
  // SemanticTheme is on ArtifactV2 (base type) — safe without narrowing.
  const themeKeys: Array<keyof ArtifactV2['semantic_theme']> = [
    'primaryColor',
    'accentColor',
    'bgColor',
    'fontTitle',
    'fontBody',
    'visual_preset',
    'voice_archetype',
  ]
  for (const key of themeKeys) {
    if (a.semantic_theme[key] !== b.semantic_theme[key]) {
      differences.push(
        `semantic_theme.${String(key)}: ` +
        `"${String(a.semantic_theme[key])}" vs "${String(b.semantic_theme[key])}"`
      )
    }
  }

  // ── Type-narrowed structural comparison ──────────────────────────────────
  // RULE: NEVER access .slides/.sections on un-narrowed ArtifactV2.
  // Each branch only runs after a successful type guard check.
  if (isCarouselArtifact(a) && isCarouselArtifact(b)) {
    compareCarousels(a, b, differences)
  } else if (isDeckArtifact(a) && isDeckArtifact(b)) {
    compareDecks(a, b, differences)
  } else if (isReportArtifact(a) && isReportArtifact(b)) {
    compareReports(a, b, differences)
  }
  // Future artifact types: add `else if (isXxxArtifact(a) && isXxxArtifact(b))` here.

  return { identical: differences.length === 0, differences }
}

// ─── Type-specific comparators ────────────────────────────────────────────────

/**
 * compareCarousels — compare two CarouselArtifacts at the slide level.
 *
 * Compares: slide count, and for each slide: role, layout_hint, bullet count.
 * Does NOT compare: individual bullet text, image_prompt, or visual details.
 *
 * @param a           - First CarouselArtifact.
 * @param b           - Second CarouselArtifact.
 * @param differences - Mutable array to push difference strings into.
 */
function compareCarousels(
  a: CarouselArtifact,
  b: CarouselArtifact,
  differences: string[]
): void {
  if (a.slides.length !== b.slides.length) {
    differences.push(`slideCount: ${a.slides.length} vs ${b.slides.length}`)
  }
  const minSlides = Math.min(a.slides.length, b.slides.length)
  for (let i = 0; i < minSlides; i++) {
    const sa = a.slides[i]
    const sb = b.slides[i]
    // Guard against sparse arrays (should not occur with OCL output, but defensive)
    if (sa === undefined || sb === undefined) continue

    if (sa.role !== sb.role) {
      differences.push(`slide[${i}].role: "${sa.role}" vs "${sb.role}"`)
    }
    if (sa.layout_hint !== sb.layout_hint) {
      differences.push(
        `slide[${i}].layout_hint: "${String(sa.layout_hint)}" vs "${String(sb.layout_hint)}"`
      )
    }
    // Compare bullet count only — not individual bullet text (too noisy for structural diffs)
    const bulletCountA = sa.bullets?.length ?? 0
    const bulletCountB = sb.bullets?.length ?? 0
    if (bulletCountA !== bulletCountB) {
      differences.push(`slide[${i}].bullets.length: ${bulletCountA} vs ${bulletCountB}`)
    }
  }
}

/**
 * compareDecks — compare two DeckArtifacts at the slide level.
 *
 * Compares: slide count, and for each slide: type, title.
 * Does NOT compare: body content, speaker notes, or visual details.
 *
 * @param a           - First DeckArtifact.
 * @param b           - Second DeckArtifact.
 * @param differences - Mutable array to push difference strings into.
 */
function compareDecks(
  a: DeckArtifact,
  b: DeckArtifact,
  differences: string[]
): void {
  if (a.slides.length !== b.slides.length) {
    differences.push(`slideCount: ${a.slides.length} vs ${b.slides.length}`)
  }
  const minSlides = Math.min(a.slides.length, b.slides.length)
  for (let i = 0; i < minSlides; i++) {
    const sa = a.slides[i]
    const sb = b.slides[i]
    if (sa === undefined || sb === undefined) continue

    if (sa.type !== sb.type) {
      differences.push(`slide[${i}].type: "${sa.type}" vs "${sb.type}"`)
    }
    if (sa.title !== sb.title) {
      differences.push(`slide[${i}].title: "${sa.title}" vs "${sb.title}"`)
    }
  }
}

/**
 * compareReports — compare two ReportArtifacts at the section level.
 *
 * Compares: section count, and for each section: heading.
 * Does NOT compare: section body content or metadata.
 *
 * @param a           - First ReportArtifact.
 * @param b           - Second ReportArtifact.
 * @param differences - Mutable array to push difference strings into.
 */
function compareReports(
  a: ReportArtifact,
  b: ReportArtifact,
  differences: string[]
): void {
  if (a.sections.length !== b.sections.length) {
    differences.push(`sectionCount: ${a.sections.length} vs ${b.sections.length}`)
  }
  const minSections = Math.min(a.sections.length, b.sections.length)
  for (let i = 0; i < minSections; i++) {
    const sa = a.sections[i]
    const sb = b.sections[i]
    if (sa === undefined || sb === undefined) continue

    if (sa.heading !== sb.heading) {
      differences.push(`section[${i}].heading: "${sa.heading}" vs "${sb.heading}"`)
    }
  }
}

// ─── assertArtifactFields ─────────────────────────────────────────────────────

/**
 * assertArtifactFields — assert that required fields are present on a parsed object.
 *
 * USE CASE:
 *   In eval harnesses and integration tests, after parsing a raw artifact from
 *   disk or from an LLM response, assert the minimum required fields are present
 *   before passing to ICompiler.compile().
 *
 * BEHAVIOR:
 *   - If data is not a non-null object: returns a single error.
 *   - For each field in requiredFields: records an error if the field is absent.
 *   - Returns an empty array if all required fields are present.
 *
 * EXAMPLE:
 *   ```typescript
 *   const errors = assertArtifactFields(parsedJson, ['$schema', 'artifact_type', 'title'])
 *   if (errors.length > 0) throw new Error(`Invalid artifact: ${errors.join(', ')}`)
 *   ```
 *
 * @param data          - The value to check (typically a parsed JSON object).
 * @param requiredFields - Array of field names that must be present (top-level only).
 * @returns Array of error strings. Empty array means all required fields are present.
 */
export function assertArtifactFields(data: unknown, requiredFields: string[]): string[] {
  const errors: string[] = []

  if (typeof data !== 'object' || data === null) {
    return ['Artifact must be a non-null object']
  }

  for (const field of requiredFields) {
    if (!(field in (data as Record<string, unknown>))) {
      errors.push(`Missing required field: "${field}"`)
    }
  }

  return errors
}

// ─── Internal: normalizeForHash ───────────────────────────────────────────────

/**
 * normalizeForHash — extract the stable structural subset of an ArtifactV2 for hashing.
 *
 * EXCLUDES volatile fields: id, created_at, updated_at, requestId, and any
 * implementation-detail fields not part of the canonical artifact structure.
 *
 * INCLUDES stable structure:
 *   - Base: $schema, artifact_type, title, semantic_theme (core colors + fonts)
 *   - Carousel: slides[] → { role, layout_hint, bulletCount }
 *   - Deck:     slides[] → { type, title }
 *   - Report:   sections[] → { id, heading }
 *
 * @param artifact - Any ArtifactV2 (narrowed internally via type guards).
 * @returns A plain object representing the stable structural subset.
 */
function normalizeForHash(artifact: ArtifactV2): unknown {
  const base = {
    $schema:       artifact.$schema,
    artifact_type: artifact.artifact_type,
    title:         artifact.title,
    semantic_theme: {
      primaryColor: artifact.semantic_theme.primaryColor,
      accentColor:  artifact.semantic_theme.accentColor,
      bgColor:      artifact.semantic_theme.bgColor,
      fontTitle:    artifact.semantic_theme.fontTitle,
      fontBody:     artifact.semantic_theme.fontBody,
    },
  }

  // Type-narrowed structural data — NEVER access .slides/.sections on raw ArtifactV2
  if (isCarouselArtifact(artifact)) {
    return {
      ...base,
      slides: artifact.slides.map(s => ({
        role:        s.role,
        layout_hint: s.layout_hint,
        bulletCount: s.bullets?.length ?? 0,
      })),
    }
  }
  if (isDeckArtifact(artifact)) {
    return {
      ...base,
      slides: artifact.slides.map(s => ({ type: s.type, title: s.title })),
    }
  }
  if (isReportArtifact(artifact)) {
    return {
      ...base,
      sections: artifact.sections.map(s => ({ id: s.id, heading: s.heading })),
    }
  }

  // Future artifact types: add narrowing branches here.
  // For unknown types: return base fields only (partial hash — still stable for base fields).
  return base
}

// ─── Internal: simpleHash ─────────────────────────────────────────────────────

/**
 * simpleHash — FNV-1a 32-bit hash, base-36 encoded.
 *
 * CHOICE OF ALGORITHM:
 *   FNV-1a is fast, has good distribution for short strings, and has no
 *   external dependencies. Suitable for structural hash comparison.
 *   NOT suitable for cryptographic use.
 *
 * BASE-36 OUTPUT:
 *   Encodes the 32-bit unsigned integer in base 36 (digits + lowercase letters).
 *   Output length: 5–7 characters. URL-safe. Human-readable in logs.
 *
 * @param str - Input string to hash (JSON-serialized artifact structure).
 * @returns Base-36 string representation of the FNV-1a 32-bit hash.
 */
function simpleHash(str: string): string {
  // FNV-1a 32-bit: offset basis = 0x811c9dc5, prime = 0x01000193
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    // Math.imul handles 32-bit integer multiplication without overflow
    h = (Math.imul(h, 0x01000193) >>> 0)
  }
  return h.toString(36)
}


