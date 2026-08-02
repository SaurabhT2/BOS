# Publishing Layer — Implementation Notes

This is an engineering scope/limitations note, not a second architecture
document. `PUBLISHING_ARCHITECTURE_V1.md` remains the sole source of truth
for design decisions; nothing here revises it.

## What this package implements

The parts of `PUBLISHING_ARCHITECTURE_V1.md` §13 calls "stable enough to
build against": the domain model (§4), the lifecycle (§5), and the
Publisher contract shape (§7), plus the persistence (§6), governance (§8),
and Publisher-registry (§7) machinery those three sections require to be
usable rather than purely theoretical:

- Full domain model (`types.ts`)
- Lifecycle engine, state derived from evidence not stored (`lifecycle.ts`)
- Governance policy integration via an injected provider (`policy.ts`)
- Publisher contract + registry (`publisher-contract.ts`, `publisher-registry.ts`)
- Two Publishers: Share Link (§13's recommended first) and Download (`publishers/`)
- Storage abstraction: Supabase Storage (production) + in-memory (tests/dev) (`storage.ts`)
- Persistence abstraction: Supabase (production) + in-memory (tests/dev), for every §4 entity (`repository*.ts`)
- Audit trail projector (`audit.ts`)
- Content hashing (`hash.ts`)
- Orchestrating service facade — the in-process API surface §11 describes (`publishing-service.ts`)
- Supabase migration defining all seven new tables (`supabase/migrations/20260801090000_publishing_layer.sql`)
- Full unit test suite (`src/__tests__/`)
- Registration in the workspace's layer-tier/boundary/circular-dependency tooling (`scripts/shared/package-registry.mjs`)

## What was deliberately NOT built, and why

Every item below is a genuine stop-at-the-boundary decision, not an
oversight — each has either an explicit textual basis in
`PUBLISHING_ARCHITECTURE_V1.md` §13, a concrete conflict discovered by
reading the actual codebase, or both.

### 1. HTTP API routes / admin endpoints

§13, verbatim: *"Where engineering should stop, precisely: at the
boundary of this document... Everything in Sections 9 (HTTP contracts)...
is intentionally directional, not specified to implementation detail —
schemas, auth models, and request/response shapes should be designed in
the engineering milestone that actually builds them, informed by the
product decisions above, not guessed at here."*

This isn't just a documentary caution — it's independently confirmed by
the actual repository. `apps/web/app/api/artifacts/[id]/versions/route.ts`
already exists, and already means something different: it serves
`ArtifactVersioningService`'s campaign-regeneration versions (`campaigns`
table), not this package's `ArtifactVersion`. Building the routes §9
sketches at face value (`GET /artifacts/{id}/versions`, etc.) would either
collide with that existing route or require inventing, unprompted, a
resolution to "how does Publishing's `Artifact` identity relate to the
existing `campaigns` table" — exactly the kind of missing product
decision the top-level engagement brief says to stop at rather than
invent. `@brandos/publishing-layer` is registered in
`FORBIDDEN_IN_ROUTES` (`scripts/shared/package-registry.mjs`) so that
whenever this wiring does happen, it goes through a CPL proxy — consistent
with how every other lower-layer package is already required to.

### 2. CPL integration / policy source wiring

`policy.ts` defines `IPublishingPolicyProvider` and ships
`StaticPolicyProvider` (governance-config's documented defaults, same
value for every workspace) as the only concrete implementation. Wiring
this to a real, workspace-scoped policy source (`control-plane-layer`'s
`PolicyAdminService`, or a Supabase-backed equivalent) is application-layer
work this engagement does not include, for the same layer-tier reason as
item 1: `control-plane-layer` sits *above* `publishing-layer` in
`scripts/shared/package-registry.mjs`'s `LAYER_TIERS`, so
`publishing-layer` cannot import it without an upward-dependency boundary
violation. The seam is real and ready; the wiring is a follow-up.

### 3. Render-output eviction / regeneration-on-demand

§13, verbatim: *"Whether render-output caching (Section 6) is solving a
real, current performance problem or is speculative — do not build the
storage-abstraction/caching layer ahead of evidence that cold-start/
re-render cost is actually a problem in production."*

`storage.ts` implements the base requirement the domain model cannot
function without (store bytes, return a durable pointer — §6's "cache
with a receipt"), but not automatic eviction or "reconstruct from source
if evicted" logic. See that file's header for the full reasoning.

### 4. Retention-window enforcement / scheduled archival

§13 lists "what 'published' must mean for compliance" and specific
retention numbers as unresolved product/legal decisions. `RetentionPolicy`
exists as a real type and repository (§4 is in the stable/buildable set),
with a conservative default (retain indefinitely, no hard-delete). No
scheduler, cron, or automatic archival job exists — `deleteVersion()` only
acts when called, and only hard-deletes bytes when a workspace's
`RetentionPolicy.hardDeleteAllowed` is explicitly `true`.

### 5. LinkedIn / Facebook / Twitter / Email / CMS / OAuth / Analytics / Campaigns / Scheduling / Workflow engines

Explicitly out of scope per the engagement brief and named in
`PUBLISHING_ARCHITECTURE_V1.md` §7/§12/§13 as future plugins. The registry
(`publisher-registry.ts`) is open — adding any of these later means one
new file plus one `registry.register(...)` call, never a change to
lifecycle/audit/policy code, which is the entire point of §7's plugin
discipline.

## Known limitations (stated, not hidden)

- **Version-number / write-once races.** `versionNumber` resolution
  (`existingVersions.length + 1`) and the `supersededBy` write-once
  guard are "read, then write," not DB-enforced atomic operations,
  under true concurrent writers to the same `Artifact`. This is the
  *same* limitation `control-plane-layer`'s existing
  `ArtifactVersioningService` already has (see its own
  `linkAndFinalizeVersion()` comments) — not a regression, but also not
  fixed here. The migration adds a `UNIQUE(artifact_id, version_number)`
  constraint so a race fails loudly (a real Postgres error) instead of
  silently duplicating a version number; a caller-side retry-on-conflict
  loop is not implemented.
- **`appendRenderedOutput` on the Supabase backend is read-modify-write**,
  not an atomic jsonb append (no Postgres function defined for it). A
  concurrent append of two *different* formats to the same version can
  lose one under a race. See `repository-supabase.ts`'s method comment.
- **Migration SQL is written, not executed.** Per
  `supabase/migrations/README.md`'s own standing note for this
  repository, this sandbox has no credentials or network path to any
  real Supabase project. The migration has been checked for internal
  consistency against the TypeScript row mappers in
  `repository-supabase.ts` (column-for-column), but "applies cleanly to
  the actual live schema" has not been, and could not be, verified here.

## Validation performed vs. not performed

See the final engineering report delivered in-conversation for the full,
honest breakdown of what was and was not runnable in this sandbox
(package-local build/typecheck/test vs. full-workspace `pnpm validate`,
which requires installing every workspace package's dependencies).
