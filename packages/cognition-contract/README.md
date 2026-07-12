# @platform/cognition-contract

The system contract between BrandOS (Execution Platform) and IntelligenceOS
(Cognitive Platform). Types only. No runtime logic beyond
`createDegradedCognitionContext`, which is pure data construction.

Governed by, and must stay consistent with:
- `architecture/INTELLIGENCE_PLATFORM_ARCHITECTURE.md`
- `architecture/COGNITION_CONTRACT_SPEC.md`
- `architecture/INTELLIGENCE_PLATFORM_IMPLEMENTATION.md` §3–§4

## Physical duplication (tracked, temporary)

This package is currently duplicated byte-for-byte in both the `brandos`
and `intelligence-os` repositories, because the two are separate repos with
no shared package registry between them today. **Any change to `src/` must
be applied identically to both copies in the same change set.**

Follow-up (not yet scheduled): publish this package to a real registry
(private npm registry or a git-dependency workspace protocol both repos can
resolve) and delete one of the two copies in favor of a real dependency.
Until then, a CI check comparing the two copies' file hashes is recommended
so drift is caught immediately rather than discovered at integration time.

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

## Known contract gaps (require an explicit decision — not resolved here)

This was discovered while migrating BrandOS's existing brand-intelligence
package onto this contract. It is not a blocking technical constraint — it
is a product-surface conflict between existing BrandOS behavior and the
architecture documents' exclusion rules. Flagging per the
"stop and explain, don't invent" instruction rather than deciding
unilaterally:

1. **Explicit brand-voice configuration ingestion.** Before this
   migration, BrandOS forwarded a workspace's user-edited persona record
   (brand name, tone override, banned phrases, etc. — from
   `@brandos/auth`'s persona storage) into brand-cognition resolution on
   every request, and it was merged live with learned signals.
   `CognitionRequest` (this package) intentionally carries only
   `workspaceId` and `taskType` — no persona payload — per
   `INTELLIGENCE_PLATFORM_IMPLEMENTATION.md` §4's exact signature, since
   BrandOS is not supposed to hand IntelligenceOS raw configuration on the
   synchronous read path. That leaves open how a workspace's explicit,
   user-set brand-voice configuration reaches IntelligenceOS at all.
   `observe()` doesn't fit (it reports generation outcomes, not settings).
   Needs an explicit decision: an ingestion path outside the four
   `CognitionProvider` operations (e.g. a one-time/on-change sync call),
   or treating persona configuration as a `CognitionContext.voice` override
   that IntelligenceOS itself is told about through some other channel.

Until this is resolved, the BrandOS-side migration in this change set
preserves the mechanical contract exactly as specified and leaves the gap
visible rather than papering over it with a shadow parameter or an
undocumented fifth method.
