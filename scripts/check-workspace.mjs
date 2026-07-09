#!/usr/bin/env node
/**
 * scripts/check-workspace.mjs
 *
 * BrandOS Workspace Wiring Validator — v3
 *
 * Validates:
 *   1. Every @brandos/* internal dep uses "workspace:*"
 *   2. No package self-references
 *   3. uuid version consistency (^9.x)
 *   4. No stale package-lock.json in individual packages (pnpm workspace)
 *   5. All known packages are present on disk
 *   6. Root workspace manifest includes all expected globs
 *
 * v3 changes:
 *   - Package list imported from shared/package-registry.mjs (single source of truth)
 *   - Package discovery uses shared/fs-utils.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { KNOWN_PACKAGES, isInternalPackage } from './shared/package-registry.mjs';
import { collectWorkspacePackages } from './shared/fs-utils.mjs';

const ROOT = resolve(process.cwd());
let issues = 0;
let warnings = 0;

function warn(msg)  { console.warn(`[check-workspace] ⚠️  ${msg}`); warnings++; }
function fail(msg)  { console.error(`[check-workspace] ❌ ${msg}`); issues++; }
function ok(msg)    { console.log(`[check-workspace] ✅ ${msg}`); }

// ── 1. Known packages present on disk ─────────────────────────────────────

for (const { dir } of KNOWN_PACKAGES) {
  const pkgJson = join(ROOT, dir, 'package.json');
  if (!existsSync(pkgJson)) {
    fail(`Known package missing on disk: ${dir}/package.json`);
  }
}

// ── 2. Root workspace manifest validation ─────────────────────────────────

let rootPkg;
try {
  rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
} catch {
  fail('Cannot read root package.json');
  process.exit(1);
}

const workspaces = rootPkg.workspaces ?? [];
if (!workspaces.includes('packages/*')) {
  fail('Root package.json workspaces missing "packages/*" glob');
}
if (!workspaces.includes('apps/*')) {
  fail('Root package.json workspaces missing "apps/*" glob');
}

const redundant = workspaces.filter(
  w => w !== 'packages/*' && w !== 'apps/*' && w.startsWith('packages/')
);
if (redundant.length > 0) {
  warn(`Root package.json workspaces has redundant explicit entries (covered by "packages/*"): ${redundant.join(', ')}`);
  warn('  Fix: remove redundant entries — "packages/*" already covers them.');
}

// ── 3. Stale package-lock.json detection ──────────────────────────────────
// In a pnpm workspace, individual packages must NOT have their own package-lock.json.

for (const { name, dir } of collectWorkspacePackages(ROOT)) {
  const lockFile = join(dir, 'package-lock.json');
  if (existsSync(lockFile)) {
    fail(`${name}: package-lock.json found — stale npm lockfile in pnpm workspace. Delete it.`);
  }
}

// ── 4. Per-package dependency validation ──────────────────────────────────

function checkPackage({ dir, pkg }) {
  const name = pkg.name ?? dir;
  const allDeps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  };

  for (const [dep, ver] of Object.entries(allDeps)) {
    // v3 fix: was `!dep.startsWith('@brandos/')`, which skipped workspace:*
    // validation entirely for @platform/cognition-contract. Now derives from
    // the shared RECOGNIZED_SCOPES authority.
    if (!isInternalPackage(dep)) continue;

    if (dep === name) {
      fail(`${name}: self-referencing dependency "${dep}"`);
      continue;
    }

    if (ver !== 'workspace:*') {
      fail(`${name}: dep "${dep}" uses "${ver}" instead of "workspace:*"`);
    }
  }

  if (allDeps['uuid'] && !allDeps['uuid'].startsWith('^9')) {
    warn(`${name}: uuid version "${allDeps['uuid']}" — expected ^9.x.x`);
  }

  if (pkg.packageManager && name !== 'brandos-platform') {
    warn(`${name}: has "packageManager" field — this should only be in root package.json`);
  }
}

for (const entry of collectWorkspacePackages(ROOT)) {
  checkPackage(entry);
}

// ── Summary ────────────────────────────────────────────────────────────────

if (issues === 0 && warnings === 0) {
  ok(`Workspace wiring OK (${KNOWN_PACKAGES.length} packages validated)`);
} else if (issues === 0) {
  ok(`Workspace wiring OK with ${warnings} warning(s) — review above`);
} else {
  console.error(`[check-workspace] ❌ ${issues} issue(s) found, ${warnings} warning(s)`);
  process.exit(1);
}
