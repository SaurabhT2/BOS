# AGENT_CONTEXT — @brandos/ui-admin

**Layer:** L3a — Configuration Schema  
**Maturity:** L3 (L2 → L3 migration complete)  
**Build order position:** 7 of 16 (peer with runtime-config, governance-config, artifact-config)

---

## Package Purpose

Shared admin UI primitives. Provides stateless, reusable React components and hooks consumed by every admin page in `apps/web`. Prevents copy-paste UI drift across admin panels.

This package owns **admin component primitives** — not business logic, not API calls (except via `useAdminSave`), and not page layout.

---

## Relationship to `@brandos/presentation-layer`

| Package | Owns |
|---|---|
| `@brandos/ui-admin` | Admin-specific primitives (dark industrial design, stats, toggles, save patterns) |
| `@brandos/presentation-layer` | Workspace-facing UI (CarouselRenderer, GenerationProgressDisplay, WorkspaceShell) |

These are **complementary, not overlapping**. Do not merge them. Admin UI is consumed by `apps/web` admin pages. Presentation layer is consumed by workspace/studio pages.

---

## Responsibilities

| Component/Hook | File | Purpose |
|---|---|---|
| Design tokens | `src/tokens.ts` | 17 color tokens — single source of truth for admin colors |
| `AdminCard` | `src/layout.tsx` | Card wrapper |
| `SectionTitle` | `src/layout.tsx` | Section header with icon |
| `Toggle` | `src/inputs.tsx` | Boolean toggle with label/description |
| `NumberInput` | `src/inputs.tsx` | Numeric input with min/max/unit |
| `SelectInput` | `src/inputs.tsx` | Dropdown select |
| `SegmentedControl` | `src/inputs.tsx` | Multi-option tab-style selector |
| `StatCard` | `src/display.tsx` | Metric display card |
| `StatusBadge` | `src/display.tsx` | Colored status indicator |
| `SaveButton` | `src/actions.tsx` | Async save with loading/success/error states |
| `useAdminSave` | `src/hooks.ts` | Hook managing async save lifecycle |
| `CapabilityRegistry` | `src/CapabilityRegistry.ts` | L3 machine-readable capability map |
| `validatePackage` | `src/validatePackage.ts` | Self-check health report |

---

## Non-Responsibilities

- Page layout (admin pages own their own layout)
- API calls (except `useAdminSave` which accepts a save callback — it does not call APIs directly)
- Authentication (that's `@brandos/auth`)
- Business logic
- Generation pipeline components (that's `@brandos/presentation-layer`)

---

## Public Contracts

The only file consumers should import from is `src/index.tsx` via `@brandos/ui-admin`.

```typescript
import {
  tokens,
  AdminCard, SectionTitle,
  Toggle, NumberInput, SelectInput, SegmentedControl,
  StatCard, StatusBadge,
  SaveButton,
  useAdminSave,
} from '@brandos/ui-admin'
import type { IUIAdmin } from '@brandos/ui-admin'
```

`src/IUIAdmin.ts` is the machine-readable interface boundary. Read it before modifying.

### Component prop signatures

| Export | Props |
|---|---|
| `tokens` | `{ bg, surface, border, text, accent, ... }` — 17 color tokens |
| `AdminCard` | `{ children?, style?, className? }` |
| `SectionTitle` | `{ children?, icon, color? }` |
| `Toggle` | `{ label?, checked, onChange, desc?, color?, disabled? }` |
| `NumberInput` | `{ label, value, onChange, min?, max?, unit?, disabled? }` |
| `SelectInput` | `{ label, value, onChange, options, disabled? }` |
| `SegmentedControl` | `{ value, onChange, options }` |
| `StatCard` | `{ label, value, unit?, trend? }` |
| `StatusBadge` | `{ status: 'ok' \| 'warn' \| 'error' \| 'info', label? }` |
| `SaveButton` | `{ onSave, disabled?, label? }` |
| `useAdminSave` | `(saveFn: () => Promise<void>) => { saving, saved, error, save }` |

---

## Dependencies

| Package | Reason |
|---|---|
| `@brandos/contracts` | Shared type imports (if any admin-related contract types are needed) |
| `react` | UI components (peer dependency) |

No `@brandos/ai-runtime-layer`, no `@brandos/control-plane-layer`, no `@brandos/governance-layer`. This package is purely presentational-primitive.

---

## Consumers

| Consumer | What they use |
|---|---|
| `apps/web` admin pages | All components, tokens, `useAdminSave` |

---

## Internal Architecture

```
src/
  tokens.ts             ← design token constants (SINGLE SOURCE OF TRUTH)
  layout.tsx            ← AdminCard, SectionTitle
  inputs.tsx            ← Toggle, NumberInput, SelectInput, SegmentedControl
  display.tsx           ← StatCard, StatusBadge
  actions.tsx           ← SaveButton
  hooks.ts              ← useAdminSave
  index.tsx             ← re-exports only (public barrel)
  IUIAdmin.ts           ← public contract interfaces
  IPackage.ts           ← package boundary declaration
  CapabilityRegistry.ts ← machine-readable capability registry
  validatePackage.ts    ← self-check health report
  __tests__/
    useAdminSave.test.ts
    validatePackage.test.ts
```

**All public exports are at `@brandos/ui-admin`.** No consumer changes from the L2→L3 sub-module split.

---

## Invariants

**I-1 — No business logic.** Components display and collect values. They do not implement business rules.

**I-2 — No API calls.** `useAdminSave` accepts a save callback; it does not call APIs. The caller owns the API call.

**I-3 — `tokens.ts` is the single source of truth.** All colors in admin UI components must come from `tokens`. No hardcoded hex values in component files.

**I-4 — Stateless components (except `useAdminSave`).** Components are functional with no internal state except transient UI state (hover, focus).

---

## Safe Changes

- Adding new components (with tests)
- Adding new tokens to `tokens.ts`
- Adding new props to existing components (optional, non-breaking)
- Bug fixes

---

## Dangerous Changes

- Removing tokens that are referenced by existing admin pages in `apps/web`
- Changing component prop signatures (breaking change for all admin page consumers)
- Removing any component

---

## Test Strategy

**Test runner:** Vitest (vitest.config.ts)  
**Location:** `src/__tests__/`

Required coverage:
- `useAdminSave.test.ts` — loading state, success state, error state, abort/unmount
- `validatePackage.test.ts` — health report, capability registry checks

---

## Known Technical Debt

- No visual regression tests. Admin UI components have no Storybook or snapshot tests.
- L3 maturity — not yet L4. Missing: full `validatePackage()` test suite beyond the basic scaffolding.

---

## Agent Instructions

Before modifying this package:

1. Read this file.
2. Read `src/IUIAdmin.ts` — this is the contract.
3. For new components, add to `src/index.tsx` and declare the interface in `IUIAdmin.ts`.
4. Always source colors from `tokens.ts` — never hardcode hex values.
5. Run `pnpm test` in this package after changes.
