/**
 * scripts/shared/table-ownership.mjs
 *
 * Database ownership mapping — SINGLE SOURCE OF TRUTH.
 *
 * Derived from architecture knowledge encoded in monorepo_context.md + AGENT_CONTEXT
 * files. Update this map when ownership changes.
 *
 * PROVENANCE: extracted from scripts/generate-database-context.mjs (P3.5 —
 * Agenticity Infrastructure Expansion) so that generate-database-context.mjs and
 * the new architecture-intelligence generators (generate-architecture-graph.mjs,
 * generate-agent-entrypoints.mjs, generate-dependency-impact.mjs) consume the
 * exact same ownership data instead of each declaring their own copy.
 *
 * Per the P3.5 architectural rule ("Do NOT create new sources of truth — if
 * ownership information already exists, consume it, derive from it, reuse it"),
 * this file does not introduce a new authority; it relocates the pre-existing
 * one to a place multiple generators can import without duplication. The data
 * values are unchanged from their original location.
 *
 * v3 fix (Context Generation Pipeline Modernization):
 *   @brandos/brand-intelligence was deleted as part of the BrandOS /
 *   IntelligenceOS platform split (see scripts/shared/package-registry.mjs's
 *   own v2 note). This file still listed it as the owner AND sole writer of
 *   three tables (brand_memory_entries, identity_signals, identity_versions).
 *   A package that has been deleted cannot write anything — these tables
 *   currently have NO code-level writer at all. Rather than silently
 *   reassigning ownership to @brandos/cognition-client (which does not
 *   perform this role — it is a stateless HTTP adapter, not a data owner),
 *   these three entries are now marked `orphaned: true` with an explicit
 *   `owner: null`. This is a deliberate, visible "nobody currently owns
 *   this data" signal for generate-database-context.mjs's validation report,
 *   not a silent correction — see that generator's §Validation section and
 *   docs/architecture/GAP_ANALYSIS section (BrandOS Gap G-B2) for the
 *   required human decision (archive-and-drop vs. migrate into
 *   IntelligenceOS as historical seed data) before these rows are queried
 *   or acted on by any generator or script.
 */

export const TABLE_OWNERSHIP = {
  // ORPHANED — formerly owned/written by the now-deleted @brandos/brand-intelligence.
  // No current package writes these tables. See v3 fix note above; do not
  // reassign ownership without a human decision (Gap G-B2).
  brand_memory_entries:      { owner: null, readers: ['@brandos/control-plane-layer'], writers: [], orphaned: true, formerOwner: '@brandos/brand-intelligence' },
  identity_signals:          { owner: null, readers: ['@brandos/control-plane-layer'], writers: [], orphaned: true, formerOwner: '@brandos/brand-intelligence' },
  identity_versions:         { owner: null, readers: ['@brandos/control-plane-layer'], writers: [], orphaned: true, formerOwner: '@brandos/brand-intelligence' },

  // @brandos/auth owns (all DB CRUD flows through @brandos/auth)
  users:                     { owner: '@brandos/auth', readers: ['@brandos/auth', '@brandos/control-plane-layer'], writers: ['@brandos/auth'] },
  workspaces:                { owner: '@brandos/auth', readers: ['@brandos/auth', '@brandos/control-plane-layer'], writers: ['@brandos/auth'] },
  workspace_settings:        { owner: '@brandos/auth', readers: ['@brandos/auth', '@brandos/control-plane-layer'], writers: ['@brandos/auth', '@brandos/control-plane-layer'] },
  personas:                  { owner: '@brandos/auth', readers: ['@brandos/auth', '@brandos/control-plane-layer'], writers: ['@brandos/auth'] },
  campaigns:                 { owner: '@brandos/auth', readers: ['@brandos/auth', '@brandos/control-plane-layer'], writers: ['@brandos/auth', '@brandos/control-plane-layer'] },
  feedback:                  { owner: '@brandos/auth', readers: ['@brandos/auth'], writers: ['@brandos/auth'] },
  brand_assets:              { owner: '@brandos/auth', readers: ['@brandos/auth'], writers: ['@brandos/auth'] },

  // @brandos/control-plane-layer owns
  brandos_admin_settings:    { owner: '@brandos/control-plane-layer', readers: ['@brandos/control-plane-layer', 'apps/web'], writers: ['@brandos/control-plane-layer'] },
  brandos_artifact_approvals:{ owner: '@brandos/control-plane-layer', readers: ['@brandos/control-plane-layer', 'apps/web'], writers: ['@brandos/control-plane-layer'] },
  brandos_artifact_versions: { owner: '@brandos/control-plane-layer', readers: ['@brandos/control-plane-layer'], writers: ['@brandos/control-plane-layer'] },
  brandos_governance_audit:  { owner: '@brandos/control-plane-layer', readers: ['@brandos/control-plane-layer', 'apps/web'], writers: ['@brandos/governance-layer', '@brandos/control-plane-layer'] },
  brandos_provider_credentials: { owner: '@brandos/control-plane-layer', readers: ['@brandos/control-plane-layer', '@brandos/ai-runtime-layer'], writers: ['@brandos/control-plane-layer'] },
  brandos_provider_health:   { owner: '@brandos/control-plane-layer', readers: ['@brandos/control-plane-layer', '@brandos/ai-runtime-layer'], writers: ['@brandos/control-plane-layer', '@brandos/ai-runtime-layer'] },
  cp_telemetry:              { owner: '@brandos/control-plane-layer', readers: ['@brandos/control-plane-layer', 'apps/web'], writers: ['@brandos/control-plane-layer'] },
  cp_telemetry_summary:      { owner: '@brandos/control-plane-layer', readers: ['apps/web'], writers: ['database (view/materialised)'] },
};
