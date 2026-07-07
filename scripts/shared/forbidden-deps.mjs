/**
 * scripts/shared/forbidden-deps.mjs
 *
 * Derives, for a given package, the set of @brandos packages it is forbidden
 * from importing under RULE-LAYER-ORDER (no package may import from a
 * package at a higher layer index than its own).
 *
 * This mirrors the FORBIDDEN map construction in scripts/lint-imports.mjs
 * line-for-line (same inputs: PACKAGE_SRC_MAP + LAYER_INDEX from
 * scripts/shared/package-registry.mjs; same rule: every package at a
 * strictly higher tier index is forbidden). It is re-derived here rather
 * than imported from lint-imports.mjs because that script performs its
 * entire violation scan — including `process.exit(1)` on findings — as a
 * top-level side effect at module-load time, so importing it would trigger
 * a full repository scan (and a possible process exit) as a side effect of
 * loading a constant. Re-deriving the same small computation from the one
 * real authority (package-registry.mjs) avoids that without introducing a
 * second hand-maintained list.
 */

import { PACKAGE_SRC_MAP, LAYER_INDEX } from './package-registry.mjs';

/**
 * @param {string} pkg - e.g. '@brandos/control-plane-layer'
 * @returns {string[]} packages `pkg` must not import (sorted alphabetically)
 */
export function forbiddenDependenciesFor(pkg) {
  const myTier = LAYER_INDEX[pkg];
  if (myTier === undefined) return [];
  return Object.keys(PACKAGE_SRC_MAP)
    .filter((dep) => dep !== pkg && LAYER_INDEX[dep] !== undefined && LAYER_INDEX[dep] > myTier)
    .sort();
}

/**
 * A package is a "routing chokepoint" if Next.js route files are allowed to
 * import it directly (it is not in FORBIDDEN_IN_ROUTES) AND it transitively
 * depends on at least one package that route files are forbidden from
 * importing directly. Such a package is the sole path by which apps/web can
 * reach that capability — making it structurally critical regardless of how
 * many packages formally list it as a dependency.
 *
 * @param {string} pkg
 * @param {string[]} transitiveDependsOn - full transitive dependency closure of pkg
 * @param {string[]} forbiddenInRoutes - FORBIDDEN_IN_ROUTES from package-registry.mjs
 * @returns {boolean}
 */
export function isRoutingChokepoint(pkg, transitiveDependsOn, forbiddenInRoutes) {
  if (forbiddenInRoutes.includes(pkg)) return false;
  return transitiveDependsOn.some((dep) => forbiddenInRoutes.includes(dep));
}
