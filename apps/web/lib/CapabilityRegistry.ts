/**
 * apps/web — CapabilityRegistry.ts
 *
 * Runtime capability ownership registry for the web application.
 * Maps capability keys to their owning route/lib module.
 *
 * Usage:
 *   import { WebAppCapabilityRegistry } from './CapabilityRegistry'
 *   WebAppCapabilityRegistry.owns('generation.carousel')  // → true
 *   WebAppCapabilityRegistry.get('generation.carousel')   // → CapabilityEntry
 *   WebAppCapabilityRegistry.list()                       // → CapabilityEntry[]
 *   WebAppCapabilityRegistry.keys()                       // → CapabilityKey[]
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type CapabilityKey =
  // Generation
  | 'generation.text'
  | 'generation.carousel'
  | 'generation.deck'
  | 'generation.report'
  | 'generation.progress'
  | 'generation.transform'
  | 'generation.plan'
  | 'generation.campaigns-list'
  // Artifact
  | 'artifact.export'
  // Admin
  | 'admin.providers'
  | 'admin.provider-test'
  | 'admin.runtime-debug'
  | 'admin.local-models'
  | 'admin.iskill-test'
  // Observability (routing routes removed — were unauthenticated in-memory stubs)
  | 'observability.brand-memory'
  | 'observability.experiments'
  | 'observability.prompt-library'
  | 'observability.score-history'
  | 'observability.webhooks'
  | 'observability.telemetry'
  // Utility
  | 'utility.health'
  // utility.vlm-analyze REMOVED — route deleted (redesign cleanup). Superseded
  // by app/api/assets/[id]/analyze/route.ts, which calls Anthropic directly
  // instead of through the CPL orchestrator (which drops image attachments
  // before reaching the provider adapter — see that route's header comment).
  // Had zero frontend callers; verified via repo-wide reference search.
  | 'utility.upload'
  | 'utility.extract-from-url'
  | 'utility.persona'
  | 'utility.feedback'
  | 'utility.models'
  | 'utility.memory'
  // Auth
  | 'auth.user'
  | 'auth.admin'

export type CapabilityStatus = 'active' | 'deprecated' | 'experimental'

export interface CapabilityEntry {
  key:         CapabilityKey
  owner:       string           // route path or lib/ module
  description: string
  status:      CapabilityStatus
  pipelineEntry: 'control-plane' | 'admin' | 'observability' | 'utility' | 'auth'
  issues?:     string[]
}

// ─── Registry data ────────────────────────────────────────────────────────────

const ENTRIES: CapabilityEntry[] = [
  // ── Generation ──────────────────────────────────────────────────────────────
  { key: 'generation.text',         owner: 'app/api/generate/route.ts',                  description: 'Text post/article/campaign generation via runControlPlane()',           status: 'active', pipelineEntry: 'control-plane' },
  { key: 'generation.carousel',     owner: 'app/api/generate/route.ts + app/api/carousel/route.ts', description: 'Carousel artifact generation via executeArtifactPipeline()', status: 'active', pipelineEntry: 'control-plane' },
  { key: 'generation.deck',         owner: 'app/api/generate/route.ts',                  description: 'Deck artifact generation via executeArtifactPipeline()',                status: 'active', pipelineEntry: 'control-plane' },
  { key: 'generation.report',       owner: 'app/api/generate/route.ts',                  description: 'Report artifact generation via executeArtifactPipeline()',              status: 'active', pipelineEntry: 'control-plane' },
  { key: 'generation.progress',     owner: 'app/api/generate-with-progress/route.ts',    description: 'Streaming progress events during generation',                           status: 'active', pipelineEntry: 'control-plane' },
  { key: 'generation.transform',    owner: 'app/api/transform/route.ts',                 description: 'Multi-format content repurposing via transformAgent',                   status: 'active', pipelineEntry: 'control-plane' },
  { key: 'generation.plan',         owner: 'app/api/planner/route.ts',                   description: 'Content planning agent',                                                status: 'active', pipelineEntry: 'control-plane' },
  { key: 'generation.campaigns-list', owner: 'app/api/campaigns/route.ts',               description: 'List workspace campaigns/content rows (NEW — redesign)',                status: 'active', pipelineEntry: 'control-plane' },

  // ── Artifact ────────────────────────────────────────────────────────────────
  { key: 'artifact.export',         owner: 'app/api/artifact/export/route.ts',           description: 'Export governed ArtifactV2 to file formats',                           status: 'active', pipelineEntry: 'control-plane' },

  // ── Admin ────────────────────────────────────────────────────────────────────
  { key: 'admin.providers',         owner: 'app/api/admin/providers/route.ts',           description: 'Provider settings CRUD (enable/disable/reorder)',                       status: 'active', pipelineEntry: 'admin' },
  // admin.settings REMOVED — route deleted (Sprint A). Use v2 endpoints: /api/v2/runtime/config, /api/v2/governance/policy, /api/v2/artifact/config
  { key: 'admin.provider-test',     owner: 'app/api/v2/runtime/providers/[id]/test/route.ts', description: 'Provider connectivity test — returns health + latency', status: 'active', pipelineEntry: 'admin' },
  { key: 'admin.runtime-debug',     owner: 'app/api/admin/runtime-debug/route.ts',       description: 'Runtime diagnostics snapshot + live test invocation',                  status: 'active', pipelineEntry: 'admin' },
  { key: 'admin.local-models',      owner: 'app/api/admin/local-models/route.ts',        description: 'Local model (Ollama/LMStudio) discovery',                              status: 'active', pipelineEntry: 'admin' },
  { key: 'admin.iskill-test',       owner: 'app/api/admin/iskill-test/route.ts',         description: 'ISkill test execution harness',                                         status: 'experimental', pipelineEntry: 'admin' },

  // ── Observability ─────────────────────────────────────────────────────────────
  // observability.routing REMOVED — route deleted (Sprint A). Was unauthenticated in-memory store with no pipeline connection.
  { key: 'observability.brand-memory',   owner: 'app/api/control-plane/brand-memory/route.ts',  description: 'Brand signal store read/write',         status: 'active', pipelineEntry: 'observability', issues: ['ISSUE-2-RESOLVED'] },
  { key: 'observability.experiments',    owner: 'app/api/control-plane/experiments/route.ts',   description: 'A/B experiment config',                 status: 'active', pipelineEntry: 'observability', issues: ['ISSUE-2-RESOLVED'] },
  { key: 'observability.prompt-library', owner: 'app/api/control-plane/prompt-library/route.ts', description: 'Prompt template CRUD',                status: 'active', pipelineEntry: 'observability', issues: ['ISSUE-2-RESOLVED'] },
  { key: 'observability.score-history',  owner: 'app/api/control-plane/score-history/route.ts', description: 'Governance score history',              status: 'active', pipelineEntry: 'observability', issues: ['ISSUE-2-RESOLVED'] },
  { key: 'observability.webhooks',       owner: 'app/api/control-plane/webhooks/route.ts',      description: 'Webhook config management',             status: 'active', pipelineEntry: 'observability', issues: ['ISSUE-2-RESOLVED'] },
  { key: 'observability.telemetry',      owner: 'app/api/v2/telemetry/stats/route.ts',          description: 'Telemetry stats + experiments',         status: 'active', pipelineEntry: 'observability' },

  // ── Utility ──────────────────────────────────────────────────────────────────
  { key: 'utility.health',          owner: 'app/api/health/route.ts',              description: 'Liveness probe',                   status: 'active', pipelineEntry: 'utility' },
  // utility.vlm-analyze REMOVED — route deleted (redesign cleanup). See CapabilityKey union above for rationale.
  { key: 'utility.upload',          owner: 'app/api/upload/route.ts',              description: 'File upload',                      status: 'active', pipelineEntry: 'utility' },
  { key: 'utility.extract-from-url',owner: 'app/api/extract-from-url/route.ts',    description: 'URL content extraction',           status: 'active', pipelineEntry: 'utility' },
  { key: 'utility.persona',         owner: 'app/api/persona/route.ts',             description: 'Persona management',               status: 'active', pipelineEntry: 'utility' },
  { key: 'utility.feedback',        owner: 'app/api/feedback/route.ts',            description: 'User feedback submission',         status: 'active', pipelineEntry: 'utility' },
  { key: 'utility.models',          owner: 'app/api/models/availability/route.ts', description: 'Model availability check',         status: 'active', pipelineEntry: 'utility' },
  { key: 'utility.memory',          owner: 'app/api/memory/route.ts',              description: 'Brand memory read/write shortcut', status: 'active', pipelineEntry: 'control-plane' },

  // ── Auth ─────────────────────────────────────────────────────────────────────
  { key: 'auth.user',   owner: 'lib/supabase-server.ts → requireUser()',      description: 'User session validation via Next.js cookie context', status: 'active', pipelineEntry: 'auth' },
  { key: 'auth.admin',  owner: 'lib/admin/require-admin.ts → requireAdmin()', description: 'Admin auth guard (Next.js-specific wrapper)',        status: 'active', pipelineEntry: 'auth' },
]

// ─── Registry API ─────────────────────────────────────────────────────────────

function get(key: CapabilityKey): CapabilityEntry | undefined {
  return ENTRIES.find(e => e.key === key)
}

function keys(): CapabilityKey[] {
  return ENTRIES.map(e => e.key)
}

function list(): CapabilityEntry[] {
  return [...ENTRIES]
}

function owns(key: string): key is CapabilityKey {
  return ENTRIES.some(e => e.key === key)
}

function listIssues(): CapabilityEntry[] {
  return ENTRIES.filter(e => e.issues && e.issues.length > 0)
}

export const WebAppCapabilityRegistry = {
  get,
  keys,
  list,
  owns,
  listIssues,
} as const

export type IWebAppCapabilityRegistry = typeof WebAppCapabilityRegistry


