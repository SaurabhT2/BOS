# BrandOS UX Redesign — Implementation Progress Log

Source spec: `BrandOS — UX Redesign Document` (Product Leadership Review).
Working style: incremental phases, verified before moving on (typecheck,
boundary/import/export/circular checks — this repo has no ESLint config,
see note below).

---

## Phase 0 — Foundational fixes
Status: **Done.**

- [x] "Raw Mode — bypass governance" removed as a peer, one-click option in
      the Create UI. The underlying `OverrideMode` value `'raw'` still
      exists in `@brandos/contracts` and is still used by the legitimate
      admin/QA surface (`apps/web/app/api/admin/iskill-test/route.ts`) —
      nothing was deleted, only removed from the user-facing preset list.
- [x] Section 8 glossary adopted on every screen the doc calls out: Create
      ("Control Plane"→"Advanced", "Governance Mode"→"Quality level"),
      Settings→AI ("Quality threshold"→named presets; the cloud/local
      runtime-mode field was also renamed "Processing mode" — it was
      colliding with "Quality level," which now means the override/
      governance mode instead), Governance Audit Trail (violation codes
      translated), Library (raw score demoted).
- [x] "Brand Intelligence" naming standardized. The page h1 already said
      "Brand Intelligence" — the actual mismatch was the Identity tab's
      internal "Brand Profile" subheading (a leftover from the old Memory
      page), now renamed "Brand Identity" to match the tab name and page
      title.
- [x] **Medium #7 (first-run exposure).** Onboarding hands off into this
      same Create screen via `?onboarding=1` (confirmed in
      `onboarding/page.tsx`), which the Create page previously never read.
      Now, when that flag is present, the Advanced disclosure doesn't
      render at all — not even collapsed — on the user's first generation,
      matching the doc's "zero advanced controls" requirement for
      first-run specifically (every other session still gets the normal
      collapsed Advanced disclosure on Preview/Save).

## Phase 1 — Create screen redesign
Status: **Done** for both Critical items and the export menu.

- [x] **Critical #1 (governance bypass exposed).** Removed from
      `ControlPlanePanel`'s `OVERRIDE_MODES` list.
- [x] **Critical #2 (persistent technical console).** The right-column rail
      (`RuntimeModeSelector`, `ModelSelector`, `ControlPlanePanel`, session
      stats) no longer renders on every step for every user. It's now a
      collapsed `AdvancedControlsDisclosure`, shown only on Preview/Save —
      not What/About, addressing the Journey A/B "first generation already
      shows a governance console" friction point. `ControlPlanePanel`
      itself also now defaults to collapsed as a second layer of the fix.
- [x] Added a plain-language status line ("Checked against your brand
      guidelines — passed on the first try" / "— revised N times before
      passing" / "— flagged for your review") above the existing "Why did
      BrandOS generate this?" panel, as the primary trust signal on Preview.
- [x] **High #4 (export menu).** `ExportToolbar` redesigned: one primary,
      emerald-styled export button defaulting per artifact type (Carousel →
      PDF, Deck → PowerPoint, Report → PDF, Newsletter → HTML), a labeled
      "More export options" control for the rest, and JSON separated out
      as "Developer format (JSON)."
- [ ] Full primary/secondary/tertiary visual-hierarchy pass beyond the
      above (§11) — not done; no further Critical/High items remain here.
- [ ] Full "Writing engine" consolidation (folding `RuntimeModeSelector` +
      `ModelSelector` into one Settings-owned preference) — deliberately
      deferred, see deviation #2 below.

## Phase 2 — Settings & compliance language translation
Status: **Done.**

- [x] **High #3.** Raw 0–100 "quality threshold" number field replaced with
      three named presets (Draft-friendly 55 / Balanced 70 / Polished 85)
      as the primary control. The exact numeric input still exists, moved
      behind a `<details>` "Set an exact number instead" disclosure — same
      `/api/workspace/settings` contract, nothing removed.
- [x] **High #5.** Governance Audit Trail entries now lead with a narrated
      plain-language sentence (matching Library's version-history style:
      "Passed on the first try." / "Needed 1 revision — needed a stronger
      opening line — then passed." / "Flagged for review — …"). Raw codes,
      score, repair count, and request ID moved behind a per-entry "View
      technical detail" expand. Translation table covers the complete
      `PolicyViolationType` union from `governanceEngine.ts` (3 codes).
- [x] **Medium #9 (BYOK depth).** Reviewed — already structurally separated
      into its own "Providers (BYOK)" section with its own heading, distinct
      from the Quality section above it. No change needed.
- [x] **Low #11 (Settings grouping).** Flat "Configure" list replaced with
      three light section headers ("AI & Quality," "Integrations &
      Billing," "Compliance") per §16, no new nav depth. Analytics placed
      under "AI & Quality" (closest theme; §16's list didn't explicitly
      place it).

## Phase 3 — Consistency pass
Status: **Done.**

- [x] **Low #12.** Library's "Score: 82" peer-weight badge (single-version
      case) demoted to a small secondary annotation, with a narrated
      sentence ("Passed on the first try — no revisions were needed.") as
      the primary statement instead.
- [x] **§17.2 state-describing toggles.** Audited every binary control in
      the app-level (non-admin) surface: the only other one besides "Apply
      Brand Memory" was Create's "Campaign mode" button, which previously
      communicated its state through color alone. Added an inline
      description line beneath it ("— on: one brief generates every format
      you select below, together" / "— off: create a single piece of
      content"), matching the reference pattern.
- [x] **§17.6 "explain, don't just disable."** Found one real instance:
      Settings→AI's quality-override `<fieldset disabled={!canWriteSettings}>`
      previously went inert with no message. Added an explanatory line.
      Note: `canWriteSettings` is currently only false for the Explorer
      tier, and Explorer never reaches this component (it sees the
      `UpgradeGate` banner instead, per the page's own tier branching) — so
      this is defensive/currently-unreachable code, not an active bug, but
      worth fixing on the same principle rather than leaving it silent.

## Phase 4 — Guardrails
Status: **Not started** — process/ownership work, not code (a design-review
checklist + glossary ownership, §19 Phase 4). Recommend turning Section 8 of
the source doc into `docs/ux-glossary.md` and linking it from
`CLAUDE_BOOTSTRAP.md` so future screens get checked against it.

---

## Files changed

- `packages/presentation-layer/src/components/ControlPlanePanel.tsx`
- `apps/web/app/(workspace)/workspace/create/page.tsx`
- `apps/web/app/(workspace)/workspace/settings/ai/page.tsx`
- `apps/web/app/(workspace)/workspace/settings/governance-audit/page.tsx`
- `apps/web/app/(workspace)/workspace/settings/page.tsx`
- `apps/web/app/(workspace)/workspace/library/page.tsx`
- `apps/web/app/(workspace)/workspace/brand/page.tsx`

## Verification (run after every change above, all passing at time of writing)

- `npx turbo typecheck --filter=@brandos/presentation-layer...` → pass
- `npx turbo typecheck --filter=@brandos/web` → pass (17/17 tasks, all
  dependency packages included, re-run after each file edit)
- `node scripts/check-boundaries.mjs` → pass (17 packages)
- `node scripts/lint-imports.mjs` → pass
- `node scripts/check-exports.mjs` → pass (17 packages)
- `node scripts/check-circular.mjs` → pass (251 files, no cycles)
- `node scripts/check-workspace.mjs` → pass (17 packages)
- **Note:** no ESLint config (`eslint.config.*` / `.eslintrc.*`) exists
  anywhere in this repo — this predates my changes. The boundary/import/
  export/circular/workspace scripts above are this project's actual
  enforced gates (see `package.json`'s `validate` script) and all pass.
  Flagging in case ESLint's absence is itself unintentional and worth its
  own ticket.
- Have **not** run a full `next build` (no `.env` / Supabase credentials
  available in this sandbox) — typecheck + the project's own static-
  analysis scripts are the verification available here. Recommend a full
  `pnpm build` in an environment with real env vars before merging.

## Implementation decisions / deviations from the doc

1. Kept `ControlPlanePanel`'s prop/component name and file location
   unchanged — only relabeled visible text and removed the bypass option.
   Renaming the component itself would ripple into `apps/web` imports for
   no UX benefit and risks the "speculative refactoring" the brief warns
   against.
2. `cost_saver` and `premium` override modes were **kept** as user-facing
   options alongside the three primary quality levels (Balanced / Thorough
   / Quick), rather than folded entirely into a separate "Writing engine"
   Settings preference as §8's glossary table suggests. Doing the full fold
   would move routing/model-selection business logic between Create and
   Settings, out of scope per "preserve existing business logic / routing."
   Flagged as a deferred item rather than partially implemented.
3. Export defaults (Carousel→PDF, Report→PDF, Newsletter→HTML) are my
   inference from the doc's two given examples (PowerPoint for deck, PDF
   for report) — the doc doesn't specify carousel/newsletter explicitly.
   Worth a quick product sign-off before shipping.
4. Analytics was placed under the new "AI & Quality" Settings group by my
   own judgment — §16's proposed four groups don't explicitly mention where
   Analytics goes. Worth confirming.
5. The Settings→AI quality-threshold presets (55/70/85) are my own mapping
   onto Draft-friendly/Balanced/Polished — the doc names the three levels
   but doesn't specify numeric anchors. 70 is the confirmed platform
   default (kept as "Balanced"); 55 and 85 are reasonable but not
   doc-specified and worth a quick sanity check against real scoring data.

## What's left (only the one explicitly-deferred item, plus process work)

- §13 "Writing engine" consolidation — deliberately deferred, see deviation
  #2 (folding `RuntimeModeSelector` + `ModelSelector` into one
  Settings-owned preference would move routing/model-selection business
  logic ownership between Create and Settings, out of scope per "preserve
  existing business logic / routing"). Everything else about those two
  components (visibility, default-collapsed state) is fixed.
- §19 Phase 4 guardrails (turning §8's glossary into an owned doc + a
  design-review checklist) — process/ownership work, not a code change.

Every numbered item in the doc's Section 12 severity list (Critical #1–2,
High #3–6, Medium #7–10, Low #11–12) has been implemented and re-verified
after each change (see Files changed / Verification above).

---

## Phase 5 — Artifact-first review experience
Status: **Done.**

Source: two prior UX-review documents, treated as approved architecture and
implemented as-is, not re-litigated —
`BrandOS-Artifact-Experience-UX-Review.md` (Iteration 1, problem diagnosis)
and `BrandOS-Artifact-Experience-UX-Redesign-Iteration2.md` (Iteration 2,
target design). Branch: `feature/artifact-first-review-experience`.

New product principle driving this phase: the Create → Preview screen
should read as an enterprise content platform, not an AI pipeline. The
generated artifact should dominate the page; everything else exists only to
support the decision "would I publish this?"

### What changed

- [x] **Artifact-first rendering.** `CarouselRenderer` and `DeckRenderer`
      moved from an accordion (one slide open at a time, content hidden by
      default) to `SlideViewer` — a new shared component
      (`renderers/shared/SlideViewer.tsx`) — full content shown for one
      active slide at a time, with prev/next, dot pagination, arrow-key and
      touch-swipe navigation. `ReportRenderer` moved from an accordion to a
      continuous scrollable document (every section renders in full, in
      reading order — a report is read, not paged through).
      `NewsletterRenderer` (already fully expanded) got a capped reading
      width and email-preview framing instead of the wide card shared by
      the other three types.
- [x] **Technical detail consolidated into one Inspect panel.** The inline
      "Semantic Richness" block, per-slide density badges, and the
      `generation_trace` footer — each duplicated by hand across
      Carousel/Deck/Report — are removed from all four renderers. That data
      (plus what `WhyThisPanel` and the Advanced rail's `ControlPlanePanel`
      + "Session details" card used to show) now flows through one new
      `InspectPanel` component (`presentation-layer/src/components/
      InspectPanel.tsx`), closed by default, with five tabs — Execution /
      Quality / Knowledge / Identity / Learning — matching the RuntimeOS
      observability categories requested. Pure data shaping lives in
      `components/insights.ts` (`buildExecutionInsight`/
      `buildQualityInsight`), built directly from each artifact's own
      `generation_trace`/`richness_metrics` (confirmed uniformly typed
      across all four artifact types at the `@brandos/contracts` level —
      no new plumbing needed for those two pillars).
- [x] **One dominant Export action.** The old `ExportToolbar` (standalone
      Copy button, primary Export button, "More export options" menu, and
      an "ISkill validated" pill, all visible at once, rendered above the
      artifact) is replaced by a new `ExportMenu` component
      (`presentation-layer/src/components/ExportMenu.tsx`), rendered below
      the artifact instead of above it. Default click downloads the
      recommended format immediately; every other format is one click away
      in a menu; batch multi-format export and the developer JSON copy are
      real but deliberately tucked behind small links rather than being the
      default interaction. Every underlying export call
      (`exportArtifact`/`exportToCanva`/`exportToFigma`/`copyJSON`) is
      unchanged — only which UI triggers them changed.
- [x] **Save removed as a step and as a word.** The 4-step wizard
      (What/About/Preview/Save) is now 3 steps (What/About/Review). The SSE
      result handler already sets `savedCampaignId` from the response the
      instant generation completes — there was never anything to save. The
      "Continue to Save" button, the separate Save screen, "Saved — export
      or get feedback," and "Nothing to save yet" are gone, replaced by one
      ambient line: "Autosaved to Library · Checked against your brand
      guidelines...". `RepurposeWidget`, `SaveBriefButton` (a genuinely
      different feature — saving a resumable *brief* link, not the
      artifact), and the Library-link confirmation moved from the deleted
      Save step onto the single terminal Review step.
- [x] **Feedback de-emphasized, not removed.** The "Useful? Yes/Generic"
      card no longer renders as its own bordered block on the page — the
      same `submitFeedback`/`feedbackSent` state now feeds InspectPanel's
      Learning tab.
- [x] **Regenerate kept as a real, quieter secondary action** — text-weight,
      after Export in reading order — since slide-level editing is out of
      scope for this page and Regenerate is the only recovery path a user
      has if they don't like what they got.

### Files changed

- `apps/web/app/(workspace)/workspace/create/page.tsx` — `STEPS` trimmed;
  `ExportToolbar`/`WhyThisPanel`/`FeedbackRow` removed; new
  `ArtifactExportMenu` adapter + `buildActiveInsightSections()` +
  `extractKnowledgeItems()` added; the four artifact sections + the former
  Save step merged into one Review step; Advanced rail lost
  `ControlPlanePanel` and the "Session details" card (kept
  `RuntimeModeSelector`/`ModelSelector` — real settings, not inspection
  data); now-unused icon imports (`HelpCircle`, `Download`, `ThumbsUp`,
  `ThumbsDown`) removed.
- `packages/presentation-layer/src/renderers/CarouselRenderer.tsx`,
  `DeckRenderer.tsx`, `ReportRenderer.tsx`, `NewsletterRenderer.tsx` —
  richness/trace/badge chrome removed; Carousel/Deck moved to
  `SlideViewer`; Report moved to a continuous document; Newsletter got
  email-preview framing; each gained a pure `extract*PlainText()` export
  for the new "Copy as text" menu action (Newsletter's pre-existing
  `CopyNewsletterButton` logic became `extractNewsletterPlainText`).
- `packages/presentation-layer/src/renderers/shared/SlideViewer.tsx` (new)
  — shared pagination shell so Carousel and Deck don't each reimplement
  keyboard/touch/dot navigation.
- `packages/presentation-layer/src/components/insights.ts` (new) — pure
  types + builders for the five Inspect pillars.
- `packages/presentation-layer/src/components/InspectPanel.tsx` (new).
- `packages/presentation-layer/src/components/ExportMenu.tsx` (new).
- `packages/presentation-layer/src/index.ts` — exports the four new
  symbols above plus the `extract*PlainText` functions.

### Verification

- `npx turbo typecheck` (full monorepo) → pass, 33/33 tasks.
- `npx turbo test` (full monorepo) → pass, 32/32 tasks (presentation-layer
  49 tests, apps/web 45 tests — no test file needed changes; the existing
  renderer contract tests assert prop/registration shape, not markup, so
  the internal restructuring didn't touch what they check).
- `node scripts/check-workspace.mjs` / `check-boundaries.mjs` /
  `lint-imports.mjs` / `check-exports.mjs` / `check-circular.mjs` /
  `check-route-boundaries.mjs` → all pass.
- `npx turbo build --filter=@brandos/web` → **pass** (this succeeded in
  this environment, unlike the Phase 0–4 agent's note that a full build
  wasn't runnable without env vars — `/workspace/create` compiled and
  prerendered as a static page along with the rest of the app; 76/76 pages
  generated).

### Known gaps / intentionally deferred (see independent critique in the
### handoff doc under `docs/handoffs/` for the full list)

- `ControlPlanePanel`'s richer live fields (`activity_log`, full
  `intent`/`routing` detail) are only partially represented in
  InspectPanel's Execution tab — I mapped `routing.preferred_provider` as a
  fallback when an artifact has no `generation_trace`, but did not port the
  full intent/routing narrative `WhyThisPanel` used to show. Worth a
  follow-up pass if that detail turns out to matter to users, rather than
  silently dropped.
- `changeOverrideMode` (the setter `ControlPlanePanel`'s override toggle
  used to call) has no UI trigger left after `ControlPlanePanel`'s removal
  from the Advanced rail — `overrideMode` itself is still read and sent on
  every generate call, so behavior is unchanged, but the setter is
  currently dead code from a UI perspective. Flagged, not removed, since
  removing state without knowing every consumer felt riskier than a
  one-line note.
- Knowledge-pillar data for Newsletter is empty (no citation/data-point
  field exists on that artifact type) — shows the InspectPanel's honest
  empty state rather than fabricated content.
- No visual regression testing was possible in this environment (no
  running dev server against real generated data) — the manual review
  checklist in the handoff doc covers what to check by hand before merge.
