# AGENT_CONTEXT — @brandos/contracts

**Layer:** L0 — Type Kernel
**Maturity:** Stable
**Build order position:** 1 of 16
**Last updated:** Cleanup Sprint 2 WS2 — structural constraints added

---

## Package Purpose

Zero-dependency canonical type kernel for the entire BrandOS platform. Every package depends on this one. Contains types, interfaces, and constants that every layer needs without introducing cross-package coupling.

**New as of Cleanup Sprint 2 WS2:** This package now owns structural constraint interfaces and concrete constants (`CAROUSEL/DECK/REPORT_STRUCTURAL_CONSTRAINTS`). Previously these lived only in `@brandos/governance-config`. Moving them here lets OCL import them without creating an OCL → governance-config coupling.

---

## Responsibilities

| Domain | File | What it owns |
|---|---|---|
| Artifact schemas + structural constraints | `artifact-v2.ts` | `CarouselArtifact`, `DeckArtifact`, `ReportArtifact`, `ArtifactV2`, type guards, `CAROUSEL_ROLES`, **`CarouselStructuralConstraints`, `DeckStructuralConstraints`, `ReportStructuralConstraints` interfaces + constants** |
| AI runtime interfaces | `airuntime-types.ts` | `IAIRuntime`, `IProviderAdapter`, `IRouterEngine`, all request/result types |
| Generation contract | `generation-contract.ts` | `IIdentityContribution`, `IPersonaContribution`, `IIntentContribution`, `IArtifactContribution`, `IRuntimeContribution`, `ResolvedGenerationContract`, `IContractAssembler`, `IBrandRuntimeServices` (**`resolvePersonaContribution` removed — Cleanup Sprint 2 WS3**) |
| Identity types | `identity-types.ts` | `ISemanticIdentity`, `IVisualIdentity`, `IdentitySnapshot`, **`IObservationEvent`**, dimension enums |
| Brand cognition | `brand-cognition-contracts.ts` | `IBrandCognitionRuntime`, `IBrandCognitionContext`, `IBrandMemorySignal`, `IBrandSignalRepository`, V2 signal types, **`SignalClassification`**, **`IBrandCognitionRequest`**, **`IArtifactObservationRequest`** (deprecated), `IBrandVoice` |
| Auth/DB types | `auth-types.ts` | `AuthUser`, `CampaignRow`, `PersonaRow`, `FeedbackRow`, all `New*` mutation types |
| Provider registry | `provider-registry.ts` | `PROVIDER_REGISTRY`, provider name constants |
| Governance feedback | `governance-feedback.ts` | `IGovernanceFeedback`, `IAttemptHistory`, helper factories |
| Self-validation | `self-validate.ts` | `validateContractsPackage()` |

### Structural Constraint Constants (Cleanup Sprint 2 WS2)

```typescript
// Interfaces
export interface CarouselStructuralConstraints {
  minSlides: 6; maxSlides: 10; requiredRoles: ['hook', 'cta']
  minTitleChars, minHookChars, minHookWords, minCtaChars, minCtaWords,
  minSlideHeadlineChars, genericCtaPhrases
}
export interface DeckStructuralConstraints {
  minSlides: 7; maxSlides: 14; requiredRoles: ['cover', 'closing']
  minTitleChars, minSlideHeadlineChars
}
export interface ReportStructuralConstraints {
  minSections: 4; maxSections: 10; requiredSectionIds: ['executive-summary']
  minTitleChars, minSectionHeadingChars
}

// Concrete constants (OCL imports these)
export const CAROUSEL_STRUCTURAL_CONSTRAINTS: CarouselStructuralConstraints
export const DECK_STRUCTURAL_CONSTRAINTS:     DeckStructuralConstraints
export const REPORT_STRUCTURAL_CONSTRAINTS:   ReportStructuralConstraints
```

`@brandos/governance-config` re-exports these and uses `AssertEqual<>` compile-time assertions to detect drift. If you change the values here, also update `@brandos/governance-config` and verify the `AssertEqual` still compiles.

---

## Non-Responsibilities

- Runtime enforcement logic
- LLM call logic or SDK wrappers
- Supabase client code
- React components or hooks
- Business logic
- Implementation of any declared interface
- Zod schemas

---

## Public Contracts

Import exclusively from `@brandos/contracts`. Never import from internal subpaths.

```typescript
// Artifact types
import type { ArtifactV2, CarouselArtifact, DeckArtifact, ReportArtifact } from '@brandos/contracts'
import { isCarouselArtifact, isDeckArtifact, isReportArtifact } from '@brandos/contracts'

// Structural constraints (Cleanup Sprint 2 WS2)
import {
  CAROUSEL_STRUCTURAL_CONSTRAINTS,
  DECK_STRUCTURAL_CONSTRAINTS,
  REPORT_STRUCTURAL_CONSTRAINTS,
} from '@brandos/contracts'
import type {
  CarouselStructuralConstraints,
  DeckStructuralConstraints,
  ReportStructuralConstraints,
} from '@brandos/contracts'

// AI runtime interfaces
import type { IAIRuntime, TaskType } from '@brandos/contracts'

// Generation contract
import type { ResolvedGenerationContract, IContractAssembler, IBrandRuntimeServices } from '@brandos/contracts'

// Brand cognition (V2)
import type {
  IBrandCognitionRuntime, IBrandCognitionContext,
  IBrandCognitionRequest, SignalClassification, IObservationEvent,
} from '@brandos/contracts'
// IArtifactObservationRequest is deprecated — use IObservationEvent
import type { IArtifactObservationRequest } from '@brandos/contracts'

// Auth/DB
import type { AuthUser, CampaignRow, PersonaRow, DbResult } from '@brandos/contracts'

// Governance feedback
import type { IGovernanceFeedback, IAttemptHistory } from '@brandos/contracts'
import { createEmptyAttemptHistory, appendAttemptRecord } from '@brandos/contracts'
```

---

## Dependencies

None — zero runtime dependencies by architectural law.

---

## Consumers and Their Key Imports

| Consumer | Key imports from this package |
|---|---|
| `@brandos/output-control-layer` | `CAROUSEL/DECK/REPORT_STRUCTURAL_CONSTRAINTS` (WS2), artifact types, generation contract |
| `@brandos/governance-config` | Re-exports structural constraint constants after `AssertEqual` assertion |
| `@brandos/brand-intelligence` | `IBrandCognitionRuntime`, `IBrandCognitionRequest`, `IObservationEvent`, `SignalClassification` |
| `@brandos/control-plane-layer` | `IBrandCognitionRequest`, `IArtifactObservationRequest`, `IObservationEvent`, `SignalClassification` (for CPL proxy signatures) |
| `apps/web` | `ArtifactV2`, `TaskType`, auth types |

---

## Internal Architecture

```
src/
  index.ts                     ← SINGLE PUBLIC BARREL — all exports here
  artifact-v2.ts               ← artifact types + STRUCTURAL CONSTRAINTS (WS2)
  airuntime-types.ts           ← AI runtime interface contracts
  generation-contract.ts       ← contributor interfaces (resolvePersonaContribution removed — WS3)
  identity-types.ts            ← identity types + IObservationEvent
  brand-cognition-contracts.ts ← V2 brand contracts, IBrandCognitionRequest, SignalClassification
  auth-types.ts                ← auth/session + Supabase DB row types
  provider-registry.ts         ← provider name registry
  governance-feedback.ts       ← governance feedback loop types
  artifact-v2-compat.ts        ← upcast/legacy compat helpers
  IContracts.ts                ← meta-interface
  self-validate.ts             ← runtime integrity checks
  __tests__/
```

---

## Invariants

**I-1 — Zero runtime dependencies.** `package.json` `dependencies` must be empty.

**I-2 — No `@brandos/*` imports.**

**I-3 — Structural constraint changes require `governance-config` sync.** If `CAROUSEL/DECK/REPORT_STRUCTURAL_CONSTRAINTS` values change, also update the concrete constants in `@brandos/governance-config` so the `AssertEqual<>` assertions still compile.

**I-4 — Additive-only for contributor interfaces.** Never remove fields from contributor interfaces. `resolvePersonaContribution` has been permanently removed from `IBrandRuntimeServices` — do not re-add it.

**I-5 — Type guards are authoritative.** `isCarouselArtifact()`, `isDeckArtifact()`, `isReportArtifact()` are the only correct way to narrow `ArtifactV2`.

**I-6 — V2 cognition contract is active.** `IBrandCognitionRequest` is the current resolve input. `IObservationEvent` is the current observation type. `IArtifactObservationRequest` is deprecated — kept for V1 compat only.

---

## Safe Changes

- Adding new optional fields to existing interfaces
- Adding new exported types, interfaces, or const registries
- Adding new type guard functions
- Adding a new artifact type (requires type guard + schema instruction + structural constraint interface/constant)

---

## Dangerous Changes

- Removing or renaming any exported type, interface, or function
- Changing structural constraint constant values without updating `@brandos/governance-config`
- Changing `TaskType` union values (breaks routing in CPL and ai-runtime-layer)
- Changing `ArtifactV2` or any artifact's required fields
- Adding a `@brandos/*` runtime dependency

---

## Test Strategy

**Location:** `src/__tests__/`

Required:
- Contract stability tests: all expected symbol names exported
- Type guard correctness
- `validateContractsPackage()` returns no violations
- Structural constraint shape validation: all required fields present with correct types

---

## Known Technical Debt

- `IContracts.ts` — meta-interface. Consumption status UNKNOWN.
- `artifact-v2-compat.ts` — backward compat. Audit callers.
- `IArtifactObservationRequest` — deprecated. Remove when all callers use `IObservationEvent`.

---

## Current Migration Status

**Cleanup Sprint 2 WS2 (Complete):** Structural constraint interfaces and concrete constants added to `artifact-v2.ts`. Exported from `src/index.ts`. `@brandos/governance-config` updated to re-export with `AssertEqual` assertions.

**Cleanup Sprint 2 WS3 (Complete):** `resolvePersonaContribution` removed from `IBrandRuntimeServices` in `generation-contract.ts`.

---

## Agent Instructions

1. Read this file.
2. Confirm your change is additive. For removals/renames, identify all consumers first.
3. For structural constraint value changes: update both this file AND `@brandos/governance-config`.
4. Run `tsc --noEmit` in this package.
5. Run `node scripts/check-boundaries.mjs` from repo root.
