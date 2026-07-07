#!/usr/bin/env node
/**
 * scripts/check-circular.mjs
 *
 * BrandOS Circular Dependency Detector — v3
 *
 * Strategy:
 *   1. Try madge (if installed as dev dep or globally) — most thorough
 *   2. Fall back to native TypeScript import graph walk — no external deps
 *
 * Exit 1 if cycles detected. Never silently passes.
 *
 * v3 changes:
 *   - PACKAGE_SRC_MAP imported from shared/package-registry.mjs
 *   - walkTs uses shared/fs-utils.mjs::walkSourceFiles
 *   - New config packages (L3a) and brand-intelligence now included
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname, extname } from 'path';
import { execSync } from 'child_process';
import { PACKAGE_SRC_MAP } from './shared/package-registry.mjs';
import { walkSourceFiles } from './shared/fs-utils.mjs';

const ROOT = resolve(process.cwd());

// ── Try madge first ────────────────────────────────────────────────────────

function tryMadge() {
  try {
    const result = execSync(
      'node_modules/.bin/madge --circular --extensions ts packages/*/src',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd: ROOT }
    );
    if (result.includes('Found')) {
      console.error('❌ check-circular: Circular dependencies detected (madge):\n', result);
      process.exit(1);
    }
    console.log('✅ check-circular: No circular dependencies (madge).');
    return true;
  } catch (err) {
    const out = (err.stdout ?? '') + (err.stderr ?? '');
    if (out.includes('Found')) {
      console.error('❌ check-circular: Circular dependencies detected (madge):\n', out);
      process.exit(1);
    }
    return false; // madge not available
  }
}

// ── Native circular dependency detector ───────────────────────────────────
// Builds a TypeScript source-level import graph and detects cycles via DFS.

// Strips comments while preserving line count (not load-bearing here since
// this detector doesn't report line numbers, but kept consistent with the
// same fix in lint-imports.mjs / check-boundaries.mjs).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

function extractImports(filePath) {
  let rawContent;
  try { rawContent = readFileSync(filePath, 'utf8'); } catch { return []; }
  // Engineering Workflow Audit fix: this previously scanned raw file text,
  // so a JSDoc usage example like `import { x } from '@brandos/shared-utils'`
  // (illustrating how *consumers* import the package) was indistinguishable
  // from a real import — and because PACKAGE_SRC_MAP resolves a package's
  // own name back to its own src dir, several files ended up reported as
  // "importing" their own package's index.ts, i.e. a fake self-cycle. All 5
  // cycles this script reported before the fix were exactly this pattern.
  const content = stripComments(rawContent);
  const imports = [];
  const pattern = /(?:import|export)\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = pattern.exec(content)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

function resolveImportToFile(importPath, fromFile) {
  // Workspace package import
  for (const [pkg, srcDir] of Object.entries(PACKAGE_SRC_MAP)) {
    if (importPath === pkg || importPath.startsWith(pkg + '/')) {
      const sub = importPath.slice(pkg.length).replace(/^\//, '');
      const base = join(ROOT, srcDir, sub || 'index');
      for (const c of [base + '.ts', base + '/index.ts']) {
        if (existsSync(c)) return c;
      }
    }
  }

  // Relative import
  if (importPath.startsWith('.')) {
    const base = join(dirname(fromFile), importPath);
    for (const c of [base + '.ts', base + '/index.ts']) {
      if (existsSync(c)) return c;
    }
  }

  return null; // external — not tracked
}

function buildGraph() {
  const graph = new Map();

  for (const srcDir of Object.values(PACKAGE_SRC_MAP)) {
    const files = walkSourceFiles(join(ROOT, srcDir), { excludeTests: true });
    for (const file of files) {
      if (!graph.has(file)) graph.set(file, new Set());
      const imports = extractImports(file);
      for (const imp of imports) {
        const resolved = resolveImportToFile(imp, file);
        if (resolved && resolved !== file) {
          graph.get(file).add(resolved);
        }
      }
    }
  }

  return graph;
}

function findCycles(graph) {
  const cycles = [];
  const visited = new Set();
  const inStack = new Set();
  const path = [];

  function dfs(node) {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      cycles.push([...path.slice(cycleStart), node]);
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    inStack.add(node);
    path.push(node);
    for (const neighbor of (graph.get(node) ?? [])) dfs(neighbor);
    path.pop();
    inStack.delete(node);
  }

  for (const node of graph.keys()) dfs(node);
  return cycles;
}

function formatCycle(cycle) {
  return cycle
    .map(f => f.replace(ROOT + '/', '').replace(ROOT + '\\', ''))
    .join(' → ');
}

// ── Main ───────────────────────────────────────────────────────────────────

const madgeAvailable = tryMadge();

if (!madgeAvailable) {
  console.warn('[check-circular] ⚠️  madge not found — using native detector (less precise)');
  console.warn('  Tip: add "madge" to root devDependencies for more thorough analysis.');
  console.log('[check-circular] Building import graph...');

  const graph = buildGraph();
  const cycles = findCycles(graph);

  if (cycles.length === 0) {
    console.log(`✅ check-circular: No circular dependencies (native, ${graph.size} files scanned).`);
  } else {
    console.error(`❌ check-circular: ${cycles.length} circular dependency cycle(s) found:\n`);
    for (const cycle of cycles) {
      console.error(`  🔄 ${formatCycle(cycle)}\n`);
    }
    process.exit(1);
  }
}
