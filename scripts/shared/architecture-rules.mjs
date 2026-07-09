/**
 * scripts/shared/architecture-rules.mjs
 *
 * Architectural rules — SINGLE SOURCE OF TRUTH (human/agent-readable mirror).
 *
 * Derived from check-boundaries.mjs, check-route-boundaries.mjs, and
 * scripts/shared/package-registry.mjs. Rules are encoded here as data — they
 * mirror the live enforcement logic exactly, but do not execute it.
 *
 * PROVENANCE: extracted from scripts/generate-monorepo-context.mjs (P3.5 —
 * Agenticity Infrastructure Expansion) so that generate-monorepo-context.mjs
 * and the new architecture-intelligence generators (generate-agent-entrypoints.mjs,
 * generate-architecture-fixes.mjs, generate-behavior-contracts.mjs) consume the
 * exact same rule data instead of each declaring their own copy.
 *
 * Per the P3.5 architectural rule ("Do NOT create new sources of truth — if
 * ownership information already exists, consume it, derive from it, reuse it"),
 * this file does not introduce a new authority; it relocates the pre-existing
 * one. The rule contents are unchanged from their original location.
 *
 * v3 fix (Context Generation Pipeline Modernization):
 *   RULE-1, RULE-2, RULE-3, RULE-6, RULE-7 all described the deleted
 *   @brandos/brand-intelligence package. Rewritten to match
 *   scripts/check-boundaries.mjs v6 (the live enforcement this file mirrors)
 *   exactly: RULE-1/2/3 now describe @brandos/cognition-client; RULE-6/7 are
 *   retired as standalone entries (their "no concrete class, use the
 *   factory" intent is folded into RULE-3's description) — kept as
 *   redirect stubs below rather than deleted outright so any existing
 *   citation of "RULE-6"/"RULE-7" (e.g. in a stale doc, PR, or ticket)
 *   still resolves to an explanation instead of silently disappearing.
 */

import { ALLOWED_SAME_LEVEL_PAIRS, FORBIDDEN_IN_ROUTES } from './package-registry.mjs';

export const ARCH_RULES = [
  {
    id: 'RULE-LAYER-ORDER',
    source: 'check-boundaries.mjs (main loop) + LAYER_TIERS',
    description: 'No package may import from a package at a higher layer index than its own.',
    detail: 'Enforced in CI via `node scripts/check-boundaries.mjs`. Violations exit(1).',
  },
  {
    id: 'RULE-SAME-LEVEL-PEERS',
    source: 'check-boundaries.mjs + ALLOWED_SAME_LEVEL_PAIRS',
    description: 'Peer imports at the same layer index are forbidden unless the pair appears in ALLOWED_SAME_LEVEL_PAIRS.',
    detail: `Allowed pairs: ${[...ALLOWED_SAME_LEVEL_PAIRS].join(' | ')}`,
  },
  {
    id: 'RULE-1 — apps/web cognition-client isolation',
    source: 'check-boundaries.mjs checkWebBiWriteRule() (v6)',
    description: '`apps/web` must NOT import `@brandos/cognition-client` directly. All cognition access routes through CPL proxy functions.',
    detail: 'CPL proxies: getBrandMemory() [throws — no CognitionProvider equivalent], recordBrandMemoryObservation(), reviewBrandMemorySignal(), resolveBrandCognitionContext(), getBrandSummary(), ingestWorkspaceKnowledgeAsset(). Exception: apps/web/instrumentation.ts (process bootstrap) constructs and registers the singleton once, at startup, via dynamic import().',
  },
  {
    id: 'RULE-2 — OCL cognition-client isolation',
    source: 'check-boundaries.mjs checkOclBiRule() (v6)',
    description: '`@brandos/output-control-layer` must NOT import from `@brandos/cognition-client`.',
    detail: 'OCL receives all cognition data via ResolvedGenerationContract / ContributorContext.cognitionContext, populated by CPLOrchestrator. No direct cognition-client import permitted.',
  },
  {
    id: 'RULE-3 — CPL cognition-client symbol allowlist',
    source: 'check-boundaries.mjs checkCplBiRule() + CPL_COGNITION_ALLOWED_SYMBOLS (v6)',
    description: '`@brandos/control-plane-layer` may only import specific symbols from `@brandos/cognition-client`.',
    detail: 'Allowed: getGlobalCognitionClient, initCognitionClient, setGlobalCognitionClient, createDegradedCognitionContext, getGlobalKnowledgeIngestClient, initKnowledgeIngestClient, plus the CognitionContext/CognitionProvider type family re-exported from @platform/cognition-contract. HttpCognitionProvider and DegradedCognitionProvider (concrete classes) are deliberately excluded — see RULE-6/RULE-7.',
  },
  {
    id: 'RULE-4 — ARL ↛ OCL (Fix C1)',
    source: 'check-boundaries.mjs checkArlOclRule()',
    description: '`@brandos/ai-runtime-layer` must NOT import from `@brandos/output-control-layer`.',
    detail: 'ARL is a domain-agnostic runtime kernel. Artifact prompts delivered via registerArtifactPrompt() through globalThis.__brandos_runtime_adapter bridge.',
  },
  {
    id: 'RULE-5 — GL ↛ OCL (Fix C2)',
    source: 'check-boundaries.mjs checkGlOclRule()',
    description: '`@brandos/governance-layer` must NOT import from `@brandos/output-control-layer`.',
    detail: 'repairJSON / extractJSON moved to @brandos/shared-utils. Import from there.',
  },
  {
    id: 'RULE-6 — retired, folded into RULE-3 (v6)',
    source: 'formerly check-boundaries.mjs checkCplBiRepositoryRule() (Fix C4)',
    description: '(Retired) Formerly: `@brandos/control-plane-layer` must NOT import concrete BI repository classes. Under the current HTTP-adapter architecture, IntelligenceOS\'s repository layer is not visible to BrandOS at all — this concern has no analog. See RULE-3.',
    detail: 'No longer independently enforced; RULE-3\'s allowlist already excludes anything this rule would have caught.',
  },
  {
    id: 'RULE-7 — retired, folded into RULE-3 (v6)',
    source: 'formerly check-boundaries.mjs checkCplBiConcreteClassRule() (Fix C3)',
    description: '(Retired) Formerly: `@brandos/control-plane-layer` must NOT import BrandIntelligenceRuntime concrete class as a value. Current equivalent: CPL must not import HttpCognitionProvider/DegradedCognitionProvider as values — use createDegradedCognitionContext() / getGlobalCognitionClient() instead. Enforced as part of RULE-3\'s allowlist, not a separate check.',
    detail: 'No longer independently enforced; RULE-3\'s allowlist already excludes anything this rule would have caught.',
  },
  {
    id: 'RULE-OCL-GOVERNANCE-CONFIG',
    source: 'monorepo Rule 7 + WS2 + OCL dependencyBoundary.test.ts',
    description: '`@brandos/output-control-layer` must NOT import from `@brandos/governance-config`.',
    detail: 'Structural constraints now sourced directly from @brandos/contracts (Cleanup Sprint 2 WS2). Enforced by tests/boundary/dependencyBoundary.test.ts inside OCL.',
  },
  {
    id: 'RULE-PL-AUTH-ISOLATION',
    source: 'monorepo Rule 9 + WS1 + PL dependencyBoundary.test.ts',
    description: '`@brandos/presentation-layer` must NOT re-export `@brandos/auth` symbols from src/index.ts.',
    detail: 'Auth state injected via PLAuthProvider/PLAuthContext. Consumers import directly from @brandos/auth.',
  },
  {
    id: 'RULE-ROUTE-BOUNDARY',
    source: 'check-route-boundaries.mjs + FORBIDDEN_IN_ROUTES',
    description: 'Next.js route files in apps/web/app/api/ must NOT import runtime layers directly.',
    detail: `Forbidden in routes: ${FORBIDDEN_IN_ROUTES.join(', ')}`,
  },
  {
    id: 'RULE-ADMIN-AUTH',
    source: 'monorepo Rule 12',
    description: 'Every /api/admin/* route must call requireAdmin() before any logic.',
    detail: '',
  },
  {
    id: 'RULE-NODEJS-RUNTIME',
    source: 'monorepo Rule 13',
    description: 'Next.js route files that touch CPL must export `const runtime = "nodejs"`.',
    detail: '',
  },
  {
    id: 'RULE-ARTIFACT-ENGINE-NO-TOUCH',
    source: 'monorepo Rule 11',
    description: '`engine.ts` and `registry.ts` inside @brandos/artifact-engine-layer are read-only for agents.',
    detail: 'These are hard no-touch zones. Modifications require explicit human approval.',
  },
];
