# AGENT_CONTEXT — @brandos/cognition-client

**Layer:** L6 — Cognition Client (formerly L6 Brand Intelligence)
**Maturity:** L1 (new — replaces @brandos/brand-intelligence entirely)
**Build order position:** 13 of 16 (unchanged — same slot @brandos/brand-intelligence occupied)
**Last updated:** Platform split — BrandOS becomes the Execution Platform

---

## Package Purpose

The single adapter boundary between BrandOS and IntelligenceOS. This
package holds the ONLY concrete `CognitionProvider` implementation
anywhere in BrandOS (`HttpCognitionProvider`) and is the ONLY BrandOS
package permitted to import `@platform/cognition-contract`'s
`CognitionProvider` interface and construct an instance of it.

Every other BrandOS package receives an already-resolved `CognitionContext`
value — passed to it by `@brandos/control-plane-layer` — never this
package's client, and never the contract's provider interface.

This package performs **no reasoning**. No memory lookups, no scoring, no
style resolution, no learning. It serializes a `CognitionRequest`, calls
IntelligenceOS's HTTP API, and deserializes a `CognitionContext`. If you
find yourself adding logic here that interprets or derives a value rather
than passing it through, that logic belongs in IntelligenceOS, not here —
see `INTELLIGENCE_PLATFORM_ARCHITECTURE.md`.

---

## Responsibilities

| Domain | Module |
|---|---|
| HTTP `CognitionProvider` implementation | `src/HttpCognitionProvider.ts` |
| Process-scoped client singleton | `src/global-client.ts` |
| Public API surface | `src/index.ts` |

---

## What This Package Replaced

`@brandos/brand-intelligence` (deleted in the same change set that added
this package). Every symbol that package exported and that BrandOS still
needs is either:

1. **Re-exported here**, backed by an HTTP call instead of local
   computation (`resolveCognitionContext`, `observe`, `review`,
   `summarizeCognition`, `checkHealth` — the 5 `CognitionProvider`
   operations), or
2. **Moved to IntelligenceOS** (all learning, memory, style/identity
   resolution — see `intelligence-os/packages/intelligence-os/src/{memory,cognition,context,api}`),
   or
3. **Deleted outright** as dead code that only ever returned
   structurally-empty values in BrandOS (e.g. Class C topic-profile
   fields, which `BrandIntelligenceRuntime.resolveIdentityContribution()`
   always left `undefined` — see git history on
   `packages/brand-intelligence/src/runtime/BrandIntelligenceRuntime.ts`
   for confirmation before assuming a field had real behavior to preserve).

See `packages/cognition-contract/README.md`, "Known contract gaps", for
two pieces of prior `@brandos/brand-intelligence` behavior that do **not**
have a home in `CognitionProvider` yet and were intentionally left as open
questions rather than silently reintroduced through a side channel.

---

## Configuration

`initCognitionClient({ baseUrl, apiKey, timeoutMs?, maxRetries? })` must be
called once at startup (see `apps/web/instrumentation.ts`). `baseUrl` and
`apiKey` should come from environment variables
(`INTELLIGENCE_OS_API_URL`, `INTELLIGENCE_OS_API_KEY`) — this package does
not read `process.env` itself, so it stays framework-agnostic and testable
without env mocking.

---

## Degraded Mode

`resolveCognitionContext()` never throws. On any HTTP failure, timeout, or
non-2xx response, it logs and returns
`createDegradedCognitionContext(workspaceId)` — pure data, imported from
`@platform/cognition-contract`, not computed here. A generation request
must never fail outright because IntelligenceOS is unavailable.

`observe()` is fire-and-forget: failures are logged and swallowed, never
propagated to the caller. `review()`, `summarizeCognition()`, and
`checkHealth()` are not given this treatment — callers of `review()` and
`summarizeCognition()` are human-triggered UI actions that should surface
their own errors; `checkHealth()` already returns a health value on
failure rather than throwing.
