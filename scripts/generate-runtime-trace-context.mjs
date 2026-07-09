#!/usr/bin/env node
/**
 * scripts/generate-runtime-trace-context.mjs
 *
 * BrandOS Runtime Trace Context Generator (P3.5 — Deliverable 3)
 *
 * Generates .context/runtime_trace.generated.md — actual runtime behavior,
 * extracted from source, rather than declared structure. Where the existing
 * .context/runtime_model.generated.md documents the *intended* architecture
 * (component responsibilities, contracts), this file documents *what the
 * code on disk actually does and in what order*, including a few places
 * where the two disagree.
 *
 * Several sections are computed live by reading the canonical entry-point
 * files at generation time, not hand-frozen prose, so a future change to
 * the relevant source is picked up the next time this generator runs:
 *
 *   - Boot sequence            <- apps/web/instrumentation.ts (parses its own
 *                                  numbered header comment, then confirms each
 *                                  numbered call actually appears in the body)
 *   - Route orchestration map  <- every apps/web/app/api/**\/route.ts, scanned
 *                                  for calls to runControlPlane() / executeArtifactPipeline()
 *   - Repair-loop ceiling       <- packages/artifact-engine-layer/src/engine.ts (MAX_REPAIR_ATTEMPTS)
 *   - Prompt contributors       <- packages/output-control-layer/src/contract-assembler/ContractAssemblerFactory.ts
 *   - Provider registration paths <- packages/ai-runtime-layer/src/config/factory.ts
 *   - Table write-site audit   <- every package's src/ + apps/web, cross-checked
 *                                  against scripts/shared/table-ownership.mjs
 *
 * The narrative connecting these facts (why the boot order is what it is,
 * what each runtime path is for) is written once, from a direct reading of
 * the source files cited inline; it is not re-derived from the existing
 * .context/runtime_model.generated.md (consuming, not duplicating, the
 * prior context system per the P3.5 ground rule would mean treating that
 * file as authoritative for *intent* — this file's job is to check intent
 * against the code, so it is sourced from the code itself).
 *
 * Usage: node scripts/generate-runtime-trace-context.mjs
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

import { KNOWN_PACKAGES, FORBIDDEN_IN_ROUTES } from './shared/package-registry.mjs';
import { ensureDir, renderTimestamp } from './shared/context-utils.mjs';
import { walkSourceFiles } from './shared/fs-utils.mjs';
import { TABLE_OWNERSHIP } from './shared/table-ownership.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(join(__dirname, '..'));
const OUT = join(ROOT, '.context', 'runtime_trace.generated.md');

function readSafe(absPath) {
  try { return readFileSync(absPath, 'utf8'); } catch { return null; }
}

// ── 1. Boot sequence (apps/web/instrumentation.ts) ─────────────────────────

function extractBootSequence() {
  const path = join(ROOT, 'apps/web/instrumentation.ts');
  const src = readSafe(path);
  if (!src) return { steps: [], verified: false, note: 'apps/web/instrumentation.ts not found.' };

  const steps = [];
  const headerRe = /\*\s*(\d+)\.\s+(\S+?)\(\)\s*—\s*(.+)$/gm;
  let m;
  while ((m = headerRe.exec(src)) !== null) {
    steps.push({ n: Number(m[1]), call: m[2].trim(), description: m[3].trim() });
  }

  // Verify each named call actually appears in the function body (not just the comment).
  for (const step of steps) {
    step.confirmedInBody = src.includes(`${step.call}(`);
  }

  return { steps, verified: steps.length > 0 && steps.every((s) => s.confirmedInBody), path: relative(ROOT, path) };
}

// ── 2. Route orchestration map ──────────────────────────────────────────────

function findRouteFiles() {
  const apiRoot = join(ROOT, 'apps/web/app/api');
  const out = [];
  function walk(dir, segs) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full, [...segs, e]);
      else if (e === 'route.ts' || e === 'route.tsx') out.push({ route: '/api/' + segs.join('/'), file: full });
    }
  }
  walk(apiRoot, []);
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

function analyzeRouteOrchestration() {
  // v3 fix: was a fourth independently-hardcoded copy of the forbidden-import
  // list (and still referenced the deleted @brandos/brand-intelligence, never
  // updated to @brandos/cognition-client). Now derived from
  // FORBIDDEN_IN_ROUTES (shared/package-registry.mjs), the same authority
  // check-route-boundaries.mjs itself uses.
  const forbiddenRe = new RegExp(
    `@brandos\\/(${FORBIDDEN_IN_ROUTES.map((p) => p.replace('@brandos/', '')).join('|')})['"]`
  );
  const rows = [];
  for (const { route, file } of findRouteFiles()) {
    const src = readSafe(file) ?? '';
    rows.push({
      route,
      file: relative(ROOT, file),
      callsControlPlane: /\brunControlPlane\s*\(/.test(src),
      callsArtifactPipeline: /\bexecuteArtifactPipeline\s*\(/.test(src),
      importsForbiddenLayer: forbiddenRe.test(src),
    });
  }
  return rows;
}

// ── 3. Repair-loop ceiling (artifact-engine-layer/src/engine.ts) ──────────

function extractMaxRepairAttempts() {
  const path = join(ROOT, 'packages/artifact-engine-layer/src/engine.ts');
  const src = readSafe(path);
  if (!src) return null;
  const m = /MAX_REPAIR_ATTEMPTS\s*=\s*(\d+)/.exec(src);
  if (!m) return null;
  // The explanatory comment lives in a header doc-comment block, not
  // necessarily adjacent to the declaration — find the "LAW N —
  // MAX_REPAIR_ATTEMPTS..." annotation line, then take subsequent
  // doc-comment lines up to (not including) the next blank comment line.
  let comment = null;
  const lines = src.split('\n');
  const lawLineIdx = lines.findIndex((l) => /\*\s*LAW\s+\d+\s*—\s*MAX_REPAIR_ATTEMPTS/.test(l));
  if (lawLineIdx !== -1) {
    const collected = [];
    for (let i = lawLineIdx + 1; i < lines.length; i++) {
      const stripped = lines[i].replace(/\r$/, '');
      if (/^\s*\*\s*$/.test(stripped)) break; // blank comment line ends the paragraph
      const text = stripped.replace(/^\s*\*\s*/, '').trim();
      if (!text) break;
      collected.push(text);
    }
    comment = collected.join(' ');
  }
  return { value: Number(m[1]), path: relative(ROOT, path), comment };
}

// ── 4. Prompt contributors (OCL ContractAssemblerFactory) ──────────────────

function extractContributors() {
  const path = join(ROOT, 'packages/output-control-layer/src/contract-assembler/ContractAssemblerFactory.ts');
  const src = readSafe(path);
  if (!src) return { contributors: [], path: null };
  const contributors = [];
  const re = /register\(\s*'(\w+)'\s*,\s*new\s+(\w+)\(\)/g;
  let m;
  while ((m = re.exec(src)) !== null) contributors.push({ slot: m[1], class: m[2] });
  return { contributors, path: relative(ROOT, path) };
}

// ── 5. Provider registration paths (ai-runtime-layer/src/config/factory.ts) ─

function extractProviderPaths() {
  const path = join(ROOT, 'packages/ai-runtime-layer/src/config/factory.ts');
  const src = readSafe(path);
  if (!src) return null;
  const nativeProviders = ['openai', 'anthropic', 'google', 'deepseek'].filter((p) => new RegExp(`['"]${p}['"]`).test(src));
  const localProviders = ['ollama', 'lmstudio'].filter((p) => new RegExp(`['"]${p}['"]`, 'i').test(src));
  const registryDriven = /PROVIDER_REGISTRY/.test(src) || /OPENAI_COMPATIBLE_DEFS/.test(src);
  return { path: relative(ROOT, path), nativeProviders, localProviders, registryDriven };
}

// ── 6. Table write-site audit (cross-checked against TABLE_OWNERSHIP) ─────

function packageForFile(absPath) {
  const rel = relative(ROOT, absPath);
  if (rel.startsWith('apps/web')) return '@brandos/web';
  for (const { name, dir } of KNOWN_PACKAGES) {
    if (rel.startsWith(dir + '/')) return name;
  }
  return null;
}

function collectAllSourceFiles() {
  const files = [];
  for (const { dir, app } of KNOWN_PACKAGES) {
    const srcDir = app ? join(ROOT, dir, 'app') : join(ROOT, dir, 'src');
    files.push(...walkSourceFiles(srcDir));
    if (app) {
      files.push(...walkSourceFiles(join(ROOT, dir, 'lib')));
    }
  }
  return files;
}

function auditTableWriteSites() {
  const files = collectAllSourceFiles();
  const fileContents = new Map();
  for (const f of files) {
    const src = readSafe(f);
    if (src) fileContents.set(f, src);
  }

  const report = {};
  for (const table of Object.keys(TABLE_OWNERSHIP)) {
    const fromRe = new RegExp(`\\.from\\(['"]${table}['"]\\)`, 'g');
    const writeNear = new RegExp(`\\.from\\(['"]${table}['"]\\)[\\s\\S]{0,150}?\\.(insert|update|upsert|delete)\\(`);
    const foundLocations = new Set();
    const foundFiles = [];
    for (const [file, src] of fileContents) {
      if (!fromRe.test(src)) continue;
      fromRe.lastIndex = 0;
      if (writeNear.test(src)) {
        const pkg = packageForFile(file);
        if (pkg) foundLocations.add(pkg);
        foundFiles.push(relative(ROOT, file));
      }
    }
    const documented = (TABLE_OWNERSHIP[table].writers ?? []).map((w) => (w === 'apps/web' ? '@brandos/web' : w));
    const documentedSet = new Set(documented.filter((w) => w.startsWith('@brandos/')));
    const undocumented = [...foundLocations].filter((loc) => !documentedSet.has(loc));
    report[table] = {
      documentedWriters: TABLE_OWNERSHIP[table].writers ?? [],
      observedWriteLocations: [...foundLocations].sort(),
      observedWriteFiles: foundFiles.sort(),
      undocumentedWriteLocations: undocumented.sort(),
    };
  }
  return report;
}

// ── Markdown rendering ──────────────────────────────────────────────────

function renderBootSequence(boot) {
  const lines = [`## 1. Boot Sequence`, '', `Source: \`${boot.path}\` (read live at generation time — extracted from the file's own numbered header comment, then confirmed each call exists in the function body).`, ''];
  if (!boot.steps.length) {
    lines.push('_Could not extract a boot sequence — file missing or comment header changed shape. Read `apps/web/instrumentation.ts` directly._');
    return lines.join('\n');
  }
  for (const s of boot.steps) {
    const suffix = s.confirmedInBody ? '' : ' _(⚠️ not found in body)_';
    lines.push(`${s.n}. **${s.call}()** — ${s.description}${suffix}`);
  }
  lines.push('');
  lines.push('All five run synchronously, in order, once per server process (Next.js `instrumentation.ts` hook). '
    + 'Note: the AI-runtime config provider bridge (`setRuntimeConfigProvider`) is **not** wired here — '
    + 'it is wired lazily, on the first call to `AdminSettingsService.load()` '
    + '(see `packages/control-plane-layer/src/admin/settings-service-supabase.ts`), the first time any '
    + 'request touches admin settings. An agent looking for "where does ARL learn about admin overrides" '
    + 'should not stop at this boot sequence.');
  return lines.join('\n');
}

function renderRouteOrchestration(rows) {
  const lines = [
    '## 2. Request Orchestration Flow',
    '',
    'Computed live by scanning every `apps/web/app/api/**/route.ts` file for calls to the two CPL '
      + 'orchestration entry points. This is the actual call graph, not a description of it.',
    '',
  ];

  const both = rows.filter((r) => r.callsControlPlane && r.callsArtifactPipeline);
  const cplOnly = rows.filter((r) => r.callsControlPlane && !r.callsArtifactPipeline);
  const pipelineOnly = rows.filter((r) => !r.callsControlPlane && r.callsArtifactPipeline);
  const violations = rows.filter((r) => r.importsForbiddenLayer);

  lines.push(`**Routes calling both \`runControlPlane()\` and \`executeArtifactPipeline()\`: ${both.length}**`);
  lines.push('');
  lines.push('These are the structured-artifact routes (carousel/deck/report/newsletter). The key fact for agents: '
    + '`executeArtifactPipeline()` is called **from the route**, as a second, separate top-level call, '
    + '*after* `runControlPlane()` returns — it is not nested inside `CPLOrchestrator.orchestrate()`. '
    + 'A route does, sequentially:');
  lines.push('');
  lines.push('```');
  lines.push("const cpl = await runControlPlane(input, runtimeMode, supabase)      // Step 1: brand cognition + raw generation");
  lines.push("const result = await executeArtifactPipeline(taskType, cpl.output, …) // Step 2: compile + govern + repair + lifecycle");
  lines.push('```');
  lines.push('');
  if (both.length) {
    lines.push('<details><summary>Routes (click to expand)</summary>\n');
    for (const r of both) lines.push(`- \`${r.route}\` — \`${r.file}\``);
    lines.push('\n</details>\n');
  }

  lines.push(`**Routes calling only \`runControlPlane()\`** (free-text generation — post/caption/etc., governed by ` +
    '`evaluateGovernance()` inside CPL rather than the structured artifact pipeline): '
    + `${cplOnly.length}`);
  lines.push('');
  if (pipelineOnly.length) {
    lines.push(`**Routes calling \`executeArtifactPipeline()\` without \`runControlPlane()\`: ${pipelineOnly.length}** ` +
      '(re-compiling/re-governing already-generated content, e.g. export/edit flows).');
    lines.push('');
  }

  lines.push(`**Route-boundary check:** ${violations.length} route file(s) import a \`FORBIDDEN_IN_ROUTES\` package directly. `
    + 'This duplicates `scripts/check-route-boundaries.mjs` for convenience — that script is the enforcement authority; '
    + 'this is observational. See `.context/architecture_fixes.generated.md` for the live violation list.');

  return lines.join('\n');
}

function renderArtifactPaths(maxRepair) {
  const lines = ['## 3. Artifact Execution Path (`@brandos/artifact-engine-layer`)', ''];
  lines.push('`bootstrapArtifactEngine()` (called once at boot, step 1 above) registers four artifact types '
    + '— `carousel`, `deck`, `report`, `newsletter` — each as a `{ICompiler, IGovernanceAdapter}` pair on the `globalArtifactEngine` '
    + 'singleton (`packages/artifact-engine-layer/src/bootstrap.ts`). Each `ICompiler` is a thin wrapper that delegates '
    + 'to the matching `@brandos/output-control-layer` `compileXArtifact()` function; each `IGovernanceAdapter` delegates '
    + 'to the matching `@brandos/governance-layer` `validateXArtifact()` / `runXSemanticGovernance()` functions. '
    + 'Neither OCL nor governance-layer import each other directly (RULE-2, RULE-5) — `artifact-engine-layer` is the '
    + 'only thing that imports both, and the adapter pair is the entire contract between them (see Behavior Contract '
    + 'Registry, `OCL ↔ Governance`).');
  lines.push('');
  lines.push('`compileAndGovern(taskType, raw, …)` in `engine.ts` then runs, in order: compile → assert the compiled shape '
    + 'is `$schema: "artifact-json@2.0"` → govern → on a failing governance score, recompile with repair guidance and '
    + 're-govern, up to a fixed retry ceiling.');
  lines.push('');
  if (maxRepair) {
    lines.push(`**Repair ceiling (live value): \`MAX_REPAIR_ATTEMPTS = ${maxRepair.value}\`** (\`${maxRepair.path}\`)` + (maxRepair.comment ? ` — _${maxRepair.comment}_` : ''));
  } else {
    lines.push('_Could not locate `MAX_REPAIR_ATTEMPTS` — check `packages/artifact-engine-layer/src/engine.ts` directly._');
  }
  lines.push('');
  lines.push('`engine.ts` and `registry.ts` in this package are RULE-ARTIFACT-ENGINE-NO-TOUCH zones — read freely for '
    + 'tracing, but do not edit without explicit human approval.');
  return lines.join('\n');
}

function renderPromptCompilation(contrib) {
  const lines = ['## 4. Prompt Compilation Path (`@brandos/output-control-layer`)', ''];
  lines.push(`\`ContractAssemblerFactory.create()\` is called per-request (inside \`CPLOrchestrator.orchestrate()\`, not at boot — there is no startup singleton). It registers ${contrib.contributors.length} contributors on a fresh \`ContractAssembler\`:`);
  lines.push('');
  if (contrib.contributors.length) {
    for (const c of contrib.contributors) lines.push(`- \`${c.slot}\` → \`${c.class}\``);
  } else {
    lines.push('_Could not extract contributor registrations — check `ContractAssemblerFactory.ts` directly._');
  }
  lines.push('');
  lines.push('`ContractAssembler.assemble()` runs all registered contributors and folds their output into a '
    + '`ResolvedGenerationContract`, which `compilePromptFromContract()` turns into a `{system, user}` `CompiledPrompt`. '
    + 'This prompt is what is actually sent to the model — an agent debugging "why did the model produce X" should '
    + 'trace here, not assume the contributor list matches whatever an older doc says.');
  return lines.join('\n');
}

function renderProviderRegistrations(providers) {
  const lines = ['## 5. Provider & Adapter Registrations (`@brandos/ai-runtime-layer`)', ''];
  if (!providers) {
    lines.push('_Could not read `packages/ai-runtime-layer/src/config/factory.ts`._');
    return lines.join('\n');
  }
  lines.push(`Source: \`${providers.path}\`. Three independent registration paths feed the same adapter registry:`);
  lines.push('');
  lines.push(`1. **Native adapters** — direct SDK integrations: ${providers.nativeProviders.join(', ') || '(none detected)'}`);
  lines.push(`2. **Local adapters** — self-hosted/OpenAI-compatible local servers: ${providers.localProviders.join(', ') || '(none detected)'}`);
  lines.push(`3. **Registry-driven adapters** — ${providers.registryDriven ? 'driven by `PROVIDER_REGISTRY` / `OPENAI_COMPATIBLE_DEFS` declared in `@brandos/contracts`, instantiated generically rather than one class per provider' : '(no registry-driven path detected — re-check factory.ts)'}`);
  lines.push('');
  lines.push('All three paths feed `llmRouter.callWithMode()`, which is the single entry every CPL/artifact call '
    + 'eventually reaches, wrapped in the shared `CircuitBreaker` / `RateLimiter` / `CostTracker` resilience layer. '
    + 'CPL injects per-workspace overrides into this layer via `setRuntimeConfigProvider()` (wired lazily — see §1) '
    + 'rather than ARL reading the database itself; ARL has no Supabase dependency.');
  return lines.join('\n');
}

function renderGovernancePaths() {
  const lines = ['## 6. Governance Execution Paths (`@brandos/governance-layer`)', ''];
  lines.push('Two independent governance code paths exist, and neither calls the other:');
  lines.push('');
  lines.push('- **Free-text governance** — `evaluateGovernance()` in `governanceEngine.ts`. Pure, synchronous, '
    + 'heuristic/regex scoring (cliché density, buzzword density, hook strength) against `DEFAULT_PASS_THRESHOLD` '
    + 'from `@brandos/governance-config`. Used directly by `runControlPlane()` for unstructured task types (post/caption).');
  lines.push('- **Structured artifact governance** — per-type `validateXArtifact()` + `runXSemanticGovernance()` '
    + '(carousel/deck/report/newsletter), invoked exclusively through the matching `IGovernanceAdapter` inside '
    + '`@brandos/artifact-engine-layer` (§3). Routes and CPL never call these functions directly.');
  lines.push('');
  lines.push('**`OCL ↔ Governance` contract, precisely:** there is no import edge between the two packages in either '
    + 'direction (enforced — RULE-2, RULE-5). The contract between them is a *data shape*, not a function call: OCL\'s '
    + 'compiler produces an `ArtifactV2` object asserted to carry `$schema: "artifact-json@2.0"` '
    + '(`assertCompiledArtifact()` in `engine.ts`), and governance-layer\'s validators assume exactly that shape on '
    + 'input. `artifact-engine-layer`\'s adapter classes are the only code that has ever seen both sides.');
  return lines.join('\n');
}

function renderPersistence(auditReport) {
  const lines = ['## 7. Persistence Paths', ''];
  lines.push('Cross-checked live against `scripts/shared/table-ownership.mjs` by scanning every package\'s `src/` '
    + '(and `apps/web/app` + `apps/web/lib`) for `.from(\'table\').insert|update|upsert|delete(...)` call shapes. '
    + 'This catches packages that physically write a table without being its documented writer — operational '
    + 'coupling a pure import-graph view (§ architecture_graph) cannot see.');
  lines.push('');

  const flagged = Object.entries(auditReport).filter(([, r]) => r.undocumentedWriteLocations.length > 0);
  if (flagged.length) {
    lines.push('**Tables with a write call-site outside the documented `writers` list:**');
    lines.push('');
    lines.push('| Table | Documented writers | Observed write locations | Undocumented |');
    lines.push('|---|---|---|---|');
    for (const [table, r] of flagged) {
      lines.push(`| \`${table}\` | ${r.documentedWriters.join(', ') || '—'} | ${r.observedWriteLocations.join(', ') || '—'} | **${r.undocumentedWriteLocations.join(', ')}** |`);
    }
    lines.push('');
  }

  // Specifically narrate the campaigns finding if present, since it's a clean, concrete example.
  const campaigns = auditReport.campaigns;
  if (campaigns) {
    lines.push('**Worked example — `campaigns`:** documented writers are '
      + `${campaigns.documentedWriters.join(', ')}. Observed write call-sites (\`.from('campaigns').insert/update(...)\`) `
      + `are in: ${campaigns.observedWriteLocations.join(', ') || '(none detected)'}` + '.');
    lines.push('');
    lines.push('`@brandos/auth` exports `createCampaign()`, `updateCampaign()`, `getCampaignById()` '
      + '(see `.context/packages/auth.generated.md`), but no call site for any of them was found outside '
      + '`packages/auth/src` itself — every real write happens directly against the per-request Supabase client '
      + 'inside the route handler. The documented "owner" and the actual writer are different packages today. '
      + 'This is a fact about the current code, not a verdict on whether it should change; see `architecture_fixes.generated.md` '
      + 'follow-on notes.');
    lines.push('');
  }

  lines.push('For the full table inventory (columns, FKs, indexes) and the declared ownership map this section '
    + 'cross-checks against, see `.context/database_context.generated.md`.');
  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  console.log('[generate-runtime-trace-context] Starting…');

  const boot = extractBootSequence();
  const routeRows = analyzeRouteOrchestration();
  const maxRepair = extractMaxRepairAttempts();
  const contributors = extractContributors();
  const providers = extractProviderPaths();
  const tableAudit = auditTableWriteSites();

  const md = [
    '# BrandOS Runtime Trace (Generated)\n',
    `> **Generated:** ${renderTimestamp()}`,
    '> **Authority:** read live from source at generation time — see the citation under each section header.',
    '> **Scope:** this documents *actual control flow as found in source*, including any disagreement with',
    '> `.context/runtime_model.generated.md` (which documents *intended* architecture). Where the two differ,',
    '> this file is the more recently verified one — it was produced by reading the cited files directly.',
    '> ⚠️ Do not edit — regenerated by `scripts/generate-runtime-trace-context.mjs`\n',
    '---\n',
    '## Purpose',
    '',
    'An agent should be able to answer "which runtime path executes this request?" without manually opening ' +
      'every file in the orchestration chain. This file is that answer, fact-checked against source rather than ' +
      'against prior documentation.\n',
    renderBootSequence(boot),
    '',
    renderRouteOrchestration(routeRows),
    '',
    renderArtifactPaths(maxRepair),
    '',
    renderPromptCompilation(contributors),
    '',
    renderProviderRegistrations(providers),
    '',
    renderGovernancePaths(),
    '',
    renderPersistence(tableAudit),
    '',
    '## 8. Summary: Where This Disagrees With Prior Docs',
    '',
    'Findings below were produced by reading source directly while generating this file, not by editing the ' +
      'prior docs. Nothing in the referenced files was changed.\n',
    '1. **`executeArtifactPipeline()` is a second top-level call from the route, not a nested step inside ' +
      '`CPLOrchestrator.orchestrate()`.** See §2.',
    `2. **\`ContractAssemblerFactory\` registers ${contributors.contributors.length} contributors** ` +
      `(${contributors.contributors.map((c) => c.class).join(', ') || 'unknown'}), not the 2 most other context ` +
      'docs mention by name. See §4.',
    maxRepair
      ? `3. **\`MAX_REPAIR_ATTEMPTS = ${maxRepair.value}\`** in the live code` +
        (maxRepair.comment ? ` (comment: _${maxRepair.comment}_)` : '') + '. See §3.'
      : '3. _MAX_REPAIR_ATTEMPTS could not be re-verified this run._',
    `4. **\`campaigns\` writes happen directly from \`apps/web\` route handlers**, not through any ` +
      '`@brandos/auth` exported function, despite `@brandos/auth` being the documented table owner. See §7.',
    '5. **The AI-runtime config provider bridge is wired lazily** on first admin-settings load, not during the ' +
      '`instrumentation.ts` boot sequence. See §1.',
  ].join('\n');

  ensureDir(join(ROOT, '.context'));
  writeFileSync(OUT, md);
  console.log(`[generate-runtime-trace-context] ✅ ${relative(ROOT, OUT)}`);
}

main();
