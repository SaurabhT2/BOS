# BrandOS Claude Audit Package

Generated: 2026-07-02 16:35:30

## What's in this package

Canonical source-only package.

Included:
- apps/             (Next.js web app)
- packages/         (all @brandos/* packages)
- scripts/          (validation/bootstrap scripts)
- .context/         (generated architecture context — NEW)
- Root configs

Excluded:
- dist/, .next/, .turbo/
- node_modules/
- .env files
- transient files, binaries, caches

------------------------------------------------------------

## Start Here

0. CLAUDE_BOOTSTRAP.md (repo root) — START HERE. Generated synthesis of everything below: package/layer
                                      overview, required reading order, runtime flow highlights, critical
                                      packages, top 10 high-risk files, package ownership summary, the
                                      highest-value architectural rules, and the recommended agent workflow.
                                      Regenerated automatically by scripts/package-workspace.ps1 via
                                      
ode scripts/generate-claude-bootstrap.mjs (P4.2). It is a synthesis,
                                      not a replacement — it cites the files below for anything beyond a summary.

Read files in this order:

1. .context/system_inventory.generated.md  — one-page system overview
2. .context/monorepo_context.generated.md  — full package inventory + rules
3. .context/runtime_model.generated.md     — generation flow + aggregate model
4. .context/database_context.generated.md  — full schema + ownership map
5. .context/packages/<pkg>.generated.md    — per-package detail

These files were auto-generated from authoritative sources immediately before
packaging. They supersede any architecture notes in CLAUDE_AUDIT_CONTEXT.md.

Agenticity layer (P3.5 — added on top of the above, derives from it, does not replace it):

6. .context/agent_entrypoints.generated.md   — START HERE if you only know which package you're
                                                touching: one block per package — read-first pointers,
                                                public API, allowed/forbidden deps, owned tables,
                                                high-risk areas, typical tasks, consumers, applicable rules
7. .context/architecture_graph.generated.json — same ownership/dependency facts as #1-2, machine-readable
8. .context/dependency_impact.generated.json  — blast-radius / risk level before modifying a package
9. .context/runtime_trace.generated.md        — actual runtime call flow, re-verified against source on
                                                every regeneration (not just a description of intent)
10. .context/behavior_contracts.generated.json — what the major cross-package calls do on success/failure
11. .context/architecture_fixes.generated.md   — live governance-script output paired with the
                                                recommended fix; advisory only, never auto-applied

------------------------------------------------------------

## Package Graph

L0  @brandos/contracts            Zero-dependency contracts and shared types
L1  @brandos/shared-utils         Shared utilities and infrastructure helpers
L2  @brandos/auth                 Authentication/session infrastructure
L3a @brandos/runtime-config       Runtime configuration schemas
L3a @brandos/governance-config    Governance configuration schemas
L3a @brandos/artifact-config      Artifact configuration schemas
L3a @brandos/ui-admin             Admin UI configuration schemas
L3b @brandos/ai-runtime-layer     Runtime execution, providers, adapters, routing
L3b @brandos/output-control-layer Output normalization and compilation
L4  @brandos/governance-layer     Validation and scoring
L4  @brandos/iskill-runtime       ISkill execution lifecycle
L5  @brandos/artifact-engine-layer Artifact generation pipeline
L6  @brandos/brand-intelligence   Brand identity accumulation and projection
L7  @brandos/control-plane-layer  Orchestration and configuration
L8  @brandos/presentation-layer   UI components and presentation shells
L9  apps/web                      Next.js application

------------------------------------------------------------


## Generation Pipeline

node scripts/generate-schema-inventory.mjs
node scripts/generate-monorepo-context.mjs
node scripts/generate-package-contexts.mjs
node scripts/generate-database-context.mjs
node scripts/generate-runtime-model.mjs
node scripts/generate-system-inventory.mjs

# P3.5 — Agenticity Infrastructure Expansion (run after the above; none of
# these take a schema-path argument — see scripts/shared/table-ownership.mjs)
node scripts/generate-architecture-graph.mjs
node scripts/generate-dependency-impact.mjs
node scripts/generate-behavior-contracts.mjs
node scripts/generate-runtime-trace-context.mjs
node scripts/generate-architecture-fixes.mjs
node scripts/generate-agent-entrypoints.mjs

# P4.2 — Generated Claude Bootstrap (run last; synthesizes the .context/
# artifacts above into CLAUDE_BOOTSTRAP.md at the repo root)
node scripts/generate-claude-bootstrap.mjs

## Validation Scripts

node scripts/check-workspace.mjs
node scripts/check-boundaries.mjs
node scripts/check-route-boundaries.mjs
node scripts/check-exports.mjs
node scripts/lint-imports.mjs
node scripts/check-circular.mjs
