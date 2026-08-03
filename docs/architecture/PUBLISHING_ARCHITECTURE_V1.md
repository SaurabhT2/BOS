# BrandOS Publishing Architecture — Phase 10
**An Enterprise Architecture Document**
**Version:** 1.1 — incorporates implementation-experience corrections approved by `docs/reviews/PUBLISHING_FOUNDATION_COMPLIANCE_REVIEW.md` (Section 8 of that review). This is a correction pass, not a redesign: the three changes below are the only substantive differences from v1.0. Everything else in this document is unchanged.
**Status:** Architecture only. This document does not itself contain or authorize implementation — see the Publishing Foundation implementation branch and its compliance review for what has actually been built.
**Audience:** Architecture Review Board / CTO.
**Companion documents:** `RENDERING_ARCHITECTURE_V2.md`, `RENDERING_ROADMAP_V2.md` (Rendering V2, Phases 1–9, complete and merged); `docs/reviews/PUBLISHING_FOUNDATION_COMPLIANCE_REVIEW.md` (the compliance review that approved the v1.1 corrections below).

---

## v1.1 Change Log

Three changes, each arising directly from implementation experience and explicitly approved by the compliance review — no new ideas, no redesign:

1. **§5/§6 — lifecycle state must be derived from evidence, never stored as an independently-settable field.** The v1.0 document implied this but did not state it as a hard rule. The implementation discovered that stating it as a rule is what makes §6's immutability principle load-bearing rather than decorative.
2. **§4 — `DistributionJob` must reference which rendered format it targets.** A gap in the v1.0 domain model, not an implementation oversight — the implementation built exactly what §4 specified, and what §4 specified was incomplete. A version can carry multiple rendered formats; without recording which one a job targets, a retry has no way to know which format to reuse.
3. **§8 — sharpened to name which tier of the governance stack Publishing depends on.** v1.0 said Publishing "consumes governance policy... mirroring how governance-layer centralizes policy," which is ambiguous about whether that means the config/schema layer or the validation-execution layer. The implementation had to reason this out independently; it reasoned correctly, but the document should not have required that.

---

## 0. Where this fits

Rendering V2 answered "how does governed knowledge become an artifact." That question is closed: `CompositionDocument → Renderer Registry → Renderers → Artifacts` is a working, tested pipeline across HTML, PDF, PPTX, PNG, Email, and Canva.

Phase 10 answers a different question: **what happens to an artifact after it exists.** This document is the architecture for that — not a fourth renderer, not a bigger registry, a genuinely separate concern with its own lifecycle, its own state, and its own long-term evolution path toward a Domain OS capability.

---

## 1. Vision

**Publishing is the system of record for what BrandOS has produced, decided, and distributed.**

Rendering answers *"can I turn this knowledge into an artifact, and what does it look like."* Publishing answers three different questions that rendering has no business answering:

- **What happened to this artifact?** (its history — drafted, reviewed, approved, sent, superseded)
- **Who is accountable for it?** (who approved it, who published it, under what policy)
- **Where did it go, and can we prove it?** (which destinations received which version, when, with what outcome)

Rendering is a pure function: the same `CompositionDocument` always produces the same HTML. Publishing is the opposite of pure — it is the accumulation of decisions and events over an artifact's life, and that accumulation *is* the product. A brand-governance platform's real long-term value is not "we can make a PDF," it's "we can tell you exactly what went out, when, who signed off, and how to pull it back." That is Publishing's job, and it is a job Rendering was never designed to do and should never be asked to do.

**Where it fits in BrandOS:** Publishing sits immediately downstream of Rendering, as its own layer — not a subsystem bolted onto the export route, not a set of destination-specific API calls scattered through `apps/web`. It is the layer that turns "a renderer produced bytes" into "the organization has a governed, auditable record of what it shipped."

**Where it fits in the platform's future (Auth → RuntimeOS → IntelligenceOS → Core Experience → Domain OS):** Publishing is a Domain OS capability today (BrandOS-specific — brand artifacts, brand approvals, brand distribution channels), with a deliberately-shaped seam that allows it to graduate into a Core Experience-level shared service *if and when* a second Domain OS needs the same lifecycle/approval/distribution machinery. Section 10 makes this evolution explicit. It is not built as a shared service on day one, for reasons Section "Alternative Architectures" makes explicit — that would be solving a problem BrandOS doesn't have yet, for a consumer that doesn't exist yet.

---

## 2. Design Principles

1. **Rendering is deterministic; Publishing is stateful.** A renderer is a function of its input. Publishing is a record of events over time — the same artifact can be "published" today and "archived" next month with no change to the artifact's content, only to its lifecycle state.
2. **Rendering creates; Publishing manages.** Creation is Rendering's entire job and Rendering's only job. Publishing never creates content — it manages the lifecycle of content that already exists.
3. **Publishing never regenerates artifacts.** If a rendered output is wrong, the fix is a new render (a new `ArtifactVersion`), not a Publishing-layer correction. Publishing has no write path back into Rendering — this is a hard, one-directional boundary.
4. **Publishers consume render outputs; they do not know how those outputs were produced.** A `Publisher` (LinkedIn, Email, Download) receives bytes and metadata. It has no visibility into `CompositionDocument`, `ResolvedTheme`, `ResolvedLayout`, or any Composition Layer concept. This mirrors the Renderer Contract's own discipline (`RENDERER_CONTRACT.md` §2/§3) one level up the stack.
5. **Every destination is a plugin, not a branch.** The moment "if LinkedIn then X, if Email then Y" logic appears anywhere outside a `Publisher` implementation, the architecture has been violated. This is the same discipline Rendering V2 enforced for renderers (`RENDERER_CONTRACT.md` §6) — extended one layer up.
6. **Immutability of the historical record, enforced structurally, not by convention.** Once an artifact version has been approved or published, that fact is never edited, only superseded. Audit and governance value comes entirely from records that cannot be quietly rewritten. **(v1.1 addition, approved by the compliance review):** the mechanism that makes this a guarantee rather than a convention is that lifecycle state must be *derived* from the evidence records (`PublishEvent`s, `Approval`s, `Publication`s) — never stored as an independently-settable field that could be changed without a corresponding evidence record. A denormalized cache of the derived state is acceptable for read performance *only if* every write path that could change the derived answer refreshes that cache in the same operation, and any audit-facing read re-derives from evidence rather than trusting the cache. Repository interfaces that expose no update/delete path for evidence records (e.g., a `PublishEvent` repository with an append-only contract) enforce this at the type level, which is stronger than enforcing it by discipline alone.
7. **No abstraction without a second live caller.** This principle governed every phase of Rendering V2 and governs this document just as strictly. Publishing is scoped to what BrandOS actually needs today, not to a hypothetical multi-tenant, multi-Domain-OS future — that future is designed for (the seam exists) but not built for (no code exists to serve a consumer that doesn't exist).
8. **Publishing is the trust boundary, not a convenience layer.** Anything an auditor, a compliance officer, or a brand-governance lead would ask "prove it" about belongs in Publishing's domain model, not as an afterthought bolted onto a destination integration.

---

## 3. Responsibilities

### Publishing SHOULD own

| Responsibility | Why it belongs here, not elsewhere |
|---|---|
| **Artifact Repository** | The durable store of *which artifacts exist and what state they're in* — distinct from the Composition Layer's disposable, re-derivable `CompositionDocument`. |
| **Artifact Metadata** | Title, owner, brand/workspace association, tags, current lifecycle state — queryable independent of content. |
| **Artifact Versioning** | Every render is a new version; Publishing is the only layer that knows "version 3 superseded version 2." |
| **Artifact Lifecycle** | Draft → Generated → Reviewed → Approved → Published → Archived → Deleted (Section 5). |
| **Approvals** | Who is allowed to approve what, and the record that they did. |
| **Audit Trail** | An append-only log of every state transition and distribution event — the thing a compliance review actually reads. |
| **Destination Registry** | The list of configured destinations (which LinkedIn account, which ESP, which CMS) — configuration and credentials, not delivery logic itself. |
| **Distribution** | The act of handing a rendered artifact to a destination and recording the outcome. |
| **Retention** | How long artifacts and their history are kept, and what "deleted" actually means for an audited system (usually: never truly gone, only access-revoked). |
| **Governance integration** | Policy evaluation gates on the lifecycle transitions that matter (approve, publish) — Publishing is a *consumer* of governance policy, not the author of policy itself (see Section 8). |

### Publishing should NOT own

| Explicitly out of scope | Owned by |
|---|---|
| Rendering | `apps/web/lib/artifact-export-*.ts`, unchanged. |
| Composition | `@brandos/composition-layer`. |
| Knowledge / Prompting / Generation | `ai-runtime-layer`, `output-control-layer`, `artifact-engine-layer`. |
| Runtime configuration | `@brandos/runtime-config`. |
| Layout / Theme decisions | `@brandos/composition-layer`'s `resolveLayout()`/`resolveTheme()`. |

The boundary test, mirroring `RENDERER_CONTRACT.md` §4's own test for renderers: *if two different artifact versions produced identical rendered bytes, would Publishing treat them differently?* It should — because Publishing's decisions (who approved, where it went, when) are about the **version and its history**, not about the bytes. That is the clearest proof this is a genuinely separate concern from Rendering, which by design would treat identical inputs identically forever.

---

## 4. Canonical Model

This section defines **entities and relationships only** — no schemas, no field lists beyond what's needed to explain the relationship, no persistence mechanics (that's Section 6).

- **Artifact** — the durable identity of "a thing BrandOS produced." Stable across versions; a title, an owner, a workspace, a type (carousel/deck/report/newsletter). Does not itself hold rendered content.
- **ArtifactVersion** — one immutable snapshot of an Artifact at a point in time: the governed `ArtifactV2` payload it was rendered from, plus a reference to the rendered outputs produced from it (one version can have multiple rendered formats — HTML, PDF, PPTX — all derived from the same version). A new render (new content, new theme, even the same content re-rendered after a Composition Layer change) is always a new `ArtifactVersion`, never a mutation of an existing one.
- **Approval** — a record that a specific person approved a specific `ArtifactVersion` for a specific purpose (e.g., "approved for external distribution") at a specific time, under a specific policy evaluation. Many Approvals can exist across an artifact's life (re-approval after edits); none are ever edited once created.
- **Destination** — a configured place an artifact can go: a LinkedIn company page connection, an ESP sending domain, a Canva workspace connection, a "public share link" pseudo-destination, a "direct download" pseudo-destination. A Destination is configuration + credentials + a reference to which `Publisher` plugin handles it — not delivery logic.
- **Publication** — the record of "this `ArtifactVersion` was sent to this `Destination`." A Publication is the durable outcome; it references exactly one `ArtifactVersion` and exactly one `Destination`, and holds the destination's own reference back (a LinkedIn post ID, an ESP send ID, a share-link token).
- **DistributionJob** — the (possibly async, possibly retried) unit of work that attempts to create a Publication. Separated from Publication itself because distribution can fail, retry, and take time (an ESP send is not instantaneous; a LinkedIn API call can rate-limit) — the job is the attempt, the Publication is the confirmed outcome. **(v1.1 correction, approved by the compliance review):** a `DistributionJob` must record which of the `ArtifactVersion`'s rendered formats it targets, set once at submission and never changed thereafter. This was missing from v1.0's description of the entity. Because a version can carry multiple rendered formats, a job that doesn't record which one it was submitted for has no principled way to know which format a retry should reuse — the only alternatives are guessing (e.g., defaulting to "the first available format," which is simply wrong once a second format exists) or requiring the caller to re-specify the format on every retry (which defeats the purpose of a retry being a resumption of the *same* request). This is a correction to the entity's definition, not a new capability — it was always implicit in "the job is the attempt" that the attempt has to be well-defined enough to repeat.
- **PublishEvent** — an append-only event describing something that happened (submitted, retried, succeeded, failed, revoked). The Audit Trail is built entirely from PublishEvents; nothing is ever inferred from mutable state alone.
- **AuditRecord** — a durable, queryable projection over PublishEvents plus Approvals plus lifecycle transitions, built specifically to answer "who did what, when, to what" without requiring a compliance reviewer to reconstruct history from raw events.
- **RetentionPolicy** — a rule governing how long an Artifact's versions, Approvals, Publications, and audit history remain fully accessible vs. archived vs. access-revoked, scoped per workspace/brand (different customers may have different compliance retention requirements).

### Relationships (verbal, not a schema)

An **Artifact** has many **ArtifactVersions**. Each **ArtifactVersion** has zero or more **Approvals** and zero or more **Publications**. Each **Publication** references exactly one **Destination** and was produced by exactly one **DistributionJob**. Every meaningful transition anywhere in this graph emits a **PublishEvent**. **AuditRecord** is a read-oriented view over that event history. **RetentionPolicy** applies to an Artifact (and cascades to its Versions/Approvals/Publications) but is configured at the workspace level.

---

## 5. Lifecycle

```
Draft → Generated → Reviewed → Approved → Published → Archived → (Deleted)
```

Every transition below states **who** triggers it, **what** changes, and **what governance gate** (if any) applies.

**(v1.1 addition, approved by the compliance review, applying to every state below):** the current state of an `ArtifactVersion` is always a *derived* value — computed from its `PublishEvent`s, `Approval`s, and `Publication`s — never an independently-settable field. This is what makes the lifecycle's guarantees (e.g., "Approved never silently carries forward to different content") structural rather than a matter of every caller remembering to keep a status field honest. A read-optimized cache of the derived state is a legitimate implementation choice, but only if it is refreshed by every operation that could change the derived answer and never trusted by an audit-facing read.

- **Draft.** A `CompositionDocument` exists (or is being iterated on in Studio) but no `ArtifactVersion` has been finalized. Owned entirely by Composition/Rendering; Publishing does not yet have a record. *Trigger: user editing in Studio. Gate: none.*
- **Generated.** A render has been produced and Publishing creates its first `ArtifactVersion` record for it. This is Publishing's actual entry point. *Trigger: a successful render via the Renderer Registry. Gate: none — Generated is a fact, not a decision.*
- **Reviewed.** A human (or, in future, an automated brand-compliance check) has looked at the `ArtifactVersion` and left a review outcome (not yet an approval — review can request changes). *Trigger: explicit reviewer action. Gate: none required to reach this state, but policy can require it exists before Approved is reachable.*
- **Approved.** A qualified approver has signed off, creating an immutable **Approval** record tied to this exact `ArtifactVersion`. If the artifact is edited after this point, the edit produces a *new* `ArtifactVersion` in `Generated` state — approval never silently carries forward to different content. *Trigger: approver action. Gate: governance policy evaluation (does this workspace require approval before publish; does this approver have the right role) — see Section 8.*
- **Published.** A **DistributionJob** succeeded against at least one **Destination**, producing a **Publication** record. An `ArtifactVersion` can be Published to multiple destinations independently and at different times — "published" is really "has at least one active Publication," and the full picture is the set of Publications, not a single boolean. *Trigger: distribution success. Gate: must be Approved first if the workspace's policy requires it; Destination-level permission check (does this user/workspace have the right to publish to this Destination).*
- **Archived.** The `ArtifactVersion` (and its Publications) remain fully queryable but are marked inactive — typically triggered by a newer version superseding it, or by explicit retirement. Nothing is deleted; this is a state change only. *Trigger: explicit archive action, or automatic on supersession. Gate: RetentionPolicy may prevent archiving before a minimum retention window if compliance requires the "published" record to remain the visible current state for some period.*
- **Deleted (optional, and rarely a hard delete).** For most compliance-conscious deployments, "Deleted" means access-revoked and content-purged while the AuditRecord (who published what, when) survives — because the fact that something *was* published often has to remain provable even after the content itself is gone (e.g., "we can prove this claim was live between these dates" without keeping the claim's full text forever). Whether true hard-deletion is ever offered is a per-workspace RetentionPolicy and legal question, not an architecture question this document should resolve — see Section 13.

---

## 6. Persistence Strategy

**What gets stored, and why, split by volatility:**

- **`CompositionDocument`: NOT persisted by Publishing.** It remains what `COMPOSITION_MODEL.md` §8 already established — derived, disposable, cheaply re-computable from the governed `ArtifactV2` plus theme version. Publishing references an `ArtifactVersion`'s *source* (the governed artifact + the theme/composition inputs used) so a render can be reproduced exactly if needed, but does not duplicate the Composition Layer's own caching concerns.
- **Rendered outputs (HTML/PDF/PPTX/PNG/Email bytes): persisted, but as a cache with a durable pointer, not duplicated storage of truth.** The *fact* that "ArtifactVersion 3 was rendered to PDF and here is where those bytes live" is durable (object storage reference + content hash). The bytes themselves can be regenerated from the `ArtifactVersion`'s source if the storage object is ever evicted — this is a cache-with-a-receipt, not a second source of truth, exactly extending the "derived, cacheable" posture `COMPOSITION_MODEL.md` §8 set up for `CompositionDocument` one layer further downstream.
- **Metadata (Artifact, ArtifactVersion, Approval, Destination, Publication records): fully persisted, relationally.** This is Publishing's actual database — small, structured, query-heavy (list all Approved-but-not-Published artifacts; list all Publications to a given Destination in the last 90 days). A relational store is the right tool here, independent of whatever storage the rendered bytes use.
- **Hashes: stored alongside every ArtifactVersion and every Publication.** A content hash of the source `ArtifactV2` plus theme/composition version is what makes "can we prove this exact content was what got approved and published" answerable without re-rendering — the same content-addressability idea `COMPOSITION_MODEL.md` §8 introduced for caching now does double duty as an audit primitive.
- **Version graph: an explicit, queryable structure, not inferred from timestamps.** "Which version superseded which" must be a real edge in the data model, because compliance questions ("was this claim ever live, even if superseded later that day") depend on exact version lineage, not on "whichever row has the latest `updated_at`."
- **Storage abstraction: yes, and for the same reason `@brandos/design-tokens` has zero dependencies — to avoid coupling the Publishing domain model to one storage vendor.** Whether rendered-output bytes live in Supabase Storage, S3, or something else is an infrastructure decision Publishing's domain model should not need to know about.
- **Caching vs. persistence, stated plainly:** rendered bytes are a cache (regenerable, evictable under a RetentionPolicy, not the system of record). Metadata is persistence (never evicted except under an explicit, audited RetentionPolicy action). Conflating these two is the single most common architectural mistake in systems like this — treating a rendered PDF as precious when the thing that's actually precious is the *record* that it was approved and sent.
- **Immutability, enforced at the model level, not by convention:** `ArtifactVersion`, `Approval`, and `PublishEvent` rows are never updated in place once created. A "correction" is a new row referencing the old one. This is what makes the audit trail trustworthy — a system where audit records *can* be edited is a system whose audit records prove nothing. **(v1.1 cross-reference, approved by the compliance review):** see Section 2 Principle 6 — this immutability is what makes the lifecycle's derived-state rule (Section 5) possible in the first place; the two are the same guarantee viewed from two angles.

---

## 7. Publisher Registry

Mirrors the Renderer Registry's own architecture deliberately — a proven pattern from this same codebase, not a new invention:

- **A `Publisher` is a contract**, conceptually parallel to `Renderer<T>` (`RENDERER_CONTRACT.md`): given a rendered output reference and a Destination's configuration, attempt distribution, and return a durable outcome (success with the destination's own reference, or failure with a reason). A `Publisher` never touches `CompositionDocument`, never re-renders, and never makes a lifecycle/approval decision — those are Publishing-core concerns, not destination concerns, exactly mirroring how a `Renderer` never makes a theme/layout decision (`RENDERER_CONTRACT.md` §2/§3).
- **Why destinations become plugins, not branches:** the moment LinkedIn-specific or ESP-specific logic leaks into the core lifecycle/approval code, adding a new destination requires touching code that has nothing to do with that destination — exactly the anti-pattern `RENDERING_ARCHITECTURE_AUDIT.md` found in the pre-Rendering-V2 export route (`if (format === 'canva')` branches scattered through a route file that should have been format-agnostic). A `Publisher` plugin means "add LinkedIn support" touches exactly one new file plus one registry entry, never the lifecycle engine.
- **A Destination Registry entry names which `Publisher` handles it** — the same "explicit choice made visible at the call site, not hidden in branching" discipline `RENDERER_CONTRACT.md` §5 established for the Canva split (`CanvaFieldRenderer` vs. `CanvaImportFallback`). Publishing inherits this discipline rather than reinventing it.

**Potential publishers**, listed to establish scope, not to commit to build order:
- **Share Link** — the simplest possible "destination": a durable, revocable public URL pointing at a rendered output. Likely the first `Publisher` built, since it requires no external API integration at all and exercises the full lifecycle/Publication/audit model end to end.
- **Download** — arguably not even a distinct "destination" so much as the absence of one; worth naming explicitly so the model doesn't force every rendered artifact through a Destination it doesn't need.
- **LinkedIn** — requires OAuth, rate-limit handling, and API-specific retry semantics — a genuinely nontrivial `Publisher`.
- **Email (ESP)** — the natural consumer of Rendering V2 Phase 9's `renderNewsletterToEmailHTML()`, which was built specifically anticipating this (`RENDERING_ROADMAP_V2.md` Phase 10 bullet).
- **CMS** — publishing to a customer's own website/CMS; likely the most heterogeneous `Publisher` category (every CMS is different) and a reasonable candidate for "build a generic webhook/API `Publisher` rather than one per CMS vendor" as a design decision when the time comes.
- **Canva** — note this is the *destination* sense of Canva (a Publication record for "this went to a Canva design"), distinct from Rendering V2 Phase 6's `CanvaFieldRenderer`/`CanvaImportFallback` (the *rendering* sense of Canva, which produces the design in the first place). These are adjacent, not the same concern — Rendering produces the Canva design; Publishing would record that it was produced and track its lifecycle, if that distinction ever turns out to matter for a given customer's compliance needs.
- **Future integrations** — deliberately left open-ended; the entire point of the plugin model is that this list is never closed.

---

## 8. Governance

Publishing is a **consumer** of governance policy, not its author — the same relationship `artifact-engine-layer` already has with `governance-layer` for content validation, extended to lifecycle decisions. **(v1.1 sharpening, approved by the compliance review):** concretely, this means Publishing depends on the governance stack's *configuration/schema tier* (policy definitions and defaults) — not its *validation-execution tier* (the engine that actually runs content-governance checks). Publishing has no reason to invoke a content-validation engine; it consumes already-governed content and already-defined policy, and re-deriving or re-validating either would violate Section 2 Principle 3. v1.0's phrasing of this relationship was ambiguous enough that resolving it correctly required independent reasoning during implementation; this sharpening exists so that reasoning doesn't have to be redone by the next reader.

- **Who approved:** every `Approval` record names a specific person and their role at the time of approval (roles can change later; the record reflects the role *at approval time*, not the role looked up today).
- **Who published:** every `Publication`/`DistributionJob` names who initiated it — which may differ from who approved it (a common real-world pattern: one person approves, an automated scheduler or a different team member actually triggers distribution).
- **Policy evaluation:** the Approved and Published lifecycle gates (Section 5) each invoke a policy check — "does this workspace require approval before publish," "does this approver's role satisfy this workspace's approval policy," "is this Destination allowed for this artifact type." Publishing calls into policy; it does not define policy rules itself, mirroring exactly how `governance-layer` centralizes content-validation policy rather than letting each artifact type define its own ad hoc rules.
- **Evidence:** the combination of `ArtifactVersion` (exact content hash), `Approval` (who, when, under what policy version), and `Publication` (where, when, destination's own confirmation reference) together constitute the evidence package a compliance review or a regulator would ask for. This is why none of the three can be optional or best-effort in the data model.
- **Compliance:** retention and access-revocation (Section 5/6) are themselves governed by policy, not hardcoded — different customers, different regulatory contexts, different retention requirements.
- **Brand audit:** because every Publication references the exact `ArtifactVersion` (not just "the artifact" loosely), a brand-governance review can answer "show me everything published under the old logo before the rebrand cutover date" precisely, not approximately.
- **Rollback:** "rollback" in this model is never destructive — it means creating a new lifecycle event (e.g., a Destination-side retraction where the `Publisher` supports it, like deleting a LinkedIn post via API) plus a durable `PublishEvent` recording that the rollback happened, who triggered it, and why. The original `Publication` record is never deleted; a system that could erase evidence of a rollback would defeat the purpose of having an audit trail at all.

---

## 9. HTTP Contracts (future — interfaces only, no implementation)

Assuming Publishing eventually becomes independently addressable (Section 10), the REST surface it would expose — **named and scoped only, no request/response schemas, no status-code tables, no implementation**:

- `POST /artifacts/{id}/versions` — record a new `ArtifactVersion` (called by Rendering after a successful render, not called by end users directly).
- `GET /artifacts/{id}` / `GET /artifacts/{id}/versions` — read artifact/version metadata and lifecycle state.
- `POST /artifacts/{id}/versions/{versionId}/review` — record a review outcome.
- `POST /artifacts/{id}/versions/{versionId}/approve` — record an approval (subject to policy evaluation).
- `GET /destinations` / `POST /destinations` — read/configure the Destination Registry (connect a LinkedIn account, register an ESP sending domain).
- `POST /artifacts/{id}/versions/{versionId}/publish` — submit a `DistributionJob` against a named Destination.
- `GET /artifacts/{id}/publications` — list Publications (where has this version actually gone, and with what outcome).
- `POST /artifacts/{id}/publications/{publicationId}/revoke` — trigger a rollback where the Destination's `Publisher` supports it.
- `GET /artifacts/{id}/audit` — the audit trail view for this artifact.

These are named to establish the *shape* of the eventual API surface for planning purposes — designing request bodies, auth scoping, pagination, and error contracts is implementation work explicitly out of scope for this document.

---

## 10. Deployment Model

**Today:** Publishing lives inside BrandOS (`apps/web` + a new `packages/publishing-layer`), the same way Rendering does — a package with clean internal boundaries, not a separate deployable. This is a deliberate, justified choice, not a placeholder — see Section 14 (Alternative Architectures) for why the alternatives were rejected *for now*.

**Future — Publishing Layer:** as BrandOS's own usage grows (more destinations, higher distribution volume, longer audit-retention requirements), `packages/publishing-layer` grows into a more clearly separated internal layer — its own database schema/connection pool even if still deployed inside the same application, its own background-job infrastructure for `DistributionJob` processing (this is the one place in Publishing where genuine async/event-driven processing is warranted regardless of which overall architecture wins, because destination calls are slow and fail independently of the request that triggered them).

**Eventually — Independent Publishing Service:** if and when a second Domain OS (beyond BrandOS) needs the same lifecycle/approval/audit/distribution machinery, Publishing graduates to a Core-Experience-level shared service with its own deployment, callable over the HTTP contracts sketched in Section 9. Because the `Publisher` plugin contract and the domain model (Section 4) were designed without any BrandOS-specific assumptions baked into their core shape (a `ArtifactVersion` is generic; only the artifact *type* discriminant is BrandOS-flavored today), this extraction is a redeployment plus a network boundary, not a redesign — the same "interfaces designed once, implementation location changes later" discipline `RENDERING_ARCHITECTURE_V2.md` §1.3 established for renderers.

---

## 11. Core Experience Integration

Core Experience (the layer above Domain OS's) should consume Publishing **exclusively through its API surface** (Section 9, or in-process equivalents while Publishing lives inside BrandOS) — and should never contain destination-specific logic of any kind. A Core Experience "Publish" button calls `POST .../publish` with a Destination identifier; it does not know or care whether that Destination is LinkedIn or Email. This is the same boundary discipline as `RENDERER_CONTRACT.md`'s renderer contract, applied at the Core-Experience/Domain-OS seam instead of the renderer-dispatch seam. If Core Experience ever needs to show "what destinations are available for this artifact," it calls the Destination Registry's read endpoint — it does not maintain its own list of known destinations, which would immediately create the two-sources-of-truth problem this entire document is designed to avoid.

---

## 12. Future Evolution

The domain model in Section 4 is deliberately shaped to make each of these additions an extension, not a redesign:

- **Scheduled publishing** — a `DistributionJob` gains a scheduled-execution time instead of executing immediately; no change to `Publication`, `PublishEvent`, or the approval gate.
- **Campaigns** — a grouping entity referencing multiple `Artifact`s and their `Publication`s, sitting *above* the model in Section 4, not requiring changes to it.
- **A/B variants** — multiple `ArtifactVersion`s under one `Artifact`, each independently publishable, with `Publication` records tagging which variant went where — the version graph (Section 6) already supports parallel, non-superseding versions, not just linear history, which is exactly what this needs.
- **Multi-channel publishing** — already native to the model: one `ArtifactVersion` can have many `Publication`s across many `Destination`s independently; this isn't a future feature so much as a natural reading of the Section 4 relationships as already designed.
- **Workflow engines** — the lifecycle (Section 5) as described is a fixed sequence; a future workflow engine would generalize the *gates* between states (today: a simple policy check) into configurable, multi-step approval chains — an evolution of the governance integration (Section 8), not a change to the lifecycle states themselves.
- **External approvals** — an Approval record's "who" need not always be an internal BrandOS user; the model already treats an approver as an identity reference, which can be extended to represent an external stakeholder (e.g., a client sign-off) without a structural change.
- **Analytics** — engagement/performance data from a Destination (opens, clicks, impressions) attaches to a `Publication` record as an additional, later-arriving fact — it does not change what a Publication fundamentally represents (an artifact-version-to-destination event).

---

## 13. Risks — what should NOT be built yet, and what decisions are still needed

**What should not be built yet:**
- A generalized workflow engine (Section 12) — no evidence yet that BrandOS's approval needs exceed a single approve/publish gate.
- A dedicated Publishing microservice deployment (Section 10's "Eventually" state) — there is currently exactly one consumer (BrandOS itself); building for a second Domain OS that doesn't exist yet is the same premature-abstraction mistake this document's own principles (Section 2.7) rule out.
- CMS-per-vendor `Publisher` implementations — build the generic case first; do not speculate about which specific CMS platforms matter until a customer need names one.
- True hard-deletion of audit history — this is as much a legal/compliance question as an engineering one (Section 5's "Deleted" discussion) and should not be engineered ahead of that determination.

**Product decisions still needed before implementation can begin (unchanged from the prior conversation, restated here for completeness since this document supersedes that informal list):**
- Which destination is genuinely first: Share Link (simplest, exercises the full model with no external dependency) is the architecturally-recommended starting `Publisher` specifically *because* it validates the lifecycle/approval/audit model before any external-API complexity is layered on top — LinkedIn or Email can follow once the core model is proven.
- What "published" must mean for compliance purposes for BrandOS's actual customers — this determines how strict the Approval gate and retention rules need to be from day one versus later.
- Whether an ESP is already selected, or is itself an open decision.
- Whether render-output caching (Section 6) is solving a real, current performance problem or is speculative — do not build the storage-abstraction/caching layer ahead of evidence that cold-start/re-render cost is actually a problem in production.

**Where engineering should stop, precisely:** at the boundary of this document. The domain model (Section 4), the lifecycle (Section 5), and the Publisher contract shape (Section 7) are the parts of this document stable enough to build against — confirmed by the Publishing Foundation implementation and its compliance review, which validated all three against real code with only the corrections listed in the v1.1 Change Log above. Everything in Sections 9 (HTTP contracts), 10 (deployment), and 12 (future evolution) is intentionally directional, not specified to implementation detail — schemas, auth models, and request/response shapes should be designed in the engineering milestone that actually builds them, informed by the product decisions above, not guessed at here.

---

## 14. Alternative Architectures Considered

Per the instruction to challenge this design before finalizing it: three alternatives were seriously considered and rejected, plus a fourth worth naming for completeness. Each is evaluated on the same axis — does it serve BrandOS's *actual, current* need, or does it solve a problem that doesn't exist yet at the cost of complexity that does.

### Alternative A: Publishing fully embedded in BrandOS, no separation at all
*(i.e., destination-specific code lives directly in `apps/web/app/api/artifact/export/route.ts` and similar routes, the way Canva's Design Import originally did before Rendering V2 Phase 6.)*

**What it looks like:** Add a `/publish` route. `if (destination === 'linkedin')` branch. `if (destination === 'email')` branch. No `Publisher` plugin contract, no Destination Registry, no separate lifecycle model — approval status becomes a column on the existing artifact record.

**Trade-offs:**
- ✅ Fastest to a working first destination — no registry, no plugin contract to design first.
- ✅ Zero new deployable, zero new operational surface.
- ❌ Reproduces exactly the anti-pattern `RENDERING_ARCHITECTURE_AUDIT.md` found and Rendering V2 spent six phases undoing (Findings C-3, M-2, and the Canva-split rationale in Phase 6) — destination-specific branching embedded in a route file, invisible until the third destination makes the branching unmanageable.
- ❌ No real audit trail — a status column tells you the *current* state, not the *history* of who approved what and when, which is precisely what a compliance review needs and precisely what this architecture cannot provide without becoming, piecemeal, the very model this document proposes anyway.
- ❌ Makes the eventual extraction (Section 10) far harder — coupling accretes silently in a way clean interfaces prevent.

**Rejected because:** this is not "simpler," it is "the same complexity, arrived at later, with worse tooling to manage it, and no audit trail in the meantime." Rendering V2 already proved (repeatedly, across Findings C-2, C-3, M-2) that this codebase's own history is one of exactly this mistake being made and then unwound at real cost. Repeating it deliberately for Publishing would be choosing to redo work this same initiative already paid down.

### Alternative B: Pure event-driven publishing from day one
*(i.e., every lifecycle transition — generated, reviewed, approved, published — is an event on a message bus; all state is derived by replaying/consuming events; CQRS-style read models rebuilt from an event log.)*

**What it looks like:** No direct writes to an `Artifact`/`ArtifactVersion` table. Every action publishes an event (`ArtifactGenerated`, `ArtifactApproved`, `PublicationRequested`, `PublicationSucceeded`); a set of consumers/workers build queryable projections from the event stream; the event log itself is the only true source of truth.

**Trade-offs:**
- ✅ Genuinely the *right* long-term shape for the audit trail specifically — Section 4's `PublishEvent` and Section 6's "immutability enforced at the model level" are both already event-sourcing-flavored ideas, borrowed deliberately.
- ✅ Natural fit for `DistributionJob` processing specifically, where async, retryable, failure-prone work is the norm (a LinkedIn API call or an ESP send is not a synchronous, always-succeeds operation).
- ❌ As the architecture for the *entire* system (including simple things like "record an approval" or "read an artifact's current state"), this is substantial operational complexity — a message broker, a fleet of consumers, event schema versioning and migration, replay/idempotency handling — with no current evidence BrandOS's publishing volume or consumer count justifies it.
- ❌ Makes the simplest, most valuable first `Publisher` (Share Link, per Section 13) far slower to ship, because even the trivial case now requires the full event-sourcing machinery to be stood up first.
- ❌ Debuggability suffers in the early stages of a system's life — reconstructing "what is the current state of this artifact" from a raw event stream is harder to reason about during initial rollout than reading a row in a table, precisely when the team most needs to move fast and verify behavior directly.

**Rejected as the whole-system architecture, but partially adopted where it earns its keep:** `PublishEvent` as an append-only log (Section 4) and asynchronous, retryable `DistributionJob` processing (Section 10) are both event-driven ideas this document deliberately keeps, because that piece of the system (external distribution calls) genuinely has the async, failure-prone shape event-driven architectures are built for. The lifecycle/approval core (Draft → Approved) does not share that shape — it is low-volume, human-paced, and benefits from being simple and directly queryable. This is a **hybrid**, not a rejection of event-driven ideas outright — the same "use the right tool for the specific problem, not one paradigm for everything" discipline Rendering V2 applied when it kept PDF on Chromium rather than switching PDF generation engines wholesale (`RENDERING_ARCHITECTURE_V2.md` §4.1).

### Alternative C: Independent PublishingOS microservice from day one
*(i.e., stand up Publishing as its own deployable service — own database, own deployment pipeline, own auth trust boundary, called over the network by BrandOS from the start.)*

**What it looks like:** Section 10's "Eventually" state, built first instead of last.

**Trade-offs:**
- ✅ Forces clean boundaries from day one — no possibility of the accidental coupling Alternative A risks, because a network boundary makes coupling expensive to create by accident.
- ✅ If a second Domain OS's need were already known and concrete, this would be close to the right call.
- ❌ There is exactly one consumer today (BrandOS). Building a multi-tenant-shaped service for a population of one consumer is the textbook case Section 2's Principle 7 (and this entire body of work's recurring theme — the dormant `IRendererAdapter` registry Rendering V2 Phase 7 had to revive) explicitly warns against: an abstraction with no second caller.
- ❌ Adds real operational cost immediately — a new deployable to build, secure, monitor, and version, a new network hop and its associated latency/failure modes, a new auth trust boundary to design correctly (service-to-service auth is not free) — all before a single artifact has been published anywhere.
- ❌ Slows down the exact iteration speed needed while the domain model (Section 4) is still being validated against real usage — schema mistakes are far more expensive to fix across a service boundary than inside a single deployable during the first few months of real use.

**Rejected for now, explicitly not forever:** Section 10 names this as the eventual state and Section 4/7's design choices (a generic domain model, a plugin-shaped `Publisher` contract) are deliberately made *so that* this extraction is cheap when it's actually warranted. Building it now would be paying the full cost of the "Eventually" column in Section 10 while only being ready to use the "Today" column's feature set.

### Alternative D (named for completeness): Publishing as a Core-Experience-level shared service, owned above BrandOS entirely, from day one

**What it looks like:** Skip "Domain OS capability that might graduate" and build Publishing as a Core Experience concern from the start, on the theory that every future Domain OS will need lifecycle/approval/audit/distribution eventually, so build it shared immediately.

**Trade-offs:**
- ✅ Avoids a future migration entirely if the multi-Domain-OS future is certain and near.
- ❌ No second Domain OS exists today to validate that its lifecycle/approval/distribution needs actually look like BrandOS's. Designing a "shared" model against a single real example is designing against a sample size of one and calling it general — a real risk of building the *wrong* generalized model, which is more expensive to fix later than extracting a validated BrandOS-specific model would be.
- ❌ Organizationally, this asks Core Experience to own and prioritize a capability that today only BrandOS uses — a resourcing and roadmap-ownership mismatch, not just a technical one.

**Rejected for the same reason as Alternative C, one level more so:** this isn't just premature service extraction, it's premature *generalization* — designing for requirements that are still hypothetical. Section 10's graduation path exists precisely so that if this future arrives, the move is available without having guessed wrong today.

### Why the recommended architecture (Sections 1–13) wins the comparison

The recommended design is best understood as **"Alternative A's deployment simplicity, Alternative B's event-sourced audit trail and async distribution handling, without Alternative B's whole-system operational overhead, and Alternative C/D's clean extraction seam without paying Alternative C/D's cost before there's a second consumer to justify it."** It is not a compromise reached by splitting the difference — it is the specific combination that matches what Rendering V2 already proved works in this exact codebase: start as a well-bounded package inside the existing application (proven: `@brandos/composition-layer`), use registries/plugin contracts to keep destination-specific logic out of core flow (proven: the Renderer Registry, the Canva split), apply async/event-driven techniques only where the problem genuinely has that shape (proven: PDF stayed on Chromium rather than switching engines wholesale, because the problem was a bad *template*, not a bad *engine*), and design interfaces that don't need to change when the deployment story eventually does (proven: this is exactly how Rendering's own `Renderer<T>` contract was designed). This document's recommendation is not a novel architectural bet — it is the application of a pattern this codebase has already validated once, to the next layer of the system.

**Post-implementation note (v1.1):** the Publishing Foundation implementation and its compliance review (`docs/reviews/PUBLISHING_FOUNDATION_COMPLIANCE_REVIEW.md`) validated this recommendation against real code — the domain model, lifecycle, and Publisher contract all held up without requiring the redesign any of Alternatives A–D would have implied, and the one entity gap found (`DistributionJob`'s missing format reference, corrected in Section 4 above) was a refinement within the recommended architecture, not evidence that a different one of these four alternatives should have been chosen instead.
