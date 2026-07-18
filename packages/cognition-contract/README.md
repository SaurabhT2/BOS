# @platform/cognition-contract

The system contract between BrandOS (Execution Platform) and IntelligenceOS
(Cognitive Platform). Types only. No runtime logic beyond
`createDegradedCognitionContext`, which is pure data construction.

Governed by, and must stay consistent with:
- `architecture/INTELLIGENCE_PLATFORM_ARCHITECTURE.md`
- `architecture/COGNITION_CONTRACT_SPEC.md`
- `architecture/INTELLIGENCE_PLATFORM_IMPLEMENTATION.md` §3–§4

## Physical duplication (tracked, temporary)

This package is currently duplicated in both the `brandos` and
`intelligence-os` repositories, because the two are separate repos with no
shared package registry between them today. **Any change to `src/` must be
applied to both copies in the same change set, or explicitly allowlisted as
a deliberate divergence — see the next section.**

Follow-up (not yet scheduled): publish this package to a real registry
(private npm registry or a git-dependency workspace protocol both repos can
resolve) and delete one of the two copies in favor of a real dependency.
That requires provisioning a private package registry, which is an
infrastructure/ops decision outside a code change to this package.

**Until then (Cognitive Platform Evolution Program, EM-1.1):** this
divergence is no longer just "recommended" — `scripts/check-contract-parity.mjs`
is a real, runnable symbol-level diff between this copy and the sibling
repository's copy, and `.github/workflows/contract-parity.yml` wires it
into CI (pending two things that need to be filled in by whoever owns the
actual repositories: the real `<ORG>/...` repo slug, and a checkout token
with read access to the sibling private repo — see the workflow file's
comments). Run it locally with:

```
SIBLING_CONTRACT_SRC=/path/to/sibling/packages/cognition-contract/src \
  pnpm --filter @platform/cognition-contract check:parity
```

It does not require the two copies to be byte-identical — see
`contract-parity.allowlist.json` for the one currently-known, deliberate
exception (Option B, below) — but it fails the build on anything else,
which is exactly the gap that let this package's `CognitionContext` silently
fall a full minor version behind IntelligenceOS's copy (missing the
ADR-004 `knowledge`/`reasoning`/`positioning` sections) until the audit that
produced the Cognitive Platform Evolution Program caught it by hand. That
gap is fixed as of contract version 1.1.0 — this copy now matches.

## Resolved: raw-signal review UI (Option B)

BrandOS's `/workspace/brand` page previously listed individual pending
memory signals (id, classification, confidence, content) for human
approve/reject, backed by `CognitionProvider.review()`. That surface has
been removed from BrandOS along with `review()` and
`CognitionReviewDecision` from this contract: `CognitionProvider` never had
a read operation that could populate such a list (per
`COGNITION_CONTRACT_SPEC.md` §4's exclusion of raw/unconsolidated signals
from anything BrandOS can see), and raw-signal review is now understood to
be entirely IntelligenceOS's responsibility rather than a BrandOS product
surface. BrandOS consumes only synthesized cognition through
`resolveCognitionContext` / `observe` / `summarizeCognition` / `checkHealth`.

## Resolved: explicit brand-voice configuration ingestion (EM-1.2)

Previously, BrandOS forwarded a workspace's user-edited persona record
(brand name, tone override, banned phrases, etc. — from `@brandos/auth`'s
persona storage) nowhere outside BrandOS itself; `CognitionRequest`
deliberately carries only `workspaceId`/`taskType`, and `observe()` reports
generation outcomes, not settings, so neither fit. IntelligenceOS's own
`ingestWorkspaceConfiguration` / `POST /v1/workspace-configuration`
(ADR-003 §2.4) was already built and deployed to receive exactly this, but
had zero BrandOS callers.

As of the Cognitive Platform Evolution Program's Milestone 1, BrandOS's
`@brandos/cognition-client` package has a `WorkspaceConfigurationClient`
that calls this endpoint whenever a workspace's persona configuration is
created or updated (see `@brandos/auth`'s `dbService.ts`). `personas` is
now a write-through cache: writes go to IntelligenceOS first, then to the
local table. See this repository's `packages/auth/README.md` (ownership
note near `updatePersona`) for the BrandOS-side detail.

## Open architecture question (not resolved by this program)

1. **`review()` / `CognitionReviewDecision` — Option B.** BrandOS's copy of
   `CognitionProvider` still intentionally has 4 operations, not
   IntelligenceOS's 5 (see `CognitionProvider.ts`'s Option B docblock and
   `contract-parity.allowlist.json`). Whether BrandOS ever needs a review
   surface at all — a narrow, real one, or none — is a product/architecture
   decision the Cognitive Platform Evolution Program's EM-4.5 flags but
   does not make unilaterally.
