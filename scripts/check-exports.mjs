#!/usr/bin/env node
/**
 * scripts/check-exports.mjs
 *
 * BrandOS Export Map Validator — v3
 *
 * Validates that every package's declared exports exist on disk.
 * Run after `pnpm build` to confirm dist outputs are correct.
 *
 * Checks:
 *   - pkg.main exists
 *   - pkg.types exists
 *   - All pkg.exports entries exist (handles nested export map objects)
 *
 * v3 changes:
 *   - Package discovery uses shared/fs-utils.mjs::collectWorkspacePackages
 *   - New config packages automatically included via the shared registry
 */

import { existsSync } from 'fs';
import { resolve, join } from 'path';
import { collectWorkspacePackages } from './shared/fs-utils.mjs';

const ROOT = resolve(process.cwd());
let failures = 0;
let packagesChecked = 0;
let packagesSkipped = 0;

function collectExportPaths(exports) {
  const paths = [];
  if (!exports) return paths;

  for (const [, value] of Object.entries(exports)) {
    if (typeof value === 'string') {
      paths.push(value);
    } else if (typeof value === 'object' && value !== null) {
      for (const v of Object.values(value)) {
        if (typeof v === 'string') paths.push(v);
        else if (typeof v === 'object' && v !== null) {
          for (const vv of Object.values(v)) {
            if (typeof vv === 'string') paths.push(vv);
          }
        }
      }
    }
  }
  return paths;
}

function checkPackage({ dir, pkg }) {
  const distDir = `${dir}/dist`;
  const isApp = dir.includes('/apps/') || dir.includes('\\apps\\');

  if (!existsSync(distDir) && !isApp) {
    console.warn(`[check-exports] ⏭  ${pkg.name ?? dir}: no dist/ directory — run pnpm build first`);
    packagesSkipped++;
    return;
  }

  const name = pkg.name ?? dir;
  const checks = [];

  if (pkg.main) checks.push(pkg.main);
  if (pkg.types) checks.push(pkg.types);

  const exportPaths = collectExportPaths(pkg.exports);
  checks.push(...exportPaths);

  const uniqueChecks = [...new Set(checks)];
  let hasFailure = false;

  for (const entry of uniqueChecks) {
    const full = `${dir}/${entry}`;
    if (!existsSync(full)) {
      console.error(`[check-exports] ❌ ${name}: missing export "${entry}"`);
      failures++;
      hasFailure = true;
    }
  }

  if (!hasFailure) packagesChecked++;
}

for (const entry of collectWorkspacePackages(ROOT)) {
  checkPackage(entry);
}

if (failures === 0) {
  if (packagesSkipped > 0) {
    console.log(`[check-exports] ✅ All present exports valid (${packagesChecked} checked, ${packagesSkipped} skipped — no dist)`);
  } else {
    console.log(`[check-exports] ✅ All package exports present (${packagesChecked} packages)`);
  }
} else {
  console.error(`[check-exports] ❌ ${failures} missing export(s). Run pnpm build first.`);
  process.exit(1);
}
