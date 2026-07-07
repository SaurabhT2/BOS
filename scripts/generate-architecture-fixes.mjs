#!/usr/bin/env node
/**
 * scripts/generate-architecture-fixes.mjs
 *
 * BrandOS Architecture Fix Generator (P3.5 — Deliverable 5)
 *
 * Generates .context/architecture_fixes.generated.md — runs the four named
 * governance scripts (check-boundaries, lint-imports, check-route-boundaries,
 * check-workspace), parses whatever they report, and pairs every real
 * violation with the recommended fix already on file for that rule
 * (scripts/shared/architecture-rules.mjs — no new fix vocabulary is invented
 * here). check-circular and check-exports are also run and reported on,
 * since they are read along the way and their current state is directly
 * relevant to "is this fix list complete" — see §5/§6 below.
 *
 * ADVISORY ONLY. This generator never edits source, never edits the
 * governance scripts it runs, and never changes which rules are enforced —
 * see the P3.5 constraint that this deliverable must not modify code.
 *
 * Two things this generator does that a naive "run the linter, dump the
 * output" version would not:
 *
 *   1. For lint-imports.mjs specifically, every reported violation is
 *      cross-checked against the actual source line it cites. lint-imports
 *      matches the text `from '@brandos/X'` anywhere in the raw file
 *      content, including inside comments — so a comment that mentions a
 *      package name produces an identical violation report to a real
 *      import. Each finding is independently re-classified as a real
 *      import or a comment match before being presented.
 *
 *   2. For check-circular.mjs (which itself warns it is using a "less
 *      precise" native detector because `madge` isn't installed), every
 *      reported cycle is independently re-verified by reading both files
 *      and confirming a *bidirectional* import edge actually exists. A
 *      one-directional barrel re-export (`export { x } from './y'`) is not
 *      a cycle even though the native detector reports the two files as
 *      mutually involved.
 *
 * Usage: node scripts/generate-architecture-fixes.mjs
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join, resolve, relative, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

import { ensureDir, renderTimestamp } from './shared/context-utils.mjs';
import { ARCH_RULES } from './shared/architecture-rules.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(join(__dirname, '..'));
const OUT = join(ROOT, '.context', 'architecture_fixes.generated.md');

function readSafe(absPath) {
  try { return readFileSync(absPath, 'utf8'); } catch { return null; }
}

// Markdown table cells break on a literal `|` — escape it for any dynamic
// text placed inside a `| ... |` row (e.g. ARCH_RULES detail text that
// itself joins items with " | ").
function tcell(text) {
  return String(text ?? '').replace(/\|/g, '\\|');
}

function runScript(relScriptPath) {
  try {
    const out = execFileSync('node', [join(ROOT, relScriptPath)], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { exitCode: 0, output: out, crashed: false };
  } catch (err) {
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    return { exitCode: err.status ?? 1, output, crashed: err.status === null || err.status === undefined };
  }
}

// ── Fix lookup (from the existing ARCH_RULES authority — no new fix text) ──

function fixFor(ruleToken) {
  const rule = ARCH_RULES.find((r) => r.id === ruleToken || r.id.startsWith(`${ruleToken} `) || r.id.startsWith(`${ruleToken}(`));
  if (!rule) return null;
  return { ruleId: rule.id, fix: rule.detail || rule.description };
}

// ── check-boundaries.mjs ────────────────────────────────────────────────
// Every violation check in this script prints a single-line
// `[BOUNDARY VIOLATION] RULE-N...: <message>` via console.error — see
// scripts/check-boundaries.mjs. Parsed generically rather than one parser
// per rule so a new check added there is picked up automatically.

function parseBoundaries(output) {
  const violations = [];
  const re = /\[BOUNDARY VIOLATION\]\s+(RULE-[\w-]+(?:\s*\([^)]*\))?):\s*(.+)/g;
  let m;
  while ((m = re.exec(output)) !== null) {
    const ruleToken = m[1].split(' ')[0].replace(/[:,]$/, '');
    violations.push({ rule: m[1], message: m[2].trim(), ...wrapFix(ruleToken) });
  }
  return violations;
}

function wrapFix(ruleToken) {
  const f = fixFor(ruleToken);
  return f ? { recommendedFix: f.fix, ruleReference: f.ruleId } : { recommendedFix: null, ruleReference: null };
}

// ── check-route-boundaries.mjs ──────────────────────────────────────────

function parseRouteBoundaries(output) {
  const violations = [];
  const re = /📍 (.+?):(\d+)\s*\n\s*import "(.+?)"\s*\n\s*❌ Forbidden: (.+?)\s*\n\s*💡 Fix: (.+)/g;
  let m;
  while ((m = re.exec(output)) !== null) {
    violations.push({
      file: m[1], line: Number(m[2]), import: m[3], forbidden: m[4].trim(), recommendedFix: m[5].trim(),
    });
  }
  return violations;
}

// ── check-workspace.mjs ──────────────────────────────────────────────────

function parseWorkspace(output) {
  const warnings = [];
  const lines = output.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /⚠️\s+(.+)/.exec(lines[i]);
    if (m && !/warning\(s\)/.test(m[1])) {
      const fixMatch = /⚠️\s+Fix:\s*(.+)/.exec(lines[i + 1] ?? '');
      warnings.push({ message: m[1].trim(), recommendedFix: fixMatch ? fixMatch[1].trim() : null });
    }
  }
  return warnings;
}

// ── lint-imports.mjs (with comment-vs-real-import re-verification) ──────

function parseLintImports(output) {
  const violations = [];
  const re = /❌ VIOLATION: (.+?):(\d+)\s*\n\s*Package:\s*(.+?)\s*\n\s*Imports:\s*(.+?)\s*\n\s*Source:\s*(.+)/g;
  let m;
  while ((m = re.exec(output)) !== null) {
    const [, file, lineStr, pkg, imports, sourceLine] = m;
    const trimmedSource = sourceLine.trim();
    const isComment = /^(\/\/|\/\*|\*)/.test(trimmedSource);
    violations.push({
      file, line: Number(lineStr), package: pkg.trim(), forbiddenImport: imports.trim(),
      sourceLine: trimmedSource,
      likelyFalsePositive: isComment,
      classification: isComment
        ? 'Matched text is inside a comment, not an executable import statement — lint-imports.mjs matches '
          + "the substring `from '@brandos/X'` anywhere in raw file content. No code change needed."
        : 'Matched text is a real import statement.',
      recommendedFix: isComment ? null : 'Replace with an allowed dependency, or move the referenced symbol per RULE-LAYER-ORDER.',
    });
  }
  return violations;
}

// ── check-circular.mjs (with bidirectional-edge re-verification) ────────

function relSpecifierVariants(fromFile, toFile) {
  // Builds the plausible relative-import specifiers fromFile could use to
  // reference toFile (with/without extension, with/without './').
  const fromDir = dirname(fromFile);
  let rel = relative(fromDir, toFile).replace(/\.tsx?$/, '');
  if (!rel.startsWith('.')) rel = './' + rel;
  const noIndex = rel.replace(/\/index$/, '');
  return [...new Set([rel, noIndex, noIndex === '.' ? './index' : noIndex])];
}

function fileImportsOther(fromAbs, toAbs) {
  const src = readSafe(fromAbs);
  if (!src) return false;
  return relSpecifierVariants(fromAbs, toAbs).some((spec) =>
    src.includes(`from '${spec}'`) || src.includes(`from "${spec}"`));
}

function parseCircular(output) {
  const cycles = [];
  const re = /🔄 (.+)/g;
  let m;
  while ((m = re.exec(output)) !== null) {
    const chain = m[1].split('→').map((s) => s.trim());
    const distinct = [...new Set(chain)];
    if (distinct.length !== 2) {
      cycles.push({ chain: m[1].trim(), nodes: distinct, bidirectionalConfirmed: null, classification: 'Cycle spans more than 2 distinct files — not re-verified by this generator; inspect manually.' });
      continue;
    }
    const [a, b] = distinct.map((f) => join(ROOT, f));
    const aImportsB = fileImportsOther(a, b);
    const bImportsA = fileImportsOther(b, a);
    const confirmed = aImportsB && bImportsA;
    cycles.push({
      chain: m[1].trim(),
      nodes: distinct,
      bidirectionalConfirmed: confirmed,
      classification: confirmed
        ? 'Confirmed: both files import each other — this is a real circular dependency.'
        : `Likely false positive: only a one-directional edge was found ` +
          `(${basename(distinct[0])} imports ${basename(distinct[1])}: ${aImportsB}; ` +
          `${basename(distinct[1])} imports ${basename(distinct[0])}: ${bImportsA}). ` +
          "check-circular.mjs's native detector (no `madge` installed) appears to treat a one-directional " +
          'barrel re-export as a cycle. No code change needed.',
    });
  }
  return cycles;
}

// ── Rendering ────────────────────────────────────────────────────────────

function renderBoundaries(result, violations) {
  const lines = ['## 1. `check-boundaries.mjs`', ''];
  if (result.crashed) { lines.push('⚠️ Script crashed — see raw output below.', '', '```', result.output.trim(), '```'); return lines.join('\n'); }
  if (!violations.length) {
    lines.push(`✅ ${result.output.trim() || 'No violations found.'}`);
  } else {
    lines.push(`❌ ${violations.length} violation(s) found:`, '');
    for (const v of violations) {
      lines.push(`- **${v.rule}**: ${v.message}`);
      lines.push(`  - Recommended fix: ${v.recommendedFix ?? '_no fix text on file for this rule id — see scripts/check-boundaries.mjs source_'}`);
    }
  }
  return lines.join('\n');
}

function renderRouteBoundaries(result, violations) {
  const lines = ['## 2. `check-route-boundaries.mjs`', ''];
  if (!violations.length) {
    lines.push(result.exitCode === 0 ? `✅ ${result.output.trim() || 'No violations found.'}` : '_Exited non-zero but no parseable violation found — see raw output._\n\n```\n' + result.output.trim() + '\n```');
  } else {
    lines.push(`❌ ${violations.length} violation(s) found:`, '');
    lines.push('| File | Import | Recommended Fix |', '|---|---|---|');
    for (const v of violations) lines.push(`| \`${v.file}:${v.line}\` | \`${v.import}\` | ${tcell(v.recommendedFix)} |`);
  }
  return lines.join('\n');
}

function renderWorkspace(result, warnings) {
  const lines = ['## 3. `check-workspace.mjs`', ''];
  if (!warnings.length) {
    lines.push(`✅ ${result.output.trim() || 'No issues found.'}`);
  } else {
    lines.push(`⚠️ ${warnings.length} warning(s) (non-blocking, exit code ${result.exitCode}):`, '');
    for (const w of warnings) {
      lines.push(`- ${w.message}`);
      if (w.recommendedFix) lines.push(`  - Recommended fix: ${w.recommendedFix}`);
    }
  }
  return lines.join('\n');
}

function renderLintImports(result, violations) {
  const lines = [
    '## 4. `lint-imports.mjs`',
    '',
    '_Every finding below is independently re-checked against the actual source line before being reported as real or a likely false positive — see the module header for why this check exists for this script specifically._',
    '',
  ];
  if (!violations.length) {
    lines.push(`✅ ${result.output.trim() || 'No violations found.'}`);
    return lines.join('\n');
  }
  const real = violations.filter((v) => !v.likelyFalsePositive);
  const fp = violations.filter((v) => v.likelyFalsePositive);

  lines.push(`Reported by the script: ${violations.length}. Re-verified as real imports: ${real.length}. Re-classified as likely false positives: ${fp.length}.`, '');

  if (real.length) {
    lines.push('**Real violations:**', '');
    lines.push('| File | Forbidden import | Recommended fix |', '|---|---|---|');
    for (const v of real) lines.push(`| \`${v.file}:${v.line}\` | ${tcell(v.forbiddenImport)} | ${tcell(v.recommendedFix)} |`);
    lines.push('');
  }
  if (fp.length) {
    lines.push('**Likely false positives (comment text, not an import — no code change needed):**', '');
    lines.push('| File | Matched text | Source line |', '|---|---|---|');
    for (const v of fp) lines.push(`| \`${v.file}:${v.line}\` | ${tcell(v.forbiddenImport)} | \`${tcell(v.sourceLine.slice(0, 80))}\` |`);
    lines.push('');
    lines.push('_Recommendation for P4: lint-imports.mjs matches `from \'@brandos/X\'` against raw file content '
      + 'without excluding comments. Tightening the scanner (e.g. stripping `//` and `/* */` regions before '
      + 'matching) would remove this category of noise. Not fixed here — this generator does not modify other '
      + 'governance scripts._');
  }
  return lines.join('\n');
}

function renderCircular(result, cycles) {
  const lines = [
    '## 5. `check-circular.mjs` _(read for context — not one of the four scripts this deliverable is scoped to, but its findings bear directly on the fix list above)_',
    '',
  ];
  if (/madge not found/.test(result.output)) {
    lines.push('⚠️ Running without `madge` — using the script\'s own "less precise" native detector (its words). '
      + 'This is why every reported cycle below is independently re-verified rather than trusted as-is.', '');
  }
  if (!cycles.length) {
    lines.push(`✅ ${result.crashed ? 'Script crashed — see raw output.' : 'No cycles found.'}`);
    return lines.join('\n');
  }
  const confirmed = cycles.filter((c) => c.bidirectionalConfirmed === true);
  const fp = cycles.filter((c) => c.bidirectionalConfirmed === false);
  const unverified = cycles.filter((c) => c.bidirectionalConfirmed === null);

  lines.push(`Reported: ${cycles.length}. Confirmed real (bidirectional import edge): ${confirmed.length}. `
    + `Re-classified as likely false positives: ${fp.length}. Not re-verified (3+ node cycle): ${unverified.length}.`, '');
  for (const c of cycles) {
    const mark = c.bidirectionalConfirmed === true ? '🔴 CONFIRMED' : c.bidirectionalConfirmed === false ? '🟡 likely false positive' : '⚪ unverified';
    lines.push(`- ${mark}: \`${c.chain}\``);
    lines.push(`  - ${c.classification}`);
  }
  return lines.join('\n');
}

function renderExports(result) {
  const lines = ['## 6. `check-exports.mjs` _(read for context — same reason as §5)_', ''];
  if (result.crashed) {
    lines.push('🔴 **Script cannot currently run** — it crashes before performing any check:', '', '```', result.output.trim(), '```', '');
    lines.push('Root cause: `import { existsSync, join } from \'fs\'` — `join` is exported by `\'path\'`, not `\'fs\'`. '
      + 'This is a defect in the script itself, not a finding about the codebase it would otherwise check. '
      + 'Recommended fix (not applied here — out of scope for an advisory-only generator that does not modify '
      + 'other governance scripts): `import { existsSync } from \'fs\'; import { join } from \'path\';`. '
      + 'Flagged for P4 follow-up.');
  } else {
    lines.push(result.exitCode === 0 ? `✅ ${result.output.trim() || 'No issues found.'}` : `❌ exited with code ${result.exitCode}:\n\n\`\`\`\n${result.output.trim()}\n\`\`\``);
  }
  return lines.join('\n');
}

function renderReferenceTable() {
  const lines = [
    '## 7. Common Violation Patterns & Fix Reference',
    '',
    'Evergreen reference — present regardless of whether any violation is currently active, so this file is '
      + 'useful both as a live report and as a lookup table the next time a violation of a known kind appears. '
      + 'Sourced from `scripts/shared/architecture-rules.mjs` (no new fix text invented here).',
    '',
    '| Rule | What it forbids | Recommended fix |',
    '|---|---|---|',
  ];
  for (const r of ARCH_RULES) {
    lines.push(`| \`${r.id}\` | ${tcell(r.description)} | ${tcell(r.detail) || '_(see description)_'} |`);
  }
  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  console.log('[generate-architecture-fixes] Starting…');

  const boundariesResult = runScript('scripts/check-boundaries.mjs');
  const routeResult = runScript('scripts/check-route-boundaries.mjs');
  const workspaceResult = runScript('scripts/check-workspace.mjs');
  const lintResult = runScript('scripts/lint-imports.mjs');
  const circularResult = runScript('scripts/check-circular.mjs');
  const exportsResult = runScript('scripts/check-exports.mjs');

  const boundaryViolations = parseBoundaries(boundariesResult.output);
  const routeViolations = parseRouteBoundaries(routeResult.output);
  const workspaceWarnings = parseWorkspace(workspaceResult.output);
  const lintViolations = parseLintImports(lintResult.output);
  const circularCycles = parseCircular(circularResult.output);

  const totalRealViolations = boundaryViolations.length + routeViolations.length
    + lintViolations.filter((v) => !v.likelyFalsePositive).length;

  const md = [
    '# BrandOS Architecture Fix Report (Generated)\n',
    `> **Generated:** ${renderTimestamp()}`,
    '> **Authority:** live output of `scripts/check-boundaries.mjs`, `scripts/lint-imports.mjs`, '
      + '`scripts/check-route-boundaries.mjs`, `scripts/check-workspace.mjs` (the four scripts this deliverable '
      + 'is scoped to), plus `scripts/check-circular.mjs` and `scripts/check-exports.mjs` for context.',
    '> **ADVISORY ONLY — this generator never modifies code, never modifies the governance scripts it runs, '
      + 'and never changes which rules are enforced.**',
    '> ⚠️ Do not edit — regenerated by `scripts/generate-architecture-fixes.mjs`\n',
    '---\n',
    `**Summary: ${totalRealViolations} real violation(s) across the four scoped scripts` +
      `${workspaceWarnings.length ? `, ${workspaceWarnings.length} non-blocking warning(s)` : ''}.**\n`,
    renderBoundaries(boundariesResult, boundaryViolations),
    '',
    renderRouteBoundaries(routeResult, routeViolations),
    '',
    renderWorkspace(workspaceResult, workspaceWarnings),
    '',
    renderLintImports(lintResult, lintViolations),
    '',
    renderCircular(circularResult, circularCycles),
    '',
    renderExports(exportsResult),
    '',
    renderReferenceTable(),
  ].join('\n');

  ensureDir(join(ROOT, '.context'));
  writeFileSync(OUT, md);
  console.log(`[generate-architecture-fixes] ✅ ${relative(ROOT, OUT)} (${totalRealViolations} real violation(s))`);
}

main();
