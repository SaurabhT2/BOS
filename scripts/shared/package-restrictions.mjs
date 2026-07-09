/**
 * scripts/shared/package-restrictions.mjs
 *
 * Per-package ownership restrictions and the CPL↔cognition-client proxy
 * surface — SINGLE SOURCE OF TRUTH.
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
 *
 * v3 fix (Context Generation Pipeline Modernization):
 *   @brandos/brand-intelligence was deleted in the platform split. This file
 *   still described CPL's allowed-symbol list, OCL's restrictions, and web's
 *   restrictions entirely in terms of that deleted package, and carried a
 *   dedicated '@brandos/brand-intelligence' entry for a package that no
 *   longer exists on disk. Rewritten to match scripts/check-boundaries.mjs
 *   v6 (the live enforcement this file is meant to mirror) exactly:
 *   CPL_BI_ALLOWED_SYMBOLS -> CPL_COGNITION_ALLOWED_SYMBOLS, restrictions
 *   updated to name @brandos/cognition-client, and CPL_PROXY_SURFACE's
 *   method-mapping table rewritten to the actual current CognitionProvider
 *   operation names (resolveCognitionContext/observe/review/
 *   summarizeCognition — verified against control-plane-layer/src/
 *   brand-memory/service.ts, not the aspirational names in
 *   COGNITION_CONTRACT_SPEC.md, which differ — see that file's own
 *   "Known contract gaps" for the tracked spec/implementation delta).
 */

import { FORBIDDEN_IN_ROUTES } from './package-registry.mjs';

// Mirrors CPL_COGNITION_ALLOWED_SYMBOLS in scripts/check-boundaries.mjs
// exactly — keep both in sync if either changes.
export const CPL_COGNITION_ALLOWED_SYMBOLS = [
  'getGlobalCognitionClient', 'initCognitionClient', 'setGlobalCognitionClient',
  'createDegradedCognitionContext',
  'getGlobalKnowledgeIngestClient', 'initKnowledgeIngestClient',
  'CognitionContext', 'CognitionConfidence', 'VoiceProfile',
  'IdentityContribution', 'VisualIdentityProjection', 'CognitionProvenance',
  'CognitionRequest', 'ObservationInput', 'CognitionSummary', 'CognitionHealth',
  'CognitionReviewDecision', 'CognitionProvider',
  'KnowledgeAssetIngestInput', 'HttpCognitionProviderConfig', 'KnowledgeIngestClientConfig',
];

export const PACKAGE_RESTRICTIONS = {
  '@brandos/output-control-layer': [
    'Must NOT import from `@brandos/cognition-client` (RULE-2)',
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
    'May ONLY import these symbols from `@brandos/cognition-client`: ' + CPL_COGNITION_ALLOWED_SYMBOLS.join(', ') + ' (RULE-3)',
    "Must NOT import `HttpCognitionProvider` / `DegradedCognitionProvider` concrete classes as values (folded into RULE-3's allowlist, formerly separate RULE-6/RULE-7) — use `getGlobalCognitionClient()` / `createDegradedCognitionContext()`",
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
  '@brandos/cognition-client': [
    'The ONLY BrandOS package permitted to hold a concrete `CognitionProvider` implementation (`HttpCognitionProvider` / `DegradedCognitionProvider`)',
    'Performs no reasoning — pure serialize/deserialize + HTTP + degraded-mode fallback',
    'Public API surface is `packages/cognition-client/src/index.ts` — consumers must not deep-import',
  ],
  '@brandos/artifact-engine-layer': [
    '`engine.ts` and `registry.ts` are hard no-touch zones for agents (RULE-11)',
    'All external orchestration via `globalArtifactEngine` singleton (exported from `bootstrap.ts`)',
  ],
  '@brandos/web': [
    'Must NOT import `@brandos/cognition-client` directly (RULE-1)',
    'All cognition access via CPL proxy: `getBrandMemory()` (currently throws — no CognitionProvider equivalent, see cognition-contract/README.md "Known contract gaps" item 1), `recordBrandMemoryObservation()`, `reviewBrandMemorySignal()`, `resolveBrandCognitionContext()`, `getBrandSummary()`, `ingestWorkspaceKnowledgeAsset()`',
    'Exception: `apps/web/instrumentation.ts` (process bootstrap) may dynamically `import()` `@brandos/cognition-client` to construct and register the singleton once, at startup',
    'Route files must NOT import: ' + FORBIDDEN_IN_ROUTES.join(', '),
    'Auth imported directly from `@brandos/auth` (removed PL intermediate hop)',
    '`apps/web/app/layout.tsx` wraps children in `<PLAuthBridge>` inside `<AuthProvider>`',
    '`apps/web/lib/pl-auth-bridge.tsx` bridges `useAuth()` into `PLAuthProvider`',
  ],
};

// ── CPL proxy surface (published in each consumer's file) ─────────────────────

export const CPL_PROXY_SURFACE = `
### CPL Cognition Proxies

\`apps/web\` must access cognition only through these CPL functions (in
\`@brandos/control-plane-layer/src/brand-memory/service.ts\` and
\`knowledge/service.ts\`), which in turn call \`@brandos/cognition-client\`'s
\`CognitionProvider\`:

| CPL Proxy | CognitionProvider Method | Status |
|---|---|---|
| \`getBrandMemory(workspaceId, classification?)\` | *(none)* | Throws — no CognitionProvider equivalent exists (see cognition-contract/README.md, "Known contract gaps", item 1) |
| \`recordBrandMemoryObservation(input)\` | \`observe()\` | Live |
| \`reviewBrandMemorySignal(wsId, entryId, approved, reviewedBy)\` | \`review()\` | Live |
| \`resolveBrandCognitionContext(request)\` | \`resolveCognitionContext()\` | Live |
| \`getBrandSummary({ workspaceId, personaId? })\` | \`summarizeCognition(workspaceId)\` | Live — \`personaId\` accepted but ignored (no per-persona summary concept in the current contract) |
| \`ingestWorkspaceKnowledgeAsset(...)\` | \`KnowledgeIngestClient\` (separate client, not \`CognitionProvider\`) | Live |
`;
