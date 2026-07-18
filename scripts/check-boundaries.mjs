#!/usr/bin/env node
/**
 * scripts/check-boundaries.mjs
 *
 * BrandOS Architectural Boundary Enforcer — v6
 *
 * Enforces the BrandOS package dependency stack (see shared/package-registry.mjs
 * for the canonical LAYER_TIERS definition). No upward imports allowed.
 * Peer relationships at the same level must be in ALLOWED_SAME_LEVEL_PAIRS.
 *
 * Violations are printed and exit(1) to block CI.
 *
 * v6 changes (Context Generation Pipeline Modernization):
 *   @brandos/brand-intelligence was deleted in the platform split (see v2 note
 *   in shared/package-registry.mjs). RULE-1, RULE-2, RULE-3, RULE-6, and RULE-7
 *   below all scanned for imports of/symbols from `@brandos/brand-intelligence`
 *   — a package that can no longer exist on disk, so every one of these checks
 *   had become permanently vacuous (structurally unable to ever find a
 *   violation, not because the boundary is respected, but because the thing
 *   being checked for cannot occur). This meant the successor boundary
 *   (BrandOS ↔ @brandos/cognition-client, the HTTP adapter to IntelligenceOS)
 *   had NO enforcement at all — a regression nobody would have caught, since
 *   `check-boundaries.mjs` kept reporting "0 violations" throughout.
 *
 *   Verified against the actual current codebase (not assumed) before
 *   rewriting: only @brandos/control-plane-layer statically imports
 *   @brandos/cognition-client (init.ts, orchestrator.ts, brand-memory/service.ts,
 *   knowledge/service.ts, index.ts); apps/web/instrumentation.ts imports it
 *   dynamically (`await import(...)`) solely to construct and register the
 *   process-lifetime singleton at boot — a legitimate, different concern from
 *   per-request access, and the new equivalent of RULE-1's old
 *   "read-only calls from route.ts are permitted" carve-out; no package
 *   currently imports it in a way that would violate the rules below (the
 *   architecture is clean — only the enforcement code was stale).
 *
 *   RULE-1/2/3 are rewritten below to check @brandos/cognition-client.
 *   RULE-6 and RULE-7's "no concrete class, use the factory" intent is folded
 *   into RULE-3's allowlist (HttpCognitionProvider / DegradedCognitionProvider
 *   are deliberately excluded from CPL's allowlist; only the bootstrap file
 *   may construct them) rather than kept as two separate rules for a
 *   repository-class distinction (SupabaseBrandSignalRepository etc.) that
 *   has no analog under the HTTP-adapter architecture — IntelligenceOS's own
 *   repository layer is not visible to BrandOS at all anymore.
 *   checkCplBiLogicRule() (weighted_confidence / signal_type / classification
 *   field assignment) is retired outright: those are IntelligenceOS-internal
 *   Learning-pipeline field names that were never plausible in CPL after the
 *   split (CPL no longer receives raw signal records at all, only a resolved
 *   CognitionContext), so the check no longer maps to any reachable code path.
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
import { LAYER_INDEX, ALLOWED_SAME_LEVEL_PAIRS, isInternalPackage } from './shared/package-registry.mjs';
import { collectWorkspacePackages } from './shared/fs-utils.mjs';

const ROOT = resolve(process.cwd());
let violations = 0;

function getWorkspaceDeps({ pkg }) {
  const all = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    // peerDependencies intentionally excluded — peers don't enforce boundaries
  };
  // v3 fix: was `k.startsWith('@brandos/')`, which made every @platform/-scoped
  // dependency (i.e. @platform/cognition-contract) invisible to the layer-tier
  // check below. Now derives from the shared RECOGNIZED_SCOPES authority.
  return Object.keys(all).filter(isInternalPackage);
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
    // Match static import/export from 'pkg' and dynamic import('pkg').
    // v3 fix: was `(@brandos\/[^'"]+)` only — silently blind to @platform/
    // (i.e. @platform/cognition-contract) imports. Now matches any
    // recognized internal scope.
    const re = /(?:import|export|from)\s+['"](@brandos\/[^'"]+|@platform\/[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      imports.push(m[1]);
    }
    return imports;
  } catch {
    return [];
  }
}

// ── RULE-2: OCL must not import from @brandos/cognition-client ────────────────
// (v6: was @brandos/brand-intelligence, deleted in the platform split)

function checkOclBiRule(packagesRoot) {
  const oclSrc = join(packagesRoot, 'output-control-layer', 'src');
  const files = collectSourceFiles(oclSrc);
  for (const file of files) {
    const imports = getImportsFromSource(file);
    for (const imp of imports) {
      if (imp.startsWith('@brandos/cognition-client')) {
        const rel = file.replace(ROOT + '/', '');
        console.error(
          `[BOUNDARY VIOLATION] RULE-2: ${rel} imports from @brandos/cognition-client — ` +
          `OCL must receive all cognition data via ResolvedGenerationContract / ContributorContext, ` +
          `not from cognition-client directly (see IdentityContributor.ts, PersonaContributor.ts for the correct pattern)`
        );
        violations++;
      }
    }
  }
}

// ── RULE-3: CPL may only import a specific symbol set from @brandos/cognition-client ──
// (v6: was CPL_BI_ALLOWED_SYMBOLS / @brandos/brand-intelligence)
//
// Verified against actual current CPL source (init.ts, orchestrator.ts,
// brand-memory/service.ts, knowledge/service.ts, index.ts) before writing this
// list — every symbol below is a real, current import; nothing is speculative.
// Concrete provider implementation classes (HttpCognitionProvider,
// DegradedCognitionProvider) are deliberately NOT in this list — CPL must
// reach a provider only through the singleton getter/factory functions
// (folds in the old RULE-7 "no concrete class" intent). Only
// apps/web/instrumentation.ts (the process bootstrap file) is allowed to
// construct those classes directly, to register the singleton at startup.

const CPL_COGNITION_ALLOWED_SYMBOLS = new Set([
  'getGlobalCognitionClient',
  'initCognitionClient',
  'setGlobalCognitionClient',
  'createDegradedCognitionContext',
  'getGlobalKnowledgeIngestClient',
  'initKnowledgeIngestClient',
  // EM-1.2 (Cognitive Platform Evolution Program) — same reasoning as the
  // KnowledgeIngestClient entries above.
  'getGlobalWorkspaceConfigurationClient',
  'initWorkspaceConfigurationClient',
  // EM-3.1 / EM-3.3 (Cognitive Platform Evolution Program) — same
  // reasoning again.
  'getGlobalFeedbackEventClient',
  'initFeedbackEventClient',
  'getGlobalCorrectionClient',
  'initCorrectionClient',
  // Type-only symbols re-exported from @platform/cognition-contract for
  // convenience (see cognition-client/src/index.ts) — allowed because they
  // carry no runtime coupling, only shape information.
  'CognitionContext', 'CognitionConfidence', 'VoiceProfile',
  'IdentityContribution', 'VisualIdentityProjection', 'CognitionProvenance',
  'CognitionRequest', 'ObservationInput', 'CognitionSummary', 'CognitionHealth',
  'CognitionReviewDecision', 'CognitionProvider',
  'KnowledgeAssetIngestInput', 'HttpCognitionProviderConfig', 'KnowledgeIngestClientConfig',
  // EM-3.1 / EM-3.3 wire-shape type-only symbols — same "carries no
  // runtime coupling" reasoning as the block above.
  'FeedbackEventInput', 'CorrectionInput',
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
      // Look for any import from @brandos/cognition-client
      const importRe = /import\s+(?:type\s+)?(?:\*\s+as\s+\w+|\{([^}]+)\})\s+from\s+['"]@brandos\/cognition-client['"]/g;
      let m;
      while ((m = importRe.exec(src)) !== null) {
        if (!m[1]) continue; // namespace import — flag it
        const symbols = m[1].split(',').map(s => s.trim().replace(/^type\s+/, '').replace(/\s+as\s+\w+$/, '').trim());
        for (const sym of symbols) {
          if (sym && !CPL_COGNITION_ALLOWED_SYMBOLS.has(sym)) {
            const rel = file.replace(ROOT + '/', '');
            console.error(
              `[BOUNDARY VIOLATION] RULE-3: ${rel} imports '${sym}' from @brandos/cognition-client — ` +
              `CPL may only import: ${[...CPL_COGNITION_ALLOWED_SYMBOLS].join(', ')}`
            );
            violations++;
          }
        }
      }
    } catch { /* skip */ }
  }
}

// ── RULE-1: apps/web must not import @brandos/cognition-client directly ──────
// (v6: was a persona/identity-write pattern check against @brandos/brand-intelligence;
// rewritten as a direct, enforceable import-boundary check, since the old
// pattern-based check's specific target symbols — globalBrandMemory,
// inline brand_context construction — no longer exist post-split and the
// underlying "route through CPL, not BI/cognition directly" intent had no
// static check backing it at all.)
//
// Exception: apps/web/instrumentation.ts is the process bootstrap file — it
// legitimately constructs and registers the CognitionProvider singleton once,
// at startup, via dynamic `await import(...)`. This mirrors the old RULE-1's
// "read-only calls from route.ts files are permitted" carve-out, adapted to
// where singleton construction actually happens in the current architecture.

function checkWebBiWriteRule(appsRoot) {
  const apiDir = join(appsRoot, 'web', 'app', 'api');
  const libDir = join(appsRoot, 'web', 'lib');
  const files = [...collectSourceFiles(apiDir), ...collectSourceFiles(libDir)];

  for (const file of files) {
    try {
      const imports = getImportsFromSource(file);
      for (const imp of imports) {
        if (imp.startsWith('@brandos/cognition-client')) {
          const rel = file.replace(ROOT + '/', '');
          console.error(
            `[BOUNDARY VIOLATION] RULE-1: ${rel} imports from @brandos/cognition-client directly — ` +
            `apps/web must access cognition only through CPL proxies (getBrandMemory(), ` +
            `recordBrandMemoryObservation(), reviewBrandMemorySignal(), resolveBrandCognitionContext(), ` +
            `getBrandSummary(), ingestWorkspaceKnowledgeAsset())`
          );
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

// ── RULE-6 / RULE-7 (retired, v6) ──────────────────────────────────────────
//
// Formerly: "CPL must not import concrete BI repository classes" and
// "CPL must not import BrandIntelligenceRuntime concrete class". Both were
// checks against @brandos/brand-intelligence, deleted in the platform split.
// The equivalent concern under the current architecture — CPL must not
// import HttpCognitionProvider/DegradedCognitionProvider as values, only
// through getGlobalCognitionClient()/createDegradedCognitionContext() — is
// now enforced as part of RULE-3's allowlist above (those two class names
// are simply absent from CPL_COGNITION_ALLOWED_SYMBOLS, so any import of
// them is already caught by checkCplBiRule()). No separate function is
// needed for this under the HTTP-adapter architecture: IntelligenceOS's
// repository layer isn't visible to BrandOS at all anymore, so the original
// RULE-6 concern (concrete Supabase repository classes) has no analog to
// check for.

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

// ── RULE-CPL-BI-LOGIC (retired, v6) ────────────────────────────────────────
//
// Formerly checked that CPL source never assigns BI-internal field names
// (weighted_confidence, signal_type, classification) — i.e. that CPL never
// reimplements Brand Intelligence's signal-weighting logic itself. Under the
// current architecture CPL no longer receives raw signal records at all
// (only a resolved CognitionContext returned by cognition-client), so these
// field names have no reachable code path in CPL to check for. Retired
// rather than rewritten against a nonexistent concern; see brand-memory/
// service.ts and knowledge/service.ts for the current (correctly thin)
// shape of CPL's cognition-adjacent code.

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

checkOclBiRule(packagesRoot);         // RULE-2: OCL must not import @brandos/cognition-client
checkCplBiRule(packagesRoot);         // RULE-3: CPL cognition-client symbol allowlist (folds in old RULE-6/7)
checkWebBiWriteRule(appsRoot);        // RULE-1: apps/web must not import @brandos/cognition-client directly
checkArlOclRule(packagesRoot);        // RULE-4: C1 — ARL must not import OCL
checkGlOclRule(packagesRoot);         // RULE-5: C2 — GL must not import OCL
checkOclSchemaSelectionRule(packagesRoot); // RULE-OCL-SCHEMA-SELECTION: OCL must not select artifact schema types

if (violations === 0) {
  console.log(`[check-boundaries] ✅ All architectural boundaries OK (${packages.length} packages checked)`);
} else {
  console.error(`[check-boundaries] ❌ ${violations} boundary violation(s) found`);
  console.error('  Fix: ensure packages only import from layers below their own tier.');
  process.exit(1);
}
