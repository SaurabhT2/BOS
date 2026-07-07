#!/usr/bin/env node
/**
 * scripts/check-route-boundaries.mjs
 *
 * BrandOS Route Boundary Enforcer — v3
 *
 * Enforces the invariant that Next.js route files in apps/web/app/api/
 * may NOT import directly from runtime layers. All route orchestration
 * must flow through @brandos/control-plane-layer.
 *
 * ALLOWED in routes:
 *   ✅ @brandos/control-plane-layer (and subpath exports)
 *   ✅ @brandos/contracts
 *   ✅ @brandos/shared-utils
 *   ✅ @brandos/auth
 *   ✅ @brandos/presentation-layer (types only)
 *   ✅ Local app/ imports, next/, react/, node built-ins, third-party
 *
 * FORBIDDEN in routes: see FORBIDDEN_IN_ROUTES in shared/package-registry.mjs
 *
 * v3 changes:
 *   - FORBIDDEN_IN_ROUTES imported from shared/package-registry.mjs
 *   - File walking uses shared/fs-utils.mjs::walkSourceFiles
 */

import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { FORBIDDEN_IN_ROUTES } from './shared/package-registry.mjs';
import { walkSourceFiles } from './shared/fs-utils.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');

// Directories to scan for route files.
// To add middleware scanning: join(ROOT, 'apps/web/middleware.ts')
const ROUTE_DIRS = [
  join(ROOT, 'apps/web/app/api'),
];

function checkFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const violations = [];

  lines.forEach((line, idx) => {
    const importMatch = line.match(/(?:import\s+|from\s+|require\s*\()['"]([/@\w\-/.]+)['"]/);
    if (!importMatch) return;

    const importPath = importMatch[1];
    for (const forbidden of FORBIDDEN_IN_ROUTES) {
      if (importPath === forbidden || importPath.startsWith(forbidden + '/')) {
        violations.push({
          file: relative(ROOT, filePath),
          line: idx + 1,
          import: importPath,
          forbidden,
          sourceLine: line.trim(),
        });
      }
    }
  });

  return violations;
}

// ── Main ──────────────────────────────────────────────────────────────────

let totalViolations = 0;
const allViolations = [];
let totalFilesScanned = 0;

for (const dir of ROUTE_DIRS) {
  const files = walkSourceFiles(dir, { extensions: ['.ts', '.tsx'] });
  totalFilesScanned += files.length;
  for (const file of files) {
    const violations = checkFile(file);
    allViolations.push(...violations);
    totalViolations += violations.length;
  }
}

// ── RULE-PIPELINE-ORDER: structured artifact routes must call runControlPlane
//    BEFORE executeArtifactPipeline, from the route handler (not nested) ─────────
//
// Canonical pattern from runtime_trace.generated.md §2 and §8 item 1:
//   const cpl = await runControlPlane(...)          // Step 1
//   const result = await executeArtifactPipeline(...) // Step 2 — top-level, not nested
//
// Routes that import both functions must call them in order and both must appear
// as top-level awaited calls (not as arguments to each other).

function checkPipelineOrder(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const pipelineViolations = [];

  // Use `await` keyword to find actual call sites — import declarations and
  // doc-comments never include `await`, so this avoids false positives.
  const cplPos = content.indexOf('await runControlPlane(');
  const aepPos = content.indexOf('await executeArtifactPipeline(');

  // Route only has one call type — not a dual-pipeline route
  if (cplPos === -1 || aepPos === -1) return pipelineViolations;

  // Detect: executeArtifactPipeline awaited BEFORE runControlPlane (wrong order)
  if (aepPos < cplPos) {
    pipelineViolations.push({
      file: relative(ROOT, filePath),
      rule: 'RULE-PIPELINE-ORDER',
      detail: 'executeArtifactPipeline() appears before runControlPlane() — wrong order. ' +
              'runControlPlane() must execute first (Step 1), then executeArtifactPipeline() (Step 2).',
    });
  }

  // Detect: executeArtifactPipeline nested inside runControlPlane call (both on same logical line)
  // Heuristic: look for executeArtifactPipeline appearing as an argument inside a runControlPlane(...)
  const nestRe = /runControlPlane\s*\([^)]*executeArtifactPipeline/s;
  if (nestRe.test(content)) {
    pipelineViolations.push({
      file: relative(ROOT, filePath),
      rule: 'RULE-PIPELINE-ORDER',
      detail: 'executeArtifactPipeline() appears to be nested inside runControlPlane() call. ' +
              'Both must be top-level awaited calls from the route handler (not nested).',
    });
  }

  return pipelineViolations;
}

const pipelineViolations = [];
for (const dir of ROUTE_DIRS) {
  const files = walkSourceFiles(dir, { extensions: ['.ts', '.tsx'] });
  for (const file of files) {
    pipelineViolations.push(...checkPipelineOrder(file));
  }
}

if (pipelineViolations.length > 0) {
  console.error(`\n❌ check-route-boundaries: ${pipelineViolations.length} pipeline order violation(s):\n`);
  for (const v of pipelineViolations) {
    console.error(`  📍 ${v.file}`);
    console.error(`     ❌ ${v.rule}: ${v.detail}\n`);
  }
  totalViolations += pipelineViolations.length;
}

if (totalViolations === 0) {
  console.log('✅ check-route-boundaries: No violations found.');
  console.log(`   Scanned ${totalFilesScanned} route file(s) in:`);
  ROUTE_DIRS.forEach(d => console.log(`     ${relative(ROOT, d)}/`));
  process.exit(0);
}

console.error(`❌ check-route-boundaries: ${totalViolations} violation(s) in ${totalFilesScanned} files scanned.\n`);
console.error('RULE: Next.js route files must not import runtime layers directly.');
console.error('      All orchestration must flow through @brandos/control-plane-layer.\n');

for (const v of allViolations) {
  console.error(`  📍 ${v.file}:${v.line}`);
  console.error(`     import "${v.import}"`);
  console.error(`     ❌ Forbidden: ${v.forbidden}`);
  console.error(`     💡 Fix: use @brandos/control-plane-layer instead\n`);
}

console.error(`Total: ${totalViolations} violation(s)`);
process.exit(1);
