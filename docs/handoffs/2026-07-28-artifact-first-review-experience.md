# Handoff — Artifact-first review experience (Iteration 3 implementation)

**Branch:** `feature/artifact-first-review-experience`
**Status:** Implementation complete, fully validated, not merged, not pushed
(see "Push status" below).

This is the implementation half of a three-part sequence:

1. `BrandOS-Artifact-Experience-UX-Review.md` — Iteration 1, problem diagnosis.
2. `BrandOS-Artifact-Experience-UX-Redesign-Iteration2.md` — Iteration 2,
   approved target design.
3. This branch — Iteration 3, the implementation of (2), treated as approved
   architecture and not re-litigated.

See `UX_IMPLEMENTATION_PROGRESS.md` → "Phase 5" for the same summary in this
repo's own running log format. This document is the fuller handoff.

## Objective

Turn the Create → Preview screen from something that reads as an AI
pipeline/debugging console into something that reads as an enterprise
content platform: the generated artifact dominates the page, one Export
action is unambiguous, saving is invisible and automatic, and every
technical/telemetry surface is consolidated into one closed-by-default
Inspect panel.

## Architectural context

- Monorepo, Turborepo + pnpm workspaces. `packages/presentation-layer` is a
  boundary-enforced pure-UI package (`RULE-9`: no imports from
  `ai-runtime-layer`/`output-control-layer`/`governance-layer`/
  `control-plane-layer`/brand-intelligence) — every new component added here
  is display-only, taking already-computed data as props, never calling
  business-logic layers directly.
- `apps/web/app/(workspace)/workspace/create/page.tsx` is the one consumer
  that owns all business logic (generation, export, feedback, campaign
  persistence) and wires it into the presentation-layer components.
- Confirmed at the type level (`packages/contracts/src/artifact-v2.ts`) that
  `generation_trace: GenerationTrace` and `richness_metrics: RichnessMetrics`
  are both present on the shared base artifact type — every one of Carousel/
  Deck/Report/Newsletter already carries them in the same shape. This is
  what made a single, non-duplicated `insights.ts` builder possible instead
  of one bespoke telemetry-reading implementation per artifact type (the
  duplication Iteration 1 flagged as a problem in its own right).

## Decisions made (and why)

1. **InspectPanel and ExportMenu live in `presentation-layer`, not
   `apps/web`.** They're pure display components (no fetch, no business
   logic) — callbacks in, JSX out — so they belong in the shared UI package
   per its own stated boundary, and are reusable if another consumer ever
   needs the same artifact-review chrome.
2. **SlideViewer is shared between Carousel and Deck, not duplicated.** Both
   moved from an accordion to a single-active-slide viewer; extracting the
   pagination/keyboard/touch logic once avoids the exact kind of duplication
   Iteration 1 called out (the richness/trace blocks were hand-copied across
   three renderer files before this change).
3. **Report moved to a continuous document, not a slide viewer.** A report
   is read start to finish, not paged through — this was an explicit
   Iteration 2/3 requirement ("each artifact type should feel native").
4. **ControlPlanePanel removed from the Advanced rail, not folded in
   whole.** Its read-only fields (score, routing, fixes) are superseded by
   InspectPanel. `RuntimeModeSelector`/`ModelSelector` — genuine settings a
   user chooses, not inspection data — stayed in Advanced. This is a real
   consolidation, not a rename; see "Known gaps" below for what wasn't fully
   ported (`activity_log`, full intent narrative).
5. **Save removed as a step and as a word, not just relabeled.** Verified in
   the SSE result handler that `savedCampaignId` is already set the instant
   generation completes — there was never a save action to perform. Every
   "Save"-branded string was removed, not softened.
6. **Regenerate kept, positioned as a secondary action.** Iteration 2 argued
   for this explicitly (§F.1): with slide editing out of scope, Regenerate
   is a user's only recovery path if they don't like the result. Implemented
   as a text-weight button, after Export in reading order, dispatching to
   the exact same `generate(selectedFormat)` / `generateCarousel()` call the
   original "Generate" button used.
7. **SaveBriefButton was *not* touched or removed.** It saves a resumable
   *brief* (topic/format) for cross-session continuity — a different
   feature from artifact autosave, despite the similar name. Relocated onto
   the single Review step (it used to live behind the now-deleted Save
   step) but its logic is unchanged.

## Implementation summary

See `UX_IMPLEMENTATION_PROGRESS.md` → Phase 5 → "Files changed" for the
complete file list with per-file rationale. Short version: 4 new files in
`presentation-layer` (`InspectPanel.tsx`, `ExportMenu.tsx`, `insights.ts`,
`renderers/shared/SlideViewer.tsx`), 4 renderer files rewritten (chrome
removed, Carousel/Deck moved to SlideViewer, Report moved to a continuous
document, Newsletter reframed), `presentation-layer/src/index.ts` extended
with the new public exports, and `create/page.tsx` restructured (3-step
wizard, new export/inspect wiring, Save step deleted and its contents
merged into Review).

## Validation performed

All green, run against this branch, in this order, after every substantive
edit (not just once at the end):

| Check | Result |
|---|---|
| `npx turbo typecheck` (full monorepo) | ✅ 33/33 tasks |
| `npx turbo test` (full monorepo) | ✅ 32/32 tasks — presentation-layer 49 tests, apps/web 45 tests, no test file edits needed |
| `node scripts/check-workspace.mjs` | ✅ 17 packages |
| `node scripts/check-boundaries.mjs` | ✅ 17 packages |
| `node scripts/lint-imports.mjs` | ✅ no violations |
| `node scripts/check-exports.mjs` | ✅ 17 packages |
| `node scripts/check-circular.mjs` | ✅ no cycles (255 files, native detector — `madge` isn't installed in this sandbox) |
| `node scripts/check-route-boundaries.mjs` | ✅ 60 route files, no violations |
| `npx turbo build --filter=@brandos/web` | ✅ succeeded — 76/76 pages generated, `/workspace/create` prerendered statically |

No ESLint config exists in this repo (predates this change, confirmed in
Phase 0's notes too) — the scripts above are this project's actual enforced
gates per `package.json`'s `validate` script, and all pass.

## Manual review checklist (before merge)

Nothing here was visually verified against a running dev server with real
generated data — only typechecked, unit-tested, and built. Please confirm:

1. **Carousel/Deck SlideViewer** — arrow-key navigation, touch swipe (on an
   actual touch device or emulator), and the dot pagination all move the
   same active-slide index in sync; the prev/next buttons correctly disable
   at the first/last slide.
2. **Report** — long reports (10+ sections) render as a reasonably-paced
   scroll, not an overwhelming wall — may want a "jump to section" affordate
   if real reports run long; not implemented here (out of scope per "don't
   redesign individual slides/sections' content").
3. **ExportMenu** — click the recommended-format button and confirm the
   download fires immediately with no extra dialog; open the "More formats"
   menu and confirm each row downloads on a single click; confirm Canva/
   Figma rows still trigger their existing separate flows (new-tab open /
   handoff-token panel) correctly through the new menu.
4. **InspectPanel** — confirm all five tabs render without error for each
   of the four artifact types, including the honest empty states (e.g.
   Newsletter's Knowledge tab, artifacts with no `generation_trace`).
5. **Autosave line wording** — "Autosaved to Library · Checked against your
   brand guidelines..." — confirm this reads correctly for every
   `qualityStatusLine()` branch (first-try pass, repaired, flagged).
6. **Regenerate** — confirm it correctly re-triggers carousel generation vs.
   other formats (mirrors the exact dispatch the original Generate button
   used) and that it doesn't fire while a generation is already in flight.
7. **Campaign Lite (multiple formats generated in one session)** — confirm
   InspectPanel and the autosave line stay singular (tied to
   `getActiveArtifact()`'s existing precedence) while each artifact type
   still gets its own correctly-scoped ExportMenu.
8. **Accessibility** — InspectPanel's tabs use `role="tablist"`/`role="tab"`;
   SlideViewer uses `role="group"` + `aria-roledescription="carousel"` and
   full keyboard support. Worth a screen-reader pass this environment
   couldn't perform.

## Known risks / intentionally left as technical debt

1. **`ControlPlanePanel`'s `activity_log` and full intent/routing narrative
   are not fully ported into InspectPanel.** I mapped
   `routing.preferred_provider` as a fallback Execution field when an
   artifact has no `generation_trace` of its own, but did not reproduce the
   richer per-attempt activity log or the intent-detection narrative
   (`detected_task`/`complexity`/`ambiguity_level`/`suggested_improvements`)
   that `WhyThisPanel` used to show. If that detail turns out to matter,
   it's a real gap, not an oversight I'm hiding — flagged here and in
   Phase 5's progress-log entry.
2. **`changeOverrideMode` has no UI trigger anymore.** `overrideMode` itself
   is still read and sent on every generate call (behavior unchanged); only
   the toggle UI (`ControlPlanePanel`'s override selector) that used to call
   its setter is gone. I left the setter defined rather than remove state I
   couldn't fully trace every consumer of — a quick grep-and-confirm, then
   delete, is a reasonable five-minute follow-up.
3. **Newsletter's Knowledge pillar is always empty** — that artifact type
   has no citation/data-point field in its contract. InspectPanel shows its
   honest empty state; nothing was fabricated to fill the tab.
4. **No visual/manual QA was possible in this sandbox** (no real Supabase
   data, no interactive browser session) — everything above is typecheck +
   unit test + build verified, not eyeballed. See the manual review
   checklist above.
5. **`RECOMMENDED_FORMAT`/`SECONDARY_FORMATS` are static per-artifact-type
   maps in `create/page.tsx`**, matching the prior `ExportToolbar`'s
   `PRIMARY` table exactly (same formats, same defaults) — no behavior
   change, just relocated. If format availability ever needs to vary by
   workspace tier or artifact content, this is the place to make it
   dynamic; it isn't today (and wasn't before this change either).

## Independent critique

Reviewing this as the same kind of critic who wrote Iteration 1:

- **The five-pillar taxonomy (Execution/Quality/Knowledge/Identity/
  Learning) is honest but uneven in richness.** Execution and Quality have
  real, always-available data. Knowledge and Identity are thin for some
  artifact types (Newsletter has no Knowledge data at all; Identity is a
  single boolean). That's not a bug — it's what's actually true about the
  system — but a product reviewer might reasonably ask whether a
  five-tab UI is the right shape when two of the five tabs are frequently
  near-empty. An alternative would've been to only render tabs with data,
  but Iteration 2/3's brief explicitly wanted a "predictable" taxonomy
  across artifact types, so I kept all five with honest empty states rather
  than a shape-shifting panel. Worth revisiting with real usage data.
- **Regenerate's placement is a judgment call, not a certainty.** I put it
  as a quiet secondary action next to Export. An equally defensible
  alternative was making it a small icon-only button to reduce label noise
  further. I chose a labeled text button for discoverability given it's a
  genuinely new pattern for this screen (previously the only "try again"
  path was navigating back through the wizard).
- **I did not attempt to make Carousel/Deck's SlideViewer visually distinct
  from each other beyond their existing color/type theming** — both use the
  same pagination chrome. Iteration 3's brief asked for each type to "feel
  native"; I judged that Carousel and Deck are similar enough in structure
  (both are literally sequences of slides) that sharing the viewer shell
  while keeping their existing distinct visual identity (gradients, slide
  type badges, stats blocks vs. bullets) satisfies that requirement without
  inventing two different pagination patterns for no real gain. A more
  ambitious take might disagree.
- **The ControlPlanePanel gap (risk #1 above) is the one piece of this
  implementation I'm least confident about.** I chose to consolidate rather
  than preserve every field, on the judgment that a two-panel "somewhat
  consolidated" outcome would be worse than a one-panel "mostly
  consolidated, with a documented gap" outcome — but I'd want a real
  product owner to confirm the intent-detection narrative isn't relied on
  by anyone before calling this fully closed.
- **Compromise, stated plainly:** this implementation trades some of
  `WhyThisPanel`'s narrative richness (full sentences explaining *why*
  BrandOS routed a request a certain way) for InspectPanel's more
  tabular, scannable format. That's the right trade for an artifact-first,
  glanceable inspection experience — but it is a real trade, not a strict
  improvement on every axis.

## Push status

This branch exists locally in the sandbox this work was done in
(`feature/artifact-first-review-experience`, based on `main`, all changes
committed — see the final commit for the full file list). I do not have
GitHub write credentials in this environment (this was an anonymous HTTPS
clone), so **I could not push this branch or open a PR**. To get this into
review:

```
# from a machine/environment with push access to SaurabhT2/BOS:
git remote add sandbox <path-or-bundle-from-this-session>   # or apply the diff directly
git push origin feature/artifact-first-review-experience
gh pr create --base main --head feature/artifact-first-review-experience \
  --title "Artifact-first review experience (Iteration 3)" \
  --body-file docs/handoffs/2026-07-28-artifact-first-review-experience.md
```

Per this project's repository rules, nothing here was merged into `main` —
this handoff and the branch are the full deliverable; a human (or the next
agent, with push access) needs to actually open the PR.

## Recommended next steps

1. Push the branch and open the PR (see above).
2. Work through the manual review checklist against a real dev environment
   with actual generated artifacts.
3. Decide on risk #1 (ControlPlanePanel's `activity_log`/intent narrative) —
   confirm it's safe to leave out permanently, or file a follow-up to port
   it into InspectPanel's Execution tab.
4. Quick five-minute cleanup of `changeOverrideMode` (risk #2) once
   confirmed nothing else depends on it.
5. Revisit the five-pillar Inspect taxonomy after real usage — is a
   sometimes-empty Knowledge/Identity tab worth its place, or should
   InspectPanel only render tabs with data?
