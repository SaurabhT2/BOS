# AGENT_CONTEXT — @brandos/design-tokens

**Layer:** L1.5 — Design Token Vocabulary (Rendering V2)
**Maturity:** New (Rendering V2 Phase 1)
**Build order position:** inserted after `@brandos/contracts`, before `@brandos/composition-layer`
**Last updated:** Rendering V2 Phase 1

> Zero dependencies. Values only. No resolution logic, no artifact reads, no renderer code.

---

## Package Purpose

The single named vocabulary of visual primitives every rendering layer resolves into or reads from: color palette roles, a type scale, a spacing scale, radii, and named visual presets matching `ArtifactV2.SemanticTheme.visual_preset`'s existing literal union (`executive-dark | modern-light | vibrant | minimal | corporate | social`).

Introduced to close Finding H-3 from `RENDERING_ARCHITECTURE_AUDIT.md` (no shared design-token source; three independent hex/pixel/point-size tables across the HTML, PPTX, and React renderers) and to serve as the prerequisite vocabulary `@brandos/composition-layer`'s `resolveTheme()` resolves `semantic_theme` into — see `RENDERING_ARCHITECTURE_V2.md` §2.2 and `DESIGN_SYSTEM_ARCHITECTURE.md` for the full rationale on scope and sequencing.

---

## Responsibilities

| Domain | File | What it owns |
|---|---|---|
| Palette roles | `colors.ts` | `PaletteRoles` interface, hex validation/normalization helpers |
| Type scale | `typography.ts` | `TypeScale`, `TypographyTokens`, `BASE_TYPE_SCALE`, `DEFAULT_FONT_STACK` |
| Spacing scale | `spacing.ts` | `SpacingTokens`, `BASE_SPACING` |
| Radii | `radii.ts` | `RadiusTokens`, `BASE_RADII` |
| Named presets | `presets.ts` | `DESIGN_PRESETS` (one entry per `visual_preset` value), `getPreset()`, `isVisualPresetName()` |

---

## Non-Responsibilities

- Does **not** read `ArtifactV2`, `semantic_theme`, or `carousel_meta.palette` — it has no artifact-shaped input at all. Reading those fields and choosing/overriding a preset is `@brandos/composition-layer`'s `resolveTheme()` responsibility, not this package's.
- Does **not** decide layout archetypes (`layout_hint` resolution is also `@brandos/composition-layer`, in a different module — `resolveLayout()`).
- Does **not** know about any renderer's format-specific geometry (a `'split'` layout's CSS grid vs. PPTX text-box positions) — that is renderer-owned per `RENDERER_CONTRACT.md`.
- Does **not** implement `BrandProfile`/brand-specific per-workspace overrides — that is `@brandos/brand-intelligence`'s (L6) domain; this package holds only house-default values.
- Elevation, density, and motion tokens are deliberately **not** included in this phase — no current renderer has a consumer for them (see `DESIGN_SYSTEM_ARCHITECTURE.md` §2 for the explicit per-category decision table).

---

## Dependency rule

**Zero dependencies on any other `@brandos/*` or `@platform/*` package.** This is enforced by `scripts/check-boundaries.mjs` (see `scripts/shared/package-registry.mjs`'s `LAYER_TIERS`, where this package sits at its own tier immediately after `@brandos/contracts` and before `@brandos/composition-layer`). A token package with dependencies on the layers that consume it would be a circular-import risk the moment someone wants to derive a token from artifact data — that derivation belongs in Theme Resolution (`composition-layer`), not here.

---

## Consumers

- `@brandos/composition-layer` — `resolveTheme()` (the primary, and for Phase 1 the *only production*, consumer).
- `apps/web/lib/artifact-export-html.ts` (Phase 3+) — imports resolved token values to emit CSS custom properties.
- `apps/web/lib/artifact-export-pptx.ts` (Phase 5+) — imports resolved token values as its hex-string source.

---

## Testing

`vitest run` (`pnpm --filter @brandos/design-tokens test`). Coverage thresholds: 95% statements/functions/lines, 90% branches (matches `@brandos/contracts`'s convention). Notably, `presets.test.ts` enforces that `DESIGN_PRESETS`'s key set stays exactly in sync with `ArtifactV2.SemanticTheme.visual_preset`'s literal union — since this package deliberately does not import that type (zero-dependency rule above), this test is the mechanism that catches drift if the schema's preset union ever changes.
