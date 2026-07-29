// ============================================================
// packages/composition-layer/src/theme.ts
//
// resolveTheme() is the ONE place ArtifactV2.semantic_theme and
// CarouselArtifact.carousel_meta.palette/font_style are read.
// Closes RENDERING_ARCHITECTURE_AUDIT.md Findings C-2/P-1.
//
// No renderer may read semantic_theme or carousel_meta.palette
// directly after this milestone ships (RENDERER_CONTRACT.md §3).
// ============================================================

import type { ArtifactV2 } from '@brandos/contracts'
import { getPreset, normalizeHexColor, isValidHexColor, type PaletteRoles } from '@brandos/design-tokens'
import type { ResolvedTheme } from './types'

/**
 * Minimal, real (not speculative) seam for future @brandos/brand-intelligence
 * (L6) integration — see RENDERING_ARCHITECTURE_V2.md §5. This phase supports
 * exactly one capability through it: an explicit palette-role override map,
 * merged shallowly over the resolved palette. It does not attempt to model
 * the full future BrandProfile shape, since that object does not exist yet
 * and speculating its fields here would be exactly the kind of premature
 * abstraction principle 7 rules out.
 */
export interface BrandContextInput {
  overridePalette?: Partial<PaletteRoles>
}

function applyExplicitColorOverrides(base: PaletteRoles, artifact: ArtifactV2): PaletteRoles {
  const theme = artifact.semantic_theme
  const result = { ...base }

  // ArtifactV2.SemanticTheme documents these as "6-char hex, no #" — normalize
  // defensively (accepts either form) since nothing upstream of this function
  // enforces the "no #" convention at the type level.
  if (theme.primaryColor) result.primary = normalizeHexColor(theme.primaryColor)
  if (theme.accentColor) result.accent = normalizeHexColor(theme.accentColor)
  if (theme.bgColor) result.background = normalizeHexColor(theme.bgColor)

  return result
}

/**
 * carousel_meta.palette is an unordered array of hex strings with no named
 * roles (RENDERING_ARCHITECTURE_AUDIT.md §9: "Color palette as hex strings").
 * The convention adopted here — index 0 → primary, index 1 → accent,
 * index 2 → background — is a documented, deliberate interpretation of an
 * otherwise ambiguous field, not a guess buried in behavior. Entries beyond
 * index 2 are intentionally unused; there is no additional named role for
 * them yet, and inventing one would be speculative.
 */
function applyCarouselMetaPalette(base: PaletteRoles, artifact: ArtifactV2): PaletteRoles {
  if (artifact.artifact_type !== 'carousel') return base
  const palette = artifact.carousel_meta.palette
  if (!palette || palette.length === 0) return base

  const result = { ...base }
  const validated = palette.filter((c) => {
    try {
      normalizeHexColor(c)
      return true
    } catch {
      return false
    }
  })

  if (validated[0]) result.primary = normalizeHexColor(validated[0])
  if (validated[1]) result.accent = normalizeHexColor(validated[1])
  if (validated[2]) result.background = normalizeHexColor(validated[2])

  return result
}

function applyBrandOverride(base: PaletteRoles, brandContext?: BrandContextInput): PaletteRoles {
  if (!brandContext?.overridePalette) return base
  return { ...base, ...brandContext.overridePalette }
}

/**
 * Resolve an artifact's presentation theme exactly once. Falls back to the
 * house default preset ('executive-dark') when semantic_theme carries no
 * visual_preset at all — including the legacy-upcast path
 * (upcastCarouselBlueprint), which sets only visual_preset: 'executive-dark'
 * and nothing else, so it resolves identically to the modern default case.
 *
 * NOTE ON carousel_meta.font_style: this field is a descriptive label
 * (e.g. "elegant serif"), not a CSS font-family/font-stack value — mapping
 * arbitrary descriptive labels to concrete font stacks would require a
 * curated lookup table with no current specification for what labels exist
 * or what they should map to. Building that table now would be a
 * speculative abstraction (principle 7). It is deliberately left unconsumed
 * here; semantic_theme.fontTitle/fontBody (which ARE font-family values) are
 * consumed below.
 */
export function resolveTheme(artifact: ArtifactV2, brandContext?: BrandContextInput): ResolvedTheme {
  const preset = getPreset(artifact.semantic_theme?.visual_preset)

  let palette = applyExplicitColorOverrides(preset.palette, artifact)
  palette = applyCarouselMetaPalette(palette, artifact)
  palette = applyBrandOverride(palette, brandContext)

  const typography = {
    ...preset.typography,
    titleFont: artifact.semantic_theme?.fontTitle ?? preset.typography.titleFont,
    bodyFont: artifact.semantic_theme?.fontBody ?? preset.typography.bodyFont,
  }

  return {
    palette,
    typography,
    spacing: preset.spacing,
    radii: preset.radii,
  }
}

export { isValidHexColor }
