#!/usr/bin/env node
/**
 * scripts/generate-claude-bootstrap.mjs
 *
 * BrandOS Claude/Agent Bootstrap Generator (P4.2)
 *
 * Generates CLAUDE_BOOTSTRAP.md at the repository root — the canonical
 * entry point for a new Claude/GPT/Cursor agent working on BrandOS.
 *
 * Unlike every other generator in scripts/, this one does not read source
 * code or run other scripts. It only synthesizes the ten artifacts the
 * P3.5/P4.1 architecture-intelligence layer already produced:
 *
 *   .context/agent_entrypoints.generated.md
 *   .context/runtime_trace.generated.md
 *   .context/architecture_graph.generated.json
 *   .context/dependency_impact.generated.json
 *   .context/behavior_contracts.generated.json
 *   .context/monorepo_context.generated.md
 *   .context/runtime_model.generated.md
 *   .context/system_inventory.generated.md
 *   .context/database_context.generated.md
 *   .context/packages/*.generated.md
 *
 * Every number, package name, file path, and rule quoted in the output is
 * extracted from one of the above at generation time — nothing is
 * hardcoded (the few literal strings in this file are markdown section
 * titles and the fixed reading-order list the P4.2 spec itself prescribes,
 * not architecture facts).
 *
 * Usage: node scripts/generate-claude-bootstrap.mjs
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve, relative, basename } from 'path';
import { fileURLToPath } from 'url';

import { KNOWN_PACKAGES } from './shared/package-registry.mjs';
import { renderTimestamp } from './shared/context-utils.mjs';
import { walkSourceFiles } from './shared/fs-utils.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(join(__dirname, '..'));
const OUT = join(ROOT, 'CLAUDE_BOOTSTRAP.md');

const CTX = (rel) => join(ROOT, '.context', rel);

function readText(rel) {
  try { return readFileSync(CTX(rel), 'utf8'); } catch { return null; }
}

function readJson(rel) {
  try { return JSON.parse(readFileSync(CTX(rel), 'utf8')); } catch { return null; }
}

// ── Load every input once ──────────────────────────────────────────────

function loadInputs() {
  return {
    agentEntrypoints: readText('agent_entrypoints.generated.md'),
    runtimeTrace: readText('runtime_trace.generated.md'),
    architectureGraph: readJson('architecture_graph.generated.json'),
    dependencyImpact: readJson('dependency_impact.generated.json'),
    behaviorContracts: readJson('behavior_contracts.generated.json'),
    monorepoContext: readText('monorepo_context.generated.md'),
    runtimeModel: readText('runtime_model.generated.md'),
    systemInventory: readText('system_inventory.generated.md'),
    databaseContext: readText('database_context.generated.md'),
  };
}

function loadPackageDocs() {
  const dir = CTX('packages');
  const docs = {};
  if (!existsSync(dir)) return docs;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.generated.md')) continue;
    const slug = file.replace('.generated.md', '');
    docs[slug] = readFileSync(join(dir, file), 'utf8');
  }
  return docs;
}

// ── Section 1: Overview ────────────────────────────────────────────────

function buildOverview(inputs) {
  const lines = ['## Overview', ''];
  const packages = inputs.architectureGraph?.packages ?? [];
  const apps = packages.filter((p) => p.isApp);
  const libs = packages.filter((p) => !p.isApp);
  const layers = new Set(packages.map((p) => p.layer).filter(Boolean));
  const impactPkgs = inputs.dependencyImpact?.packages ?? {};
  const criticalNames = Object.entries(impactPkgs)
    .filter(([, v]) => v.riskLevel === 'critical')
    .map(([k]) => k)
    .sort();

  lines.push(`- **Packages:** ${libs.length} libraries + ${apps.length} application${apps.length === 1 ? '' : 's'} = ${packages.length} total`);
  lines.push(`- **Architectural layers:** ${layers.size} (L0–L${Math.max(...[...layers].map((l) => Number(String(l).replace('L', '')) || 0))})`);
  lines.push(`- **Critical packages:** ${criticalNames.length ? criticalNames.map((n) => `\`${n}\``).join(', ') : '(none currently flagged critical)'}`);
  lines.push(`- **Behavior contracts tracked:** ${inputs.behaviorContracts?.contracts?.length ?? 'unknown'}`);
  lines.push(`- **Generated:** ${renderTimestamp()}`);
  lines.push('');
  lines.push('This document is itself generated — see `scripts/generate-claude-bootstrap.mjs`. It synthesizes '
    + 'the architecture-intelligence layer below; it does not replace any single file in it.');
  return lines.join('\n');
}

// ── Section 2: Required Reading Order ──────────────────────────────────

const READING_ORDER = [
  { n: 1, rel: 'monorepo_context.generated.md', label: 'monorepo_context' },
  { n: 2, rel: 'system_inventory.generated.md', label: 'system_inventory' },
  { n: 3, rel: 'runtime_model.generated.md', label: 'runtime_model' },
  { n: 4, rel: 'runtime_trace.generated.md', label: 'runtime_trace' },
  { n: 5, rel: 'architecture_graph.generated.json', label: 'architecture_graph' },
  { n: 6, rel: 'dependency_impact.generated.json', label: 'dependency_impact' },
  { n: 7, rel: 'behavior_contracts.generated.json', label: 'behavior_contracts' },
  { n: 8, rel: 'agent_entrypoints.generated.md', label: 'agent_entrypoints' },
];

function buildReadingOrder() {
  const lines = ['## Required Reading Order', '',
    'Read in this order. Each entry is checked for existence at generation time — a missing file means the '
    + 'context-generation pipeline has not been run, not that the step should be skipped.', ''];
  for (const { n, rel, label } of READING_ORDER) {
    const exists = existsSync(CTX(rel));
    lines.push(`${n}. ${exists ? '✅' : '⚠️ MISSING —'} \`.context/${rel}\` (${label})`);
  }
  const pkgDirExists = existsSync(CTX('packages'));
  const pkgCount = pkgDirExists ? readdirSync(CTX('packages')).filter((f) => f.endsWith('.generated.md')).length : 0;
  lines.push(`9. ${pkgDirExists ? '✅' : '⚠️ MISSING —'} \`.context/packages/<package>.generated.md\` — package-specific context (${pkgCount} available; read the one(s) you're about to touch)`);
  return lines.join('\n');
}

// ── Section 3: Runtime Flow ─────────────────────────────────────────────

function buildRuntimeFlow(inputs) {
  const lines = ['## Runtime Flow', ''];
  const trace = inputs.runtimeTrace;
  if (!trace) {
    lines.push('_`.context/runtime_trace.generated.md` not found — run `node scripts/generate-runtime-trace-context.mjs` first._');
    return lines.join('\n');
  }

  lines.push('Extracted from `runtime_trace.generated.md`, which is itself generated by reading source live — '
    + 'this is the actual call graph, not a description of intent.');
  lines.push('');

  const bothMatch = /Routes calling both.*?:\s*(\d+)/.exec(trace);
  const onlyCplMatch = /Routes calling only `runControlPlane\(\)`.*?:\s*(\d+)/.exec(trace);
  const repairMatch = /Repair ceiling \(live value\): `MAX_REPAIR_ATTEMPTS = (\d+)`/.exec(trace);
  const contributorsMatch = /`ContractAssemblerFactory` registers (\d+) contributors/.exec(trace);

  if (bothMatch) lines.push(`- **${bothMatch[1]}** route(s) run the full pipeline: \`runControlPlane()\` then \`executeArtifactPipeline()\` (two sequential top-level calls, not nested).`);
  if (onlyCplMatch) lines.push(`- **${onlyCplMatch[1]}** route(s) run free-text generation only (\`runControlPlane()\`, governed by \`evaluateGovernance()\` inline, no structured artifact pipeline).`);
  if (contributorsMatch) lines.push(`- Prompt assembly runs **${contributorsMatch[1]} contributors** per request via \`ContractAssemblerFactory\` (no startup singleton — assembled fresh every call).`);
  if (repairMatch) lines.push(`- Governance repair loop ceiling: **${repairMatch[1]} attempts** (\`MAX_REPAIR_ATTEMPTS\`) before a structured artifact fails outright.`);

  const summaryMatch = /## 8\. Summary: Where This Disagrees With Prior Docs\s*\n\s*\n.*?\n\n([\s\S]*?)(?=\n##|(?![\s\S]))/.exec(trace);
  if (summaryMatch) {
    lines.push('');
    lines.push('**Where the live trace disagrees with other docs** (see `runtime_trace.generated.md` §8 for full citations):');
    lines.push('');
    lines.push(summaryMatch[1].trim());
  }
  return lines.join('\n');
}

// ── Section 4: Critical Packages ────────────────────────────────────────

function buildCriticalPackages(inputs) {
  const lines = ['## Critical Packages', ''];
  const impact = inputs.dependencyImpact?.packages;
  if (!impact) {
    lines.push('_`.context/dependency_impact.generated.json` not found — run `node scripts/generate-dependency-impact.mjs` first._');
    return lines.join('\n');
  }

  const entries = Object.entries(impact);
  const byConsumers = [...entries].sort((a, b) => b[1].transitiveConsumers.length - a[1].transitiveConsumers.length)[0];
  const byBlastRadius = [...entries].sort((a, b) => b[1].affectedPackages.length - a[1].affectedPackages.length)[0];
  const critical = entries.filter(([, v]) => v.riskLevel === 'critical').sort((a, b) => a[0].localeCompare(b[0]));

  lines.push(`- **Highest consumer count:** \`${byConsumers[0]}\` — ${byConsumers[1].transitiveConsumers.length} package(s) transitively depend on it.`);
  lines.push(`- **Highest blast radius:** \`${byBlastRadius[0]}\` — ${byBlastRadius[1].affectedPackages.length} package(s) would be affected by a breaking change.`);
  lines.push('');
  lines.push('**Risk level `critical`** (see `dependency_impact.generated.json` `_meta.methodology` for the exact formula):');
  lines.push('');
  lines.push('| Package | Score | Transitive consumers | Direct deps | Routing chokepoint |');
  lines.push('|---|---|---|---|---|');
  for (const [name, v] of critical) {
    const f = v.riskFactors;
    lines.push(`| \`${name}\` | ${f.score} | ${f.transitiveConsumerCount} | ${f.directDependencyCount} | ${f.isRoutingChokepoint ? 'yes' : 'no'} |`);
  }
  return lines.join('\n');
}

// ── Section 5: Top 10 High-Risk Files ───────────────────────────────────
//
// Combines three independent generated signals, none of which alone names
// individual files at this granularity:
//   - dependency_impact.generated.json  -> the owning package's blast-radius score
//   - runtime_trace.generated.md        -> files actually on a live execution path
//   - architecture_graph.generated.json `restrictions` (+ agent_entrypoints.generated.md
//     "High-Risk Areas", itself sourced from each package's AGENT_CONTEXT.md)
//                                        -> files named in an explicit human-authored
//                                           restriction, with a bonus if that restriction
//                                           is a hard "no-touch" rule
//
// A file mentioned by more of these three independent sources, and owned by
// a higher-blast-radius package, ranks higher. The formula is printed in the
// output, not hidden.

const FILE_TOKEN_RE = () => /`([a-zA-Z0-9_./@-]+\.(?:ts|tsx|mjs|js))`/g;
const NO_TOUCH_RE = /no-touch|read-only|hard no-touch|must not (?:be )?(?:modif|edit|touch)/i;

function buildFileIndex() {
  const index = new Map(); // basename -> [{path, pkg}]
  for (const { name, dir, app } of KNOWN_PACKAGES) {
    const candidateDirs = app ? [join(ROOT, dir, 'app'), join(ROOT, dir, 'lib')] : [join(ROOT, dir, 'src')];
    for (const d of candidateDirs) {
      if (!existsSync(d)) continue;
      for (const f of walkSourceFiles(d)) {
        const rel = relative(ROOT, f);
        const base = basename(f);
        if (!index.has(base)) index.set(base, []);
        index.get(base).push({ path: rel, pkg: name });
      }
    }
  }
  return index;
}

function packageNamesIn(text) {
  return [...new Set([...text.matchAll(/@brandos\/[\w-]+/g)].map((m) => m[0]))];
}

// Returns the package name scoping a bare filename mention in
// runtime_trace.generated.md, which is organized into "## N. Section Title
// (`@brandos/x`)" sections rather than per-package blocks. Prefers the
// package named in the *enclosing section heading* (the document's own
// scope boundary, which can be over a thousand characters away from a late
// mention within a long section) before falling back to the nearest
// @brandos/ mention in the immediately preceding text.
function nearbyPackageHint(text, index) {
  const headingIdx = text.lastIndexOf('\n## ', index);
  if (headingIdx !== -1) {
    const lineEnd = text.indexOf('\n', headingIdx + 1);
    const headingLine = text.slice(headingIdx, lineEnd === -1 ? undefined : lineEnd);
    const headingMatch = /@brandos\/[\w-]+/.exec(headingLine);
    if (headingMatch) return headingMatch[0];
  }
  const window = text.slice(Math.max(0, index - 400), index);
  const matches = [...window.matchAll(/@brandos\/[\w-]+/g)];
  return matches.length ? matches[matches.length - 1][0] : null;
}

// `scopeCandidates`: package names to try, in priority order, used only to
// disambiguate when more than one real file structurally matches `token`.
// A dropped (null) mention is preferable to a confidently wrong one in a
// high-risk-files list — this never guesses among multiple structural
// matches without a scope hint that actually resolves one of them.
function resolveMention(token, scopeCandidates, fileIndex) {
  if (token.includes('/') && existsSync(join(ROOT, token))) return token;

  const scopes = scopeCandidates.filter(Boolean);
  const base = basename(token);
  const candidates = fileIndex.get(base) ?? [];
  // For a token with a relative path component (e.g. "src/index.ts" or
  // "config/factory.ts"), only candidates whose full path actually ends
  // with that relative path are structural matches — this is what stops a
  // generic suffix like "src/index.ts" from matching whichever package
  // happens to be first in registry order before scope is even consulted.
  const structural = token.includes('/')
    ? candidates.filter((c) => c.path.endsWith(`/${token}`) || c.path === token)
    : candidates;

  if (structural.length === 1) return structural[0].path;
  if (structural.length === 0) return null;

  for (const scope of scopes) {
    const hit = structural.find((c) => c.pkg === scope);
    if (hit) return hit.path;
  }
  return null;
}

function collectFileMentions(inputs, fileIndex) {
  const mentions = [];

  if (inputs.runtimeTrace) {
    const text = inputs.runtimeTrace;
    for (const m of text.matchAll(FILE_TOKEN_RE())) {
      const hint = nearbyPackageHint(text, m.index);
      const resolved = resolveMention(m[1], [hint], fileIndex);
      if (resolved) mentions.push({ file: resolved, source: 'runtime_trace', noTouch: false });
    }
  }

  if (inputs.architectureGraph?.packages) {
    for (const pkg of inputs.architectureGraph.packages) {
      for (const restriction of pkg.restrictions ?? []) {
        // Try the restriction's own package first — that's the reliable
        // signal in the common case. Any other package named in the text
        // is only a fallback, because a restriction can name another
        // package as the *object* of the rule rather than the file's
        // location (e.g. presentation-layer's restriction "must NOT
        // re-export @brandos/auth symbols from src/index.ts" is about
        // presentation-layer's own index.ts, not auth's).
        const scopes = [pkg.package, ...packageNamesIn(restriction)];
        for (const m of restriction.matchAll(FILE_TOKEN_RE())) {
          const resolved = resolveMention(m[1], scopes, fileIndex);
          if (resolved) mentions.push({ file: resolved, source: 'architectural_restrictions', noTouch: NO_TOUCH_RE.test(restriction) });
        }
      }
    }
  }

  if (inputs.agentEntrypoints) {
    const blockRe = /^## (@brandos\/[\w-]+)\s*\n([\s\S]*?)(?=\n## |(?![\s\S]))/gm;
    for (const bm of inputs.agentEntrypoints.matchAll(blockRe)) {
      const pkg = bm[1];
      const hrMatch = /\*\*High-Risk Areas\*\*.*?\n([\s\S]*?)(?=\n\*\*|(?![\s\S]))/.exec(bm[2]);
      if (!hrMatch) continue;
      for (const m of hrMatch[1].matchAll(FILE_TOKEN_RE())) {
        const scopes = [pkg, ...packageNamesIn(hrMatch[1])];
        const resolved = resolveMention(m[1], scopes, fileIndex);
        if (resolved) mentions.push({ file: resolved, source: 'architectural_restrictions', noTouch: NO_TOUCH_RE.test(hrMatch[1]) });
      }
    }
  }

  return mentions;
}

function ownerOf(file) {
  for (const { name, dir } of KNOWN_PACKAGES) {
    if (file.startsWith(`${dir}/`)) return name;
  }
  return null;
}

function buildTopHighRiskFiles(inputs) {
  const lines = ['## Top 10 High-Risk Files', '',
    'Derived by combining three independent generated signals: the owning package\'s blast-radius score '
    + '(`dependency_impact.generated.json`), whether the file sits on a live execution path '
    + '(`runtime_trace.generated.md`), and whether the file is named in an explicit architectural '
    + 'restriction (`architecture_graph.generated.json` + `agent_entrypoints.generated.md`, the latter '
    + 'itself sourced from each package\'s `AGENT_CONTEXT.md`).', '',
    '`score = ownerBlastRadiusScore + 10 × (number of independent sources mentioning the file) + 25 if the file is named in a hard "no-touch" restriction`', ''];

  if (!inputs.dependencyImpact?.packages || !inputs.architectureGraph?.packages) {
    lines.push('_Required inputs missing — run the architecture-graph and dependency-impact generators first._');
    return lines.join('\n');
  }

  const fileIndex = buildFileIndex();
  const mentions = collectFileMentions(inputs, fileIndex);

  const byFile = new Map();
  for (const m of mentions) {
    if (!byFile.has(m.file)) byFile.set(m.file, { file: m.file, sources: new Set(), noTouch: false });
    const e = byFile.get(m.file);
    e.sources.add(m.source);
    if (m.noTouch) e.noTouch = true;
  }

  const impact = inputs.dependencyImpact.packages;
  const ranked = [...byFile.values()].map((e) => {
    const owner = ownerOf(e.file);
    const ownerImpact = owner ? impact[owner] : null;
    const ownerScore = ownerImpact?.riskFactors?.score ?? 0;
    const ownerRisk = ownerImpact?.riskLevel ?? 'unknown';
    const score = ownerScore + 10 * e.sources.size + (e.noTouch ? 25 : 0);
    return { file: e.file, owner, ownerRisk, sources: [...e.sources].sort(), noTouch: e.noTouch, score };
  }).sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

  const top = ranked.slice(0, 10);
  if (!top.length) {
    lines.push('_No file-level mentions resolved across the scanned sources this run._');
    return lines.join('\n');
  }

  lines.push('| # | File | Owner | Owner risk | Sources | No-touch | Score |');
  lines.push('|---|---|---|---|---|---|---|');
  top.forEach((r, i) => {
    lines.push(`| ${i + 1} | \`${r.file}\` | ${r.owner ?? '_unresolved_'} | ${r.ownerRisk} | ${r.sources.join(', ')} | ${r.noTouch ? '⚠️ yes' : 'no'} | ${r.score} |`);
  });
  return lines.join('\n');
}

// ── Section 6: Package Ownership Summary ───────────────────────────────

function firstSentence(text) {
  if (!text) return null;
  const cleaned = text.trim().split('\n')[0];
  const m = /^(.*?[.!?])(\s|$)/.exec(cleaned);
  return (m ? m[1] : cleaned).trim();
}

function extractPackagePurpose(pkgDoc) {
  const m = /^## Package Purpose\s*\n+([\s\S]*?)(?=\n## |(?![\s\S]))/m.exec(pkgDoc ?? '');
  if (!m) return null;
  return firstSentence(m[1]);
}

function buildOwnershipSummary(inputs, packageDocs) {
  const lines = ['## Package Ownership Summary', '',
    'One-line purpose per package, extracted from the first sentence of each package\'s own '
    + '`AGENT_CONTEXT.md` "Package Purpose" section (embedded in `.context/packages/<pkg>.generated.md`).', ''];

  const packages = inputs.architectureGraph?.packages ?? [];
  if (!packages.length) {
    lines.push('_`.context/architecture_graph.generated.json` not found._');
    return lines.join('\n');
  }

  const rows = packages.map((p) => {
    const slug = p.dir.split('/').pop();
    const purpose = extractPackagePurpose(packageDocs[slug]) ?? '_(no Package Purpose section found)_';
    return { name: p.package, layer: p.layer, purpose };
  });

  lines.push('| Package | Layer | Purpose |');
  lines.push('|---|---|---|');
  for (const r of rows) lines.push(`| \`${r.name}\` | ${r.layer ?? '?'} | ${r.purpose} |`);
  return lines.join('\n');
}

// ── Section 7: Architectural Rules ──────────────────────────────────────

function parseMonorepoRules(monorepoContext) {
  if (!monorepoContext) return [];
  const rules = [];
  const re = /^### `([^`]+)`\s*\n\*\*Source:\*\* (.+?)\s*\n\n([\s\S]*?)(?=\n### `|\n## |(?![\s\S]))/gm;
  for (const m of monorepoContext.matchAll(re)) {
    const [, id, source, body] = m;
    const detailMatch = /^>\s*(.+)$/m.exec(body);
    const description = body.replace(/^>\s*.+$/m, '').trim();
    rules.push({ id, source, description, detail: detailMatch ? detailMatch[1] : '' });
  }
  return rules;
}

function buildArchitecturalRules(inputs) {
  const lines = ['## Architectural Rules', '',
    'Highest-value restrictions, selected automatically from `monorepo_context.generated.md` by how many '
    + '`critical`/`high` risk packages (per `dependency_impact.generated.json`) each rule concerns — not a '
    + 'fixed editorial list. Full rule set: `monorepo_context.generated.md` § Architectural Rules.', ''];

  const rules = parseMonorepoRules(inputs.monorepoContext);
  const impact = inputs.dependencyImpact?.packages ?? {};
  const notableRisk = new Set(Object.entries(impact)
    .filter(([, v]) => v.riskLevel === 'critical' || v.riskLevel === 'high')
    .map(([k]) => k));

  const UNIVERSAL = new Set(['RULE-LAYER-ORDER', 'RULE-SAME-LEVEL-PEERS']);
  const scored = rules
    .filter((r) => !UNIVERSAL.has(r.id))
    .map((r) => {
      const text = `${r.id} ${r.description} ${r.detail}`;
      const hits = [...notableRisk].filter((pkg) => text.includes(pkg));
      return { ...r, score: hits.length };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 8);

  if (scored.length) {
    for (const r of scored) lines.push(`- **\`${r.id}\`** — ${r.description}`);
  } else if (rules.length) {
    lines.push('_No rule text matched a critical/high-risk package by name this run — showing all rules instead:_');
    for (const r of rules.slice(0, 8)) lines.push(`- **\`${r.id}\`** — ${r.description}`);
  } else {
    lines.push('_`.context/monorepo_context.generated.md` not found or its rules section could not be parsed._');
  }

  // Derived facts: foundational packages (zero deps + broad consumer fan-out)
  // are a structural fact, not one of the named rules, computed the same way
  // a human reading the graph would notice it.
  const packages = inputs.architectureGraph?.packages ?? [];
  const foundational = packages.filter((p) => (p.dependsOn?.length ?? 1) === 0 && (impact[p.package]?.transitiveConsumers?.length ?? 0) >= 5);
  if (foundational.length) {
    lines.push('');
    lines.push('**Derived (not a named rule, computed from the dependency graph):**');
    for (const p of foundational) {
      const consumerCount = impact[p.package]?.transitiveConsumers?.length ?? 0;
      lines.push(`- \`${p.package}\` depends on nothing and is depended on by ${consumerCount} other package(s) — the canonical authority for whatever it exports.`);
    }
  }

  return lines.join('\n');
}

// ── Section 8: Agent Workflow ────────────────────────────────────────────

function buildAgentWorkflow(inputs) {
  const lines = ['## Agent Workflow', ''];
  const hasFixes = existsSync(CTX('architecture_fixes.generated.md'));
  lines.push('1. Read this document.');
  lines.push('2. Read `.context/packages/<package>.generated.md` for the package you are about to touch.');
  lines.push('3. Read `.context/dependency_impact.generated.json` for that package — know the blast radius before changing anything.');
  lines.push('4. Read `.context/behavior_contracts.generated.json` for any cross-package contract your change affects.');
  lines.push('5. Implement the change.');
  lines.push(`6. Validate: \`node scripts/check-boundaries.mjs\`, \`node scripts/check-workspace.mjs\`${hasFixes ? ', and review `.context/architecture_fixes.generated.md` for any newly introduced violation' : ''}.`);
  lines.push('7. Run `pnpm context:refresh` so `.context/` and this document reflect the change for the next agent.');
  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  console.log('[generate-claude-bootstrap] Starting…');

  const inputs = loadInputs();
  const packageDocs = loadPackageDocs();

  const missing = [];
  if (!inputs.architectureGraph) missing.push('architecture_graph.generated.json');
  if (!inputs.dependencyImpact) missing.push('dependency_impact.generated.json');
  if (missing.length) {
    console.warn(`[generate-claude-bootstrap] ⚠️  Missing required input(s): ${missing.join(', ')} — affected sections will note this inline.`);
  }

  const md = [
    '# CLAUDE_BOOTSTRAP.md (Generated)\n',
    `> **Generated:** ${renderTimestamp()}`,
    '> **Authority:** synthesized from `.context/*.generated.*` — see `scripts/generate-claude-bootstrap.mjs`.',
    '> This is the canonical entry point for a new Claude/GPT/Cursor agent working on BrandOS. It is a',
    '> *synthesis*, not a replacement — every section cites the generated artifact it was derived from so',
    '> you can go straight to the source for more detail.',
    '> ⚠️ Do not edit by hand — regenerated by `node scripts/generate-claude-bootstrap.mjs`\n',
    '---\n',
    buildOverview(inputs),
    '',
    buildReadingOrder(),
    '',
    buildRuntimeFlow(inputs),
    '',
    buildCriticalPackages(inputs),
    '',
    buildTopHighRiskFiles(inputs),
    '',
    buildOwnershipSummary(inputs, packageDocs),
    '',
    buildArchitecturalRules(inputs),
    '',
    buildAgentWorkflow(inputs),
  ].join('\n');

  writeFileSync(OUT, md);
  console.log(`[generate-claude-bootstrap] ✅ ${relative(ROOT, OUT)}`);
}

main();
