#!/usr/bin/env node
/**
 * scripts/shared/package-registry.mjs
 *
 * BrandOS Canonical Package Registry — v2
 *
 * SINGLE SOURCE OF TRUTH for:
 *   - Package names and their filesystem paths
 *   - Architectural layer tiers (L0 → L11)
 *   - Source directory map (for TypeScript walkers)
 *   - Build order (topological, for ManualOrder mode)
 *
 * ALL check-*.mjs and lint-imports.mjs import from here.
 * When a package is added, renamed, or removed, edit ONLY this file.
 *
 * Rename history:
 *   identity-layer → brand-intelligence  (BrandIntelligence migration, v4)
 *
 * v2 changes (Engineering Workflow Audit & Consolidation):
 *   @brandos/brand-intelligence was deleted as part of the BrandOS /
 *   IntelligenceOS platform split (Milestone 1) — its responsibilities
 *   moved to IntelligenceOS, reached over HTTP via the two packages below.
 *   This registry still listed it, which meant `check-workspace.mjs`
 *   unconditionally failed (KNOWN_PACKAGES pointed at a directory that no
 *   longer exists). Removed everywhere.
 *
 *   @platform/cognition-contract and @brandos/cognition-client — added
 *   during the platform split (Milestone 1/2) as brand-intelligence's
 *   replacement — were never added here, which meant they were invisible
 *   to check-boundaries.mjs's upward-import checks (both as source and as
 *   dependency target — a package importing cognition-client with a
 *   violating direction would not have been caught) and to
 *   check-circular.mjs / lint-imports.mjs's source walk (their src/ trees
 *   were never scanned at all — PACKAGE_SRC_MAP is the walk list). Both
 *   are now registered.
 */

// ── Layer tiers — lower index = more foundational ─────────────────────────
// Each sub-array is a set of peer packages at the same tier.
// No package may import from a tier with a higher index than its own.
export const LAYER_TIERS = [
  ['@platform/cognition-contract'],                                                 // L0 — cross-platform contract, zero deps (shared with IntelligenceOS)
  ['@brandos/contracts'],                                                           // L1 — zero-dep shared types
  ['@brandos/shared-utils'],                                                        // L2 — infrastructure helpers
  ['@brandos/cognition-client'],                                                    // L3 — sole holder of a concrete CognitionProvider instance
  ['@brandos/auth'],                                                                // L4 — authentication
  ['@brandos/runtime-config', '@brandos/governance-config', '@brandos/artifact-config', '@brandos/ui-admin'], // L5 — config schemas (contracts-only deps)
  ['@brandos/ai-runtime-layer', '@brandos/output-control-layer'],                  // L6 — runtime execution peers
  ['@brandos/governance-layer', '@brandos/iskill-runtime'],                        // L7 — governed execution peers
  ['@brandos/artifact-engine-layer'],                                               // L8 — artifact orchestration
  ['@brandos/control-plane-layer'],                                                 // L9 — system integrator / orchestration
  ['@brandos/presentation-layer'],                                                  // L10 — UI components
  ['@brandos/web'],                                                                 // L11 — Next.js app
];

// Flat map: package name → tier index (derived from LAYER_TIERS)
export const LAYER_INDEX = Object.fromEntries(
  LAYER_TIERS.flatMap((tier, i) => tier.map(pkg => [pkg, i]))
);

// ── Known packages with disk paths ────────────────────────────────────────
// Used by check-workspace.mjs for presence validation.
// 'app: true' packages are under apps/ instead of packages/.
export const KNOWN_PACKAGES = [
  // L0-L2: Foundation
  { name: '@platform/cognition-contract',   dir: 'packages/cognition-contract' },
  { name: '@brandos/contracts',             dir: 'packages/contracts' },
  { name: '@brandos/shared-utils',          dir: 'packages/shared-utils' },
  // L3: Cognition client
  { name: '@brandos/cognition-client',      dir: 'packages/cognition-client' },
  // L4: Auth
  { name: '@brandos/auth',                  dir: 'packages/auth' },
  // L5: Config schemas
  { name: '@brandos/runtime-config',        dir: 'packages/runtime-config' },
  { name: '@brandos/governance-config',     dir: 'packages/governance-config' },
  { name: '@brandos/artifact-config',       dir: 'packages/artifact-config' },
  { name: '@brandos/ui-admin',              dir: 'packages/ui-admin' },
  // L6: Runtime execution
  { name: '@brandos/ai-runtime-layer',      dir: 'packages/ai-runtime-layer' },
  { name: '@brandos/output-control-layer',  dir: 'packages/output-control-layer' },
  // L7: Governed execution
  { name: '@brandos/governance-layer',      dir: 'packages/governance-layer' },
  { name: '@brandos/iskill-runtime',        dir: 'packages/iskill-runtime' },
  // L8: Artifact pipeline
  { name: '@brandos/artifact-engine-layer', dir: 'packages/artifact-engine-layer' },
  // L9-L10: Orchestration + UI
  { name: '@brandos/control-plane-layer',   dir: 'packages/control-plane-layer' },
  { name: '@brandos/presentation-layer',    dir: 'packages/presentation-layer' },
  // L11: App
  { name: '@brandos/web',                   dir: 'apps/web', app: true },
];

// ── Source directory map ───────────────────────────────────────────────────
// Maps package name → relative src/ path.
// Used by check-circular.mjs, lint-imports.mjs for TypeScript source walks.
// Config packages (L5) are schema-only and typically have no deep src tree;
// they are included so violations inside them are still caught.
export const PACKAGE_SRC_MAP = {
  '@platform/cognition-contract':   'packages/cognition-contract/src',
  '@brandos/contracts':             'packages/contracts/src',
  '@brandos/shared-utils':          'packages/shared-utils/src',
  '@brandos/cognition-client':      'packages/cognition-client/src',
  '@brandos/auth':                  'packages/auth/src',
  '@brandos/runtime-config':        'packages/runtime-config/src',
  '@brandos/governance-config':     'packages/governance-config/src',
  '@brandos/artifact-config':       'packages/artifact-config/src',
  '@brandos/ui-admin':              'packages/ui-admin/src',
  '@brandos/ai-runtime-layer':      'packages/ai-runtime-layer/src',
  '@brandos/output-control-layer':  'packages/output-control-layer/src',
  '@brandos/governance-layer':      'packages/governance-layer/src',
  '@brandos/iskill-runtime':        'packages/iskill-runtime/src',
  '@brandos/artifact-engine-layer': 'packages/artifact-engine-layer/src',
  '@brandos/control-plane-layer':   'packages/control-plane-layer/src',
  '@brandos/presentation-layer':    'packages/presentation-layer/src',
};

// ── Buildable packages (have a dist/ output) ──────────────────────────────
// Used by platform-verify and platform-clean to enumerate dist folders.
// Matches KNOWN_PACKAGES minus apps/web (which uses .next instead of dist/).
export const BUILDABLE_PACKAGES = KNOWN_PACKAGES
  .filter(p => !p.app)
  .map(p => p.dir);

// ── Topological build order ────────────────────────────────────────────────
// Used by ManualOrder mode in platform-dev and platform-rebuild.
// Must be a strict linear order consistent with LAYER_TIERS.
export const BUILD_ORDER = [
  '@platform/cognition-contract',
  '@brandos/contracts',
  '@brandos/shared-utils',
  '@brandos/cognition-client',
  '@brandos/auth',
  '@brandos/runtime-config',
  '@brandos/governance-config',
  '@brandos/artifact-config',
  '@brandos/ui-admin',
  '@brandos/ai-runtime-layer',
  '@brandos/output-control-layer',
  '@brandos/governance-layer',
  '@brandos/iskill-runtime',
  '@brandos/artifact-engine-layer',
  '@brandos/control-plane-layer',
  '@brandos/presentation-layer',
  '@brandos/web',
];

// ── Route boundary rules ───────────────────────────────────────────────────
// Packages that Next.js route files must NOT import directly.
// All orchestration must flow through @brandos/control-plane-layer.
export const FORBIDDEN_IN_ROUTES = [
  '@brandos/governance-layer',
  '@brandos/ai-runtime-layer',
  '@brandos/output-control-layer',
  '@brandos/artifact-engine-layer',
  '@brandos/iskill-runtime',
  '@brandos/cognition-client',
];

// ── Allowed same-level peer imports ──────────────────────────────────────
// Genuine bidirectional contracts between packages at the same tier.
export const ALLOWED_SAME_LEVEL_PAIRS = new Set([
  '@brandos/governance-layer→@brandos/iskill-runtime',
  '@brandos/iskill-runtime→@brandos/governance-layer',
]);
