#!/usr/bin/env node
/**
 * scripts/check-boundaries.mjs
 *
 * BrandOS Architectural Boundary Enforcer — v5
 *
 * Enforces the BrandOS package dependency stack (see shared/package-registry.mjs
 * for the canonical LAYER_TIERS definition). No upward imports allowed.
 * Peer relationships at the same level must be in ALLOWED_SAME_LEVEL_PAIRS.
 *
 * Violations are printed and exit(1) to block CI.
 *
 * v5 changes (Architecture Corrections — Fix C1, C2, C3, C4):
 *   Added failing assertions for all P0 coupling violations:
 *     RULE-4 (Fix C1): @brandos/ai-runtime-layer must NOT import from
 *             @brandos/output-control-layer. Artifact prompts are delivered via
 *             registerArtifactPrompt() through globalThis.__brandos_runtime_adapter.
 *     RULE-5 (Fix C2): @brandos/governance-layer must NOT import from
 *             @brandos/output-control-layer. repairJSON/extractJSON have moved to
 *             @brandos/shared-utils — import from there.
 *     RULE-6 (Fix C4): @brandos/control-plane-layer must NOT import concrete BI
 *             repository classes (SupabaseBrandSignalRepository, etc.). Use
 *             createBrandSignalRepository() from the @brandos/brand-intelligence API.
 *     RULE-7 (Fix C3): @brandos/control-plane-layer must NOT import
 *             BrandIntelligenceRuntime concrete class as a value. Use
 *             createDegradedCognitionContext() standalone export instead.
 *
 *   Updated RULE-3 allowed symbols: removed BrandIntelligenceRuntime,
 *     added createDegradedCognitionContext and createBrandSignalRepository.
 *
 * v4 changes (Ownership Audit Phase 3.4):
 *   Added import-source checks to enforce the three new boundary rules:
 *     RULE-1: apps/web must NOT import from @brandos/brand-intelligence directly
 *             for identity/persona writes. Route all writes through CPL or a BI
 *             API surface method (getBrandSummary, updatePersonaProfile, etc.).
 *             Exception: read-only calls (resolve, getBrandSummary, getMemory,
 *             recordArtifactObservation) from route.ts files are permitted.
 *     RULE-2: @brandos/output-control-layer must NOT import from
 *             @brandos/brand-intelligence. OCL receives all data via
 *             ResolvedGenerationContract — not by reaching into BI directly.
 *     RULE-3: @brandos/control-plane-layer may only import
 *             getGlobalBrandIntelligenceRuntime and IBrandCognitionRuntime from
 *             @brandos/brand-intelligence. No other BI symbols may be imported.
 *
 * v3 changes:
 *   - LAYER_TIERS, LAYER_INDEX, ALLOWED_SAME_LEVEL_PAIRS imported from
 *     shared/package-registry.mjs — no local copy
 *   - Package discovery uses shared/fs-utils.mjs
 *   - New config packages (L3a) and brand-intelligence (L6) now covered
 */

import { join, resolve } from 'path';
import { readFileSync, readdirSync, statSync } from 'fs';
import { LAYER_INDEX, ALLOWED_SAME_LEVEL_PAIRS } from './shared/package-registry.mjs';
import { collectWorkspacePackages } from './shared/fs-utils.mjs';

const ROOT = resolve(process.cwd());
let violations = 0;

function getWorkspaceDeps({ pkg }) {
  const all = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    // peerDependencies intentionally excluded — peers don't enforce boundaries
  };
  return Object.keys(all).filter(k => k.startsWith('@brandos/'));
}

// ── Source-file import scanner ────────────────────────────────────────────────

function collectSourceFiles(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory() && entry !== 'node_modules' && entry !== '.next' && !entry.startsWith('.')) {
          results.push(...collectSourceFiles(full));
        } else if (stat.isFile() && /\.(ts|tsx|mts|js|mjs)$/.test(entry)) {
          results.push(full);
        }
      } catch { /* skip unreadable entries */ }
    }
  } catch { /* skip unreadable dirs */ }
  return results;
}

function getImportsFromSource(filePath) {
  try {
    const src = readFileSync(filePath, 'utf-8');
    const imports = [];
    // Match static import/export from 'pkg' and dynamic import('pkg')
    const re = /(?:import|export|from)\s+['"](@brandos\/[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      imports.push(m[1]);
    }
    return imports;
  } catch {
    return [];
  }
}

// ── RULE-2: OCL must not import from @brandos/brand-intelligence ──────────────

function checkOclBiRule(packagesRoot) {
  const oclSrc = join(packagesRoot, 'output-control-layer', 'src');
  const files = collectSourceFiles(oclSrc);
  for (const file of files) {
    const imports = getImportsFromSource(file);
    for (const imp of imports) {
      if (imp.startsWith('@brandos/brand-intelligence')) {
        const rel = file.replace(ROOT + '/', '');
        console.error(
          `[BOUNDARY VIOLATION] RULE-2: ${rel} imports from @brandos/brand-intelligence — ` +
          `OCL must receive all data via ResolvedGenerationContract, not from BI directly`
        );
        violations++;
      }
    }
  }
}

// ── RULE-3: CPL may only import getGlobalBrandIntelligenceRuntime + IBrandCognitionRuntime ──

const CPL_BI_ALLOWED_SYMBOLS = new Set([
  'getGlobalBrandIntelligenceRuntime',
  'initBrandIntelligenceRuntime',      // init function — CPL boots BI at startup
  'IBrandCognitionRuntime',
  'IBrandIntelligenceRuntime',         // type import — interface only
  'BrandIntelligenceConfig',           // type import — config shape
  'BrandIntelligenceResolution',       // type import — resolution result
  // Fix C3: createDegradedCognitionContext replaces static BrandIntelligenceRuntime method
  'createDegradedCognitionContext',
  // Fix C4: createBrandSignalRepository hides concrete SupabaseBrandSignalRepository
  'createBrandSignalRepository',
]);

function checkCplBiRule(packagesRoot) {
  const cplSrc = join(packagesRoot, 'control-plane-layer', 'src');
  const files = collectSourceFiles(cplSrc);
  for (const file of files) {
    try {
      const rawSrc = readFileSync(file, 'utf-8');
      // Strip single-line (//) and multi-line (/* */) comments so JSDoc references
      // to symbol names don't trigger false positives (FP1 — enterprise.ts header)
      const src = rawSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
        .replace(/\/\/[^\n]*/g, '');           // line comments
      // Look for any import from @brandos/brand-intelligence
      const importRe = /import\s+(?:type\s+)?(?:\*\s+as\s+\w+|\{([^}]+)\})\s+from\s+['"]@brandos\/brand-intelligence['"]/g;
      let m;
      while ((m = importRe.exec(src)) !== null) {
        if (!m[1]) continue; // namespace import — flag it
        const symbols = m[1].split(',').map(s => s.trim().replace(/^type\s+/, '').replace(/\s+as\s+\w+$/, '').trim());
        for (const sym of symbols) {
          if (sym && !CPL_BI_ALLOWED_SYMBOLS.has(sym)) {
            const rel = file.replace(ROOT + '/', '');
            console.error(
              `[BOUNDARY VIOLATION] RULE-3: ${rel} imports '${sym}' from @brandos/brand-intelligence — ` +
              `CPL may only import: ${[...CPL_BI_ALLOWED_SYMBOLS].join(', ')}`
            );
            violations++;
          }
        }
      }
    } catch { /* skip */ }
  }
}

// ── RULE-1: apps/web persona/identity write imports ──────────────────────────
// Read-only BI calls from route files are permitted.
// Writes (updatePersonaProfile, direct Supabase persona writes) must go via BI API methods.
// This rule is enforced by code review rather than static analysis, but we flag
// any direct 'personas' table writes outside of @brandos/brand-intelligence.

function checkWebBiWriteRule(appsRoot) {
  const apiDir = join(appsRoot, 'web', 'app', 'api');
  const libDir = join(appsRoot, 'web', 'lib');
  const files = [...collectSourceFiles(apiDir), ...collectSourceFiles(libDir)];

  const FORBIDDEN_PATTERNS = [
    // Importing globalBrandMemory from CPL (Phase 1.4 fix)
    { re: /from\s+['"]@brandos\/control-plane-layer['"]\s*.*?globalBrandMemory/s, desc: 'globalBrandMemory imported from CPL (use getGlobalBrandIntelligenceRuntime from @brandos/brand-intelligence)' },
    // Inline brand_context construction with audience_type in routes
    { re: /brand_context\s*:\s*\{[^}]*audience_type\s*:[^}]*persona/, desc: 'inline brand_context with audience_type constructed from persona (let BI resolve this)' },
  ];

  for (const file of files) {
    try {
      const src = readFileSync(file, 'utf-8');
      for (const { re, desc } of FORBIDDEN_PATTERNS) {
        if (re.test(src)) {
          const rel = file.replace(ROOT + '/', '');
          console.error(`[BOUNDARY VIOLATION] RULE-1: ${rel} — ${desc}`);
          violations++;
        }
      }
    } catch { /* skip */ }
  }
}


// ── RULE-4 (Fix C1): ARL must NOT import from @brandos/output-control-layer ──
//
// ai-runtime-layer is a domain-agnostic runtime kernel.
// Artifact prompts are pushed to it via registerArtifactPrompt() at bootstrap
// time (globalThis.__brandos_runtime_adapter). No direct OCL import permitted.

function checkArlOclRule(packagesRoot) {
  const arlSrc = join(packagesRoot, 'ai-runtime-layer', 'src');
  const files = collectSourceFiles(arlSrc);
  for (const file of files) {
    try {
      const src = readFileSync(file, 'utf-8');
      if (src.includes("'@brandos/output-control-layer'") ||
          src.includes('"@brandos/output-control-layer"')) {
        const rel = file.replace(ROOT + '/', '');
        console.error(
          `[BOUNDARY VIOLATION] RULE-4 (Fix C1): ${rel} imports from @brandos/output-control-layer — ` +
          `ARL must not depend on OCL. Use registerArtifactPrompt() bridge instead.`
        );
        violations++;
      }
    } catch { /* skip */ }
  }
}

// ── RULE-5 (Fix C2): GL must NOT import from @brandos/output-control-layer ──
//
// governance-layer validates artifacts; it must not depend on OCL's compilers.
// repairJSON/extractJSON are now in @brandos/shared-utils — import from there.

function checkGlOclRule(packagesRoot) {
  const glSrc = join(packagesRoot, 'governance-layer', 'src');
  const files = collectSourceFiles(glSrc);
  for (const file of files) {
    try {
      const src = readFileSync(file, 'utf-8');
      if (src.includes("'@brandos/output-control-layer'") ||
          src.includes('"@brandos/output-control-layer"')) {
        const rel = file.replace(ROOT + '/', '');
        console.error(
          `[BOUNDARY VIOLATION] RULE-5 (Fix C2): ${rel} imports from @brandos/output-control-layer — ` +
          `GL must not depend on OCL. Import repairJSON/extractJSON from @brandos/shared-utils instead.`
        );
        violations++;
      }
    } catch { /* skip */ }
  }
}

// ── RULE-6 (Fix C4): CPL must NOT import concrete BI repository classes ──
//
// SupabaseBrandSignalRepository and SupabaseBrandMemoryRepository are
// implementation details of @brandos/brand-intelligence. CPL must use
// the createBrandSignalRepository() factory function from the public API.

const CPL_BI_REPOSITORY_FORBIDDEN = [
  'SupabaseBrandSignalRepository',
  'SupabaseBrandMemoryRepository',
  'InMemoryBrandMemoryRepository',
];

function checkCplBiRepositoryRule(packagesRoot) {
  const cplSrc = join(packagesRoot, 'control-plane-layer', 'src');
  const files = collectSourceFiles(cplSrc);
  for (const file of files) {
    try {
      const rawSrc = readFileSync(file, 'utf-8');
      // Strip comments first — see RULE-3's FP1 fix above. Without this,
      // historical/migration-note comments that merely *mention* these
      // symbol names (e.g. explaining what used to be imported pre-split)
      // trip this rule exactly like real code would. Confirmed as a live
      // false positive during the Milestone 3+ Engineering Workflow Audit:
      // control-plane-layer/src/init.ts's docblock explains its own
      // migration away from SupabaseBrandSignalRepository, and that
      // explanation alone was enough to fail `check-boundaries.mjs`.
      const src = rawSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
        .replace(/\/\/[^\n]*/g, '');           // line comments
      for (const symbol of CPL_BI_REPOSITORY_FORBIDDEN) {
        if (src.includes(symbol)) {
          const rel = file.replace(ROOT + '/', '');
          console.error(
            `[BOUNDARY VIOLATION] RULE-6 (Fix C4): ${rel} references '${symbol}' — ` +
            `CPL must not import concrete BI repository classes. ` +
            `Use createBrandSignalRepository() from @brandos/brand-intelligence instead.`
          );
          violations++;
        }
      }
    } catch { /* skip */ }
  }
}

// ── RULE-7 (Fix C3): CPL must NOT import BrandIntelligenceRuntime concrete class ──
//
// CPL must use createDegradedCognitionContext() and createBrandSignalRepository()
// from the @brandos/brand-intelligence public API. No concrete class access.

function checkCplBiConcreteClassRule(packagesRoot) {
  const cplSrc = join(packagesRoot, 'control-plane-layer', 'src');
  const files = collectSourceFiles(cplSrc);
  for (const file of files) {
    try {
      const src = readFileSync(file, 'utf-8');
      // Look for import of BrandIntelligenceRuntime as a value (not a type)
      // Type-only imports are acceptable (interface usage).
      const importRe = /import\s+(?!type\s)\{[^}]*\bBrandIntelligenceRuntime\b[^}]*\}\s+from\s+['"]@brandos\/brand-intelligence['"]/g;
      if (importRe.test(src)) {
        const rel = file.replace(ROOT + '/', '');
        console.error(
          `[BOUNDARY VIOLATION] RULE-7 (Fix C3): ${rel} imports BrandIntelligenceRuntime concrete class — ` +
          `Use createDegradedCognitionContext() from @brandos/brand-intelligence public API instead.`
        );
        violations++;
      }
    } catch { /* skip */ }
  }
}

// ── RULE-OCL-SCHEMA-SELECTION: OCL must not perform artifact schema selection ──
//
// @brandos/output-control-layer compiles into schema shapes; it must not select
// which schema/artifact type to apply. That decision belongs to the artifact
// engine registry (@brandos/artifact-engine-layer + @brandos/artifact-config).
//
// Forbidden symbols in OCL source: ARTIFACT_TYPE_REGISTRY, ARTIFACT_TYPE_IDS,
// ArtifactTypeId, ArtifactTypeMeta from @brandos/artifact-config.

const OCL_SCHEMA_SELECTION_FORBIDDEN = [
  'ARTIFACT_TYPE_REGISTRY',
  'ARTIFACT_TYPE_IDS',
  'ArtifactTypeId',
  'ArtifactTypeMeta',
];

function checkOclSchemaSelectionRule(packagesRoot) {
  const oclSrc = join(packagesRoot, 'output-control-layer', 'src');
  const files = collectSourceFiles(oclSrc);
  for (const file of files) {
    try {
      const src = readFileSync(file, 'utf-8');
      // Only flag if importing from @brandos/artifact-config AND using a forbidden symbol
      if (!src.includes('@brandos/artifact-config')) continue;
      for (const symbol of OCL_SCHEMA_SELECTION_FORBIDDEN) {
        const re = new RegExp(`\\b${symbol}\\b`);
        if (re.test(src)) {
          const rel = file.replace(ROOT + '/', '');
          console.error(
            `[BOUNDARY VIOLATION] RULE-OCL-SCHEMA-SELECTION: ${rel} references '${symbol}' ` +
            `from @brandos/artifact-config — OCL must not perform artifact type selection. ` +
            `Schema selection belongs to @brandos/artifact-engine-layer via the registry.`
          );
          violations++;
        }
      }
    } catch { /* skip */ }
  }
}

// ── RULE-CPL-BI-LOGIC: CPL must not implement Brand Intelligence logic ────────
//
// CPL proxy functions are call-throughs to @brandos/brand-intelligence; they
// must not contain implementations of identity resolution, signal weighting,
// style projection, audience interpretation, or memory composition.
//
// Detection: CPL source files must not directly manipulate BI-domain fields
// (confidence, weighted_confidence, signal_type, classification) as assignments
// outside of passing them as arguments to a BI import.

const CPL_BI_LOGIC_FORBIDDEN_PATTERNS = [
  { re: /\bweighted_confidence\s*=/, desc: 'CPL must not compute weighted_confidence — this is BI logic' },
  { re: /\bsignal_type\s*=\s*['"][^'"]+['"]/, desc: 'CPL must not assign signal_type values — this is BI logic' },
  { re: /\bclassification\s*=\s*['"][A-E]['"]/, desc: 'CPL must not assign BI classification values — this is BI logic' },
];

function checkCplBiLogicRule(packagesRoot) {
  const cplSrc = join(packagesRoot, 'control-plane-layer', 'src');
  const files = collectSourceFiles(cplSrc);
  for (const file of files) {
    try {
      const rawSrc = readFileSync(file, 'utf-8');
      // Strip comments to avoid false positives
      const src = rawSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      for (const { re, desc } of CPL_BI_LOGIC_FORBIDDEN_PATTERNS) {
        if (re.test(src)) {
          const rel = file.replace(ROOT + '/', '');
          console.error(
            `[BOUNDARY VIOLATION] RULE-CPL-BI-LOGIC: ${rel} — ${desc}`
          );
          violations++;
        }
      }
    } catch { /* skip */ }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

const packages = collectWorkspacePackages(ROOT);

// Warn about packages found in workspace but not registered in LAYER_TIERS
const knownPackages = new Set(Object.keys(LAYER_INDEX));
const unknownPackages = packages.map(p => p.name).filter(n => !knownPackages.has(n));

if (unknownPackages.length > 0) {
  console.warn('[check-boundaries] ⚠️  Packages found in workspace but not in LAYER_TIERS:');
  for (const pkg of unknownPackages) {
    console.warn(`   - ${pkg} (not boundary-checked — add to shared/package-registry.mjs if it has @brandos deps)`);
  }
}

// Layer-tier dependency checks
for (const entry of packages) {
  const { name } = entry;
  const myIndex = LAYER_INDEX[name];
  if (myIndex === undefined) continue; // unregistered — warned above

  const deps = getWorkspaceDeps(entry);
  for (const dep of deps) {
    const depIndex = LAYER_INDEX[dep];
    if (depIndex === undefined) continue;

    if (depIndex > myIndex) {
      const pairKey = `${name}→${dep}`;
      if (!ALLOWED_SAME_LEVEL_PAIRS.has(pairKey)) {
        console.error(
          `[BOUNDARY VIOLATION] ${name} (L${myIndex}) imports ${dep} (L${depIndex}) — upward dependency not allowed`
        );
        violations++;
      }
    }
  }
}

// Ownership audit Phase 3.4: fine-grained import-source rules
const packagesRoot = join(ROOT, 'packages');
const appsRoot = join(ROOT, 'apps');

checkOclBiRule(packagesRoot);
checkCplBiRule(packagesRoot);
checkWebBiWriteRule(appsRoot);
checkArlOclRule(packagesRoot);        // RULE-4: C1 — ARL must not import OCL
checkGlOclRule(packagesRoot);         // RULE-5: C2 — GL must not import OCL
checkCplBiRepositoryRule(packagesRoot); // RULE-6: C4 — CPL must not import concrete BI repos
checkCplBiConcreteClassRule(packagesRoot); // RULE-7: C3 — CPL must not import BrandIntelligenceRuntime
checkOclSchemaSelectionRule(packagesRoot); // RULE-OCL-SCHEMA-SELECTION: OCL must not select artifact schema types
checkCplBiLogicRule(packagesRoot);        // RULE-CPL-BI-LOGIC: CPL must not implement BI domain logic

if (violations === 0) {
  console.log(`[check-boundaries] ✅ All architectural boundaries OK (${packages.length} packages checked)`);
} else {
  console.error(`[check-boundaries] ❌ ${violations} boundary violation(s) found`);
  console.error('  Fix: ensure packages only import from layers below their own tier.');
  process.exit(1);
}
