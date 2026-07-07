/**
 * scripts/shared/inventory.mjs
 *
 * Builds the canonical "package inventory" (name, dir, layer, declared
 * @brandos deps, public exports) and its inverse ("who depends on me") map.
 *
 * This is the same derivation generate-monorepo-context.mjs always
 * performed inline; it is centralized here so every generator that needs
 * package-level dependency/export facts (generate-monorepo-context.mjs,
 * generate-package-contexts.mjs, and the new P3.5 architecture-intelligence
 * generators) computes them identically, from the same authority
 * (scripts/shared/package-registry.mjs + package.json + src/index.ts),
 * instead of re-deriving it slightly differently in N places.
 */

import { join } from 'path';
import { LAYER_INDEX, KNOWN_PACKAGES } from './package-registry.mjs';
import { readJsonSafe, extractPublicExports, getBrandosDeps } from './context-utils.mjs';
import { invertAdjacency } from './graph-utils.mjs';

/**
 * @param {string} root - absolute path to the repo root
 * @returns {Array<{name:string, dir:string, app:boolean, layerIndex:number|'?', deps:string[], exports:string[]}>}
 */
export function buildPackageInventory(root) {
  return KNOWN_PACKAGES.map(({ name, dir, app }) => {
    const pkg = readJsonSafe(join(root, dir, 'package.json')) ?? {};
    const deps = getBrandosDeps(pkg);
    const exports = app ? [] : extractPublicExports(join(root, dir));
    return { name, dir, app: !!app, layerIndex: LAYER_INDEX[name] ?? '?', deps, exports };
  });
}

/**
 * @param {ReturnType<typeof buildPackageInventory>} inventory
 * @returns {Record<string, string[]>} package name -> direct dependents
 */
export function buildDependentMap(inventory) {
  const dependsOnMap = Object.fromEntries(inventory.map(({ name, deps }) => [name, deps]));
  return invertAdjacency(dependsOnMap);
}
