#!/usr/bin/env node
/**
 * scripts/generate-database-context.mjs
 *
 * BrandOS Database Context Generator
 *
 * Generates .context/database_context.generated.md from schema_inventory.json.
 *
 * Authority: schema_inventory.json is the primary database authority.
 * Do not infer schema from code when this file exists.
 *
 * Output includes:
 *   - Table inventory (columns, PKs, FKs, indexes)
 *   - Relationship graph (workspace-rooted tree)
 *   - Database ownership mapping (owner/readers/writers per table)
 *   - Validation report (orphan tables, ownership violations)
 *
 * Usage:
 *   node scripts/generate-database-context.mjs [path/to/schema_inventory.json]
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  ensureDir, renderColumns, renderFKs, renderIndexes, renderTimestamp,
} from './shared/context-utils.mjs';
import { TABLE_OWNERSHIP } from './shared/table-ownership.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT      = resolve(join(__dirname, '..'));
const OUT       = join(ROOT, '.context', 'database_context.generated.md');

// ── Schema inventory loading ──────────────────────────────────────────────────

// ── Schema loading ────────────────────────────────────────────────────────────
// Preferred source: .context/schema_inventory.generated.json (live DB snapshot)
// Fallback:        schema_inventory.json (manual export, legacy)
// Override:        pass path as CLI argument
//
// Handles two JSON shapes:
//   1. New format: { _meta: {...}, tables: [...] }  (from generate-schema-inventory.mjs)
//   2. Legacy raw array: [{ table, columns, ... }, ...]
//   3. Legacy pipe-table format

const GENERATED_SCHEMA = join(ROOT, '.context', 'schema_inventory.generated.json');
const LEGACY_SCHEMA    = join(ROOT, 'schema_inventory.json');

const SCHEMA_PATH = process.argv[2]
  ? resolve(process.argv[2])
  : existsSync(GENERATED_SCHEMA) ? GENERATED_SCHEMA : LEGACY_SCHEMA;

function loadSchema() {
  if (!existsSync(SCHEMA_PATH)) {
    console.warn('[schema] Not found:', SCHEMA_PATH);
    console.warn('[schema] Run: node scripts/generate-schema-inventory.mjs');
    return null;
  }
  const raw = readFileSync(SCHEMA_PATH, 'utf-8').trim();
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) {
    // Legacy pipe-table format
    const m = raw.match(/\|\s*(\[\s*\{[\s\S]+\]\s*)\|/);
    if (m) { try { parsed = JSON.parse(m[1]); } catch (_2) {} }
  }
  if (!parsed) { console.warn('[schema] Could not parse:', SCHEMA_PATH); return null; }
  // New format: { _meta, tables }
  if (!Array.isArray(parsed) && Array.isArray(parsed.tables)) return parsed.tables;
  // Raw array
  if (Array.isArray(parsed)) return parsed;
  // Object wrapping array
  const first = Object.values(parsed)[0];
  if (Array.isArray(first)) return first;
  return null;
}



// ── Relationship graph (workspace-rooted) ─────────────────────────────────────

const RELATIONSHIP_GRAPH = `
\`\`\`
workspaces
├─ users                      (workspace_id FK)
├─ personas                   (workspace_id FK)
├─ campaigns                  (workspace_id FK)
│   └─ feedback               (campaign_id FK)
├─ brand_assets               (workspace_id FK)
├─ workspace_settings         (workspace_id FK — 1:1)
├─ brand_memory_entries       (workspace_id — no FK, text key)
├─ identity_signals           (workspace_id — no FK, text key)
└─ identity_versions          (workspace_id — no FK, text key)

(workspace-scoped telemetry / audit)
├─ brandos_artifact_approvals (workspace_id — text, no FK)
├─ brandos_artifact_versions  (workspace_id — text, no FK)
├─ brandos_governance_audit   (workspace_id — text, no FK)
└─ cp_telemetry               (user_id — no workspace FK)

(global / platform)
├─ brandos_admin_settings     (platform-level, no workspace FK)
├─ brandos_provider_credentials (global, no workspace FK)
└─ brandos_provider_health    (global, no workspace FK)
\`\`\`
`;

// ── Validation ────────────────────────────────────────────────────────────────

function runValidation(tables) {
  const tableNames = new Set(tables.map(t => t.table));
  const ownershipTableNames = new Set(Object.keys(TABLE_OWNERSHIP));

  const orphans = tables
    .filter(t => !TABLE_OWNERSHIP[t.table])
    .map(t => t.table);

  const missingFromSchema = [...ownershipTableNames]
    .filter(name => !tableNames.has(name));

  const violations = [];
  // cp_telemetry_summary is a view — it has no FK structure, flag if unexpected cols appear
  // (Real violation detection would require source scanning — flagged as future work)

  return { orphans, missingFromSchema, violations };
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderOverview(tables) {
  const tableCount = tables.length;
  const fkCount    = tables.reduce((n, t) => n + (t.foreign_keys?.length ?? 0), 0);
  const indexCount = tables.reduce((n, t) => n + (t.indexes?.length ?? 0), 0);

  return [
    '## Database Overview\n',
    '*Derived from: `schema_inventory.json` (live schema export — authoritative source)*\n',
    `| Metric | Count |`,
    `|---|---|`,
    `| Tables (incl. views) | ${tableCount} |`,
    `| Foreign keys | ${fkCount} |`,
    `| Indexes | ${indexCount} |`,
    '',
  ].join('\n');
}

function renderTableDocs(tables) {
  const lines = ['## Table Documentation\n'];
  for (const t of tables) {
    const ownership = TABLE_OWNERSHIP[t.table] ?? { owner: '*(unknown)*', readers: [], writers: [] };
    lines.push(`### \`${t.table}\`\n`);
    lines.push(`**Owner:** ${ownership.owner}`);
    if (ownership.readers.length) lines.push(`**Readers:** ${ownership.readers.join(', ')}`);
    if (ownership.writers.length) lines.push(`**Writers:** ${ownership.writers.join(', ')}`);
    lines.push('');

    lines.push(`**Primary keys:** ${t.primary_keys?.map(k => `\`${k}\``).join(', ') || '*(none)*'}\n`);

    lines.push(`**Columns:**`);
    lines.push(renderColumns(t.columns ?? []));
    lines.push('');

    lines.push(`**Foreign keys:**`);
    lines.push(renderFKs(t.foreign_keys));
    lines.push('');

    lines.push(`**Indexes:**`);
    lines.push(renderIndexes(t.indexes));
    lines.push('');
  }
  return lines.join('\n');
}

function renderOwnershipMap(tables) {
  const lines = ['## Database Ownership Mapping\n'];

  // Group by owner
  const byOwner = {};
  for (const [table, info] of Object.entries(TABLE_OWNERSHIP)) {
    (byOwner[info.owner] = byOwner[info.owner] ?? []).push({ table, ...info });
  }

  lines.push('| Table | Owner | Readers | Writers |');
  lines.push('|---|---|---|---|');
  for (const t of tables) {
    const info = TABLE_OWNERSHIP[t.table];
    if (!info) {
      lines.push(`| \`${t.table}\` | *(unmapped)* | — | — |`);
    } else {
      lines.push(`| \`${t.table}\` | ${info.owner} | ${info.readers.join(', ')} | ${info.writers.join(', ')} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function renderValidation(tables) {
  const { orphans, missingFromSchema, violations } = runValidation(tables);
  const lines = [
    '## Database Validation\n',
    `*Run at generation time against \`schema_inventory.json\`.*\n`,
  ];

  lines.push('### Orphan Tables (in schema, no ownership mapping)\n');
  if (orphans.length === 0) lines.push('*(none — all tables have ownership entries)*');
  else for (const t of orphans) lines.push(`- \`${t}\` — add to TABLE_OWNERSHIP in generate-database-context.mjs`);
  lines.push('');

  lines.push('### Missing Tables (in ownership map, absent from schema)\n');
  if (missingFromSchema.length === 0) lines.push('*(none — schema and ownership map agree)*');
  else for (const t of missingFromSchema) lines.push(`- \`${t}\` — present in ownership map but NOT in schema_inventory.json`);
  lines.push('');

  lines.push('### Ownership Violations\n');
  lines.push('*(Full static-analysis ownership violation detection requires source scanning — planned for future iteration.)*');
  lines.push('');

  lines.push('### Dead Tables (schema present, no code references)\n');
  lines.push('*(Requires source scanning — not implemented in this generator. Run `node scripts/lint-imports.mjs` for reference coverage.)*');
  lines.push('');

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  console.log('[generate-database-context] Starting…');
  const tables = loadSchema();
  ensureDir(join(ROOT, '.context'));

  const md = [
    '# BrandOS Database Context (Generated)\n',
    `> **Generated:** ${renderTimestamp()}`,
    `> **Authority:** \`schema_inventory.json\` (live schema export — supersedes migrations and code)`,
    '> ⚠️ Do not edit — regenerated by `scripts/generate-database-context.mjs`\n',
    '---\n',
    renderOverview(tables),
    renderOwnershipMap(tables),
    '## Relationship Graph\n',
    '*Workspace-rooted entity hierarchy:*\n',
    RELATIONSHIP_GRAPH,
    renderTableDocs(tables),
    renderValidation(tables),
  ].join('\n');

  writeFileSync(OUT, md);
  console.log(`[generate-database-context] ✅ ${tables.length} tables documented`);
}

main();
