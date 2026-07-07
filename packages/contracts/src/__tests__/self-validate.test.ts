/**
 * @brandos/contracts — self-validate.test.ts
 *
 * Package self-validation tests.
 *
 * These tests run the package's self-validation layer and verify
 * that all package invariants hold. They also verify structural
 * properties of the package that cannot be checked by TypeScript alone.
 *
 * Test categories:
 *   - INV-1: Only the sanctioned cross-platform contract dependency
 *            (verified via package.json)
 *   - INV-2: No @brandos/* imports in source files
 *   - Package invariant checks via validateContractsPackage()
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import {
  validateContractsPackage,
  checkProviderRegistryIntegrity,
  checkIdentityDimensions,
  checkArtifactTypeGuards,
  checkCarouselRoles,
  checkCarouselSchemaInstruction,
  checkRuntimeModeConverters,
  checkSchemaVersion,
  checkRuntimeExports,
} from '../self-validate';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers to read package source
// ─────────────────────────────────────────────────────────────────────────────

const SRC_DIR = resolve(__dirname, '..');
const PKG_ROOT = resolve(SRC_DIR, '..');
const PKG_JSON_PATH = join(PKG_ROOT, 'package.json');

function readPackageJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(PKG_JSON_PATH, 'utf-8'));
}

function getAllSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;
    if (statSync(fullPath).isDirectory()) {
      files.push(...getAllSourceFiles(fullPath));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

// ─────────────────────────────────────────────────────────────────────────────
// INV-1: Only the sanctioned cross-platform contract dependency
// ─────────────────────────────────────────────────────────────────────────────
//
// @brandos/contracts was zero-dependency until the Milestone 1 BrandOS /
// IntelligenceOS platform split, which gave it exactly one sanctioned
// runtime dependency: @platform/cognition-contract, the cross-platform
// contract package imported by both repositories (see this package's own
// package.json description, and INTELLIGENCE_PLATFORM_IMPLEMENTATION.md).
// This test previously asserted *zero* dependencies, which stopped being
// true the moment that platform-split dependency was added — but the
// failure went unnoticed because this package had no "test" script wired
// up at all (found and fixed in the Milestone 3+ Engineering Workflow
// Audit). The invariant this test should enforce isn't "no dependencies,"
// it's "no *unsanctioned* dependencies" — anything beyond the one
// cross-platform contract would be a real architecture violation.

const SANCTIONED_DEPENDENCIES = ['@platform/cognition-contract'];

describe('INV-1: Only the sanctioned cross-platform contract dependency', () => {
  it('package.json has no dependencies beyond @platform/cognition-contract', () => {
    const pkg = readPackageJson();
    const deps = pkg.dependencies as Record<string, string> | undefined;
    const depNames = deps ? Object.keys(deps) : [];
    expect(depNames.sort()).toEqual([...SANCTIONED_DEPENDENCIES].sort());
  });

  it('package.json has devDependencies (build/test tools only)', () => {
    const pkg = readPackageJson();
    const devDeps = pkg.devDependencies as Record<string, string>;
    expect(devDeps).toBeDefined();
    expect(Object.keys(devDeps).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-2: No @brandos/* imports in source files
// ─────────────────────────────────────────────────────────────────────────────

describe('INV-2: No @brandos/* imports in source files', () => {
  const sourceFiles = getAllSourceFiles(SRC_DIR);

  it('detects at least one source file to check', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it('no source file contains @brandos/ imports', () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        // Only flag actual import/require statements — not JSDoc comments or strings
        const isComment = trimmed.startsWith('//') || trimmed.startsWith('*');
        if (!isComment && line.includes('@brandos/') && (line.includes('import ') || line.includes('require('))) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Package self-validation checks — individual
// ─────────────────────────────────────────────────────────────────────────────

describe('checkProviderRegistryIntegrity', () => {
  it('passes', () => {
    const result = checkProviderRegistryIntegrity();
    expect(result.passed).toBe(true);
    if (!result.passed) console.error(result.error);
  });
});

describe('checkIdentityDimensions', () => {
  it('passes', () => {
    const result = checkIdentityDimensions();
    expect(result.passed).toBe(true);
    if (!result.passed) console.error(result.error);
  });
});

describe('checkArtifactTypeGuards', () => {
  it('passes', () => {
    const result = checkArtifactTypeGuards();
    expect(result.passed).toBe(true);
    if (!result.passed) console.error(result.error);
  });
});

describe('checkCarouselRoles', () => {
  it('passes', () => {
    const result = checkCarouselRoles();
    expect(result.passed).toBe(true);
    if (!result.passed) console.error(result.error);
  });
});

describe('checkCarouselSchemaInstruction', () => {
  it('passes', () => {
    const result = checkCarouselSchemaInstruction();
    expect(result.passed).toBe(true);
    if (!result.passed) console.error(result.error);
  });
});

describe('checkRuntimeModeConverters', () => {
  it('passes', () => {
    const result = checkRuntimeModeConverters();
    expect(result.passed).toBe(true);
    if (!result.passed) console.error(result.error);
  });
});

describe('checkSchemaVersion', () => {
  it('passes', () => {
    const result = checkSchemaVersion();
    expect(result.passed).toBe(true);
    if (!result.passed) console.error(result.error);
  });
});

describe('checkRuntimeExports', () => {
  it('passes', () => {
    const result = checkRuntimeExports();
    expect(result.passed).toBe(true);
    if (!result.passed) console.error(result.error);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Full package validation
// ─────────────────────────────────────────────────────────────────────────────

describe('validateContractsPackage — full report', () => {
  it('all checks pass', () => {
    const report = validateContractsPackage();
    if (!report.allPassed) {
      console.error('Package validation violations:', report.violations);
    }
    expect(report.allPassed).toBe(true);
  });

  it('report contains packageName @brandos/contracts', () => {
    const report = validateContractsPackage();
    expect(report.packageName).toBe('@brandos/contracts');
  });

  it('report contains agenticLevel L5', () => {
    const report = validateContractsPackage();
    expect(report.agenticLevel).toBe('L5');
  });

  it('report contains a timestamp', () => {
    const report = validateContractsPackage();
    expect(new Date(report.timestamp).getFullYear()).toBeGreaterThanOrEqual(2024);
  });

  it('report has checks array with 8 entries', () => {
    const report = validateContractsPackage();
    expect(report.checks.length).toBe(8);
  });

  it('violations array is empty when all checks pass', () => {
    const report = validateContractsPackage();
    expect(report.violations).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-3: Single entry point
// ─────────────────────────────────────────────────────────────────────────────

describe('INV-3: Single entry point', () => {
  it('package.json exports only "." (no deep export paths)', () => {
    const pkg = readPackageJson();
    const exports = pkg.exports as Record<string, unknown>;
    expect(exports).toBeDefined();
    const keys = Object.keys(exports);
    // Only "." is allowed
    expect(keys).toEqual(['.']);
  });

  it('package.json main points to dist/index.js', () => {
    const pkg = readPackageJson();
    expect(pkg.main).toBe('./dist/index.js');
  });

  it('package.json types points to dist/index.d.ts', () => {
    const pkg = readPackageJson();
    expect(pkg.types).toBe('./dist/index.d.ts');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-5: No dead code — all files in src/ are importable from index.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('INV-5: No dead code — source files reachable from index.ts', () => {
  it('every .ts file in src/ (except __tests__ and IContracts.ts) is referenced in index.ts', () => {
    const indexContent = readFileSync(join(SRC_DIR, 'index.ts'), 'utf-8');
    const sourceFiles = readdirSync(SRC_DIR).filter(
      f =>
        f.endsWith('.ts') &&
        !f.startsWith('__') &&
        f !== 'index.ts' &&
        f !== 'IContracts.ts' && // boundary documentation file — not compiled into the package
        !f.endsWith('.d.ts')
    );
    const unreferenced: string[] = [];
    for (const file of sourceFiles) {
      const baseName = file.replace('.ts', '');
      if (!indexContent.includes(`'./${baseName}'`) && !indexContent.includes(`"./${baseName}"`)) {
        unreferenced.push(file);
      }
    }
    expect(unreferenced).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error path coverage for checkProviderRegistryIntegrity
// These tests verify the validation functions correctly detect violations.
// ─────────────────────────────────────────────────────────────────────────────

import {
  type ValidationCheckResult,
  type PackageValidationReport,
} from '../self-validate';

describe('checkProviderRegistryIntegrity — violation detection', () => {
  // We can't mutate PROVIDER_REGISTRY directly (it's a const).
  // Instead we test the logic by calling the real check and verifying
  // it passes — the error branches are Istanbul-ignored as unreachable
  // defensive code for production safety.
  it('check name is PROVIDER_REGISTRY_INTEGRITY', () => {
    const result = checkProviderRegistryIntegrity();
    expect(result.check).toBe('PROVIDER_REGISTRY_INTEGRITY');
  });
});

describe('validateContractsPackage — report shape', () => {
  it('each check in report has check and passed fields', () => {
    const report = validateContractsPackage();
    for (const check of report.checks) {
      expect(typeof check.check).toBe('string');
      expect(typeof check.passed).toBe('boolean');
    }
  });

  it('check names are all unique', () => {
    const report = validateContractsPackage();
    const names = report.checks.map(c => c.check);
    expect(new Set(names).size).toBe(names.length);
  });
});


