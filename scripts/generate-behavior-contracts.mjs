#!/usr/bin/env node
/**
 * scripts/generate-behavior-contracts.mjs
 *
 * BrandOS Behavior Contract Registry Generator (P3.5 — Deliverable 4)
 *
 * Generates .context/behavior_contracts.generated.json — what each major
 * cross-package interaction actually does: inputs, outputs, failure modes,
 * and fallbacks, so an agent can reason about behavior without reading the
 * implementations.
 *
 * Covers the six pairs named in the P3.5 brief:
 *   CPL ↔ cognition-client · CPL ↔ OCL · CPL ↔ AI Runtime · CPL ↔ Artifact Engine ·
 *   OCL ↔ Governance · Auth ↔ CPL
 *
 * Unlike a dependency or ownership map, "what does this interaction do on
 * failure" is not recorded anywhere else in the repo as structured data —
 * it lives only as control flow inside the implementations. There is no
 * existing authority to consume for *this specific question*, so this file
 * is necessarily hand-curated from a direct reading of the cited call
 * sites (see `callSite` / `targetDefinition` / `notes` on each entry).
 *
 * To keep that curation honest rather than a frozen snapshot, every entry
 * carries a `verify` spec (a file + literal substrings that must still be
 * present in it) which is re-checked every time this generator runs. A
 * `verified: false` on regeneration means the cited code moved or was
 * renamed and the contract description below it needs a human re-read —
 * this generator does not silently keep stale claims looking authoritative.
 *
 * Usage: node scripts/generate-behavior-contracts.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

import { ensureDir, renderTimestamp } from './shared/context-utils.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(join(__dirname, '..'));
const OUT = join(ROOT, '.context', 'behavior_contracts.generated.json');

function readSafe(absPath) {
  try { return readFileSync(absPath, 'utf8'); } catch { return null; }
}

function verify(spec) {
  if (!spec) return { checked: false };
  const src = readSafe(join(ROOT, spec.file));
  if (src === null) return { checked: true, verified: false, reason: `file not found: ${spec.file}` };
  const missing = spec.mustContain.filter((token) => !src.includes(token));
  return missing.length
    ? { checked: true, verified: false, reason: `missing: ${missing.join(', ')}` }
    : { checked: true, verified: true };
}

// ── Contract definitions ────────────────────────────────────────────────
// Hand-curated from direct source reading (see provenance note above).
// File:line citations point at the call site actually exercised by the
// main generation flow (apps/web -> CPL.orchestrate()), not every place
// the underlying function could theoretically be invoked from.

const CONTRACTS = [
  {
    source: '@brandos/control-plane-layer',
    target: '@brandos/cognition-client',
    contract: 'HttpCognitionProvider.resolveCognitionContext() (via getGlobalCognitionClient())',
    kind: 'function-call',
    callSite: 'packages/control-plane-layer/src/orchestrator.ts (CPLOrchestrator.orchestrate(), Step 1)',
    targetDefinition: 'packages/cognition-client/src/index.ts (getGlobalCognitionClient) -> HTTP POST to IntelligenceOS apps/api (separate repository)',
    inputs: ['workspaceId', 'taskType?'],
    outputs: ['CognitionContext — { contractVersion, workspaceId, resolvedAt, confidence, voice, identity, visualIdentity, provenance }'],
    failureModes: ['HTTP request to IntelligenceOS fails, times out, or returns an error (network failure, IntelligenceOS outage, malformed response)'],
    fallbacks: [
      'CPLOrchestrator wraps the call in try/catch; on rejection it logs a warning and substitutes '
        + 'createDegradedCognitionContext() (a standalone function, never a concrete provider class — '
        + 'RULE-3). Generation continues without resolved cognition context rather than failing the request.',
    ],
    notes: 'This replaced the pre-platform-split BrandIntelligenceRuntime.resolve() in-process call '
      + '(v6 architecture rewrite — @brandos/brand-intelligence was deleted). A second, equivalent proxy — '
      + 'resolveBrandCognitionContext() in packages/control-plane-layer/src/brand-memory/service.ts — wraps '
      + 'the same getGlobalCognitionClient().resolveCognitionContext() call for other CPL-internal callers; '
      + 'this is the function named in the CPL proxy surface table '
      + '(.context/packages/control-plane-layer.generated.md). Both paths hit the same cognition-client '
      + 'method with the same failure/fallback contract.',
    verify: {
      file: 'packages/control-plane-layer/src/orchestrator.ts',
      mustContain: ['createDegradedCognitionContext', 'getGlobalCognitionClient'],
    },
  },
  {
    source: '@brandos/control-plane-layer',
    target: '@brandos/output-control-layer',
    contract: 'ContractAssemblerFactory.create() → assemble() → compilePromptFromContract()',
    kind: 'function-call',
    callSite: 'packages/control-plane-layer/src/orchestrator.ts (CPLOrchestrator.orchestrate(), Step 2)',
    targetDefinition: 'packages/output-control-layer/src/contract-assembler/ContractAssemblerFactory.ts; '
      + 'packages/output-control-layer/src/prompt-compiler/compilePromptFromContract.ts',
    inputs: ['ResolvedGenerationContract — folded output of 5 contributors: identity, persona, intent, artifact, runtime'],
    outputs: ['CompiledPrompt { system, user } — the literal text sent to the model'],
    failureModes: ['A contributor throws during assemble() (e.g. malformed brand or persona context passed through from Step 1)'],
    fallbacks: [
      'None observed at this call site specifically — unlike the brand-cognition step (Step 1), there is no '
        + 'local try/catch around prompt assembly/compilation in orchestrator.ts. A failure here propagates to '
        + 'whatever caught runControlPlane() at the route level. Re-check orchestrator.ts before assuming '
        + 'otherwise if this matters for an incident.',
    ],
    notes: '`ContractAssemblerFactory.create()` runs per-request, not at boot — there is no startup singleton '
      + 'for this assembler (see .context/runtime_trace.generated.md §4).',
    verify: {
      file: 'packages/output-control-layer/src/contract-assembler/ContractAssemblerFactory.ts',
      mustContain: ['IdentityContributor', 'PersonaContributor', 'IntentContributor', 'ArtifactContributor', 'RuntimeContributor'],
    },
  },
  {
    source: '@brandos/control-plane-layer',
    target: '@brandos/ai-runtime-layer',
    contract: 'callWithMode()',
    kind: 'function-call',
    callSite: 'packages/control-plane-layer/src/orchestrator.ts',
    targetDefinition: 'packages/ai-runtime-layer/src/llmRouter.ts',
    inputs: ['prompt (compiled.user string)', 'runtimeMode', '{ systemPrompt, taskType, userId }'],
    outputs: ['RuntimeResult on success; a structured "unavailable" result (checked via isUnavailable()) rather than a throw, when no provider can serve the request'],
    failureModes: ['Every registered provider/adapter is unavailable, rate-limited, or circuit-broken'],
    fallbacks: [
      'CPLOrchestrator checks isUnavailable(runtimeResult) and throws a CPL-level error that names the '
        + 'underlying message. There is no further provider fallback or retry at this call site beyond what '
        + "ARL's own CircuitBreaker / RateLimiter already attempted internally before returning.",
    ],
    notes: 'CPL injects per-workspace runtime overrides into ARL via setRuntimeConfigProvider() '
      + '(wired lazily on first admin-settings load — see runtime_trace.generated.md §1), not by passing '
      + 'config through this call.',
    verify: {
      file: 'packages/control-plane-layer/src/orchestrator.ts',
      mustContain: ['callWithMode', 'isUnavailable'],
    },
  },
  {
    source: '@brandos/control-plane-layer',
    target: '@brandos/artifact-engine-layer',
    contract: 'executeArtifactPipeline() → globalArtifactEngine.compileAndGovern()',
    kind: 'function-call',
    callSite: 'apps/web routes (e.g. app/api/generate/route.ts) call executeArtifactPipeline() as a second, '
      + 'separate top-level call after runControlPlane() returns — see runtime_trace.generated.md §2. '
      + 'executeArtifactPipeline() itself (packages/control-plane-layer/src/artifact-pipeline.ts) then calls '
      + 'globalArtifactEngine.compileAndGovern() once per pipeline run.',
    targetDefinition: 'packages/artifact-engine-layer/src/engine.ts (compileAndGovern())',
    inputs: ['ArtifactPipelineInput { taskType, requestId, runtimeMode, raw LLM output, … }'],
    outputs: ['ArtifactPipelineResult<ArtifactV2> — governed, schema-asserted artifact + governance score + attempt history'],
    failureModes: [
      'taskType has no registered compiler/governance pair (throws — "No pipeline registered for taskType")',
      'compileAndGovern() exhausts MAX_REPAIR_ATTEMPTS (3) without reaching a passing governance score',
    ],
    fallbacks: [
      'On a failing governance score, compileAndGovern() recompiles with repair guidance and re-governs, up '
        + 'to MAX_REPAIR_ATTEMPTS times, before surfacing a failed result to executeArtifactPipeline().',
    ],
    notes: 'Per an in-repo historical note ("AB-002 FIX", packages/control-plane-layer/src/artifact-pipeline.ts '
      + '~line 496), Phase C lifecycle (audit trail, versioning, approval) previously ran inside '
      + 'CPLOrchestrator AND inside executeArtifactPipeline, double-running governance on two different '
      + 'artifact instances. The current design — orchestrator returns raw text only; executeArtifactPipeline '
      + 'is the single governed path — is the fix. This corroborates, from the code\'s own history, the §2 '
      + 'finding that the two functions are sequential top-level calls rather than nested ones.',
    verify: {
      file: 'packages/control-plane-layer/src/artifact-pipeline.ts',
      mustContain: ['globalArtifactEngine', 'compileAndGovern', 'AB-002'],
    },
  },
  {
    source: '@brandos/output-control-layer',
    target: '@brandos/governance-layer',
    contract: 'ArtifactV2 schema contract (no direct import either direction)',
    kind: 'data-shape-contract',
    callSite: 'packages/artifact-engine-layer/src/compiler/*.ts and src/governance/*.ts (adapter classes — '
      + 'the only code that imports both packages)',
    targetDefinition: 'packages/artifact-engine-layer/src/engine.ts (assertCompiledArtifact())',
    inputs: ['Raw LLM output (string) into the OCL compiler side'],
    outputs: ['ArtifactV2 object carrying `$schema: "artifact-json@2.0"`, produced by OCL and consumed as-is by governance-layer\'s validators'],
    failureModes: ['OCL compiler output does not carry the expected $schema marker'],
    fallbacks: ['assertCompiledArtifact() throws immediately, before governance-layer ever sees the artifact — there is no silent shape-coercion fallback.'],
    notes: 'RULE-2 and RULE-5 forbid an import edge between these two packages in either direction. '
      + '@brandos/artifact-engine-layer is structurally the only package that has ever imported both; its '
      + 'per-type Compiler/GovernanceAdapter class pairs are the entire contract between OCL and governance-layer. '
      + 'There is no function call from one to the other — the contract is purely the data shape both sides agree on.',
    verify: {
      file: 'packages/artifact-engine-layer/src/engine.ts',
      mustContain: ['assertCompiledArtifact', 'artifact-json@2.0'],
    },
  },
  {
    source: '@brandos/auth',
    target: '@brandos/control-plane-layer',
    contract: 'getWorkspaceSettings() / getWorkspaceById()',
    kind: 'function-call',
    callSite: 'packages/control-plane-layer/src/workspace/settings-resolver.ts',
    targetDefinition: 'packages/auth/src/db/dbService.ts',
    inputs: ['workspaceId'],
    outputs: ['DbResult<WorkspaceSettingsRow> / DbResult<WorkspaceRow> — { data, error } tuple, never a throw'],
    failureModes: ['Supabase query returns an error (row missing, RLS denial, transient DB error)'],
    fallbacks: [
      'auth functions never throw on a query failure — they return { data: null, error: message }. CPL\'s '
        + 'settings-resolver is responsible for deciding what a null result means for the caller (e.g. '
        + 'falling back to workspace defaults); the failure is a value, not an exception, by the time it '
        + 'reaches CPL.',
    ],
    notes: 'This is the one contract pair in this registry where the dependency direction is the reverse of '
      + 'the package layer order intuition might suggest: @brandos/auth (L2) is lower-tier than '
      + '@brandos/control-plane-layer (L8), so CPL importing auth is the normal, allowed direction '
      + '(RULE-LAYER-ORDER) — listed here as "Auth ↔ CPL" per the P3.5 brief\'s naming, the call direction is CPL → auth.',
    verify: {
      file: 'packages/control-plane-layer/src/workspace/settings-resolver.ts',
      mustContain: ['getWorkspaceSettings', 'getWorkspaceById'],
    },
  },
];

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  console.log('[generate-behavior-contracts] Starting…');

  const contracts = CONTRACTS.map((c) => {
    const { verify: verifySpec, ...rest } = c;
    return { ...rest, verification: verify(verifySpec) };
  });

  const unverified = contracts.filter((c) => c.verification.checked && !c.verification.verified);

  const output = {
    _meta: {
      generated: renderTimestamp(),
      generator: 'scripts/generate-behavior-contracts.mjs',
      purpose: 'What each major cross-package interaction does — inputs, outputs, failure modes, fallbacks — '
        + 'so an agent can reason about behavior without reading the implementations.',
      provenance: 'Hand-curated from direct source reading (no existing authority records failure-mode/fallback '
        + 'behavior as structured data); each entry carries a live-checked `verification` field so drift in the '
        + 'underlying code is visible on the next regeneration rather than silently going stale.',
      contractCount: contracts.length,
      unverifiedCount: unverified.length,
      ...(unverified.length ? { unverifiedContracts: unverified.map((c) => `${c.source} -> ${c.target}: ${c.contract}`) } : {}),
    },
    contracts,
  };

  ensureDir(join(ROOT, '.context'));
  writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
  console.log(`[generate-behavior-contracts] ✅ ${relative(ROOT, OUT)} (${contracts.length} contracts, ${unverified.length} unverified)`);
}

main();
