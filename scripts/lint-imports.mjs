#!/usr/bin/env node
/**
 * scripts/lint-imports.mjs
 *
 * BrandOS Source-Level Import Direction Enforcer — v4
 *
 * Scans TypeScript source files and enforces that no package imports
 * from a layer above itself (source-level complement to check-boundaries.mjs,
 * which checks package.json deps).
 *
 * v3 changes:
 *   - PACKAGE_SRC_MAP imported from shared/package-registry.mjs
 *   - LAYER_TIERS drives FORBIDDEN map generation — no manual list to maintain
 *   - File walking uses shared/fs-utils.mjs::walkSourceFiles
 *   - Fixed: collectFiles was referenced but never defined (ReferenceError bug)
 *   - New config packages (L3a) and brand-intelligence now covered
 *
 * v4 changes (Engineering Workflow Audit & Consolidation):
 *   - This script was never wired to any pnpm/package.json script — running
 *     it directly (`node scripts/lint-imports.mjs`) surfaced 6 "violations"
 *     that are all matches inside comments (migration notes, illustrative
 *     "import from X instead" examples), not real imports — the regex scan
 *     never stripped comments first. Fixed by stripping comments before
 *     matching, the same technique check-boundaries.mjs's RULE-3 already
 *     uses for the identical class of false positive. Newlines inside block
 *     comments are preserved (characters blanked, not removed) so reported
 *     line numbers stay accurate.
 *   - Now exposed as `pnpm lint:imports` and included in `pnpm validate`.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, relative, join } from 'path';
import { PACKAGE_SRC_MAP, LAYER_TIERS, LAYER_INDEX } from './shared/package-registry.mjs';
import { walkSourceFiles } from './shared/fs-utils.mjs';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

// Strips comments while preserving line numbers (block comments are blanked
// character-by-character rather than removed, so embedded newlines survive).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

// ── Build FORBIDDEN map from LAYER_TIERS ──────────────────────────────────
// For each package, the forbidden set is every package at a HIGHER tier index.
// This is derived automatically so adding a package to package-registry.mjs
// is sufficient — no manual list maintenance needed here.

const FORBIDDEN = {};

for (const [pkg] of Object.entries(PACKAGE_SRC_MAP)) {
  const myTier = LAYER_INDEX[pkg];
  if (myTier === undefined) continue;

  FORBIDDEN[pkg] = Object.keys(PACKAGE_SRC_MAP).filter(dep => {
    if (dep === pkg) return false;
    const depTier = LAYER_INDEX[dep];
    return depTier !== undefined && depTier > myTier;
  });
}

// ── Governance symbol deprecation list ────────────────────────────────────
// Symbols re-exported from @brandos/control-plane-layer as deprecated shims.
// Packages other than CPL must migrate to the canonical source.
const GOVERNANCE_SYMBOL_NAMES = [
  'registerPolicyViolationHandler',
  'evaluateGovernance',
  'GovernanceEvaluationResult',
  'ControlPlaneResult',
  'PolicyViolationType',
  'PolicyConfig',
  'DEFAULT_POLICY_CONFIG',
];

// ── Helpers ────────────────────────────────────────────────────────────────

function makePackagePattern(pkg) {
  const escaped = pkg.replace(/[/\\]/g, '[/\\\\]');
  return new RegExp(`from\\s+['"]${escaped}(?:[/']|['"])`, 'g');
}

// ── Main: upward import scan ───────────────────────────────────────────────

let violations = 0;

for (const [pkg, srcDirRelative] of Object.entries(PACKAGE_SRC_MAP)) {
  const forbidden = FORBIDDEN[pkg] ?? [];
  if (forbidden.length === 0) continue;

  const fullSrcDir = resolve(root, srcDirRelative);
  if (!existsSync(fullSrcDir)) continue;

  const files = walkSourceFiles(fullSrcDir);

  for (const file of files) {
    let rawContent;
    try { rawContent = readFileSync(file, 'utf8'); } catch { continue; }
    const content = stripComments(rawContent);

    const lines = content.split('\n');

    for (const dep of forbidden) {
      const pattern = makePackagePattern(dep);
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const upToMatch = content.slice(0, match.index);
        const lineNum = upToMatch.split('\n').length;
        const lineContent = lines[lineNum - 1]?.trim() ?? '';

        console.error(`❌ VIOLATION: ${relative(root, file)}:${lineNum}`);
        console.error(`   Package:  ${pkg}`);
        console.error(`   Imports:  ${dep} (forbidden — upward dependency)`);
        console.error(`   Source:   ${lineContent}`);
        console.error('');
        violations++;
      }
    }
  }
}

// ── Governance symbol deprecation check ───────────────────────────────────
// Catches packages that import governance symbols through the CPL shim
// instead of directly from @brandos/governance-layer / @brandos/governance-config.

const GOVERNANCE_CPL_PATTERN = /from\s+['"]@brandos\/control-plane-layer['"]/g;

for (const [pkg, srcRelPath] of Object.entries(PACKAGE_SRC_MAP)) {
  if (pkg === '@brandos/control-plane-layer') continue;

  const srcDir = resolve(root, srcRelPath);
  if (!existsSync(srcDir)) continue;

  // FIX: was calling undefined collectFiles() — now uses walkSourceFiles()
  const files = walkSourceFiles(srcDir);

  for (const file of files) {
    let rawContent;
    try { rawContent = readFileSync(file, 'utf8'); } catch { continue; }
    const content = stripComments(rawContent);

    if (!GOVERNANCE_CPL_PATTERN.test(content)) continue;
    GOVERNANCE_CPL_PATTERN.lastIndex = 0;

    const lines = content.split('\n');
    for (const symbol of GOVERNANCE_SYMBOL_NAMES) {
      if (!content.includes(symbol)) continue;

      lines.forEach((line, i) => {
        if (line.includes(symbol) && line.includes('@brandos/control-plane-layer')) {
          console.error(`❌ DEPRECATED IMPORT: ${relative(root, file)}:${i + 1}`);
          console.error(`   Governance symbol '${symbol}' imported through CPL.`);
          console.error(`   Migrate to '@brandos/governance-layer' or '@brandos/governance-config'.`);
          console.error(`   Source: ${line.trim()}`);
          console.error('');
          violations++;
        }
      });
    }
  }
}

// ── Summary ────────────────────────────────────────────────────────────────

if (violations > 0) {
  console.error(`${violations} import violation(s) detected. Fix before building.`);
  process.exit(1);
}

console.log('✅ lint-imports: No dependency direction violations.');
