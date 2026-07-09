#!/usr/bin/env node
/**
 * scripts/shared/context-utils.mjs
 *
 * BrandOS Context Generator Shared Utilities
 *
 * Used exclusively by generate-*.mjs scripts.
 * All file I/O, source walking, and export extraction lives here
 * so the four generators share one implementation.
 */

import {
  readFileSync, existsSync, mkdirSync, readdirSync, statSync,
} from 'fs';
import { join } from 'path';
import { isInternalPackage } from './package-registry.mjs';

// ── File I/O ──────────────────────────────────────────────────────────────────

export function readJsonSafe(filePath) {
  try { return JSON.parse(readFileSync(filePath, 'utf-8')); }
  catch { return null; }
}

export function readFileSafe(filePath) {
  try { return readFileSync(filePath, 'utf-8'); }
  catch { return ''; }
}

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function renderTimestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

// ── Source file walker ────────────────────────────────────────────────────────
// Re-implements walkSourceFiles() from fs-utils.mjs so context-utils.mjs
// is independently loadable (no circular dependency).

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.turbo', '.git', 'coverage', 'build', 'out']);

export function walkSourceFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  let entries;
  try { entries = readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      results.push(...walkSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

// ── Import extraction ─────────────────────────────────────────────────────────

/**
 * Extract all internal-scope (@brandos/*, @platform/*) imports from a
 * TypeScript file, normalised to package name.
 *
 * v3 fix: was hardcoded to `@brandos\/` only, silently blind to
 * @platform/cognition-contract imports. Now matches any recognized scope
 * (scripts/shared/package-registry.mjs::RECOGNIZED_SCOPES).
 */
export function getBrandosImports(filePath) {
  const src = readFileSafe(filePath);
  const imports = new Set();
  const re = /from\s+['"](@brandos\/[^'"]+|@platform\/[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    imports.add(m[1].split('/').slice(0, 2).join('/'));
  }
  return [...imports];
}

/**
 * Extract internal-scope deps from a package.json object (deps + devDeps,
 * not peers).
 *
 * v3 fix: was `k.startsWith('@brandos/')` only — same @platform/ blind spot
 * as getBrandosImports() above. Now derives from RECOGNIZED_SCOPES.
 */
export function getBrandosDeps(pkgJson) {
  const all = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };
  return Object.keys(all).filter(isInternalPackage);
}

// ── Public export extraction from src/index.ts ────────────────────────────────

export function extractPublicExports(packageDir) {
  const src = readFileSafe(join(packageDir, 'src', 'index.ts'));
  if (!src) return [];

  const symbols = [];
  const namedRe = /^export\s+(?:type\s+)?\{([^}]+)\}/gm;
  let m;
  while ((m = namedRe.exec(src)) !== null) {
    for (const raw of m[1].split(',')) {
      const s = raw.trim().replace(/^type\s+/, '').replace(/\s+as\s+\S+$/, '').trim();
      if (s && !s.startsWith('//')) symbols.push(s);
    }
  }

  const directRe = /^export\s+(?:default\s+)?(?:class|function|const|let|var|type|interface|enum|abstract\s+class)\s+(\w+)/gm;
  while ((m = directRe.exec(src)) !== null) {
    if (m[1]) symbols.push(m[1]);
  }

  return [...new Set(symbols)];
}

// ── Table documentation helpers ───────────────────────────────────────────────

export function renderColumns(columns) {
  return columns.map(c => {
    const nullable = c.nullable === 'NO' ? ' `NOT NULL`' : '';
    const def = (c.default !== null && c.default !== undefined) ? ` default \`${c.default}\`` : '';
    return `  - \`${c.column}\` — ${c.type}${nullable}${def}`;
  }).join('\n');
}

export function renderFKs(fks) {
  if (!fks || fks.length === 0) return '  *(none)*';
  return fks.map(fk =>
    `  - \`${fk.column}\` → \`${fk.references_table}.${fk.references_column}\``
  ).join('\n');
}

export function renderIndexes(indexes) {
  if (!indexes || indexes.length === 0) return '  *(none)*';
  return indexes.map(i => `  - \`${i}\``).join('\n');
}
