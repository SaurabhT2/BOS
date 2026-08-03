# Architecture Compliance Review — Publishing Foundation (Phase 10)
**Reviewer role:** Independent Architecture Review Board, acting as the author of `PUBLISHING_ARCHITECTURE_V1.md`.
**Reviewed artifact:** `feature/publishing-foundation-phase-10` (8 commits, `65278a5`), branched from `main@c539868`.
**Method:** Not a review of `PR_DESCRIPTION.md`'s or `HANDOFF.md`'s claims. The bundle was applied to a genuinely fresh, independent clone of the real repository; every build/typecheck/test/validate command was re-run from scratch in this review; every cross-referenced factual claim in the implementer's own notes was independently checked against the actual codebase rather than trusted; every core source file was read in full against the corresponding architecture section. Where the implementation's own claims turned out to be wrong, that is reported below, not smoothed over — and the same standard applies to my own findings while writing this: one apparent test failure below was investigated to a confirmed root cause rather than reported at face value.

---

## 1. Executive Summary

This is a faithful, carefully-researched, and largely excellent realization of `PUBLISHING_ARCHITECTURE_V1.md`'s stable core (§4 domain model, §5 lifecycle, §7 Publisher contract, plus the supporting §6/§8/§11 machinery those sections require to be usable). The implementation does not merely satisfy the architecture's letter — in at least two places (state derivation, the `retainSourcePayload` opt-in) it makes the architecture's own principles *more* rigorously enforceable than the prose alone specified, which is a legitimate improvement, not scope creep. Every "deliberately not built" claim in `PUBLISHING_LAYER_NOTES.md` was checked against the actual repository and found accurate — including two claims (a colliding existing route, a pre-existing race-condition pattern in `control-plane-layer`) that required independently locating and reading files the notes only described. All quantitative claims in `PR_DESCRIPTION.md` (133 tests, coverage percentages to the decimal point, 38/38 and 20-package validation) were independently reproduced from a clean clone.

One genuine, confirmed defect exists: `DistributionJob` does not persist which rendered `format` a publish was submitted for, so `retryDistribution()` silently falls back to the version's first available format rather than the one originally requested. This is real, but narrow, low-likelihood in current usage (most versions today carry one rendered format), and cleanly fixable without any model redesign.

One process note, not a code defect: a full-workspace parallel test run showed one flaky, non-reproducible timeout in `governance-layer` — a package `publishing-layer` does not depend on. Isolated and repeated runs confirmed this is environmental, not a regression, and I want to be explicit that I am reporting my own investigation of a false alarm, not asking the reader to take "0 regressions" on faith either.

**Recommendation: APPROVE WITH MINOR CHANGES.** Detail and severity classification in Section 8.

---

## 2. Architecture Compliance Matrix

| § | Section | Status | Notes |
|---|---|---|---|
| 1 | Vision | ✓ | The package's own header docstring and `PUBLISHING_LAYER_NOTES.md` both restate the Rendering-vs-Publishing distinction correctly and apply it as an actual constraint (no rendering call anywhere in this package — verified by import graph). |
| 2 | Design Principles | ✓ | All eight principles independently traceable to specific code decisions (see Section 3). Principle 6 (immutability) is enforced at the *type/interface* level, not just by convention — stronger than the prose required. |
| 3 | Responsibilities | ✓ | The "should not own" boundary is enforced structurally: `publishing-layer` has zero dependency on `composition-layer`, `ai-runtime-layer`, `output-control-layer`, `governance-layer`, or `artifact-engine-layer` (confirmed via `package.json` and the layer-tier registry, not just asserted in comments). |
| 4 | Canonical Model | ✓ | All nine named entities (`Artifact`, `ArtifactVersion`, `Approval`, `Destination`, `Publication`, `DistributionJob`, `PublishEvent`, `AuditRecord`, `RetentionPolicy`) implemented with the exact relationships described. One gap within an otherwise-faithful section: `DistributionJob` omits the requested-format reference (Section 5, Section 8). |
| 5 | Lifecycle | ✓ | All seven states implemented; every transition's actor/metadata/gate matches §5's description. State is *derived* from evidence (a stronger mechanism than the architecture mandated — see Section 6). |
| 6 | Persistence Strategy | ✓ | Cache-vs-truth distinction correctly implemented: rendered bytes go through a content-addressed `RenderedOutputStore` (regenerable-in-principle, evictable), metadata is fully relational, hashes are stored at both the source and rendered-output level, immutability enforced by the repository interfaces themselves (`PublishEventRepository` has no update/delete method at all, not just "shouldn't call it"). |
| 7 | Publisher Registry | ✓ | Structurally parallel to `Renderer<T>` (composition-layer), confirmed by direct comparison of both files. Two working Publishers (Share Link, Download), correctly differentiated on `revoke()`'s `success`/`unsupported` distinction. |
| 8 | Governance | ✓ | Both gated transitions (Approved, Published) call into policy via an injected `IPublishingPolicyProvider`, never author policy. `Approval.policySnapshot` and `PublishEvent` together give exactly the evidence package §8 describes. Rollback is non-destructive (revoke marks, never deletes) exactly as specified. |
| 9 | HTTP Contracts | ✗ (correctly) | Not implemented. §13 explicitly calls this "intentionally directional," and the implementer additionally found a concrete, checkable reason it would be actively wrong to build now (a real, differently-scoped route already exists at the same path shape). Correct deferral, not a miss. |
| 10 | Deployment Model | ✓ (for "Today") | Lives inside BrandOS as a package with a clean dependency boundary, exactly as §10's "Today" state describes. §10's "Future"/"Eventually" states are not applicable to an implementation milestone. |
| 11 | Core Experience Integration | △ | The in-process API surface (`PublishingService`) exists and is the correct shape §11 describes — but nothing in `apps/web` calls it yet, and `publishing-layer` is correctly placed in `FORBIDDEN_IN_ROUTES` pending a CPL proxy. This is the right *state* to be in given no CPL wiring exists, but it means §11 is implemented as a capability, not yet as an integration — see Section 4 for why this is a correct partial, not a miss. |
| 12 | Future Evolution | N/A | Nothing in this section was meant to be built now; nothing was built prematurely against it either (no scheduling, campaign, or A/B-variant code exists). Correctly left alone. |
| 13 | Risks | ✓ | Every "should not be built yet" item genuinely was not built; every "what should not be built yet" boundary was independently checked (not just cited) — see Section 4. |

**Legend:** ✓ fully implemented (or correctly, deliberately not implemented where §13 says not to). △ partially implemented, with the shortfall explained. ✗ not implemented.

---

## 3. Engineering Review

- **Package boundaries / dependency direction:** Correct, and *more precisely* correct than my own document specified. `publishing-layer` depends only on `@brandos/contracts`, `@brandos/governance-config`, and `@brandos/shared-utils` — deliberately skipping `@brandos/governance-layer` (the validation *engine*, one tier up) in favor of `@brandos/governance-config` (pure config/schema, several tiers down). My architecture document said Publishing "calls into policy... mirroring how governance-layer centralizes... policy," which is ambiguous about which package that means concretely. The implementer's choice is the more defensible reading of my own §2 Principle 4 ("Publishing never regenerates artifacts... consumes render outputs") extended to policy: consuming a config schema is not the same as depending on an execution engine that has no business being invoked from this layer. This is a real architectural refinement discovered during implementation, not just a lucky guess — verified independently against the actual tier registry and dependency list, not asserted.
- **Layering:** `FORBIDDEN_IN_ROUTES` correctly extended to include `publishing-layer`, and `lint:routes` (re-run independently) confirms zero violations across all 60 route files. This is the correct posture given no CPL proxy exists — routes *cannot* reach this package yet, by design, matching §9/§13's deferral rather than working around it.
- **Naming:** The `ArtifactVersion`/`Approval` collision with pre-existing, unrelated `control-plane-layer` concepts is handled correctly and is disclosed prominently (a header comment in `types.ts`, not a footnote) rather than silently risking confusion. Both cited colliding files were independently located and confirmed to exist with the described unrelated shape.
- **Domain model:** See Compliance Matrix §4. Strong, with the one `DistributionJob.format` gap noted.
- **Repository abstractions:** Interface-segregated per entity, matching §4's own "each entity is an independently queryable thing" framing rather than one god-repository. `PublishEventRepository`'s append-only contract is enforced by the interface shape itself.
- **Lifecycle implementation:** The single strongest piece of engineering in this branch. Deriving `ArtifactLifecycleState` from evidence (`PublishEvent`s, `Approval`s, `Publication`s) rather than storing it as an independently-settable field is not something my document mandated in so many words — but it is the mechanism that makes §6's immutability principle unbreakable rather than merely advisory, and it is applied consistently: `buildAuditRecord` (audit.ts) re-derives state fresh rather than trusting the cache, and every mutating `PublishingService` method calls `refreshArtifactStateCache` afterward so the denormalized `Artifact.currentState`/`currentVersionId` fields (a legitimate, disclosed read-optimization) never silently diverge from the derivable truth. I checked every call site of `refreshArtifactStateCache`, not just the existence of the method.
- **Publisher registry:** Sound. One minor documentation imprecision: the header comment frames the registry's class-based (not singleton) design as "the one deliberate deviation from `GovernancePluginRegistry`'s singleton-export pattern" — but `@brandos/artifact-engine-layer`'s `ArtifactRegistry` (Rendering V2's own registry) is a closer precedent still, and already supports exactly this class-plus-singleton pattern. The engineering decision made is correct and consistent with the more relevant precedent; only the comment's citation is imprecise. Classified Low severity in Section 8 — it affects a code comment's accuracy, not behavior.
- **Governance integration:** Correct scope discipline — a narrow `PublishingPolicySnapshot` (not the full `PolicyConfig`), an injected provider seam rather than a live CPL import, a documented conservative default (`StaticPolicyProvider`). The claim that `ApprovalGatesSchema` already defines `requirePublishingApproval`/`requireApprovalForExternalPublish` was independently verified against `governance-config/src/index.ts` — accurate, field names and defaults both.
- **Audit model:** Correct — a pure projection function, no I/O, re-derives rather than trusts. `publicationsByContentHash` directly and correctly implements the exact "old logo, rebrand cutover" scenario named in my own document, using the semantically correct hash (source content + theme, not rendered-output bytes).
- **Persistence model / storage abstraction:** Correct cache-vs-truth split. The `SupabaseRenderedOutputStore`'s env-var names and Supabase client configuration were independently verified to match three separate pre-existing services in `control-plane-layer` exactly (`ArtifactVersioningService`, `ApprovalService`, `AuditTrailService`) — genuine convention-following, not coincidence.
- **Testing:** 133/133 passing, coverage independently reproduced to the decimal point (97.24%/89.58%/99.01%). Coverage exclusions (`repository-supabase.ts`, pure-type files) are configured and justified in the vitest config itself, not just claimed in prose. Spot-checked test content is substantive (real edge cases like "a rejected Approval must not count as approved"), not padding.
- **Validation:** `pnpm run build:packages` (19/19), `pnpm run typecheck` (38/38), `pnpm run validate` (20 packages, all five checks), and `check-circular` (285 files, zero cycles) all independently reproduced clean from a fresh clone. `pnpm run test` showed one flaky timeout on first run in a package this branch does not touch or depend on; isolated and repeated runs confirmed 37/37 and ruled out a real regression (Section 6 has the full investigation).
- **Documentation:** `AGENT_CONTEXT.md` and `PUBLISHING_LAYER_NOTES.md` are both present, and every specific, checkable factual claim across both documents that I attempted to verify turned out to be accurate.
- **Migration strategy:** Table-naming collision avoidance (`brandos_publishing_*` prefix) verified against the actual pre-existing `brandos_artifact_versions`/`brandos_artifact_approvals` tables. `UNIQUE(artifact_id, version_number)` constraint present and correctly reasoned about (fails loud on a race, does not prevent one). The "zero RLS usage elsewhere in this repo" claim was verified accurate once I excluded the new migration's own comment text describing that claim from my grep (a false alarm in my own first pass, corrected before relying on it).

---

## 4. Deviations from Architecture

None found that weaken the architecture. Every deviation identified is either a legitimate refinement (state derivation, the governance-config-not-governance-layer dependency choice, the optional `retainSourcePayload` flag) or a correctly-scoped deferral that the architecture itself called for (§9 HTTP routes, CPL policy wiring, retention enforcement, render-output eviction). None of the "not built" items were missed by oversight — each has either a direct textual basis in §13 or an independently-verified concrete conflict in the actual codebase, and I checked rather than assumed both kinds of claim.

---

## 5. Improvements Discovered During Implementation

1. **State derived from evidence, not stored as an independent field.** Turns §6's immutability principle from a convention into a structural guarantee. This is worth folding back into the architecture document itself (see Section 7).
2. **`governance-config` (not `governance-layer`) as the policy dependency.** A more precise application of "Publishing consumes, never re-derives" than my own document specified explicitly.
3. **`ArtifactVersion.source.payload` as an opt-in, not a default.** My document didn't resolve whether the full governed payload should always be retained alongside its hash; the implementation correctly recognized this as a real, undecided tradeoff (storage cost vs. reproducibility) and made it a caller-provided flag rather than guessing at a default — consistent with §13's own discipline about not inventing product decisions.
4. **`Publisher.revoke()`'s three-way outcome (`success` / `unsupported` / `failure`)**, distinguishing "nothing to undo" from "tried and failed" — a real robustness improvement over a boolean, discovered because two genuinely different Publishers (Share Link vs. Download) needed genuinely different honest answers to "can you roll this back."

---

## 6. Risks

- **`DistributionJob` format-forgetting (see Section 4/8).** Concrete, reproducible: a version with multiple rendered formats, published via a non-default format, will retry against the wrong format after a failure. Low likelihood today (most versions carry one format), real once multi-format publishing is common.
- **Read-then-write race conditions** (`versionNumber` assignment, `supersededBy`) — disclosed honestly, mitigated by a real DB constraint (fails loud, doesn't silently corrupt), not eliminated. Explicitly not worse than existing precedent in this codebase, and explicitly not claimed to be fixed.
- **Migration SQL is unexecuted against any live database.** Column-for-column consistency with the TypeScript row mappers was checked by reading, not by running it — this is a real, disclosed, unavoidable-in-this-sandbox gap, not a hidden one.
- **`repository-supabase.ts`'s live network calls are untested.** Its pure logic is; the wire-level Supabase interaction is not, and cannot be without a live project.
- **Test-suite flakiness under full parallel load** (Section 3/8) — worth a maintainer's attention independent of this PR, since it will resurface for the next branch that happens to run at the wrong moment, but it is not something this PR introduced or should be blocked on.

---

## 7. Critical Questions, Answered Directly

1. **Did the implementation preserve the architectural intent?** Yes.
2. **Did engineering improve the architecture?** Yes — evidence-derived lifecycle state (Section 5) is a genuine improvement worth adopting back into the architecture document itself, not just the code.
3. **Did engineering accidentally weaken the architecture?** No instance found.
4. **Did engineering introduce unnecessary abstractions?** No. Every abstraction (the injected policy provider, the two-implementation storage/repository split, the Publisher plugin contract) has a real, current, non-hypothetical caller, matching the "no abstraction without a second live caller" discipline this whole initiative has held to.
5. **Did engineering violate separation of concerns?** No. The dependency-direction findings (Section 3) show this was actively defended, not merely not-violated by accident.
6. **Did engineering make assumptions the architecture deliberately avoided?** No — the one place a real product-shaped decision had to be made unilaterally (`DEFAULT_APPROVER_ROLES`, `retainSourcePayload`'s default), it was made conservatively and disclosed as an overridable default, not silently baked in as if it were a resolved product decision.

---

## 8. Would I Change `PUBLISHING_ARCHITECTURE_V1.md`? — Changes Arising From Implementation Experience Only

Per the instruction not to invent new future ideas — these three are strictly things this implementation *taught* me, not new speculation:

1. **Add explicitly, to §5/§6:** "Lifecycle state must be derived from evidence (`PublishEvent`s, `Approval`s, `Publication`s), never stored as an independently-settable field. A denormalized cache for read performance is acceptable *only* if every write path that could change the derived answer refreshes it in the same transaction/operation, and any audit-facing read must re-derive rather than trust the cache." My original document implied this but didn't say it as a hard rule — implementation experience showed it's the difference between the immutability principle being decorative and being load-bearing.
2. **Add to §4's `DistributionJob` description:** it must reference which rendered format (from the version's `renderedOutputs`) it targets, not just the version as a whole — a version can have multiple formats, and a retry needs to know which one it was actually retrying. This was a gap in my own domain-model description, not just an implementation oversight, since the implementer built exactly what §4 as written specified.
3. **Sharpen §8's "consumer of governance policy, not its author" line** to say explicitly *which* tier of the governance stack that means (a config/schema source, not a validation engine) — implementation experience showed the original phrasing was ambiguous enough that getting it right required the implementer to independently reason it out from first principles rather than read it directly off the page. They reasoned it out correctly, but the document should not have required that.

I would **not** simplify, remove, rename, split, or merge anything else — the domain model, lifecycle, and Publisher contract all held up completely unchanged against a real implementation, which is the strongest validation an architecture document can get.

---

## 9. Recommended Follow-Up Work

- **Critical:** none.
- **High:** none.
- **Medium:** Fix `DistributionJob`/`retryDistribution` to persist and reuse the originally-requested format (Section 4/6/8). Small, contained change (add one field to the type, the repository patch shape, and the migration; thread it through `submitPublish`/`retryDistribution`) — does not require touching the lifecycle engine, the audit model, or any Publisher.
- **Low:** Correct the `publisher-registry.ts` header comment to cite `ArtifactRegistry` (`artifact-engine-layer`) as the precedent, alongside or instead of `GovernancePluginRegistry` — a documentation accuracy fix, not a behavior change.
- **Low:** Consider whether the full-workspace parallel test run's flakiness (Section 3/6) is worth a `governance-layer`-specific timeout increase or test-isolation fix — unrelated to this PR's correctness, but this PR's own CI run is where it happened to surface for me, so flagging it here is the most useful place to record it.
- **Not blocking, explicitly future work already correctly deferred by this PR:** CPL policy-provider wiring, HTTP routes, LinkedIn/Email/CMS Publishers, retention-window enforcement, render-output eviction — all already correctly out of scope per Sections 2 and 4 above.

---

## 10. Merge Recommendation

**APPROVE WITH MINOR CHANGES.**

Rationale: no Critical or High-severity findings. The one Medium-severity gap (`DistributionJob` format-forgetting) is real but narrow, doesn't corrupt data, doesn't violate any architectural principle (it's a missing field, not a wrong design), and is cleanly fixable in isolation. Everything else is Low-severity documentation polish or explicitly-deferred future work that this PR correctly chose not to build. The domain model, lifecycle engine, and Publisher contract — the three things §13 itself called "stable enough to build against" — were all implemented faithfully, and in places more rigorously than the architecture document demanded. This is what a compliant Phase 10 foundation should look like.
