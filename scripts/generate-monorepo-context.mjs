// generate-monorepo-context.mjs
// BrandOS Monorepo Context Generator
//
// Generates .context/monorepo_context.generated.md
//
// Authority sources:
//   1. scripts/shared/package-registry.mjs  (layer tiers, build order, rules)
//   2. packages/<name>/package.json         (declared dependencies)
//   3. packages/<name>/src/index.ts         (public API surface)
//   4. check-boundaries.mjs                 (rule derivation, read not executed)
//   5. check-route-boundaries.mjs           (route restriction rules)
//
// Output is deterministic: identical source produces identical output.
// Usage: node scripts/generate-monorepo-context.mjs

import {
  LAYER_TIERS, LAYER_INDEX, KNOWN_PACKAGES,
  BUILD_ORDER,
} from './shared/package-registry.mjs';
import {
  ensureDir, walkSourceFiles, getBrandosImports, renderTimestamp,
} from './shared/context-utils.mjs';
import { ARCH_RULES } from './shared/architecture-rules.mjs';
import { buildPackageInventory, buildDependentMap } from './shared/inventory.mjs';
import { join, resolve, relative } from 'path';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT   = resolve(join(__dirname, '..'));
const OUT    = join(ROOT, '.context', 'monorepo_context.generated.md');

// ── Import coupling analysis ──────────────────────────────────────────────────

function buildCoupling(inventory) {
  const importCounts = {};
  const crossLayerSet = new Set();

  for (const { name: from, dir, layerIndex: fromL } of inventory) {
    const files = walkSourceFiles(join(ROOT, dir, 'src'));
    const seen  = new Set();
    for (const file of files) {
      for (const dep of getBrandosImports(file)) {
        if (dep === from) continue;
        importCounts[dep] = (importCounts[dep] ?? 0) + 1;
        const toL = LAYER_INDEX[dep];
        if (!seen.has(dep) && toL !== undefined && toL !== fromL) {
          crossLayerSet.add(`\`${from}\` → \`${dep}\``);
          seen.add(dep);
        }
      }
    }
  }

  const mostImported = Object.entries(importCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([pkg, n]) => ({ pkg, n }));

  return { mostImported, crossLayerEdges: [...crossLayerSet].slice(0, 16) };
}


// ── Render sections ───────────────────────────────────────────────────────────

function renderInventory(inventory, dependentMap) {
  const lines = [
    '## Package Inventory\n',
    '*Derived from: `scripts/shared/package-registry.mjs` + `packages/*/package.json`*\n',
  ];

  const byLayer = {};
  for (const e of inventory) {
    (byLayer[e.layerIndex] = byLayer[e.layerIndex] ?? []).push(e);
  }

  // Layer name labels from LAYER_TIERS
  const layerLabels = LAYER_TIERS.reduce((acc, tier, i) => {
    acc[i] = tier.map(n => n.replace('@brandos/', '')).join(', ');
    return acc;
  }, {});

  for (const li of Object.keys(byLayer).sort((a, b) => Number(a) - Number(b))) {
    lines.push(`### L${li} — ${layerLabels[li] ?? ''}\n`);
    for (const { name, dir, deps, exports, app } of byLayer[li]) {
      const dependents = dependentMap[name] ?? [];
      lines.push(`**\`${name}\`**`);
      lines.push(`- Location: \`${dir}\``);
      lines.push(deps.length
        ? `- Dependencies: ${deps.map(d => `\`${d}\``).join(', ')}`
        : `- Dependencies: *(none — foundational)*`);
      lines.push(dependents.length
        ? `- Dependents: ${dependents.map(d => `\`${d}\``).join(', ')}`
        : `- Dependents: *(none — top of stack)*`);
      if (!app && exports.length > 0) {
        const shown = exports.slice(0, 18);
        const extra = exports.length > 18 ? ` *(+${exports.length - 18} more)*` : '';
        lines.push(`- Public exports: ${shown.map(e => `\`${e}\``).join(', ')}${extra}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function renderDependencyGraph(inventory) {
  // v3 fix (Context Generation Pipeline Modernization): this tree used to be
  // hand-maintained ASCII art, independent of LAYER_TIERS below it — which
  // meant it could (and did) drift out of sync with the actual registry
  // (wrong layer indices, referenced @brandos/brand-intelligence after it
  // was deleted, never updated when LAYER_TIERS grew from 9 to 12 tiers).
  // Now derived directly from LAYER_TIERS + each package's real declared
  // deps (inventory[].deps, from package.json via getBrandosDeps) — the
  // same authority the "Package Counts per Layer" table below already used.
  const byName = Object.fromEntries(inventory.map((p) => [p.name, p]));
  const treeLines = LAYER_TIERS.map((tier, layerIdx) =>
    tier.map((pkgName) => {
      const pkg = byName[pkgName];
      const deps = pkg && pkg.deps.length ? pkg.deps.join(', ') : '(no internal deps)';
      return `L${layerIdx}  ${pkgName.padEnd(34)} → ${deps}`;
    }).join('\n')
  ).join('\n');

  return [
    '## Dependency Graph\n',
    '*Derived from: `packages/*/package.json` + `scripts/shared/package-registry.mjs` ' +
      '(layer tree below is generated, not hand-authored — see v3 fix note in source)*\n',
    '### Layer Dependency Graph\n',
    '```',
    treeLines,
    '```\n',
    '### Topological Build Order\n',
    '```',
    ...BUILD_ORDER.map((p, i) => `${String(i + 1).padStart(2, ' ')}. ${p}`),
    '```\n',
    `### Package Counts per Layer\n`,
    '| Layer | Count | Packages |',
    '|---|---|---|',
    ...LAYER_TIERS.map((tier, i) => `| L${i} | ${tier.length} | ${tier.join(', ')} |`),
    '',
  ].join('\n');
}

function renderCoupling(inventory) {
  const { mostImported, crossLayerEdges } = buildCoupling(inventory);
  return [
    '## Import Graph Summary\n',
    '*Derived from: source scan of `packages/*/src/**/*.ts` — agent-friendly summary, not full file graph*\n',
    '### Most Imported Packages\n',
    '| Package | Approximate import count |',
    '|---|---|',
    ...mostImported.map(({ pkg, n }) => `| \`${pkg}\` | ${n} |`),
    '\n### Notable Cross-Layer Coupling\n',
    ...(crossLayerEdges.length ? crossLayerEdges.map(e => `- ${e}`) : ['*(none detected)*']),
    '',
  ].join('\n');
}

function renderRules() {
  const lines = [
    '## Architectural Rules\n',
    '*Derived from: `check-boundaries.mjs`, `check-route-boundaries.mjs`, `package-registry.mjs`*\n',
  ];
  for (const r of ARCH_RULES) {
    lines.push(`### \`${r.id}\``);
    lines.push(`**Source:** ${r.source}\n`);
    lines.push(r.description);
    if (r.detail) lines.push(`\n> ${r.detail}`);
    lines.push('');
  }
  return lines.join('\n');
}

function renderPublicAPI(inventory) {
  const lines = [
    '## Public API Surface\n',
    '*Derived from: `packages/*/src/index.ts` barrel exports*\n',
  ];
  for (const { name, dir, exports, app } of inventory) {
    if (app || exports.length === 0) continue;
    lines.push(`### \`${name}\``);
    lines.push(`Entry: \`${dir}/src/index.ts\`\n`);
    const rows = [];
    for (let i = 0; i < exports.length; i += 6)
      rows.push(exports.slice(i, i + 6).map(e => `\`${e}\``).join(', '));
    lines.push(rows.join(',\n'));
    lines.push('');
  }
  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  console.log('[generate-monorepo-context] Starting…');
  ensureDir(join(ROOT, '.context'));

  const inventory    = buildPackageInventory(ROOT);
  const dependentMap = buildDependentMap(inventory);

  const md = [
    '# BrandOS Monorepo Context (Generated)\n',
    `> **Generated:** ${renderTimestamp()}`,
    '> **Authority:** `scripts/shared/package-registry.mjs` (layers) · `packages/*/package.json` (deps) · `packages/*/src/index.ts` (API)',
    '> ⚠️ Do not edit — regenerated by `scripts/generate-monorepo-context.mjs`\n',
    '---\n',
    renderInventory(inventory, dependentMap),
    renderDependencyGraph(inventory),
    renderCoupling(inventory),
    renderRules(),
    renderPublicAPI(inventory),
  ].join('\n');

  writeFileSync(OUT, md);
  console.log(`[generate-monorepo-context] ✅ ${relative(ROOT, OUT)} (${inventory.length} packages, ${ARCH_RULES.length} rules)`);
}

main();
