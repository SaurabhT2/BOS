/**
 * @brandos/shared-utils — IPackage.ts
 *
 * Machine-readable package boundary declaration.
 * L5: Autonomous Ecosystem — self-describing, self-validating.
 *
 * STRUCTURAL NOTE (FIX-3 applied):
 *   Root-level shadow files (./index.ts, ./IPackage.ts) that previously
 *   duplicated this src/ tree have been deleted. The canonical files
 *   are in src/ only. The package entry point is dist/index.js (compiled
 *   from src/ by tsconfig.json). Agents MUST NOT recreate root-level
 *   *.ts files — they would be outside the tsconfig rootDir and would
 *   not be compiled into dist/.
 */

export interface IPackage {
  name: string
  purpose: string
  responsibilities: string[]
  publicContracts: string[]
  allowedImports: string[]
  forbiddenImports: string[]
  ownedCapabilities: string[]
  invariants: string[]
  dependencies: string[]
  migrationHistory: string[]
  agenticLevel: string
  agenticBlockers: string[]
}

export const SHARED_UTILS_PACKAGE: IPackage = {
  name: '@brandos/shared-utils',

  purpose:
    'Infrastructure primitive layer. Stateless utility functions and injectable infrastructure classes ' +
    'used across all layers. Owns zero domain logic, zero artifact logic, zero skill logic.',

  responsibilities: [
    'Structured levelled logging with child loggers and request IDs (utils.logger)',
    'Exponential backoff retry with jitter and budget adapter (utils.retry)',
    'CircuitBreaker, RateLimiter, CostTracker resilience primitives (utils.circuitbreaker, utils.ratelimiter)',
    'Boot-time environment contract validation (utils.env)',
    'Monorepo-wide constants: version, timeouts, retry defaults (utils.constants)',
  ],

  publicContracts: [
    'src/index.ts',
    'src/ISharedUtils.ts',
    'src/IPackage.ts',
  ],

  allowedImports: [
    '@brandos/contracts',
  ],

  forbiddenImports: [
    '@brandos/iskill-runtime',
    '@brandos/artifact-engine-layer',
    '@brandos/governance-layer',
    '@brandos/output-control-layer',
    '@brandos/control-plane-layer',
    'react',
    'next',
  ],

  ownedCapabilities: [
    'utils.logger',
    'utils.retry',
    'utils.circuitbreaker',
    'utils.ratelimiter',
    'utils.costtracker',
    'utils.env',
    'utils.constants',
  ],

  invariants: [
    'Zero domain logic — no artifact types, no skill logic, no generation contracts',
    'Stateless utilities — Logger, retry, env validators are pure or have isolated instance state',
    'Injectable singletons — CircuitBreaker and RateLimiter are injected by callers, not managed here',
    'No deprecated shims — skillHealth.ts and artifactCompare.ts deleted (Wave 2)',
    'Single public surface — import from src/index.ts (or package root); never from sub-files',
    'No root shadow files — src/ is canonical; root-level *.ts were deleted in FIX-3',
    'No module-level mutable state — all state is per-instance',
    'No external runtime dependencies — only @brandos/contracts (type imports only)',
  ],

  dependencies: [
    '@brandos/contracts',
  ],

  agenticLevel: 'L5',

  agenticBlockers: [
    'None. Package is self-describing, self-validating, and independently testable.',
    'Agents adding new utilities must follow the 5-step extension guide in AGENT_CONTEXT.md.',
  ],

  migrationHistory: [
    'Pre-Wave-2 (L3): skillHealth.ts and artifactCompare.ts were DEPRECATED shims re-exported from index.ts.',
    'Wave 2 (L4): Both shims deleted. TODO-SU-1 (skillHealth) and TODO-SU-2 (artifactCompare) complete.',
    'L5 (current): Root shadow files (./index.ts, ./IPackage.ts) deleted per FIX-3. ' +
      'IPackage.ts updated to L5 with agenticLevel + agenticBlockers fields. ' +
      'Test coverage gaps closed: constants.test.ts added, retry.test.ts timer fix applied, ' +
      'ISharedUtils.test.ts updated to remove stale deprecated-shim checks and add L5 architecture tests.',
  ],
}


