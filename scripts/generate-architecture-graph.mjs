#!/usr/bin/env node
/**
 * scripts/generate-architecture-graph.mjs
 *
 * BrandOS Architecture Knowledge Graph Generator (P3.5 — Deliverable 1)
 *
 * Generates .context/architecture_graph.generated.json — a single,
 * machine-readable graph answering, per package: who owns it, what it
 * depends on, who consumes it, what it exports, which tables it owns/
 * reads/writes, which routes live in it (apps/web only), which named
 * restrictions apply to it, and which architectural rules govern it.
 *
 * This generator introduces NO new authority. Every field is derived from
 * data that already exists elsewhere in the repo:
 *
 *   - package, layer, dependsOn, usedBy, exports
 *       <- scripts/shared/package-registry.mjs + package.json + src/index.ts
 *          (via scripts/shared/inventory.mjs, the same derivation
 *          generate-monorepo-context.mjs uses)
 *   - tables (owned / read / written)
 *       <- scripts/shared/table-ownership.mjs (TABLE_OWNERSHIP — the same
 *          map generate-database-context.mjs uses)
 *   - routes
 *       <- apps/web/app/api/** /route.ts file discovery (apps/web only)
 *   - restrictions
 *       <- scripts/shared/package-restrictions.mjs (PACKAGE_RESTRICTIONS —
 *          the same map generate-package-contexts.mjs uses)
 *   - forbiddenDependencies
 *       <- scripts/shared/forbidden-deps.mjs (re-derives the RULE-LAYER-ORDER
 *          computation that scripts/lint-imports.mjs performs)
 *   - appliesRules
 *       <- scripts/shared/architecture-rules.mjs (ARCH_RULES — the same data
 *          generate-monorepo-context.mjs renders), filtered to the rules
 *          whose description/detail names this package, plus the two
 *          universal rules that apply to every package.
 *
 * Output is deterministic: identical source produces identical output
 * (all arrays are sorted; the only non-deterministic field is the
 * generation timestamp in _meta).
 *
 * Usage: node scripts/generate-architecture-graph.mjs
 */

import { writeFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

import { LAYER_TIERS, LAYER_INDEX } from './shared/package-registry.mjs';
import { ensureDir, renderTimestamp } from './shared/context-utils.mjs';
import { buildPackageInventory, buildDependentMap } from './shared/inventory.mjs';
import { TABLE_OWNERSHIP } from './shared/table-ownership.mjs';
import { PACKAGE_RESTRICTIONS } from './shared/package-restrictions.mjs';
import { ARCH_RULES } from './shared/architecture-rules.mjs';
import { forbiddenDependenciesFor } from './shared/forbidden-deps.mjs';
import { rulesFor } from './shared/rule-applicability.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(join(__dirname, '..'));
const OUT = join(ROOT, '.context', 'architecture_graph.generated.json');

// ── Route discovery (apps/web only) ────────────────────────────────────────

function discoverRoutes(webDir) {
  const apiRoot = join(ROOT, webDir, 'app', 'api');
  const routes = [];
  function walk(dir, segments) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        walk(full, [...segments, entry]);
      } else if (entry === 'route.ts' || entry === 'route.tsx') {
        routes.push('/api/' + segments.join('/'));
      }
    }
  }
  walk(apiRoot, []);
  return routes.sort();
}

// ── Table ownership lookup (inverted from TABLE_OWNERSHIP) ─────────────────

function tablesFor(pkgName) {
  const owns = [];
  const reads = [];
  const writes = [];
  for (const [table, info] of Object.entries(TABLE_OWNERSHIP)) {
    if (info.owner === pkgName) owns.push(table);
    if ((info.readers ?? []).includes(pkgName)) reads.push(table);
    if ((info.writers ?? []).includes(pkgName)) writes.push(table);
  }
  return { owns: owns.sort(), reads: reads.sort(), writes: writes.sort() };
}

// ── Rule applicability (see scripts/shared/rule-applicability.mjs for the
// citation-resolution details) ─────────────────────────────────────────

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  console.log('[generate-architecture-graph] Starting…');

  const inventory = buildPackageInventory(ROOT);
  const dependentMap = buildDependentMap(inventory);

  const packages = inventory.map(({ name, dir, app, layerIndex, deps, exports }) => {
    const tables = tablesFor(name);
    const peers = layerIndex === '?' ? [] : LAYER_TIERS[layerIndex].filter((p) => p !== name);

    return {
      package: name,
      layer: layerIndex === '?' ? null : `L${layerIndex}`,
      layerPeers: peers,
      dir,
      isApp: app,
      dependsOn: [...deps].sort(),
      usedBy: [...(dependentMap[name] ?? [])].sort(),
      exports,
      exportCount: exports.length,
      tables: tables.owns,
      readsTables: tables.reads,
      writesTables: tables.writes,
      routes: app ? discoverRoutes(dir) : [],
      restrictions: PACKAGE_RESTRICTIONS[name] ?? [],
      forbiddenDependencies: forbiddenDependenciesFor(name),
      appliesRules: rulesFor(name, dir, ARCH_RULES),
    };
  });

  const output = {
    _meta: {
      generated: renderTimestamp(),
      generator: 'scripts/generate-architecture-graph.mjs',
      purpose: 'Agent-readable architecture knowledge graph — ownership, dependencies, exports, '
        + 'table access, routes, restrictions and applicable rules per package, derived from '
        + 'existing authorities (no duplicated source of truth).',
      authoritySources: [
        'scripts/shared/package-registry.mjs',
        'packages/*/package.json',
        'packages/*/src/index.ts',
        'scripts/shared/table-ownership.mjs',
        'scripts/shared/package-restrictions.mjs',
        'scripts/shared/architecture-rules.mjs',
        'apps/web/app/api/**/route.ts (route discovery)',
      ],
      packageCount: packages.length,
    },
    packages,
  };

  ensureDir(join(ROOT, '.context'));
  writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
  console.log(`[generate-architecture-graph] ✅ ${relative(ROOT, OUT)} (${packages.length} packages)`);
}

main();
