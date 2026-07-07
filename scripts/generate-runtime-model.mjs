#!/usr/bin/env node
/**
 * scripts/generate-runtime-model.mjs
 *
 * BrandOS Runtime Model Generator
 *
 * Generates .context/runtime_model.generated.md
 *
 * Explains the operational model of the system:
 *   - Core aggregates (Workspace, User, Persona, Campaign, Asset)
 *   - Brand Intelligence model (memory, signals, versions)
 *   - Runtime Configuration model (providers, health, settings)
 *   - Governance model (audits, approvals, versions)
 *   - Generation flow (canonical request lifecycle)
 *   - Active technical debt and migration status
 *
 * Authority sources:
 *   1. schema_inventory.json         — DB authority for all table/field references
 *   2. package-registry.mjs          — layer/package authority
 *   3. monorepo_context.md           — architectural authority (hand-authored)
 *
 * Usage:
 *   node scripts/generate-runtime-model.mjs [path/to/schema_inventory.json]
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { ensureDir, renderTimestamp } from './shared/context-utils.mjs';
import { LAYER_TIERS, KNOWN_PACKAGES, BUILD_ORDER } from './shared/package-registry.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT      = resolve(join(__dirname, '..'));
const OUT       = join(ROOT, '.context', 'runtime_model.generated.md');

// ── Schema loading (same logic as generate-database-context.mjs) ──────────────

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


function tableByName(tables, name) {
  return tables?.find(t => t.table === name) ?? null;
}

function colList(table) {
  if (!table) return '*(table not found in schema)*';
  return table.columns.map(c => `\`${c.column}\` (${c.type})`).join(', ');
}

// ── Render sections ───────────────────────────────────────────────────────────

function renderGenerationFlow() {
  return `## Canonical Generation Flow

*Derived from: monorepo_context.md + CPL orchestrator source*

\`\`\`
apps/web (API route)
  └─ runControlPlane(request)                       [@brandos/control-plane-layer]
       └─ CPLOrchestrator.orchestrate()
            ├─ resolveBrandCognitionContext()        [CPL proxy → BI runtime.resolve()]
            ├─ ContractAssemblerFactory.create()     [@brandos/output-control-layer]
            │   └─ Contributors:
            │       ├─ PersonaContributor            [self-contained, no BI delegation — WS3]
            │       └─ IdentityContributor
            ├─ compilePromptFromContract()           [@brandos/output-control-layer]
            ├─ callWithMode()                        [@brandos/ai-runtime-layer — LLM call]
            └─ (structured tasks: carousel/deck/report)
                 └─ executeArtifactPipeline()        [CPL → @brandos/artifact-engine-layer]
                      └─ globalArtifactEngine.compileAndGovern()
                           ├─ OCL compile*Artifact()
                           ├─ governance.validate*Artifact()
                           └─ repair loop (max 2 attempts)
  └─ recordBrandMemoryObservation()                 [CPL proxy → BI, fire-and-forget]
\`\`\`

### Key Invariants

- All LLM calls go through \`callWithMode()\` in \`@brandos/ai-runtime-layer\`. No direct provider calls.
- Raw LLM output NEVER reaches \`@brandos/governance-layer\` — OCL normalises first (Rule 4 — OCL-First Law).
- \`apps/web\` routes call \`runControlPlane()\` only. No direct AI/governance imports.
- Brand intelligence is fire-and-forget: observation recording does not block response delivery.
- CPL proxy functions are the only BI surface visible to \`apps/web\`.

`;
}

function renderCoreAggregates(tables) {
  const ws  = tableByName(tables, 'workspaces');
  const usr = tableByName(tables, 'users');
  const per = tableByName(tables, 'personas');
  const cam = tableByName(tables, 'campaigns');
  const ast = tableByName(tables, 'brand_assets');
  const ws_settings = tableByName(tables, 'workspace_settings');

  return `## Core Aggregates

*Derived from: schema_inventory.json*

### Workspace
Table: \`workspaces\`
Fields: ${colList(ws)}

**Workspace is the root aggregate.** Every user, persona, campaign, asset, and brand
memory entry is scoped to a workspace. Brand intelligence resolution always receives
a \`workspaceId\`.

### User
Table: \`users\`
Fields: ${colList(usr)}

User belongs to a workspace (\`workspace_id FK\`). \`is_platform_admin\` gates all
\`/api/admin/*\` routes via \`requireAdmin()\`.

### Persona
Table: \`personas\`
Fields: ${colList(per)}

Persona is a named content voice (tone, domain, audience, key_themes, visual_style).
One persona per workspace may have \`is_default = true\`. Campaigns reference a
persona via \`persona_id FK\`.

> ⚠️ **Debt:** \`auth.createPersona()\` is missing. The \`/api/persona/\` route writes
> directly to Supabase. This bypasses the auth DB layer pattern.

### Campaign
Table: \`campaigns\`
Fields: ${colList(cam)}

Campaign is the primary generation artifact container. \`cp_request_id\` links a
campaign to its control-plane telemetry record. \`content\` (jsonb) stores the
generated ArtifactV2 payload.

### Brand Asset
Table: \`brand_assets\`
Fields: ${colList(ast)}

Binary assets associated with a workspace. \`vlm_analysis\` (jsonb) stores the
visual language model analysis result. Assets feed brand cognition context resolution.

### Workspace Settings
Table: \`workspace_settings\`
Fields: ${colList(ws_settings)}

1:1 with workspaces. Controls runtime provider selection (\`preferred_provider\`,
\`runtime_mode\`), governance threshold (\`governance_score_threshold\`), and
generation limits (\`monthly_generation_limit\`, \`asset_storage_limit_mb\`).

`;
}

function renderBrandIntelligenceModel(tables) {
  const bme = tableByName(tables, 'brand_memory_entries');
  const sig = tableByName(tables, 'identity_signals');
  const ver = tableByName(tables, 'identity_versions');

  return `## Brand Intelligence Model

*Derived from: schema_inventory.json + @brandos/brand-intelligence architecture*

Owner: **\`@brandos/brand-intelligence\`** (L6)
CPL access via proxy functions only.

### brand_memory_entries
Fields: ${colList(bme)}

V2 memory store. Each entry has a \`classification\` (single char: A/B/C/D/E),
\`status\` (\`pending_review\` | \`approved\` | \`rejected\`), \`confidence\`,
\`frequency\`, and decay fields (\`decay_rate\`, \`decayed_at\`, \`last_seen_at\`).

Key indexes:
- \`idx_bme_v2_workspace_class_status\` — primary query path for cognition resolution
- \`idx_bme_v2_last_seen_status\` — decay processing
- \`idx_bme_v2_topic_hash\` — topic diversity tracking

### identity_signals
Fields: ${colList(sig)}

Fine-grained brand identity signals. Keyed by \`(workspace_id, persona_id, dimension,
signal_type)\`. \`weighted_confidence\` is the effective signal strength after
frequency and recency weighting.

### identity_versions
Fields: ${colList(ver)}

Snapshot history of resolved identity at a point in time. \`is_current = true\`
marks the live snapshot. \`snapshot\` (jsonb) is the full resolved identity object.

### Signal Lifecycle

\`\`\`
LLM output scored by @brandos/governance-layer
  → CPLOrchestrator.recordBrandMemoryObservation() (fire-and-forget)
    → BI runtime.recordArtifactObservation()
      → BrandMemoryServiceV2.upsertSignal()
        → brand_memory_entries (status: pending_review)
          → admin reviews via /api/admin/brand-memory
            → brand_memory_entries (status: approved)
              → feeds next resolveBrandCognitionContext()
\`\`\`

### CPL Proxy Surface

| Proxy (in @brandos/control-plane-layer) | BI Method |
|---|---|
| \`getBrandMemory(workspaceId, classification?)\` | \`runtime.getMemory()\` |
| \`recordBrandMemoryObservation(input)\` | \`runtime.recordArtifactObservation()\` |
| \`reviewBrandMemorySignal(wsId, entryId, approved, reviewedBy)\` | \`runtime.review()\` |
| \`resolveBrandCognitionContext(request)\` | \`runtime.resolve()\` |
| \`getBrandSummary({ workspaceId, personaId? })\` | \`runtime.getBrandSummary()\` |

`;
}

function renderRuntimeConfigModel(tables) {
  const cred   = tableByName(tables, 'brandos_provider_credentials');
  const health = tableByName(tables, 'brandos_provider_health');
  const admin  = tableByName(tables, 'brandos_admin_settings');
  const ws_s   = tableByName(tables, 'workspace_settings');

  return `## Runtime Configuration Model

*Derived from: schema_inventory.json + @brandos/runtime-config + @brandos/control-plane-layer*

### Provider Credentials
Table: \`brandos_provider_credentials\`
Fields: ${colList(cred)}

Encrypted API keys per provider. \`encrypted_key\`, \`iv\`, \`auth_tag\` are AES-GCM
encrypted at rest. Owner: \`@brandos/control-plane-layer\`.

### Provider Health
Table: \`brandos_provider_health\`
Fields: ${colList(health)}

Rolling health checks per provider. \`healthy\`, \`latency_ms\`, \`reason\`,
\`checked_at\`. Read by \`@brandos/ai-runtime-layer\` for routing decisions.

### Admin Settings
Table: \`brandos_admin_settings\`
Fields: ${colList(admin)}

Platform-level admin configuration. \`section\` + \`id\` key. \`data\` (jsonb)
is the full settings blob. Consumed by \`AdminSettingsService\` in CPL.

### Provider Routing Model

\`\`\`
@brandos/runtime-config
  → ProviderSettingsSchema (priority, enabled, protocol, timeout, health)
    → toAIRuntimeConfig()
      → @brandos/ai-runtime-layer
        → callWithMode(mode, prompt)
          ├─ provider selection (priority-ordered, health-filtered)
          ├─ retry budget (from AIRuntimePolicy)
          ├─ circuit breaker (CircuitBreaker from @brandos/shared-utils)
          └─ fallback chain (FallbackRule from @brandos/contracts)
\`\`\`

`;
}

function renderGovernanceModel(tables) {
  const audit    = tableByName(tables, 'brandos_governance_audit');
  const approval = tableByName(tables, 'brandos_artifact_approvals');
  const version  = tableByName(tables, 'brandos_artifact_versions');

  return `## Governance Model

*Derived from: schema_inventory.json + @brandos/governance-layer + @brandos/governance-config*

Owner: **\`@brandos/control-plane-layer\`** (orchestration) + **\`@brandos/governance-layer\`** (scoring/validation)

### Governance Audit
Table: \`brandos_governance_audit\`
Fields: ${colList(audit)}

Immutable record of every governance evaluation. \`passed\`, \`score\`,
\`violations\` (jsonb array), \`repaired\`, \`repair_attempts\`.

### Artifact Approvals
Table: \`brandos_artifact_approvals\`
Fields: ${colList(approval)}

Human-in-the-loop approval workflow. Created when \`score < DEFAULT_APPROVAL_SCORE_THRESHOLD\` (70).
\`approval_status\`: \`pending\` | \`approved\` | \`rejected\`.

### Artifact Versions
Table: \`brandos_artifact_versions\`
Fields: ${colList(version)}

Versioned artifact stamp per request. \`version\` increments on repair. \`score\`
is the governance score at stamp time.

### Governance Thresholds (from @brandos/governance-config)

| Constant | Value | Meaning |
|---|---|---|
| \`DEFAULT_PASS_THRESHOLD\` | 65 | Minimum score to pass governance without repair |
| \`DEFAULT_APPROVAL_SCORE_THRESHOLD\` | 70 | Score below which human approval is required |

### Governance Flow

\`\`\`
compileAndGovern(input)
  ├─ OCL compile*Artifact()        → ArtifactV2 (typed, structured)
  ├─ governance.validate*Artifact() → GovernanceResult { score, passed, violations }
  │   ├─ score >= 65 → PASS → stamp artifact version → deliver
  │   └─ score < 65  → attempt repair (max 2 attempts)
  │       ├─ repair succeeds → re-validate → stamp → deliver
  │       └─ repair fails    → ArtifactEngineRejection
  └─ write brandos_governance_audit row (always)
\`\`\`

`;
}

function renderTelemetryModel(tables) {
  const tel = tableByName(tables, 'cp_telemetry');
  const sum = tableByName(tables, 'cp_telemetry_summary');

  return `## Telemetry Model

*Derived from: schema_inventory.json*

### cp_telemetry
Fields: ${colList(tel)}

One row per \`runControlPlane()\` invocation. Tracks \`task_type\`,
\`provider\`, \`model_id\`, \`latency_ms\`, \`initial_score\`, \`final_score\`,
\`tokens_used\`, \`cost_estimate_usd\`, \`policy_violations\`, \`failure_reasons\`.

### cp_telemetry_summary
Fields: ${colList(sum)}

Materialised daily summary view over \`cp_telemetry\`. Used by admin dashboards.

> ⚠️ **Debt (PostHog stubs):** \`@brandos/telemetry-store\` does not exist.
> Migration 3 (Telemetry Store) not started. PostHog integration is stubbed.

`;
}

function renderActiveTechDebt() {
  return `## Active Technical Debt

*Derived from: monorepo_context.md "Active Debt" section*

| ID | Description | Blocked on |
|---|---|---|
| ISSUE-3 | \`scripts/Test/\` generation tests not in turbo pipeline | — |
| ISSUE-4 | Several routes type \`supabase\` as \`any\` | — |
| ISkill gate | \`@brandos/iskill-runtime\` production-gated (Phase 2.6) | Human gate-lift |
| remix() | Not implemented — blocked on ISkill Phase 2.6 | Phase 2.6 |
| availableFormats() | Returns static list — should query artifact registry dynamically | — |
| globalThis bridge | \`globalThis.__brandos_runtime_adapter\` bridge cleanup | Phase 1.1 |
| PostHog stubs | \`@brandos/telemetry-store\` does not exist. Migration 3 not started | — |
| createPersona() | \`auth.createPersona()\` missing — persona create route writes directly to Supabase | — |

### Resolved (Cleanup Sprint 2)

| Fix | Resolution |
|---|---|
| Fix C1 — ARL → OCL | globalThis bridge |
| Fix C2 — GL → OCL for JSON utils | moved to shared-utils |
| Fix C3 — CPL importing BI concrete class | factory function |
| Fix C4 — CPL importing BI repository class | factory function |
| Fix G1 — BI updatePersonaProfile deprecated | fully removed |
| Fix G2 — BI resolvePersonaContribution deprecated | fully removed; PersonaContributor self-contained |
| WS1 — PL re-exporting auth | removed; PLAuthProvider/PLAuthBridge introduced |
| WS2 — OCL importing governance-config | structural constraints moved to contracts |
| WS3 — PersonaContributor BI delegation shim | removed; self-contained |
| apps/web BI direct imports | all 4 routes replaced with CPL proxies |

`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  console.log('[generate-runtime-model] Starting…');
  const tables = loadSchema();
  if (!tables) {
    console.warn('[generate-runtime-model] ⚠️  schema_inventory.json not found — table field lists will be empty.');
  }
  ensureDir(join(ROOT, '.context'));

  const md = [
    '# BrandOS Runtime Model (Generated)\n',
    `> **Generated:** ${renderTimestamp()}`,
    '> **Authority:** `schema_inventory.json` (DB) · `package-registry.mjs` (layers) · `monorepo_context.md` (architecture)',
    '> ⚠️ Do not edit — regenerated by `scripts/generate-runtime-model.mjs`\n',
    '---\n',
    renderGenerationFlow(),
    renderCoreAggregates(tables),
    renderBrandIntelligenceModel(tables),
    renderRuntimeConfigModel(tables),
    renderGovernanceModel(tables),
    renderTelemetryModel(tables),
    renderActiveTechDebt(),
  ].join('\n');

  writeFileSync(OUT, md);
  console.log(`[generate-runtime-model] ✅ Written: .context/runtime_model.generated.md`);
}

main();
