/**
 * scripts/shared/package-restrictions.mjs
 *
 * Per-package ownership restrictions and the CPL↔BI proxy surface —
 * SINGLE SOURCE OF TRUTH.
 *
 * Derived from check-boundaries.mjs. Maps package name → specific
 * restrictions that apply to that package.
 *
 * PROVENANCE: extracted from scripts/generate-package-contexts.mjs (P3.5 —
 * Agenticity Infrastructure Expansion) so that generate-package-contexts.mjs
 * and the new architecture-intelligence generators (generate-agent-entrypoints.mjs,
 * generate-architecture-fixes.mjs, generate-behavior-contracts.mjs) consume the
 * exact same restriction data instead of each declaring their own copy.
 *
 * Per the P3.5 architectural rule ("Do NOT create new sources of truth — if
 * ownership information already exists, consume it, derive from it, reuse it"),
 * this file does not introduce a new authority; it relocates the pre-existing
 * one. The data is unchanged from its original location.
 */

import { FORBIDDEN_IN_ROUTES } from './package-registry.mjs';

export const CPL_BI_ALLOWED_SYMBOLS = [
  'getGlobalBrandIntelligenceRuntime', 'initBrandIntelligenceRuntime',
  'IBrandCognitionRuntime', 'IBrandIntelligenceRuntime',
  'BrandIntelligenceConfig', 'BrandIntelligenceResolution',
  'createDegradedCognitionContext', 'createBrandSignalRepository',
];

export const PACKAGE_RESTRICTIONS = {
  '@brandos/output-control-layer': [
    'Must NOT import from `@brandos/brand-intelligence` (RULE-2)',
    'Must NOT import from `@brandos/governance-config` (OCL-GOVERNANCE-CONFIG — WS2)',
    'Structural constraints sourced from `@brandos/contracts` only',
    'Enforced by `tests/boundary/dependencyBoundary.test.ts`',
  ],
  '@brandos/ai-runtime-layer': [
    'Must NOT import from `@brandos/output-control-layer` (RULE-4 / Fix C1)',
    'Artifact prompts delivered via `registerArtifactPrompt()` through `globalThis.__brandos_runtime_adapter`',
  ],
  '@brandos/governance-layer': [
    'Must NOT import from `@brandos/output-control-layer` (RULE-5 / Fix C2)',
    'Use `repairJSON` / `extractJSON` from `@brandos/shared-utils` instead',
    'Must NOT import from `@brandos/ai-runtime-layer`',
  ],
  '@brandos/control-plane-layer': [
    'May ONLY import these symbols from `@brandos/brand-intelligence`: ' + CPL_BI_ALLOWED_SYMBOLS.join(', ') + ' (RULE-3)',
    'Must NOT import concrete BI repository classes (RULE-6 / Fix C4) — use `createBrandSignalRepository()` factory',
    'Must NOT import `BrandIntelligenceRuntime` concrete class as a value (RULE-7 / Fix C3) — use `createDegradedCognitionContext()`',
    '`engine.ts` and `registry.ts` in artifact-engine-layer are read-only (RULE-11)',
    'Every /api/admin/* route must call `requireAdmin()` (RULE-12)',
    'CPL-touching routes must export `const runtime = "nodejs"` (RULE-13)',
  ],
  '@brandos/presentation-layer': [
    'Must NOT re-export `@brandos/auth` symbols from `src/index.ts` (RULE-9 / WS1)',
    'Auth state injected via `PLAuthProvider` / `PLAuthContext`',
    'Shell components use `usePLAuth()` not `useAuth()` directly',
    'Consumers import auth directly from `@brandos/auth`',
    'Dependency: `@brandos/contracts` ONLY (auth removed in Cleanup Sprint 2)',
    'Enforced by `__tests__/unit/dependencyBoundary.test.ts`',
  ],
  '@brandos/brand-intelligence': [
    'Fully removed: `updatePersonaProfile()`, `resolvePersonaContribution()` (Cleanup Sprint 2)',
    'These symbols no longer exist in the runtime class or `IBrandIntelligenceRuntime`',
    'V2 API only: `initBrandIntelligenceRuntime`, `getGlobalBrandIntelligenceRuntime`, factory functions',
  ],
  '@brandos/artifact-engine-layer': [
    '`engine.ts` and `registry.ts` are hard no-touch zones for agents (RULE-11)',
    'All external orchestration via `globalArtifactEngine` singleton (exported from `bootstrap.ts`)',
  ],
  '@brandos/web': [
    'Must NOT import `@brandos/brand-intelligence` directly (RULE-1 / Rule 8)',
    'All BI access via CPL proxy: `getBrandMemory()`, `recordBrandMemoryObservation()`, `reviewBrandMemorySignal()`, `resolveBrandCognitionContext()`, `getBrandSummary()`',
    'Route files must NOT import: ' + FORBIDDEN_IN_ROUTES.join(', '),
    'Auth imported directly from `@brandos/auth` (removed PL intermediate hop)',
    '`apps/web/app/layout.tsx` wraps children in `<PLAuthBridge>` inside `<AuthProvider>`',
    '`apps/web/lib/pl-auth-bridge.tsx` bridges `useAuth()` into `PLAuthProvider`',
  ],
};

// ── CPL proxy surface (published in each consumer's file) ─────────────────────

export const CPL_PROXY_SURFACE = `
### CPL Brand Memory Proxies
\`apps/web\` must access brand intelligence only through these CPL functions:

| CPL Proxy | BI Method |
|---|---|
| \`getBrandMemory(workspaceId, classification?)\` | \`runtime.getMemory()\` |
| \`recordBrandMemoryObservation(input)\` | \`runtime.recordArtifactObservation()\` |
| \`reviewBrandMemorySignal(wsId, entryId, approved, reviewedBy)\` | \`runtime.review()\` |
| \`resolveBrandCognitionContext(request)\` | \`runtime.resolve()\` |
| \`getBrandSummary({ workspaceId, personaId? })\` | \`runtime.getBrandSummary()\` |
`;
