# BrandOS AI Context Generation Pipeline

This document explains how BrandOS keeps its AI-agent-facing context
(`.context/*.generated.*`, `CLAUDE_BOOTSTRAP.md`) synchronized with the
actual codebase. Read this before adding, editing, or removing anything in
`/scripts`.

## TL;DR

```bash
pnpm context:refresh          # regenerate everything, local/sandbox mode
pnpm context:refresh:ci       # regenerate everything, CI mode (DB required)
```

This is **the single supported entry point**. Don't run individual
`generate-*.mjs` scripts by hand as your normal workflow — that's exactly how
this pipeline went stale for an entire platform migration before this
document existed (see "History" below). Individual scripts are still useful
for fast iteration while you're editing one of them (`node
scripts/generate-monorepo-context.mjs`), but the source of truth for "is
`.context/` up to date" is always a full `pnpm context:refresh` run.

## What gets generated

| Output | Generator | Tier |
|---|---|---|
| `.context/schema_inventory.generated.json` | `generate-schema-inventory.mjs` | 1 (DB, best-effort) |
| `.context/agent_entrypoints.generated.md` | `generate-agent-entrypoints.mjs` | 2 |
| `.context/architecture_graph.generated.json` | `generate-architecture-graph.mjs` | 2 |
| `.context/dependency_impact.generated.json` | `generate-dependency-impact.mjs` | 2 |
| `.context/behavior_contracts.generated.json` | `generate-behavior-contracts.mjs` | 2 |
| `.context/monorepo_context.generated.md` | `generate-monorepo-context.mjs` | 2 |
| `.context/runtime_trace.generated.md` | `generate-runtime-trace-context.mjs` | 2 |
| `.context/packages/<pkg>.generated.md` | `generate-package-contexts.mjs` | 2 |
| `.context/architecture_fixes.generated.md` | `generate-architecture-fixes.mjs` | 2 |
| `.context/database_context.generated.md` | `generate-database-context.mjs` | 3 |
| `.context/runtime_model.generated.md` | `generate-runtime-model.mjs` | 3 |
| `.context/system_inventory.generated.md` | `generate-system-inventory.mjs` | 3 |
| `CLAUDE_BOOTSTRAP.md` | `generate-claude-bootstrap.mjs` | 4 |
| `.context/context_refresh_summary.generated.json` (with `--json`) | `context-refresh.mjs` itself | 5 |

**Start reading at `CLAUDE_BOOTSTRAP.md`** — it's the synthesized entry point
and links to everything else. Individual `.context/*.generated.md` files are
for depth on one topic once `CLAUDE_BOOTSTRAP.md` points you there.

## Orchestration order, and why

`scripts/context-refresh.mjs` runs generators in five tiers. The order isn't
arbitrary — it follows real dependencies between generators (some read other
generators' output; a few produce nothing that anything else depends on).
The full rationale lives in the header comment of `context-refresh.mjs`
itself (read it before changing the order); the short version:

1. **Tier 0 — validate, fail fast.** `check-workspace.mjs` and
   `check-boundaries.mjs` run first and **stop the pipeline on failure**.
   Generating polished-looking context documents for a repository that's
   currently in a broken state (missing package, real boundary violation) is
   worse than generating nothing — it actively misleads whoever reads the
   output next.
2. **Tier 1 — DB snapshot, best-effort.** `generate-schema-inventory.mjs`
   needs a live `DATABASE_URL`/`SUPABASE_DB_URL`. In most local/sandbox
   environments that isn't available, and that's fine — this tier is
   soft-skipped with a clear warning, not a hard failure. Pass `--ci` (or run
   `pnpm context:refresh:ci`) to make DB absence fatal, which is what the
   actual CI pipeline should do (a CI environment that's supposed to have
   DB access but doesn't is a real problem worth failing loudly on).
3. **Tier 2 — independent inventories.** These eight generators only read
   `scripts/shared/*.mjs` and the live source tree — no inter-generator
   reads. Order among them doesn't matter; they're grouped for reporting
   clarity, not correctness.
4. **Tier 3 — schema-dependent.** These three prefer
   `.context/schema_inventory.generated.json` (Tier 1's output) for full
   fidelity — table field lists, etc. — but **degrade gracefully** (empty
   field lists, not a crash) if Tier 1 was skipped. They must run *after*
   Tier 1 so they pick up a fresh snapshot when one exists.
5. **Tier 4 — final aggregator.** `generate-claude-bootstrap.mjs` reads
   nearly every artifact from Tiers 2–3. Must run last.
6. **Tier 5 — validate + summarize.** `context-refresh.mjs` itself checks
   that every expected output exists, is non-empty, and doesn't regress a
   short, deliberately narrow set of known staleness patterns (see
   "Regression guard," below) — then prints/writes a summary.

## Adding a new generator

1. Write `scripts/generate-<name>.mjs`. Follow the conventions in
   "Generator conventions" below.
2. Pick the right tier in `context-refresh.mjs`:
   - Does it need `.context/schema_inventory.generated.json`? → Tier 3.
   - Does it need another generator's *output* (not just `shared/*.mjs`)? →
     whichever tier comes after that generator (or a new tier, if the
     dependency doesn't fit the existing five — that's a legitimate reason
     to restructure the tiers, don't force it).
   - Otherwise → Tier 2.
3. Add its output filename to `expectedFiles` in `context-refresh.mjs`'s
   `validateArtifacts()` so Tier 5 catches a silent "exits 0, writes
   nothing" bug in the new generator.
4. Add a row to the table above.
5. Run `pnpm context:refresh` twice in a row and diff the output (ignoring
   timestamp lines) — it should be identical. If it isn't, your generator
   has a non-determinism bug (unstable object key order, `Date.now()` outside
   the timestamp line, `Math.random()`, directory-listing order dependence,
   etc.) that will make every future diff of `.context/` noisy and useless.

## Removing a generator

1. Delete `scripts/generate-<name>.mjs`.
2. Remove it from the relevant tier list in `context-refresh.mjs`.
3. Remove its row from `expectedFiles` in `validateArtifacts()`.
4. **Delete its output file(s) from `.context/` in the same commit.** Do not
   leave the old `.generated.*` file on disk — nothing will ever regenerate
   or clean it up automatically, and a stale, orphaned generated artifact is
   exactly the failure mode this whole pipeline exists to prevent (see
   "History," below, and the "Orphaned artifact" check in Tier 5, which
   catches per-package files under `.context/packages/` but **not** other
   orphaned top-level `.context/*.generated.*` files — that check is
   currently package-scoped only; see "Known limitations").
5. Update the table above and any doc that referenced the removed output
   (search for the filename across `docs/`, `AGENT_CONTEXT.md` files, and
   other generators' "Further Detail" / "See also" sections).

## Generator conventions

- **No new sources of truth.** If the fact you need (a package's layer, a
  table's owner, a boundary rule) is already encoded somewhere in
  `scripts/shared/*.mjs`, import it. Don't re-derive or re-hardcode it. This
  single rule is why `scripts/shared/` exists, and violating it is the root
  cause of most of the staleness this pipeline modernization found and fixed
  (five independent hardcoded copies of "which packages are forbidden in
  routes," for example, three of which had drifted from each other before
  being consolidated to one).
- **Degrade, don't crash, on missing optional input.** If your generator's
  ideal input (e.g. a live DB snapshot) might not be available, produce a
  best-effort output with a clear inline warning rather than throwing. Reserve
  a non-zero exit code for genuine failures the orchestrator should stop on.
- **Deterministic output.** Same source tree in → byte-identical output out,
  except for the single embedded timestamp line (use
  `shared/context-utils.mjs`'s `renderTimestamp()` for that line, and only
  that line — don't call `Date.now()`/`new Date()` anywhere else in a
  generator's rendered output). Sort anything derived from object key
  iteration or directory listings before rendering.
- **Historical mentions are fine; stale claims are not.** A generator's own
  header comment describing what changed and why (a "v3 fix" / "v6 changes"
  note, for example) is good practice and should stay even after the thing
  it describes is old news — it's how the next person understands why the
  code looks the way it does. What must never happen is a generator's
  *rendered output* asserting something false about the current state of the
  codebase (e.g., naming a deleted package as a current table owner). If you
  need to mention a deleted/retired thing in generated output, say so
  explicitly ("formerly," "deleted," "no longer exists") rather than stating
  it as current fact.
- **Self-verify claims you can verify.** `generate-behavior-contracts.mjs`'s
  `verify()` mechanism — checking that a cited file still contains the
  strings a hand-written contract entry claims it does — is the reason this
  modernization effort caught its own target staleness (a hand-written
  contract entry referencing a call site that had since changed) via
  `unverified: 1` in its own output, before any human went looking. If your
  generator makes claims about specific source locations, consider whether
  a similar lightweight self-check is worth adding.

## Regression guard

`context-refresh.mjs`'s Tier 5 includes a small, deliberately narrow set of
regex checks (`REGRESSION_PATTERNS`) that fail the pipeline if a generated
artifact asserts a specific, known-stale claim as current fact (currently:
naming the deleted `@brandos/brand-intelligence` package as a live table
owner or layer member). This is **not** a general "the string
brand-intelligence must never appear anywhere" check — historical/explanatory
mentions are expected and fine (see "Generator conventions" above) and would
make the check useless if banned outright. It's a narrow, specific
regression test for the exact staleness this modernization effort found and
fixed, so a future edit can't silently reintroduce it. Extend
`REGRESSION_PATTERNS` the same way if you fix a similar class of staleness in
the future: narrow, specific, tied to an exact phrasing that would only
appear if the bug came back — not a blanket string ban.

## Known limitations

- The orphaned-artifact check in Tier 5 only covers `.context/packages/*`.
  A top-level `.context/<name>.generated.*` file for a generator that was
  since removed (not renamed) won't be caught automatically — follow step 4
  under "Removing a generator" above by hand.
- `generate-schema-inventory.mjs` and the DB-dependent sections of Tier 3
  generators can't be verified in an environment without database access
  (e.g. this modernization's sandbox). They were reviewed for correctness of
  logic and error handling, but their DB-dependent output was not exercised
  end-to-end against a live schema during this pass — do that once in an
  environment with real DB credentials before fully trusting Tier 3's
  DB-derived sections.
- Tiers run sequentially, not in parallel, within `context-refresh.mjs`. For
  ~15 generators each taking tens to low-hundreds of milliseconds, this is a
  ~1–2 second total run — fast enough that parallelizing wasn't worth the
  added complexity (interleaved output, harder-to-read failures) at this
  scale. Revisit if the generator count or per-generator runtime grows
  significantly.

## History

Before `context-refresh.mjs` existed, the *only* thing that chained multiple
`generate-*.mjs` scripts together was `scripts/package-workspace.ps1`, a
Windows PowerShell **packaging/bundling** tool for producing distributable
"Claude bundle" zips. It does call most of the generators in a sensible
order (see its own header comment) — but only when someone manually runs
`.\scripts\package-workspace.ps1 -Scope full`, and even then context
generation is opt-in for the `artifact`/`runtime` scopes
(`-GenerateContext`). It is not wired into CI, not triggered by git hooks or
commits, not cross-platform (PowerShell — doesn't run in most CI runners or
this repository's own Linux/macOS dev sandboxes without `pwsh` installed),
and not reachable via `pnpm`. In practice this meant context regeneration
happened only on the occasions someone manually packaged a bundle — which is
exactly how several generators (and the `shared/*.mjs` modules many of them
import) went stale for an entire platform migration (the BrandOS /
IntelligenceOS split, in which `@brandos/brand-intelligence` was deleted and
replaced by `@brandos/cognition-client`) without anyone noticing.
`check-boundaries.mjs` kept reporting "0 violations" throughout that entire
period — not because the boundary was respected, but because its own checks
were scanning for imports of a package that could no longer exist, making
them permanently unable to find anything either way.

`context-refresh.mjs` doesn't replace `package-workspace.ps1` (that script's
job — producing a packaged, zipped bundle for distribution — is a separate
concern from "is `.context/` up to date"). It fills the actual gap:
cross-platform, `pnpm`-native, CI-integratable (`--ci`/`--json`),
self-validating, and — critically — the thing you'd reach for by default,
so it actually gets run.

See the "v3 fix" / "v6 changes" header comments throughout
`scripts/shared/*.mjs` and the individual `generate-*.mjs` files for the
specific staleness this modernization pass found and fixed, and
`docs/architecture/` (if present) for the full architecture review this
pipeline modernization followed from.
