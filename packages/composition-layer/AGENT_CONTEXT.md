# AGENT_CONTEXT — @brandos/composition-layer

**Layer:** L1.75 — Composition (Rendering V2)
**Maturity:** New (Rendering V2 Phase 2)
**Build order position:** inserted after `@brandos/design-tokens`, before `@brandos/shared-utils`
**Last updated:** Rendering V2 Phase 2

> Depends only on `@brandos/contracts` (for `ArtifactV2` types) and `@brandos/design-tokens`. Deliberately NOT dependent on `@brandos/governance-layer` or `@brandos/artifact-engine-layer` — this package consumes an already-governed artifact object at runtime; it never imports the packages that produce one.

---

## Package Purpose

The single place `ArtifactV2`'s presentation-intent fields — `semantic_theme`, `carousel_meta.palette`/`font_style`, `layout_hint`, `emphasis_keywords` — are read and resolved into a renderer-agnostic `CompositionDocument`. Closes Findings C-2, C-3, and P-1/P-2 from `RENDERING_ARCHITECTURE_AUDIT.md` (these fields are fully specified in the schema and confirmed, by direct grep, to be read by zero export renderers today).

Full design rationale: `COMPOSITION_MODEL.md`. Full type definitions: `packages/composition-layer/src/types.ts` (kept in sync with that document — if they diverge, the code wins, and the doc should be corrected).

---

## Responsibilities

| Module | Responsibility |
|---|---|
| `theme.ts` | `resolveTheme(artifact, brandContext?)` — the only reader of `semantic_theme` and `carousel_meta.palette`/`font_style`. |
| `layout.ts` | `resolveLayout(ctx, artifactType, strategy?)` — the only reader of `layout_hint`. Carousel and deck have *different* `layout_hint` literal unions; report and newsletter have *no* `layout_hint` field at all (verified directly against `packages/contracts/src/artifact-v2.ts` — this is not what the original audit's summary implied at a glance, and mattered for how this module had to be designed). See `LayoutResolutionStrategy` for the pluggable-strategy seam Phase 8 (layout intelligence) extends. |
| `compose.ts` | `composeArtifact(artifact, options?)` — the only caller of `resolveTheme()`/`resolveLayout()`; assembles the full `CompositionDocument`; folds `emphasis_keywords` into block-level `emphasis` spans instead of silently dropping them (today, only the Studio `CarouselRenderer` even notices this field — no export renderer does). |
| `renderer-contract.ts` | `Renderer<T>` interface every format renderer implements — see `RENDERER_CONTRACT.md`. Type-only; no implementations live here. |
| `types.ts` | `CompositionDocument`/`CompositionUnit`/`CompositionBlock`/`ResolvedTheme`/`ResolvedLayout`. Type-only. |

---

## Non-Responsibilities

- **No format-specific geometry.** A `'split'` `ResolvedLayout` value does not know it becomes a CSS grid in HTML and two positioned text boxes in PPTX — that is renderer-owned (`RENDERER_CONTRACT.md` §2).
- **No I/O, no LLM calls, no governance re-validation.** Pure function of its inputs. If a caller passes a value that isn't actually schema-valid (e.g. bypassed governance), `composeArtifact()` fails fast with `UnsupportedArtifactTypeError` rather than guessing.
- **No persistence.** `CompositionDocument` is derived and disposable by default; it is deliberately content-addressable (`artifactId` + `artifactVersion`) so a future caching layer (Roadmap Phase 10) can be added without a shape change, but this package does not implement caching itself.
- **`landing_page` / `social_post` / `thread` are out of scope.** `ArtifactV2` (the actual exported union type) only has 4 members — `CarouselArtifact | DeckArtifact | ReportArtifact | NewsletterArtifact` — matching the current export pipeline's own real scope. `composeArtifact()` throws a clear, named error for anything else rather than silently no-op'ing; this is a defensive runtime guard for malformed/ungoverned input, since TypeScript itself considers the branch unreachable for well-typed `ArtifactV2` values.

---

## Known, documented interpretation calls (not bugs — see code comments at the cited location for full rationale)

- `carousel_meta.palette` is an unordered `string[]` with no named roles. `theme.ts` interprets index 0 → `primary`, index 1 → `accent`, index 2 → `background`, and ignores anything beyond index 2. This is a deliberate, documented convention for an otherwise-ambiguous field, not a guess buried in behavior.
- `carousel_meta.font_style` (a descriptive label like `"elegant serif"`, not a CSS font-family value) is intentionally **not** consumed — mapping arbitrary descriptive labels to concrete font stacks would need a curated lookup table with no current specification for what labels exist, which would be a speculative abstraction. `semantic_theme.fontTitle`/`fontBody` (which ARE font-family values) are consumed instead.
- `ReportSection.data_points` (`{ label, value, source? }`) has no natural `stat-row`-shaped equivalent (`stat-row`'s `delta` means a change indicator, not a citation) — `compose.ts` renders these as a formatted `evidence-list` instead of stretching `stat-row` to mean something it doesn't.
- Carousel and report `CompositionUnit`s are marked `pageBreak: 'avoid'` (protect each unit from a mid-unit break); deck units are `'always'` for `cover`/`divider`/`closing` types and `'avoid'` otherwise; report and newsletter (flowing-document formats) default to `'auto'`, with newsletter's `divider` type as the one `'always'` exception. This extends a protection the audit found deck-only today to carousel — an explicit, intentional behavior change for the PDF renderer (Phase 4), not a silent one.

---

## Dependency rule

Two dependencies only: `@brandos/contracts` (types), `@brandos/design-tokens` (values). Enforced by `scripts/check-boundaries.mjs`. No renderer library (`pptxgenjs`, `puppeteer-core`, `react`) may ever appear in this package's dependencies — the moment one does, this package has silently become a fourth renderer instead of the renderer-agnostic layer every renderer sits on.

---

## Testing

`vitest run` (`pnpm --filter @brandos/composition-layer test`). **Important repo-wide finding surfaced while building this package's tests:** the standard `tsconfig.json`/`typecheck` pattern used across this repo excludes `__tests__` from `tsc --noEmit`, and vitest's esbuild transform does not type-check either — meaning test fixtures can silently drift out of sync with the schema with no tooling ever catching it (confirmed: `packages/presentation-layer/__tests__/contract/renderers.contract.test.ts`'s `REPORT_FIXTURE`/`BASE_FIELDS` use field names — `section`/`type: 'executive_summary'`/`title`, `primary_role`/`seniority_level`, `arc_type`/`tension`/`key_insight` — that do not exist anywhere on the current schema, and this has never been caught). This package adds `tsconfig.typecheck.json` (included via the `typecheck` script) specifically to include test files in type-checking, and it immediately caught a real error in this package's own fixtures during development. Recommend this pattern be adopted repo-wide as a separate, small hygiene task — out of scope for Rendering V2 itself, noted here for visibility.

Coverage thresholds: 90% statements/functions/lines, 85% branches. Current actuals: 99.65% statements, 92% branches, 100% functions/lines.
