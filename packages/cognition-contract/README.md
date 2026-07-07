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

## Known contract gaps (require an explicit decision — not resolved here)

These were discovered while migrating BrandOS's existing brand-intelligence
package onto this contract. Neither is a blocking technical constraint —
both are product-surface conflicts between existing BrandOS behavior and
the architecture documents' exclusion rules. Flagging per the
"stop and explain, don't invent" instruction rather than deciding
unilaterally:

1. **Raw-signal review UI.** BrandOS's `/workspace/brand` page lists
   individual pending memory signals (id, classification, confidence,
   content) for human approve/reject. `CognitionProvider` has no read
   operation that returns a list of raw or reviewable signals — by design,
   per `COGNITION_CONTRACT_SPEC.md` §4's exclusion of raw/unconsolidated
   signals from anything BrandOS can see. `review()` can still *act* on an
   entry by its opaque id, but nothing in the current contract can populate
   the list this page renders. Needs an explicit decision: extend the
   contract with a narrowly scoped, already-summarized "reviewable items"
   read (still no raw content, e.g. classification + confidence + a
   pre-rendered display string), or change the product surface.

2. **Explicit brand-voice configuration ingestion.** Before this
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
   Needs an explicit decision: an ingestion path outside the five
   `CognitionProvider` operations (e.g. a one-time/on-change sync call),
   or treating persona configuration as a `CognitionContext.voice` override
   that IntelligenceOS itself is told about through some other channel.

Until either is resolved, the BrandOS-side migration in this change set
preserves the mechanical contract exactly as specified and leaves both gaps
visible rather than papering over them with a shadow parameter or an
undocumented sixth method.
