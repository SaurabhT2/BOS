// generate-schema-inventory.mjs
// BrandOS Live Schema Inventory Generator
//
// Connects directly to the live PostgreSQL database and generates:
//   .context/schema_inventory.generated.json   (authoritative schema snapshot)
//   .context/schema-validation.generated.md    (validation report)
//
// Authority: live PostgreSQL information_schema + pg_indexes.
// Do NOT derive schema from migrations or source code.
//
// Connection resolution order (first found wins):
//   1. DATABASE_URL        env var
//   2. SUPABASE_DB_URL     env var
//   3. Derived from NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//      (Supabase session-mode pooler on port 5432)
//
// Env files loaded (in order, later values win):
//   .env  ->  .env.local  ->  .env.production
//
// Usage:
//   node scripts/generate-schema-inventory.mjs
//   node scripts/generate-schema-inventory.mjs --env .env.staging
//   node scripts/generate-schema-inventory.mjs --out path/to/output.json
//
// Prerequisite (one-time):
//   pnpm add -D pg --filter=@brandos/scripts
//   — or —
//   npm install pg --save-dev   (in repo root)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT      = resolve(join(__dirname, '..'));
const OUT_DIR   = join(ROOT, '.context');
const OUT_JSON  = join(OUT_DIR, 'schema_inventory.generated.json');
const OUT_VAL   = join(OUT_DIR, 'schema-validation.generated.md');

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const envFlag  = args.indexOf('--env');
const outFlag  = args.indexOf('--out');
const extraEnv = envFlag !== -1 ? args[envFlag + 1] : null;
const outFile  = outFlag !== -1 ? resolve(args[outFlag + 1]) : OUT_JSON;

// ── Env file loader ───────────────────────────────────────────────────────────
// Minimal dotenv implementation — no external dependency.
// Supports quoted values, inline comments, and multiline values.

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const src = readFileSync(filePath, 'utf-8');
  const result = {};
  for (const rawLine of src.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Strip inline comments (outside of quoted strings)
    if (val.startsWith('"')) {
      const close = val.indexOf('"', 1);
      val = close !== -1 ? val.slice(1, close) : val.slice(1);
    } else if (val.startsWith("'")) {
      const close = val.indexOf("'", 1);
      val = close !== -1 ? val.slice(1, close) : val.slice(1);
    } else {
      const commentIdx = val.indexOf(' #');
      if (commentIdx !== -1) val = val.slice(0, commentIdx).trim();
    }
    if (key) result[key] = val;
  }
  return result;
}

function loadEnv() {
  const files = [
    join(ROOT, '.env'),
    join(ROOT, '.env.local'),
    join(ROOT, 'apps', 'web', '.env'),
    join(ROOT, 'apps', 'web', '.env.local'),
    join(ROOT, 'apps', 'web', '.env.production'),
  ];
  if (extraEnv) files.push(resolve(extraEnv));

  const merged = {};
  for (const f of files) {
    Object.assign(merged, parseEnvFile(f));
  }
  // Apply to process.env without overwriting existing values (existing wins)
  for (const [k, v] of Object.entries(merged)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

// ── Connection URL resolution ─────────────────────────────────────────────────

function resolveConnectionUrl() {
  // 1. Explicit DATABASE_URL
  if (process.env.DATABASE_URL) {
    return { url: process.env.DATABASE_URL, source: 'DATABASE_URL' };
  }

  // 2. SUPABASE_DB_URL
  if (process.env.SUPABASE_DB_URL) {
    return { url: process.env.SUPABASE_DB_URL, source: 'SUPABASE_DB_URL' };
  }

  // 3. Derive from Supabase project URL + service role key
  // Supabase direct connection: postgresql://postgres.[ref]:[password]@[region].pooler.supabase.com:5432/postgres
  // OR: postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
  //
  // We cannot derive the DB password from the service role key alone — the
  // service role key is a JWT, not the raw postgres password.
  // Supabase exposes the DB password separately in project settings.
  //
  // If neither DATABASE_URL nor SUPABASE_DB_URL is set, fail with a clear message.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceKey) {
    // User has Supabase configured but no direct DB URL set.
    // Guide them to set DATABASE_URL.
    return { url: null, source: 'supabase-partial', supabaseUrl };
  }

  return { url: null, source: 'none' };
}

// ── Database introspection queries ────────────────────────────────────────────

const SQL_TABLES = `
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type   IN ('BASE TABLE', 'VIEW')
  ORDER BY table_name
`;

const SQL_COLUMNS = `
  SELECT
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default,
    ordinal_position
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position
`;

const SQL_PRIMARY_KEYS = `
  SELECT
    tc.table_name,
    kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema    = kcu.table_schema
  WHERE tc.table_schema     = 'public'
    AND tc.constraint_type  = 'PRIMARY KEY'
  ORDER BY tc.table_name, kcu.ordinal_position
`;

const SQL_FOREIGN_KEYS = `
  SELECT
    tc.table_name                              AS table_name,
    kcu.column_name                            AS column,
    ccu.table_name                             AS references_table,
    ccu.column_name                            AS references_column
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema    = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
   AND ccu.table_schema    = tc.table_schema
  WHERE tc.table_schema    = 'public'
    AND tc.constraint_type = 'FOREIGN KEY'
  ORDER BY tc.table_name, kcu.column_name
`;

const SQL_INDEXES = `
  SELECT
    tablename,
    indexname
  FROM pg_indexes
  WHERE schemaname = 'public'
  ORDER BY tablename, indexname
`;

// ── pg client loader ──────────────────────────────────────────────────────────
// pg is loaded dynamically so the script fails gracefully with a useful message
// if the package hasn't been installed yet.

async function loadPg() {
  try {
    const mod = await import('pg');
    return mod.default ?? mod;
  } catch {
    console.error('');
    console.error('ERROR: pg package not found.');
    console.error('');
    console.error('Install it once at the repo root:');
    console.error('  pnpm add -D pg');
    console.error('  — or —');
    console.error('  npm install --save-dev pg');
    console.error('');
    console.error('pg is a devDependency used only by the schema generator script.');
    console.error('It is not bundled into any application package.');
    console.error('');
    process.exit(1);
  }
}

// ── Introspect schema ─────────────────────────────────────────────────────────

async function introspect(connectionUrl) {
  const { Pool } = await loadPg();

  const pool = new Pool({
    connectionString: connectionUrl,
    ssl: { rejectUnauthorized: false }, // Supabase requires SSL; disable cert verification for pooler
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });

  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    console.error('');
    console.error('ERROR: Unable to connect to database.');
    console.error('');
    console.error('Connection string source: ' + connectionUrl.replace(/:[^:@]+@/, ':***@'));
    console.error('Cause:', err.message);
    console.error('');
    console.error('Check:');
    console.error('  1. DATABASE_URL is set in .env or .env.local');
    console.error('  2. The database is reachable from this machine');
    console.error('  3. SSL/firewall settings allow the connection');
    console.error('');
    await pool.end().catch(() => {});
    process.exit(1);
  }

  try {
    console.log('  Connected. Introspecting schema...');

    const [tablesRes, columnsRes, pksRes, fksRes, idxRes] = await Promise.all([
      client.query(SQL_TABLES),
      client.query(SQL_COLUMNS),
      client.query(SQL_PRIMARY_KEYS),
      client.query(SQL_FOREIGN_KEYS),
      client.query(SQL_INDEXES),
    ]);

    return {
      tables:  tablesRes.rows,
      columns: columnsRes.rows,
      pks:     pksRes.rows,
      fks:     fksRes.rows,
      indexes: idxRes.rows,
    };
  } finally {
    client.release();
    await pool.end();
  }
}

// ── Assemble schema inventory ─────────────────────────────────────────────────

function assemble({ tables, columns, pks, fks, indexes }) {
  // Build lookup maps
  const columnsByTable  = {};
  const pksByTable      = {};
  const fksByTable      = {};
  const indexesByTable  = {};

  for (const col of columns) {
    (columnsByTable[col.table_name] = columnsByTable[col.table_name] ?? []).push({
      column:   col.column_name,
      type:     col.data_type,
      nullable: col.is_nullable === 'YES' ? 'YES' : 'NO',
      default:  col.column_default ?? null,
    });
  }

  for (const pk of pks) {
    (pksByTable[pk.table_name] = pksByTable[pk.table_name] ?? []).push(pk.column_name);
  }

  for (const fk of fks) {
    (fksByTable[fk.table_name] = fksByTable[fk.table_name] ?? []).push({
      column:            fk.column,
      references_table:  fk.references_table,
      references_column: fk.references_column,
    });
  }

  for (const idx of indexes) {
    (indexesByTable[idx.tablename] = indexesByTable[idx.tablename] ?? []).push(idx.indexname);
  }

  // Assemble per-table records, sorted alphabetically (tables already sorted by SQL)
  return tables.map(({ table_name }) => ({
    table:        table_name,
    columns:      columnsByTable[table_name]  ?? [],
    primary_keys: pksByTable[table_name]      ?? [],
    foreign_keys: (fksByTable[table_name]     ?? []).sort((a, b) => a.column.localeCompare(b.column)),
    indexes:      (indexesByTable[table_name] ?? []).sort(),
  }));
}

// ── Validation ────────────────────────────────────────────────────────────────

// Tables that are expected to have no workspace_id (platform-level / cross-workspace)
const WORKSPACE_EXEMPT = new Set([
  'workspaces',
  'brandos_admin_settings',
  'brandos_provider_credentials',
  'brandos_provider_health',
  'cp_telemetry_summary',       // materialised view
]);

function validate(inventory) {
  const warnings = [];

  for (const entry of inventory) {
    const { table, columns, primary_keys, foreign_keys, indexes } = entry;
    const colNames = columns.map(c => c.column);

    // Tables without primary keys
    if (primary_keys.length === 0) {
      warnings.push({
        type: 'NO_PRIMARY_KEY',
        table,
        message: `Table \`${table}\` has no primary key.`,
        detail: 'Every table should have a primary key. Views without PKs are expected.',
      });
    }

    // Orphan foreign key columns (column declared as FK but references_table empty)
    for (const fk of foreign_keys) {
      if (!fk.references_table || !fk.references_column) {
        warnings.push({
          type: 'ORPHAN_FK',
          table,
          message: `FK column \`${fk.column}\` in \`${table}\` has no resolved references_table.`,
          detail: 'May indicate a dangling FK or introspection issue.',
        });
      }
    }

    // Missing workspace_id on business tables
    if (!WORKSPACE_EXEMPT.has(table) && !colNames.includes('workspace_id')) {
      warnings.push({
        type: 'MISSING_WORKSPACE_SCOPE',
        table,
        message: `Table \`${table}\` has no \`workspace_id\` column.`,
        detail: 'BrandOS requires workspace scoping for all business entities. If this table is intentionally global, add it to WORKSPACE_EXEMPT in generate-schema-inventory.mjs.',
      });
    }

    // Duplicate index names (across entire schema — pg_indexes enforces unique within schema)
    // but check for semantically duplicate coverage by checking if two indexes share the same
    // column set (requires index definition parsing — skip for now, note as future work)
  }

  return warnings;
}

// ── Render validation report ──────────────────────────────────────────────────

function renderValidation(inventory, warnings, generatedAt) {
  const tableCount  = inventory.length;
  const colCount    = inventory.reduce((n, t) => n + t.columns.length, 0);
  const fkCount     = inventory.reduce((n, t) => n + t.foreign_keys.length, 0);
  const idxCount    = inventory.reduce((n, t) => n + t.indexes.length, 0);

  const byType = {};
  for (const w of warnings) {
    (byType[w.type] = byType[w.type] ?? []).push(w);
  }

  const lines = [
    '# BrandOS Schema Validation Report (Generated)',
    '',
    `> **Generated:** ${generatedAt}`,
    '> **Source:** Live PostgreSQL (information_schema + pg_indexes)',
    '> Do not edit — regenerated by `scripts/generate-schema-inventory.mjs`',
    '',
    '---',
    '',
    '## Summary',
    '',
    `| Metric | Count |`,
    `|---|---|`,
    `| Tables / Views | ${tableCount} |`,
    `| Columns | ${colCount} |`,
    `| Foreign keys | ${fkCount} |`,
    `| Indexes | ${idxCount} |`,
    `| Warnings | ${warnings.length} |`,
    '',
  ];

  if (warnings.length === 0) {
    lines.push('## Warnings', '', '*(none — schema passed all checks)*', '');
    return lines.join('\n');
  }

  const WARN_SECTIONS = [
    { type: 'NO_PRIMARY_KEY',        heading: 'Tables Without Primary Keys' },
    { type: 'ORPHAN_FK',             heading: 'Orphan Foreign Keys' },
    { type: 'MISSING_WORKSPACE_SCOPE', heading: 'Missing Workspace Scoping (`workspace_id`)' },
  ];

  lines.push('## Warnings', '');

  for (const { type, heading } of WARN_SECTIONS) {
    const group = byType[type];
    if (!group || group.length === 0) continue;
    lines.push(`### ${heading}`, '');
    for (const w of group) {
      lines.push(`**Table:** \`${w.table}\``, '');
      lines.push(`**Issue:** ${w.message}`, '');
      if (w.detail) lines.push(`> ${w.detail}`, '');
      lines.push('---', '');
    }
  }

  // Catch-all for any warning types not in WARN_SECTIONS
  const knownTypes = new Set(WARN_SECTIONS.map(s => s.type));
  const unknown    = warnings.filter(w => !knownTypes.has(w.type));
  if (unknown.length > 0) {
    lines.push('### Other Warnings', '');
    for (const w of unknown) {
      lines.push(`- \`${w.table}\`: ${w.message}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[generate-schema-inventory] Starting...');

  // 1. Load env files
  loadEnv();

  // 2. Resolve connection URL
  const { url, source, supabaseUrl } = resolveConnectionUrl();

  if (!url) {
    console.error('');
    console.error('ERROR: Unable to resolve database connection URL.');
    console.error('');
    if (source === 'supabase-partial') {
      console.error(`Detected Supabase project URL: ${supabaseUrl}`);
      console.error('');
      console.error('To connect directly to the database, add one of these to .env.local:');
      console.error('');
      console.error('  # Option A — Supabase Session-mode Pooler (recommended for schema introspection)');
      console.error('  DATABASE_URL=postgresql://postgres.[project-ref]:[db-password]@[region].pooler.supabase.com:5432/postgres');
      console.error('');
      console.error('  # Option B — Direct connection (bypasses pooler, requires IPv6 or Supabase IPv4 add-on)');
      console.error('  DATABASE_URL=postgresql://postgres:[db-password]@db.[project-ref].supabase.co:5432/postgres');
      console.error('');
      console.error('Find your connection strings in: Supabase Dashboard > Project Settings > Database > Connection string');
    } else {
      console.error('Set DATABASE_URL or SUPABASE_DB_URL in .env or .env.local.');
      console.error('');
      console.error('Example:');
      console.error('  DATABASE_URL=postgresql://postgres:password@db.xxxx.supabase.co:5432/postgres');
    }
    console.error('');
    process.exit(1);
  }

  const maskedUrl = url.replace(/:[^:@]+@/, ':***@');
  console.log(`[generate-schema-inventory] Connecting via: ${source}`);
  console.log(`[generate-schema-inventory] URL: ${maskedUrl}`);

  // 3. Introspect
  const raw       = await introspect(url);
  const inventory = assemble(raw);
  const warnings  = validate(inventory);

  // 4. Write outputs
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const outPath = outFile;
  if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });

  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const outputDoc   = {
    _meta: {
      generated:    generatedAt,
      source:       'live-postgres',
      connection:   source,
      table_count:  inventory.length,
      column_count: raw.columns.length,
      fk_count:     raw.fks.length,
      index_count:  raw.indexes.length,
    },
    tables: inventory,
  };

  writeFileSync(outPath, JSON.stringify(outputDoc, null, 2));
  writeFileSync(OUT_VAL, renderValidation(inventory, warnings, generatedAt));

  // 5. Summary
  console.log('');
  console.log(`[generate-schema-inventory] Done.`);
  console.log(`  Tables:   ${inventory.length}`);
  console.log(`  Columns:  ${raw.columns.length}`);
  console.log(`  FKs:      ${raw.fks.length}`);
  console.log(`  Indexes:  ${raw.indexes.length}`);
  console.log(`  Warnings: ${warnings.length}`);
  console.log(`  Output:   ${outPath}`);
  console.log(`  Report:   ${OUT_VAL}`);

  if (warnings.length > 0) {
    console.log('');
    console.log(`[generate-schema-inventory] WARNINGS:`);
    for (const w of warnings) {
      console.log(`  [${w.type}] ${w.table}: ${w.message}`);
    }
  }
}

main().catch(err => {
  console.error('');
  console.error('ERROR: Schema inventory generation failed.');
  console.error(err.message);
  console.error('');
  process.exit(1);
});
