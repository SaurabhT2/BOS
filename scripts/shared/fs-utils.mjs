#!/usr/bin/env node
/**
 * scripts/shared/fs-utils.mjs
 *
 * BrandOS Shared Filesystem Utilities — v1
 *
 * Provides:
 *   walkSourceFiles(dir, opts)          — recursive TypeScript source walker
 *   collectWorkspacePackages(root)      — enumerate all packages/ and apps/ entries
 *
 * Previously duplicated as:
 *   walkTs()      in check-circular.mjs, lint-imports.mjs
 *   getAllFiles()  in check-route-boundaries.mjs
 *   inline loops  in check-boundaries.mjs, check-exports.mjs, check-workspace.mjs
 */

import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Recursively collect source files under `dir`.
 *
 * @param {string} dir - Absolute path to scan.
 * @param {object} [opts]
 * @param {string[]} [opts.extensions=['.ts','.tsx']] - File extensions to include.
 * @param {boolean}  [opts.excludeTests=false]        - Exclude *.test.ts files.
 * @param {boolean}  [opts.excludeDeclarations=true]  - Exclude *.d.ts files.
 * @returns {string[]} Absolute file paths.
 */
export function walkSourceFiles(dir, opts = {}) {
  const {
    extensions = ['.ts', '.tsx'],
    excludeTests = false,
    excludeDeclarations = true,
  } = opts;

  const files = [];
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      files.push(...walkSourceFiles(full, opts));
    } else {
      if (excludeDeclarations && entry.endsWith('.d.ts')) continue;
      if (excludeTests && (entry.endsWith('.test.ts') || entry.endsWith('.spec.ts'))) continue;
      if (extensions.some(ext => entry.endsWith(ext))) {
        files.push(full);
      }
    }
  }

  return files;
}

/**
 * Enumerate every package under `packages/` and `apps/` in the repo root.
 * Reads each directory's package.json to get the package name.
 *
 * @param {string} root - Absolute repo root path.
 * @returns {{ name: string, dir: string, pkg: object }[]}
 */
export function collectWorkspacePackages(root) {
  const packages = [];
  for (const base of ['packages', 'apps']) {
    const baseDir = join(root, base);
    if (!existsSync(baseDir)) continue;
    let entries;
    try { entries = readdirSync(baseDir); } catch { continue; }

    for (const entry of entries) {
      const dir = join(baseDir, entry);
      let stat;
      try { stat = statSync(dir); } catch { continue; }
      if (!stat.isDirectory()) continue;

      const pkgJsonPath = join(dir, 'package.json');
      if (!existsSync(pkgJsonPath)) continue;

      let pkg;
      try { pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')); } catch { continue; }

      packages.push({ name: pkg.name ?? entry, dir, pkg });
    }
  }
  return packages;
}
