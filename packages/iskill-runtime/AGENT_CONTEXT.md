# AGENT_CONTEXT — @brandos/iskill-runtime

**Layer:** L4 — Governed Execution  
**Maturity:** L4 (Wave C upgrade complete)  
**Build order position:** 11 of 16 (peer with governance-layer)

---

## Package Purpose

Governed execution runtime for ISkill and ICP Bundle orchestration. Owns the complete skill lifecycle: validate → prepare → execute → govern → repair → finalize → export. Manages skill registration, personalization context building, and bundle management.

This package is **fully implemented**. As of the Phase 2.6 gate-lift (2026-06-21, human-approved), the ISkill **contract-contribution path** is active in production: `SkillContributor` (in `@brandos/output-control-layer`) is registered in `ContractAssemblerFactory`'s default set and contributes the carousel-founder workflow for `taskType === 'carousel'` requests. The separate `SkillRuntime.execute()` lifecycle (validate→prepare→execute→govern→repair→finalize→export, with its own LLM call) remains unwired to the canonical generation path — that is a distinct, heavier execution mode and was out of scope for this gate-lift.

---

## Responsibilities

| Concern | Module |
|---|---|
| Skill registration and lookup | `src/registry/skill-registry.ts` |
| Bundle registration and lookup | `src/registry/bundle-registry.ts` |
| Skill lifecycle orchestration | `src/lifecycle/executor.ts` |
| Personalization context building | `src/personalization/context.ts` |
| Governance bridge (skill → governance-layer) | `src/governance/bridge.ts` |
| Execution context construction | `src/execution/context-builder.ts` |
| Capability registry | `src/capability/SkillCapabilityRegistry.ts` |
| Repair registry | `src/repair/repair-registry.ts` |
| ISkill runtime (primary entry) | `src/runtime/skill-runtime.ts` |
| Telemetry health check | `src/telemetry/health.ts` |
| Reference skill: carousel-founder | `src/skills/carousel-founder.ts` |
| Reference skill: linkedin-post | `src/skills/linkedin-post.ts` |
| Package self-validation | `src/validatePackage.ts` |
| Package metadata | `src/IPackage.ts` |

---

## Non-Responsibilities

- AI provider calls (those go through `ai-runtime-layer` via injected `callLLM`)
- Artifact compilation beyond what each skill defines (that's `artifact-engine-layer`)
- Identity resolution and injection (that's `control-plane-layer`)
- Governance validation rules (delegates to `governance-layer` via bridge)

---

## Public Contracts

`ISkillRuntime` is the ONLY public API surface. No internal types should be consumed directly by other packages.

```typescript
import {
  // Primary runtime
  getSkillRuntime,
  _resetSkillRuntime,     // test isolation only

  // Capability registry
  SkillCapabilityRegistry,
  skillCapabilityRegistry,

  // Package health
  validatePackage,

  // Types
  type ISkillRuntime,
  type SkillCapabilityKey,
  type SkillValidationResult,
  type PackageHealthReport,
  type PACKAGE_METADATA,
} from '@brandos/iskill-runtime'
```

**Do not import from subpaths** (`@brandos/iskill-runtime/src/lifecycle/executor`, etc.).

### L4 API Surface

| Export | Purpose |
|---|---|
| `SkillCapabilityRegistry` | `registerSkill`, `resolveSkill`, `listSkills`, `validateSkill` |
| `skillCapabilityRegistry` | Singleton instance |
| `SkillCapabilityKey` | Union type of owned capability keys |
| `SkillValidationResult` | Validation result from `validateSkill()` |
| `validatePackage` | Returns `PackageHealthReport` |
| `PackageHealthReport` | Health report type |
| `PACKAGE_METADATA` | Machine-readable package descriptor |

---

## Dependencies

| Package | Reason |
|---|---|
| `@brandos/contracts` | ISkill contracts, `IdentityDimension`, `ISkillPersonalizationContext`, `ArtifactV2` |
| `@brandos/shared-utils` | `Logger`, `withRetry` |
| `@brandos/governance-layer` | Governance bridge for skill output validation |

---

## Consumers

| Consumer | What they use |
|---|---|
| `@brandos/artifact-engine-layer` | `IPlatformPluginRegistry` (from `skill-registry.ts`) |
| `@brandos/control-plane-layer` | `getSkillRuntime()` when ISkill gate is lifted |
| `apps/web` | `/api/admin/iskill-test` test harness route |

---

## Internal Architecture

```
src/
  index.ts                              ← PUBLIC API barrel
  IPackage.ts                           ← machine-readable package metadata
  validatePackage.ts                    ← self-check + globalThis declaration
  contracts/
    index.ts                            ← ISkill, ICP Bundle, ISkillExecutionContext contracts
  runtime/
    skill-runtime.ts                    ← ISkillRuntime implementation
  lifecycle/
    executor.ts                         ← full lifecycle: validate→prepare→execute→govern→repair→finalize→export
  registry/
    skill-registry.ts                   ← registerSkill, resolveSkill
    bundle-registry.ts                  ← registerBundle, resolveBundle
  capability/
    SkillCapabilityRegistry.ts          ← queryable capability map
  personalization/
    context.ts                          ← ISkillPersonalizationContext builder
  governance/
    bridge.ts                           ← ISkillRuntime → governance-layer bridge
  execution/
    context-builder.ts                  ← ISkillExecutionContext construction
  repair/
    repair-registry.ts                  ← repair strategy registry
  skills/
    carousel-founder.ts                 ← reference skill: carousel for founders
    linkedin-post.ts                    ← reference skill: LinkedIn post generation
  telemetry/
    health.ts                           ← health ping, liveness check
  bootstrap.ts                          ← DI wiring, governance bridge setup
  __tests__/
    personalization.test.ts
    registry.test.ts
    skill-runtime.test.ts
    validatePackage.test.ts
```

### Key execution flow

```
ISkillRuntime.execute(skillId, request)
  → SkillCapabilityRegistry.resolveSkill(skillId)
  → ContextBuilder.build(request)     [personalization context]
  → executor.validate(skill, context)
  → executor.prepare(skill, context)
  → executor.execute(skill, context)  [calls injected callLLM]
  → GovernanceBridge.validate(output)
  → [repair loop if needed: max 2 attempts]
  → executor.finalize(output)
  → executor.export(output, format)
```

---

## Invariants

**I-1 — `IdentityDimension` and `ISkillPersonalizationContext` are RE-EXPORTED from `@brandos/contracts`.** Do not redeclare them in this package (R1 fix).

**I-2 — Max repair attempts = 2 by default.** Configurable via `IGovernanceOverrides.repairAttempts`. Never increase without cost/latency analysis.

**I-3 — `_resetSkillRuntime()` must remain exported** for test isolation.

**I-4 — `ISkillRuntime` is the ONLY public API surface.** No internal types should be directly consumed by other packages.

**I-5 — Skills receive identity via `ISkillExecutionContext.personalization`.** Never via direct import from brand-intelligence.

**I-6 — Production gate (lifted 2026-06-21, human-approved Phase 2.6).**  
```typescript
globalThis.__brandos_iskill_contract_contributor: boolean | undefined
```
Set to `true` in `apps/web/instrumentation.ts` immediately after `bootstrapSkillRuntime()` succeeds. The ISkillContributor slot (now `SkillContributor` in `@brandos/output-control-layer`, registered in `ContractAssemblerFactory`'s default set) is active. The flag stays unset/false only if `bootstrapSkillRuntime()` throws, in which case generation continues without skill contribution (graceful degrade — unchanged from pre-gate-lift behavior).

---

## Safe Changes

- `registry/` — skill and bundle registration
- `personalization/context.ts` — personalization context builder
- `skills/` — reference skill implementations
- `capability/SkillCapabilityRegistry.ts` — additive capability declarations
- Adding new skills via `registerSkill()` (additive pattern)

---

## Dangerous Changes

- `bootstrap.ts` — DI wiring and governance bridge setup. Changes alter initialization order.
- `governance/bridge.ts` — interface between runtime and governance-layer. Changes affect governance validation path.
- `lifecycle/executor.ts` — understand all invariants before modifying. Any change to lifecycle order requires full test suite verification.
- Removing the production gate without Phase 2.6 human approval.
- Removing `_resetSkillRuntime()` export — breaks all test isolation.

---

## Test Strategy

**Test runner:** Vitest  
**Location:** `src/__tests__/`

Required coverage:
- `validatePackage.test.ts` — healthy report, never throws, gated flag behavior
- `registry.test.ts` — registerSkill / resolveSkill / listSkills
- `personalization.test.ts` — personalization context building
- `skill-runtime.test.ts` — full lifecycle with mock callLLM

---

## Known Technical Debt

- `createPassthroughGovernanceBridge` — marked deprecated. Removal blocked on test suite migration (Phase 2.6).
- Production gate removal is Phase 2.6 and requires human gate-lift decision.
- `remix()` in artifact-engine-layer is blocked on this gate removal.

---

## Current Migration Status

### Production Gate Status (Phase 2.6 — ACTIVE)
**Current state:** `globalThis.__brandos_iskill_contract_contributor = true`, set in `apps/web/instrumentation.ts` after `bootstrapSkillRuntime()` succeeds. `SkillContributor` (in `@brandos/output-control-layer`) is registered in `ContractAssemblerFactory`'s default contributor set and contributes for `taskType === 'carousel'`.  
**Gate-lift authorized by:** human approver, 2026-06-21.  
**Remaining scope, not part of this gate-lift:** `SkillRuntime.execute()`'s full lifecycle (the heavier validate→prepare→execute→govern→repair→finalize→export path with its own LLM call) is still unwired to the canonical generation path. No route calls it. Wiring it in would be a second generation pipeline, not a registration fix, and needs its own design/approval pass if ever pursued.

### L4 Requirements (Complete)
- ✅ `AGENT_CONTEXT.md` authored and current
- ✅ `IPackage.ts` present
- ✅ `SkillCapabilityRegistry.ts` with registerSkill/resolveSkill/listSkills/validateSkill
- ✅ `validatePackage()` returning `PackageHealthReport`
- ✅ `globalThis.__brandos_iskill_contract_contributor` type declared
- ✅ Test suite in `src/__tests__/`

---

## Agent Instructions

Before modifying this package:

1. Read this file.
2. Read `src/contracts/index.ts` — the ISkill contract shapes.
3. Do NOT remove the production gate without explicit Phase 2.6 approval.
4. For new skills: create a file in `src/skills/`, implement `ISkill`, register in `bootstrap.ts`.
5. For lifecycle changes: read `lifecycle/executor.ts` and all invariants before touching.
6. Run `pnpm test` after changes.
