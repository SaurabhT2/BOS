# AGENT_CONTEXT — @brandos/publishing-layer

**Layer:** L8.5 — Publishing (Phase 10)
**Maturity:** New (Phase 10, initial implementation of `PUBLISHING_ARCHITECTURE_V1.md` §1–§8)
**Build order position:** inserted after `@brandos/artifact-engine-layer`, before `@brandos/control-plane-layer`
**Last updated:** Phase 10 initial implementation

> Depends on `@brandos/contracts` (for `ArtifactType`/`ArtifactV2`), `@brandos/governance-config` (for `ApprovalGatesSchema` — Publishing *consumes* governance policy, §8), and `@brandos/shared-utils`. Deliberately NOT dependent on `@brandos/composition-layer`, `@brandos/ai-runtime-layer`, `@brandos/output-control-layer`, `@brandos/governance-layer`, or `@brandos/artifact-engine-layer` — this package consumes already-rendered bytes and already-governed content; it never re-derives or re-validates them (design principles 3/4 of the architecture doc). Also deliberately NOT dependent on `@brandos/control-plane-layer`, even though CPL is where policy is currently administered (`PolicyAdminService`) — see `PUBLISHING_LAYER_NOTES.md` for why that's an injected seam (`IPublishingPolicyProvider`), not an import.

---

## Package Purpose

The system of record for what BrandOS has produced, decided, and distributed, once a renderer has already produced bytes. Owns `Artifact` → `ArtifactVersion` → `Approval` / `Publication` / `DistributionJob` → `PublishEvent` (§4 of `PUBLISHING_ARCHITECTURE_V1.md`), the lifecycle state machine (§5), the `Publisher` plugin registry (§7), and the audit-trail projector (§4/§8). Full design rationale: `PUBLISHING_ARCHITECTURE_V1.md`. Scope boundary and what was deliberately not built in this engagement: `PUBLISHING_LAYER_NOTES.md` (same directory).

---

## Responsibilities

| Module | Responsibility |
|---|---|
| `types.ts` | Canonical domain model (§4) — `Artifact`, `ArtifactVersion`, `Approval`, `Destination`, `Publication`, `DistributionJob`, `PublishEvent`, `AuditRecord`, `RetentionPolicy`. Type-only. Contains an explicit naming-collision note vs. `@brandos/control-plane-layer`'s unrelated `ArtifactVersion`/`ApprovalRecord` — read it before touching either package. |
| `lifecycle.ts` | §5's state machine. Lifecycle state is *derived* from Approvals/Publications/PublishEvents (`deriveVersionState`), not stored as a mutable field — see the module header for why, given §6's "never updated in place" rule. `assertActionLegal` guards state-legality; `assertGateAllowed` surfaces policy-gate denials (see policy.ts) as the same `LifecycleError` type. |
| `policy.ts` | §8 — Publishing as a *consumer* of governance policy. Wires to `@brandos/governance-config`'s `ApprovalGatesSchema` via an injected `IPublishingPolicyProvider` (application layer wires this to a real, workspace-scoped policy source — not done in this engagement, see notes doc). |
| `publisher-contract.ts` | `Publisher` interface (§7) — deliberately mirrors `@brandos/composition-layer`'s `Renderer<T>` one layer up the stack. Type-only. |
| `publisher-registry.ts` | `PublisherRegistry` — dispatch by `publisherId`, mirrors `governance-layer`'s `GovernancePluginRegistry` pattern (instantiable, not a bare singleton — see file header for why). |
| `publishers/share-link-publisher.ts`, `publishers/download-publisher.ts` | The two Publisher implementations this engagement ships (§13's recommended starting set). Neither makes an external API call. |
| `storage.ts` | `RenderedOutputStore` (§6) — `SupabaseRenderedOutputStore` (real, production) + `InMemoryRenderedOutputStore` (tests/local dev). Deliberately excludes eviction/regeneration-on-demand — §13 flags that as unvalidated-need speculative work. |
| `repository.ts` / `repository-memory.ts` / `repository-supabase.ts` | §6's persistence abstraction, split by entity, with two complete implementations (in-memory, Supabase). See `repository-supabase.ts`'s header for why it does NOT use CPL's existing "warn and swallow" fire-and-forget error pattern. |
| `audit.ts` | Pure projector: raw rows → `AuditRecord` (§4/§8). The only place an `AuditRecord` is constructed. |
| `hash.ts` | SHA-256 content hashing (§6's audit primitive) for both rendered bytes and governed source payloads. Uses Node's built-in `crypto.subtle` — zero new dependency. |
| `publishing-service.ts` | The orchestrating facade — §11's "in-process equivalent" of the future HTTP surface (§9). Every public method here is what a future Next.js route or CPL proxy would call directly. |

---

## Non-Responsibilities

- **No rendering, no re-rendering.** Consumes `RenderedOutputRef` bytes handed to it; never calls into Rendering V2, never inspects `CompositionDocument` (§2 principles 2–4).
- **No HTTP routes, no admin endpoints.** §9's REST surface is explicitly "future — interfaces only, no implementation" in the architecture doc itself, and building Next.js routes this round would have required inventing unresolved product/auth decisions (§13) — confirmed concretely by the fact that `apps/web/app/api/artifacts/[id]/versions` already exists for an *unrelated* concept (CPL's campaign-regeneration versions), so §9's sketched paths would collide with a real existing route, not just a hypothetical one. See `PUBLISHING_LAYER_NOTES.md`.
- **No CPL wiring.** `@brandos/publishing-layer` is listed in `FORBIDDEN_IN_ROUTES` (`scripts/shared/package-registry.mjs`) — same discipline already applied to `governance-layer`/`ai-runtime-layer`/etc. — so a future `apps/web` route must go through a CPL proxy, which does not exist yet.
- **No LinkedIn/Facebook/Twitter/Email/CMS/OAuth/Analytics/Campaign/Scheduling/Workflow-engine Publishers.** All explicitly future plugins (§7, §12, §13) — the registry is open (§7's whole point), nothing here blocks adding them later.
- **No retention-window enforcement, no scheduled archival/deletion job.** `RetentionPolicy`'s *shape* is implemented (§4); the actual compliance-driven numbers are an unresolved product/legal decision (§13).
