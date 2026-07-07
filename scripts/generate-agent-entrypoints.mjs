#!/usr/bin/env node
/**
 * scripts/generate-agent-entrypoints.mjs
 *
 * BrandOS Agent Entrypoints Context Generator (P3.5 — Deliverable 6)
 *
 * Generates .context/agent_entrypoints.generated.md — for every package, a
 * single block telling a newly spawned agent exactly where to start:
 * what to read first, its public API, what it may/may not depend on, what
 * tables it owns, which areas are documented as risky to change, what kinds
 * of tasks are normal here, who consumes it, and which architectural rules
 * apply.
 *
 * Every field is derived from an existing authority — nothing here is a
 * new source of truth:
 *
 *   - Read First            <- .context/packages/<slug>.generated.md (already exists)
 *   - Public APIs           <- scripts/shared/inventory.mjs (package.json + src/index.ts)
 *   - Allowed Dependencies  <- declared @brandos deps (package.json)
 *   - Forbidden Dependencies<- scripts/shared/forbidden-deps.mjs (mirrors lint-imports.mjs)
 *   - Owned Tables          <- scripts/shared/table-ownership.mjs
 *   - High-Risk Areas       <- each package's own AGENT_CONTEXT.md, "## Dangerous Changes"
 *   - Typical Tasks         <- each package's own AGENT_CONTEXT.md, "## Agent Instructions"
 *                              (falls back to "## Safe Changes" if Agent Instructions is empty)
 *   - Consumers             <- scripts/shared/inventory.mjs (dependent map)
 *   - Architectural Rules   <- scripts/shared/rule-applicability.mjs (ARCH_RULES)
 *
 * AGENT_CONTEXT.md per package is hand-authored, pre-existing, and already
 * consumed verbatim by generate-package-contexts.mjs — this generator reads
 * the same files and extracts two specific sections from them as structured
 * fields rather than asking an agent to re-read the whole document for
 * those two facts every time.
 *
 * Usage: node scripts/generate-agent-entrypoints.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

import { ensureDir, renderTimestamp } from './shared/context-utils.mjs';
import { buildPackageInventory, buildDependentMap } from './shared/inventory.mjs';
import { TABLE_OWNERSHIP } from './shared/table-ownership.mjs';
import { PACKAGE_RESTRICTIONS } from './shared/package-restrictions.mjs';
import { ARCH_RULES } from './shared/architecture-rules.mjs';
import { rulesFor } from './shared/rule-applicability.mjs';
import { forbiddenDependenciesFor } from './shared/forbidden-deps.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(join(__dirname, '..'));
const OUT = join(ROOT, '.context', 'agent_entrypoints.generated.md');

function readSafe(absPath) {
  try { return readFileSync(absPath, 'utf8'); } catch { return null; }
}

function slugOf(dir) {
  return dir.split('/').pop();
}

// ── AGENT_CONTEXT.md section extraction ────────────────────────────────

function extractSection(src, heading) {
  if (!src) return [];
  const lines = src.split('\n');
  const startIdx = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (startIdx === -1) return [];
  const items = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+\S/.test(lines[i])) break; // next section
    const bullet = /^\s*[-*]\s+(.+)/.exec(lines[i]) || /^\s*\d+\.\s+(.+)/.exec(lines[i]);
    if (bullet) items.push(bullet[1].trim());
  }
  return items;
}

function highRiskAreasFor(agentContextSrc) {
  return extractSection(agentContextSrc, 'Dangerous Changes');
}

function typicalTasksFor(agentContextSrc) {
  const instructions = extractSection(agentContextSrc, 'Agent Instructions');
  if (instructions.length) return { items: instructions, source: 'Agent Instructions' };
  const safe = extractSection(agentContextSrc, 'Safe Changes');
  return { items: safe, source: 'Safe Changes' };
}

// ── Table ownership lookup ──────────────────────────────────────────────

function ownedTablesFor(pkgName) {
  return Object.entries(TABLE_OWNERSHIP)
    .filter(([, info]) => info.owner === pkgName)
    .map(([table]) => table)
    .sort();
}

// ── Rendering ────────────────────────────────────────────────────────────

function truncatedList(items, max) {
  if (items.length <= max) return items.map((i) => `- \`${i}\``).join('\n');
  const shown = items.slice(0, max).map((i) => `- \`${i}\``).join('\n');
  return `${shown}\n- _...and ${items.length - max} more — full list in \`.context/architecture_graph.generated.json\`_`;
}

function renderPackageBlock({ name, dir, app, deps, exports }, dependentMap) {
  const slug = slugOf(dir);
  const agentContextPath = join(dir, 'AGENT_CONTEXT.md');
  const agentContextSrc = readSafe(join(ROOT, agentContextPath));
  const hasAgentContext = existsSync(join(ROOT, agentContextPath));
  const hasPackageDoc = existsSync(join(ROOT, '.context', 'packages', `${slug}.generated.md`));

  const consumers = [...(dependentMap[name] ?? [])].sort();
  const forbidden = forbiddenDependenciesFor(name);
  const owned = ownedTablesFor(name);
  const highRisk = highRiskAreasFor(agentContextSrc);
  const tasks = typicalTasksFor(agentContextSrc);
  const restrictions = PACKAGE_RESTRICTIONS[name] ?? [];
  const rules = rulesFor(name, dir, ARCH_RULES);

  const lines = [`## ${name}`, ''];

  lines.push('**Read First:**');
  if (hasPackageDoc) lines.push(`- \`.context/packages/${slug}.generated.md\``);
  if (hasAgentContext) lines.push(`- \`${agentContextPath}\``);
  if (!hasPackageDoc && !hasAgentContext) lines.push('- _(no generated package doc or AGENT_CONTEXT.md found)_');
  lines.push('');

  lines.push(`**Public APIs** (${exports.length} export${exports.length === 1 ? '' : 's'}):`);
  lines.push(app ? '- _(app package — no src/index.ts public API surface)_' : (exports.length ? truncatedList(exports, 12) : '- _(none exported)_'));
  lines.push('');

  lines.push('**Allowed Dependencies** (declared `@brandos/*` deps):');
  lines.push(deps.length ? deps.map((d) => `- \`${d}\``).join('\n') : '- _(none — foundational package)_');
  lines.push('');

  lines.push('**Forbidden Dependencies** (RULE-LAYER-ORDER — everything at a higher tier):');
  lines.push(forbidden.length ? truncatedList(forbidden, 10) : '- _(none — top of the dependency order)_');
  lines.push('');

  lines.push('**Owned Tables:**');
  lines.push(owned.length ? owned.map((t) => `- \`${t}\``).join('\n') : '- _(owns no tables)_');
  lines.push('');

  lines.push('**High-Risk Areas** _(from `AGENT_CONTEXT.md` → "Dangerous Changes")_:');
  lines.push(highRisk.length ? highRisk.map((h) => `- ${h}`).join('\n') : '- _(none documented)_');
  lines.push('');

  lines.push(`**Typical Tasks** _(from \`AGENT_CONTEXT.md\` → "${tasks.source}")_:`);
  lines.push(tasks.items.length ? tasks.items.map((t) => `- ${t}`).join('\n') : '- _(none documented)_');
  lines.push('');

  lines.push(`**Consumers** (${consumers.length} direct):`);
  lines.push(consumers.length ? consumers.map((c) => `- \`${c}\``).join('\n') : '- _(none — nothing in this repo imports it)_');
  lines.push('');

  lines.push('**Architectural Rules:**');
  lines.push(rules.map((id) => `- \`${id}\``).join('\n'));
  if (restrictions.length) {
    lines.push('');
    lines.push('_Named restrictions (from `scripts/shared/package-restrictions.mjs`):_');
    lines.push(restrictions.map((r) => `- ${r}`).join('\n'));
  }

  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  console.log('[generate-agent-entrypoints] Starting…');

  const inventory = buildPackageInventory(ROOT);
  const dependentMap = buildDependentMap(inventory);

  const blocks = inventory.map((pkg) => renderPackageBlock(pkg, dependentMap));

  const md = [
    '# BrandOS Agent Entrypoints (Generated)\n',
    `> **Generated:** ${renderTimestamp()}`,
    '> **Authority:** `scripts/shared/package-registry.mjs` (deps/layers) · `packages/*/AGENT_CONTEXT.md` '
      + '("Dangerous Changes" / "Agent Instructions") · `scripts/shared/table-ownership.mjs` · '
      + '`scripts/shared/architecture-rules.mjs`',
    '> ⚠️ Do not edit — regenerated by `scripts/generate-agent-entrypoints.mjs`\n',
    '---\n',
    '## Purpose',
    '',
    'A newly spawned agent should be able to read this file, pick the package it needs to touch, and know '
      + 'exactly where to start — without first reconstructing ownership, dependency direction, or risk areas '
      + 'from source. Every field below cites the existing file it was derived from; nothing here is a new '
      + 'authority.\n',
    '## Index',
    '',
    inventory.map(({ name }) => `- [${name}](#${name.replace(/[@/]/g, '').toLowerCase()})`).join('\n'),
    '',
    '---\n',
    blocks.join('\n\n---\n\n'),
  ].join('\n');

  ensureDir(join(ROOT, '.context'));
  writeFileSync(OUT, md);
  console.log(`[generate-agent-entrypoints] ✅ ${relative(ROOT, OUT)} (${inventory.length} packages)`);
}

main();
