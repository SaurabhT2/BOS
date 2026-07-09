#!/usr/bin/env node
/**
 * scripts/context-refresh.mjs
 *
 * BrandOS AI Context Refresh Orchestrator — v1
 *
 * THE single supported entry point for regenerating all AI context across
 * the BrandOS repository. Run via:
 *
 *   pnpm context:refresh
 *
 * or directly:
 *
 *   node scripts/context-refresh.mjs [--skip-db] [--json] [--ci]
 *
 * WHY THIS EXISTS
 * ────────────────
 * Before this file, /scripts contained ~13 independent `generate-*.mjs`
 * generators plus ~6 `check-*.mjs` / `lint-imports.mjs` validators, none of
 * which were wired into package.json or into each other. Every one of them
 * was run manually, by hand, whenever someone happened to remember to. That
 * is exactly how several of them went stale for an entire platform migration
 * (the BrandOS / IntelligenceOS split) without anyone noticing — see the
 * v3/v6 "Context Generation Pipeline Modernization" notes throughout
 * scripts/shared/*.mjs and the individual generators for the specific
 * staleness this uncovered and fixed.
 *
 * This orchestrator does not replace any generator's logic. Every
 * `generate-*.mjs` script still works standalone (for fast iteration while
 * editing one generator). This file only sequences them correctly, reports
 * progress, and fails loudly instead of silently when something is wrong.
 *
 * ORCHESTRATION ORDER (dependency-respecting — see docs/context-generation.md
 * for the full rationale)
 * ────────────────────────────────────────────────────────────────────────
 *   Tier 0 — Validate repository state (fail-fast; a broken workspace or a
 *            real boundary violation makes every downstream artifact
 *            misleading, so we stop here rather than document a broken repo)
 *     check-workspace.mjs, check-boundaries.mjs
 *
 *   Tier 1 — Database snapshot (best-effort; skipped with a clear warning,
 *            not a pipeline failure, if DATABASE_URL/SUPABASE_DB_URL is
 *            unavailable — this is normal in sandboxes/CI without DB access)
 *     generate-schema-inventory.mjs
 *
 *   Tier 2 — Independent inventories/graphs (no inter-generator dependencies;
 *            each only reads scripts/shared/*.mjs + the live source tree)
 *     generate-agent-entrypoints.mjs
 *     generate-architecture-graph.mjs
 *     generate-dependency-impact.mjs
 *     generate-behavior-contracts.mjs
 *     generate-monorepo-context.mjs
 *     generate-runtime-trace-context.mjs
 *     generate-package-contexts.mjs
 *     generate-architecture-fixes.mjs   (persists a report of the Tier 0 checks
 *                                        + check-route-boundaries/check-circular)
 *
 *   Tier 3 — Depends on the Tier 1 DB snapshot for full fidelity (degrade
 *            gracefully — empty field lists, not a crash — if Tier 1 was
 *            skipped; still worth running for their non-DB sections)
 *     generate-database-context.mjs
 *     generate-runtime-model.mjs
 *     generate-system-inventory.mjs
 *
 *   Tier 4 — Final aggregator (reads nearly every artifact above; must run
 *            last)
 *     generate-claude-bootstrap.mjs
 *
 *   Tier 5 — Validate generated artifacts + produce final summary (this file)
 *
 * See docs/context-generation.md for: how to add a new generator, how to
 * remove one, generator/output conventions, and the full rationale for this
 * ordering.
 */

import { spawnSync } from 'child_process';
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { KNOWN_PACKAGES } from './shared/package-registry.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(join(__dirname, '..'));
const SCRIPTS = join(ROOT, 'scripts');
const CONTEXT_DIR = join(ROOT, '.context');

const args = process.argv.slice(2);
const FLAGS = {
  skipDb: args.includes('--skip-db'),
  json: args.includes('--json'),
  ci: args.includes('--ci'), // CI mode: DB absence is a hard failure, not a soft skip
};

// ── Tiny process runner with timing ─────────────────────────────────────────

function run(scriptRelPath, { optional = false } = {}) {
  const label = scriptRelPath;
  const start = Date.now();
  const result = spawnSync('node', [join(SCRIPTS, scriptRelPath)], {
    cwd: ROOT,
    encoding: 'utf-8',
  });
  const durationMs = Date.now() - start;
  const ok = result.status === 0;
  return {
    script: label,
    ok,
    optional,
    durationMs,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

// ── Reporting ────────────────────────────────────────────────────────────────

const results = [];
let hardFailure = false;

function report(entry, { failsPipeline = true } = {}) {
  results.push(entry);
  const icon = entry.ok ? '✅' : entry.optional ? '⚠️ ' : '❌';
  const time = `${entry.durationMs}ms`;
  console.log(`${icon} ${entry.script.padEnd(38)} ${time.padStart(8)}${entry.ok ? '' : `  — ${entry.optional ? 'SKIPPED (optional)' : 'FAILED'}`}`);
  if (!entry.ok && entry.stderr) {
    console.log(entry.stderr.split('\n').map((l) => `      ${l}`).join('\n'));
  }
  if (!entry.ok && !entry.optional && failsPipeline) hardFailure = true;
}

function heading(text) {
  console.log(`\n── ${text} ${'─'.repeat(Math.max(0, 70 - text.length))}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const pipelineStart = Date.now();
console.log(`BrandOS AI Context Refresh — starting at ${new Date().toISOString()}\n`);

// Tier 0 — Validate repository state (fail-fast)
heading('Tier 0 — Validate repository state');
report(run('check-workspace.mjs'));
report(run('check-boundaries.mjs'));

if (hardFailure) {
  console.log('\n❌ Repository state is invalid — stopping before generating any context.');
  console.log('   Generated context for a broken repo would be misleading. Fix the');
  console.log('   violation(s) above, then re-run `pnpm context:refresh`.\n');
  process.exit(1);
}

// Tier 1 — Database snapshot (best-effort unless --ci)
heading('Tier 1 — Database snapshot (best-effort)');
if (FLAGS.skipDb) {
  console.log('⚠️  --skip-db passed — skipping generate-schema-inventory.mjs');
  results.push({ script: 'generate-schema-inventory.mjs', ok: false, optional: true, durationMs: 0, stdout: '', stderr: '--skip-db flag' });
} else {
  const dbResult = run('generate-schema-inventory.mjs', { optional: !FLAGS.ci });
  report(dbResult, { failsPipeline: FLAGS.ci });
  if (!dbResult.ok && !FLAGS.ci) {
    console.log('   No DATABASE_URL/SUPABASE_DB_URL available — this is expected in sandboxes');
    console.log('   and most local dev setups. Tier 3 generators below will still run, using');
    console.log('   their DB sections degraded (empty field lists) rather than failing.');
    console.log('   Pass --ci to make this a hard failure (recommended for the CI pipeline,');
    console.log('   where a DB snapshot should always be available).');
  }
}

// Tier 2 — Independent inventories/graphs
heading('Tier 2 — Independent inventories & graphs');
const tier2 = [
  'generate-agent-entrypoints.mjs',
  'generate-architecture-graph.mjs',
  'generate-dependency-impact.mjs',
  'generate-behavior-contracts.mjs',
  'generate-monorepo-context.mjs',
  'generate-runtime-trace-context.mjs',
  'generate-package-contexts.mjs',
  'generate-architecture-fixes.mjs',
];
for (const script of tier2) report(run(script));

// Tier 3 — Depends on Tier 1's DB snapshot for full fidelity, degrades gracefully
heading('Tier 3 — Schema-dependent context (degrades gracefully without DB)');
const tier3 = [
  'generate-database-context.mjs',
  'generate-runtime-model.mjs',
  'generate-system-inventory.mjs',
];
for (const script of tier3) report(run(script));

if (hardFailure) {
  console.log('\n❌ One or more Tier 2/3 generators failed. Stopping before the final');
  console.log('   aggregator (generate-claude-bootstrap.mjs), since it reads their output.\n');
  printSummary();
  process.exit(1);
}

// Tier 4 — Final aggregator (reads nearly everything above)
heading('Tier 4 — Final aggregator');
report(run('generate-claude-bootstrap.mjs'));

// Tier 5 — Validate generated artifacts
heading('Tier 5 — Validate generated artifacts');
const validation = validateArtifacts();
for (const line of validation.messages) console.log(line);

printSummary(validation);

process.exit(hardFailure || validation.failed ? 1 : 0);

// ── Tier 5 implementation ───────────────────────────────────────────────────

function validateArtifacts() {
  const messages = [];
  let failed = false;

  // 1. Every generator that ran successfully should have produced a
  //    non-empty file (catches a generator that exits 0 but writes nothing).
  const expectedFiles = [
    'agent_entrypoints.generated.md',
    'architecture_graph.generated.json',
    'dependency_impact.generated.json',
    'behavior_contracts.generated.json',
    'monorepo_context.generated.md',
    'runtime_trace.generated.md',
    'architecture_fixes.generated.md',
    'database_context.generated.md',
    'runtime_model.generated.md',
    'system_inventory.generated.md',
  ];
  for (const f of expectedFiles) {
    const p = join(CONTEXT_DIR, f);
    if (!existsSync(p)) {
      messages.push(`❌ Missing expected artifact: .context/${f}`);
      failed = true;
    } else if (statSync(p).size === 0) {
      messages.push(`❌ Artifact is empty: .context/${f}`);
      failed = true;
    }
  }
  if (!existsSync(join(ROOT, 'CLAUDE_BOOTSTRAP.md'))) {
    messages.push('❌ Missing expected artifact: CLAUDE_BOOTSTRAP.md');
    failed = true;
  }

  // 2. Orphaned per-package files — a .context/packages/<x>.generated.md
  //    for a package no longer in KNOWN_PACKAGES. This is exactly the class
  //    of bug this modernization found (.context/packages/brand-intelligence
  //    .generated.md survived on disk for an entire platform migration after
  //    the package it described was deleted, because no generator or check
  //    ever looked at "files present on disk that no current package
  //    accounts for" — only at "packages present that lack a file").
  const pkgDir = join(CONTEXT_DIR, 'packages');
  if (existsSync(pkgDir)) {
    // Must match generate-package-contexts.mjs's own slug derivation exactly
    // (name.replace('@brandos/', '').replace('/', '-')) or every @platform/*
    // package falsely reports as orphaned on every run.
    const known = new Set(KNOWN_PACKAGES.map((p) => p.name.replace('@brandos/', '').replace('/', '-')));
    const onDisk = readdirSync(pkgDir).filter((f) => f.endsWith('.generated.md'));
    for (const f of onDisk) {
      const slug = f.replace('.generated.md', '');
      if (!known.has(slug)) {
        messages.push(`⚠️  Orphaned artifact: .context/packages/${f} — no package named "${slug}" exists ` +
          `in scripts/shared/package-registry.mjs::KNOWN_PACKAGES. If the package was removed, delete this ` +
          `file (it will never be regenerated or overwritten automatically).`);
      }
    }
  }

  // 3. Regression guard: no generated artifact should assert a *deleted*
  //    package's continued existence as current fact. This is a narrow,
  //    deliberately-scoped check (not a general "no mention of the string"
  //    check) — historical/explanatory mentions ("formerly", "deleted",
  //    "was replaced by") are expected and fine; the patterns below are
  //    the specific phrasings that would indicate a generator regressed
  //    back to treating brand-intelligence as live.
  const REGRESSION_PATTERNS = [
    { re: /Owner:\s*\*\*`@brandos\/brand-intelligence`\*\*/, desc: 'asserts @brandos/brand-intelligence as a live table owner' },
    { re: /L\d+\s+@brandos\/brand-intelligence\s+→/, desc: 'lists @brandos/brand-intelligence in a live layer diagram' },
  ];
  if (existsSync(CONTEXT_DIR)) {
    walkGenerated(CONTEXT_DIR, (file) => {
      const content = readFileSafe(file);
      if (!content) return;
      for (const { re, desc } of REGRESSION_PATTERNS) {
        if (re.test(content)) {
          messages.push(`❌ Regression detected in ${file.replace(ROOT + '/', '')}: ${desc}`);
          failed = true;
        }
      }
    });
  }

  if (messages.length === 0) messages.push('✅ All generated artifacts present, non-empty, and pass regression checks.');
  return { failed, messages };
}

function walkGenerated(dir, fn) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkGenerated(p, fn);
    else if (entry.name.endsWith('.generated.md') || entry.name.endsWith('.generated.json')) fn(p);
  }
}

function readFileSafe(p) {
  try { return readFileSync(p, 'utf-8'); } catch { return null; }
}

function printSummary(validation) {
  const totalMs = Date.now() - pipelineStart;
  const okCount = results.filter((r) => r.ok).length;
  const skippedCount = results.filter((r) => !r.ok && r.optional).length;
  const failedCount = results.filter((r) => !r.ok && !r.optional).length;

  heading('Summary');
  console.log(`Ran ${results.length} step(s) in ${(totalMs / 1000).toFixed(1)}s: ` +
    `${okCount} ok, ${skippedCount} skipped, ${failedCount} failed.`);
  if (failedCount > 0) {
    console.log('\nFailed steps:');
    for (const r of results.filter((r) => !r.ok && !r.optional)) console.log(`  - ${r.script}`);
  }
  if (skippedCount > 0) {
    console.log('\nSkipped (optional):');
    for (const r of results.filter((r) => !r.ok && r.optional)) console.log(`  - ${r.script}`);
  }
  if (validation) {
    console.log(`\nArtifact validation: ${validation.failed ? '❌ FAILED' : '✅ PASSED'}`);
  }
  console.log(`\nOutputs written to: .context/ and CLAUDE_BOOTSTRAP.md`);
  console.log(`Next: read CLAUDE_BOOTSTRAP.md for the canonical starting point for any agent session.\n`);

  if (FLAGS.json) {
    const jsonPath = join(CONTEXT_DIR, 'context_refresh_summary.generated.json');
    const payload = {
      generatedAt: new Date().toISOString(),
      totalMs,
      okCount, skippedCount, failedCount,
      steps: results.map((r) => ({ script: r.script, ok: r.ok, optional: r.optional, durationMs: r.durationMs })),
      artifactValidation: validation ? { failed: validation.failed, messages: validation.messages } : null,
    };
    try {
      writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf-8');
      console.log(`Machine-readable summary: .context/context_refresh_summary.generated.json`);
    } catch (e) {
      console.log(`(--json requested but summary write failed: ${e.message})`);
    }
  }
}
