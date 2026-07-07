#!/usr/bin/env node
/**
 * scripts/generate-dependency-impact.mjs
 *
 * BrandOS Dependency Impact Graph Generator (P3.5 — Deliverable 2)
 *
 * Generates .context/dependency_impact.generated.json — answers, for every
 * package, "what breaks if I change this?" before an agent touches it.
 *
 * Fields per package:
 *   - directConsumers      packages that import this package directly
 *   - transitiveConsumers  directConsumers + everything downstream of them
 *                          (the full "compile-time" blast radius)
 *   - affectedPackages     transitiveConsumers, PLUS packages coupled to this
 *                          one through a channel other than a TypeScript
 *                          import: same-tier ALLOWED_SAME_LEVEL_PAIRS peers,
 *                          and packages that read/write a table this package
 *                          owns (per TABLE_OWNERSHIP) without importing it —
 *                          a real "runtime/data" blast radius that a pure
 *                          import-graph walk misses (e.g. @brandos/governance-layer
 *                          writes brandos_governance_audit, a table owned by
 *                          @brandos/control-plane-layer, despite never
 *                          importing control-plane-layer)
 *   - riskLevel            low / medium / high / critical — see methodology
 *                          in _meta.methodology and the riskFactors field on
 *                          each entry (the formula is shown, not hidden)
 *
 * No new authority is introduced. Inputs are the same ones
 * generate-architecture-graph.mjs uses:
 *   - scripts/shared/inventory.mjs       (deps / dependents, from package-registry.mjs)
 *   - scripts/shared/table-ownership.mjs (TABLE_OWNERSHIP)
 *   - scripts/shared/package-registry.mjs (ALLOWED_SAME_LEVEL_PAIRS, FORBIDDEN_IN_ROUTES)
 *   - scripts/shared/forbidden-deps.mjs   (isRoutingChokepoint)
 *
 * Usage: node scripts/generate-dependency-impact.mjs
 */

import { writeFileSync } from 'fs';
import { join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

import { ALLOWED_SAME_LEVEL_PAIRS, FORBIDDEN_IN_ROUTES } from './shared/package-registry.mjs';
import { ensureDir, renderTimestamp } from './shared/context-utils.mjs';
import { buildPackageInventory, buildDependentMap } from './shared/inventory.mjs';
import { transitiveClosure } from './shared/graph-utils.mjs';
import { TABLE_OWNERSHIP } from './shared/table-ownership.mjs';
import { isRoutingChokepoint } from './shared/forbidden-deps.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(join(__dirname, '..'));
const OUT = join(ROOT, '.context', 'dependency_impact.generated.json');

// ── Risk scoring ──────────────────────────────────────────────────────────
// score = 2 * |transitiveConsumers| + |directDependencies| + (10 if the
// package is a "routing chokepoint" — apps/web routes can only reach a
// FORBIDDEN_IN_ROUTES package through it). Both fan-in (consumers, the
// classic blast-radius signal) and fan-out (direct dependency count, an
// "integration hub" signal — e.g. control-plane-layer has very few
// consumers but breaking it cuts every downstream package off from
// apps/web) contribute. The chokepoint bonus is derived structurally from
// FORBIDDEN_IN_ROUTES (see scripts/shared/forbidden-deps.mjs) rather than
// hardcoded for any specific package name.
const WEIGHT_CONSUMER = 2;
const WEIGHT_DEPENDENCY = 1;
const CHOKEPOINT_BONUS = 10;
const THRESHOLDS = { critical: 20, high: 10, medium: 4 };

function riskLevelFor(score) {
  if (score >= THRESHOLDS.critical) return 'critical';
  if (score >= THRESHOLDS.high) return 'high';
  if (score >= THRESHOLDS.medium) return 'medium';
  return 'low';
}

// ── Same-level peer lookup (from ALLOWED_SAME_LEVEL_PAIRS "A→B" strings) ──

function sameLevelPeersOf(pkgName) {
  return [...ALLOWED_SAME_LEVEL_PAIRS]
    .filter((pair) => pair.startsWith(`${pkgName}→`))
    .map((pair) => pair.split('→')[1]);
}

// ── Table co-access coupling (catches non-import operational coupling) ────

function normalizePkgToken(token) {
  return token === 'apps/web' ? '@brandos/web' : token;
}

function tableCoupledPackages(pkgName, knownNames) {
  const coupled = new Set();
  for (const info of Object.values(TABLE_OWNERSHIP)) {
    if (info.owner !== pkgName) continue;
    for (const token of [...(info.readers ?? []), ...(info.writers ?? [])]) {
      const name = normalizePkgToken(token);
      if (name !== pkgName && knownNames.has(name)) coupled.add(name);
    }
  }
  return coupled;
}

// ── Main ────────────────────────────────────────────────────────────────

function main() {
  console.log('[generate-dependency-impact] Starting…');

  const inventory = buildPackageInventory(ROOT);
  const dependentMap = buildDependentMap(inventory);
  const knownNames = new Set(inventory.map((p) => p.name));
  const dependsOnMap = Object.fromEntries(inventory.map((p) => [p.name, p.deps]));

  // Full transitive dependsOn closure per package, needed for the
  // routing-chokepoint check (does this package transitively reach a
  // FORBIDDEN_IN_ROUTES package?).
  const transitiveDependsOn = Object.fromEntries(
    inventory.map((p) => [p.name, transitiveClosure(p.name, dependsOnMap)]),
  );

  const packages = {};

  for (const { name, deps, app } of inventory) {
    const directConsumers = [...(dependentMap[name] ?? [])].sort();
    const transitiveConsumers = transitiveClosure(name, dependentMap);

    const affected = new Set(transitiveConsumers);
    for (const peer of sameLevelPeersOf(name)) affected.add(peer);
    for (const pkg of tableCoupledPackages(name, knownNames)) affected.add(pkg);

    // Chokepoint is a property of a *library* package relative to the app
    // that consumes it; it isn't a meaningful self-relation for the app
    // itself, so apps are never classified as their own chokepoint.
    const chokepoint = app
      ? false
      : isRoutingChokepoint(name, transitiveDependsOn[name] ?? [], FORBIDDEN_IN_ROUTES);
    const score = WEIGHT_CONSUMER * transitiveConsumers.length
      + WEIGHT_DEPENDENCY * deps.length
      + (chokepoint ? CHOKEPOINT_BONUS : 0);

    packages[name] = {
      directConsumers,
      transitiveConsumers,
      affectedPackages: [...affected].sort(),
      riskLevel: riskLevelFor(score),
      riskFactors: {
        transitiveConsumerCount: transitiveConsumers.length,
        directDependencyCount: deps.length,
        isRoutingChokepoint: chokepoint,
        score,
      },
    };
  }

  const output = {
    _meta: {
      generated: renderTimestamp(),
      generator: 'scripts/generate-dependency-impact.mjs',
      purpose: 'Blast-radius lookup: what breaks, and how badly, if a given package changes — '
        + 'derived from the existing package dependency graph, ALLOWED_SAME_LEVEL_PAIRS, and '
        + 'TABLE_OWNERSHIP (no duplicated source of truth).',
      authoritySources: [
        'scripts/shared/package-registry.mjs',
        'packages/*/package.json',
        'scripts/shared/table-ownership.mjs',
      ],
      methodology: {
        transitiveConsumers: 'BFS closure over the "is imported by" relation (direct + indirect). '
          + 'Answers: who needs to be retested if this package\'s exported contract changes?',
        affectedPackages: 'transitiveConsumers, plus same-tier ALLOWED_SAME_LEVEL_PAIRS peers, plus '
          + 'packages that read/write a table this package owns without importing it. Answers: who '
          + 'could be operationally affected even without a direct import edge?',
        riskLevel: `score = ${WEIGHT_CONSUMER} * transitiveConsumerCount + ${WEIGHT_DEPENDENCY} * `
          + `directDependencyCount + (${CHOKEPOINT_BONUS} if isRoutingChokepoint). `
          + `Buckets: critical >= ${THRESHOLDS.critical}, high >= ${THRESHOLDS.high}, `
          + `medium >= ${THRESHOLDS.medium}, else low.`,
        isRoutingChokepoint: 'true if apps/web route files are allowed to import this package directly '
          + '(it is not in FORBIDDEN_IN_ROUTES) AND it transitively depends on a package that route '
          + 'files are forbidden from importing directly — i.e. it is the only path apps/web has to '
          + 'that capability, regardless of how many packages formally list it as a dependency. '
          + 'Always false for app packages themselves (the concept describes a library\'s relationship '
          + 'to the app, not the app\'s relationship to itself).',
      },
      packageCount: Object.keys(packages).length,
    },
    packages,
  };

  ensureDir(join(ROOT, '.context'));
  writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
  console.log(`[generate-dependency-impact] ✅ ${relative(ROOT, OUT)} (${Object.keys(packages).length} packages)`);
}

main();
