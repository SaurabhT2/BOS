/**
 * scripts/shared/graph-utils.mjs
 *
 * Small, pure graph helpers shared by the P3.5 architecture-intelligence
 * generators (generate-architecture-graph.mjs, generate-dependency-impact.mjs,
 * generate-agent-entrypoints.mjs). These do not encode any new authority —
 * they operate on adjacency maps that are themselves derived from
 * scripts/shared/package-registry.mjs + package.json (the existing authority).
 */

/**
 * Breadth-first transitive closure over an adjacency map.
 *
 * @param {string} start - the node to start from (excluded from the result)
 * @param {Record<string, string[]>} adjacency - map of node -> direct neighbors
 * @returns {string[]} all nodes reachable from `start`, excluding `start` itself,
 *                      sorted alphabetically for deterministic output.
 */
export function transitiveClosure(start, adjacency) {
  const seen = new Set();
  const queue = [...(adjacency[start] ?? [])];
  while (queue.length) {
    const node = queue.shift();
    if (seen.has(node) || node === start) continue;
    seen.add(node);
    for (const next of adjacency[node] ?? []) {
      if (!seen.has(next) && next !== start) queue.push(next);
    }
  }
  return [...seen].sort();
}

/**
 * Builds a "who depends on me" adjacency map from a "what do I depend on" map.
 * Pure inversion — same shape used by generate-monorepo-context.mjs's
 * buildDependentMap(), generalized for reuse.
 *
 * @param {Record<string, string[]>} dependsOnMap - node -> direct dependencies
 * @returns {Record<string, string[]>} node -> direct dependents
 */
export function invertAdjacency(dependsOnMap) {
  const inverted = Object.fromEntries(Object.keys(dependsOnMap).map((k) => [k, []]));
  for (const [name, deps] of Object.entries(dependsOnMap)) {
    for (const dep of deps) {
      if (inverted[dep]) inverted[dep].push(name);
    }
  }
  return inverted;
}
