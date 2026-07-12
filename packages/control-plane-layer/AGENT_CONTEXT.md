# AGENT_CONTEXT — @brandos/control-plane-layer

**Layer:** L7 — System Integrator / Orchestration
**Maturity:** L5 (Autonomous Ecosystem)
**Build order position:** 14 of 16
**Last updated:** Cleanup Sprint 2 — CPL proxy surface added for brand memory operations

> THIS IS THE INTEGRATION KERNEL. CPL owns no business logic. Every domain concern is delegated to its owning package. CPL wires them together in the correct order.

---

## Package Purpose

Single integration kernel for the BrandOS platform. All generation requests from `apps/web` enter here. CPL orchestrates all downstream packages and returns governed artifacts.

**As of Cleanup Sprint 2:** CPL also exposes a **proxy surface** for brand memory operations so that `apps/web` never needs to import `@brandos/brand-intelligence` directly. This is a deliberate routing rule: the correct path is `apps/web → CPL → BI`.

---

## Responsibilities

| Concern | Module |
|---|---|
| Request entry + orchestration | `src/orchestrator.ts` |
| Artifact pipeline execution | `src/artifact-pipeline.ts` |
| **Brand memory proxy** (NEW — Cleanup Sprint 2) | `src/brand-memory/service.ts` |
| Admin settings management | `src/admin/AdminSettingsService.ts` |
| Experiments | `src/experiments/` |
| Prompt library | `src/prompt-library/` |
| Score history | `src/scoring/` |
| Webhooks | `src/webhooks/` |
| Telemetry stubs | `src/telemetry/` |
| Policy management | `src/policy/` |

---

## Non-Responsibilities

CPL NEVER owns:
- AI provider logic (`ai-runtime-layer`)
- Artifact compilation (`output-control-layer`)
- Governance rules (`governance-layer`)
- Brand signal learning (`brand-intelligence`)
- UI rendering (`presentation-layer`)
- Auth (`@brandos/auth`)

---

## Public Contracts

```typescript
import {
  // Primary generation entry points
  runControlPlane,
  executeArtifactPipeline,
  initCPL,
  CPLOrchestrator,
  AdminSettingsService,

  // Brand memory proxy (Option B — cognition-consumer split)
  recordBrandMemoryObservation,
  resolveBrandCognitionContext,
  getBrandSummary,

  // Types
  type CPLRequest,
  type CPLResponse,
  type CPLConfig,
  type ArtifactPipelineRequest,
  type ArtifactPipelineResult,
} from '@brandos/control-plane-layer'
```

### Brand Memory Proxy Functions

These are exported from `src/brand-memory/service.ts` and re-exported from `src/index.ts`.

Option B (cognition-consumer split): `getBrandMemory` (raw signal read) and
`reviewBrandMemorySignal` (review-decision passthrough) have been removed.
BrandOS no longer reads raw brand-memory signals or reviews them — that is
IntelligenceOS's responsibility. `review()` was also removed from the
underlying `CognitionProvider` contract.

```typescript
// Record an artifact observation into brand memory
recordBrandMemoryObservation(input: IObservationEvent): Promise<void>

// Resolve brand cognition context for generation
resolveBrandCognitionContext(request: { workspaceId: string; taskType?: string }): Promise<CognitionContext>

// Get brand summary for display
getBrandSummary(params: { workspaceId: string; personaId?: string }): Promise<CognitionSummary>
```

**Rule:** `apps/web` routes must use these proxy functions. Direct import of `@brandos/cognition-client` in `apps/web` is forbidden.

---

## Dependencies

| Package | Reason |
|---|---|
| `@brandos/contracts` | All shared types including `IBrandCognitionRequest`, `IObservationEvent`, `SignalClassification` |
| `@brandos/shared-utils` | Logger |
| `@brandos/auth` | DB operations |
| `@brandos/runtime-config` | `toAIRuntimeConfig()` |
| `@brandos/governance-config` | `PolicyConfig`, `toAIRuntimePolicy()` |
| `@brandos/artifact-config` | `ArtifactEngineConfig` |
| `@brandos/ai-runtime-layer` | `setRuntimeConfigProvider`, `resetRuntime`, `callWithMode` |
| `@brandos/output-control-layer` | `ContractAssemblerFactory`, `compilePromptFromContract`, `normalizeOutput` |
| `@brandos/governance-layer` | `evaluateGovernance` |
| `@brandos/iskill-runtime` | `getSkillRuntime` (gated — Phase 2.6) |
| `@brandos/artifact-engine-layer` | `globalArtifactEngine`, `bootstrapArtifactEngine` |
| `@brandos/brand-intelligence` | **ONLY** factory functions + interface types (RULE-3, RULE-6, RULE-7) |

### Brand-Intelligence Import Rule (CRITICAL)

```typescript
// ✅ ALLOWED from @brandos/brand-intelligence in CPL
import {
  getGlobalBrandIntelligenceRuntime,
  initBrandIntelligenceRuntime,
  createDegradedCognitionContext,
  createBrandSignalRepository,
} from '@brandos/brand-intelligence'
import type {
  IBrandCognitionRuntime,
  IBrandIntelligenceRuntime,
  BrandIntelligenceConfig,
  BrandIntelligenceResolution,
} from '@brandos/brand-intelligence'

// ❌ FORBIDDEN — concrete class imports
import { BrandIntelligenceRuntime } from '@brandos/brand-intelligence'     // Fix C3
import { SupabaseBrandSignalRepository } from '@brandos/brand-intelligence' // Fix C4
```

---

## Internal Architecture

```
src/
  index.ts                          ← PUBLIC API barrel
  run-control-plane.ts              ← runControlPlane() — primary entry
  artifact-pipeline.ts              ← executeArtifactPipeline()
  orchestrator.ts                   ← CPLOrchestrator class
  init.ts                           ← initCPL() — wires all downstream packages at startup
  brand-memory/
    service.ts                      ← NEW (Cleanup Sprint 2): CPL proxy for BI operations
  admin/
    AdminSettingsService.ts
  experiments/
  prompt-library/
  scoring/
  webhooks/
  telemetry/
    server-analytics.ts             ← @deprecated PostHog stubs
  policy/
  __tests__/
    orchestrator.test.ts
    artifact-pipeline.test.ts
    init.test.ts
    admin/AdminSettingsService.test.ts
```

### Primary generation flow

```
apps/web POST /api/generate
  → runControlPlane(request)
       → CPLOrchestrator.orchestrate(request)
            ├─ 1. resolveBrandCognitionContext({ workspaceId })
            │     [CPL proxy → BI runtime.resolve()]
            │     or createDegradedCognitionContext() on failure
            │
            ├─ 2. ContractAssemblerFactory.create().assemble(context)
            │     → ResolvedGenerationContract
            │
            ├─ 3. compilePromptFromContract(contract)
            │     → CompiledPrompt { system, user }
            │
            ├─ 4. callWithMode(mode, { system, user, ... })
            │     → RouterResult
            │
            ├─ 5. evaluateGovernance(output, taskType)
            │     → GovernanceEvaluationResult
            │
            ├─ 6. executeArtifactPipeline(draft, type, topic) [structured only]
            │     → globalArtifactEngine.compileAndGovern()
            │
            └─ 7. recordBrandMemoryObservation(input)
                  [fire-and-forget — CPL proxy → BI]

  ← CPLResponse { artifact, score, governed, activityLog }
```

### brand-memory/service.ts

```typescript
// Routing rule enforced by this module:
//   apps/web → CPL proxy → @brandos/cognition-client → IntelligenceOS
//
// apps/web must NOT import @brandos/cognition-client directly.
//
// Option B (cognition-consumer split): getBrandMemory (raw signal read) and
// reviewBrandMemorySignal (review-decision passthrough) have been removed.
// BrandOS no longer reads or reviews raw brand-memory signals.

export async function recordBrandMemoryObservation(input)
export async function resolveBrandCognitionContext(request)
export async function getBrandSummary(params)
```

---

## Invariants

**I-1 — CPL is integration only.** No business logic owned here.

**I-2 — Single generation entry.** `runControlPlane()` is the only entry for `apps/web` routes.

**I-3 — BI concrete class ban.** Use `createDegradedCognitionContext()` and `createBrandSignalRepository()` factories (Fix C3, Fix C4).

**I-4 — Brand memory proxy is the cognition-client gateway.** `apps/web` routes must use proxy functions from this package, not import `@brandos/cognition-client` directly.

**I-5 — Observation reporting is fire-and-forget.** `recordBrandMemoryObservation()` called after returning response. Failures caught and logged. There is no raw-signal review passthrough on the BrandOS side (Option B) — `review()` was removed from the underlying `CognitionProvider` contract.

**I-6 — Internal BCs must not cross-import.** `brand-memory/`, `experiments/`, `scoring/`, etc. are soft boundaries and future extraction candidates.

**I-7 — Admin routes call `requireAdmin()`.** Every `apps/web` route under `/api/admin/*` must call `requireAdmin()`.

---

## Safe Changes

- Bug fixes to `orchestrator.ts` integration logic
- Bug fixes to `artifact-pipeline.ts`
- Adding new operations to `brand-memory/service.ts` (new proxy functions)
- Adding new internal BC operations within an existing BC directory

---

## Dangerous Changes

- Changing `runControlPlane()` or `executeArtifactPipeline()` signatures
- Changing `initCPL()` startup sequence
- Adding a concrete `@brandos/brand-intelligence` class import
- Creating cross-imports between internal BCs
- Modifying `AdminSettingsService` (affects provider config propagation)
- Removing or renaming any brand memory proxy function (apps/web depends on all 5)

---

## Test Strategy

**Test runner:** Vitest
**Location:** `src/__tests__/`

Required:
- `orchestrator.test.ts` — full happy path + degraded BI path
- `artifact-pipeline.test.ts` — pipeline entry, repair loop interaction
- `init.test.ts` — startup wiring, package init order
- `admin/AdminSettingsService.test.ts` — settings persistence, `toAIRuntimeConfig()` bridge

---

## Known Technical Debt

- **PostHog stubs in `src/telemetry/server-analytics.ts`** — `@brandos/telemetry-store` does not exist. Migration 3 planned, not started.
- **8 internal BCs** lack enforced isolation. Phase 1 CPL extraction plan not yet active.
- **`initCPL()` must run before `bootstrapArtifactEngine()`** — this ordering dependency is undocumented in `init.ts`. Should be made explicit.

---

## Current Migration Status

**Fix C3 + C4 (Complete):** Factory functions only for BI.

**Fix G2 (Complete):** PersonaContributor in OCL; CPL no longer assembles persona contributions inline.

**Cleanup Sprint 2 (Complete):** Brand memory proxy surface added (`src/brand-memory/service.ts`). All 5 proxy functions exported from `src/index.ts`.

---

## Agent Instructions

1. Read this file.
2. Confirm your change is integration logic, not business logic.
3. For new BI-facing operations: add a proxy function in `src/brand-memory/service.ts` and export from `src/index.ts`.
4. No concrete class imports from `@brandos/brand-intelligence`.
5. No cross-imports between internal BC directories.
6. Run `pnpm test` and `node scripts/check-boundaries.mjs` after changes.
7. If changing startup sequence in `init.ts`, document the new order in this file.
