/**
 * @brandos/artifact-config
 *
 * SINGLE SOURCE OF TRUTH for artifact engine settings.
 *
 * Responsibilities:
 *   - Enabled artifact types
 *   - Export channel toggles (Canva, Figma, PDF, PPTX, HTML)
 *   - Default render settings (slides, pages, theme)
 *   - Template library metadata
 *   - Render queue visibility (read-only from queue service)
 *
 * Future-ready for:
 *   - PDF generation settings
 *   - Word/DOCX generation settings
 *   - Icon generation settings
 *   - Visual pipeline config
 *   - Agent orchestration hooks
 *
 * Explicitly NOT responsible for:
 *   - Artifact pipeline execution → @brandos/artifact-engine-layer
 *   - Governance validation of artifacts → @brandos/governance-config
 *   - Runtime provider selection → @brandos/runtime-config
 */

import { z } from 'zod'

// ─── Artifact Types ───────────────────────────────────────────────────────────

export const ARTIFACT_TYPE_IDS = [
  'carousel',
  'deck',
  'report',
  'newsletter',
  'landing_page',
  'post',
  'thread',
  'visual_brief',
  // Future
  'pdf_document',
  'word_document',
  'icon_set',
  'email_template',
  'agent_workflow',
] as const

export type ArtifactTypeId = (typeof ARTIFACT_TYPE_IDS)[number]

export const ArtifactTypeMetaSchema = z.object({
  id:      z.enum(ARTIFACT_TYPE_IDS),
  enabled: z.boolean().default(true),
  label:   z.string(),
  emoji:   z.string(),
  color:   z.string(),
  beta:    z.boolean().default(false),
})

export type ArtifactTypeMeta = z.infer<typeof ArtifactTypeMetaSchema>

// Static registry of artifact type display metadata — never changes at runtime
export const ARTIFACT_TYPE_REGISTRY: Record<string, Omit<ArtifactTypeMeta, 'id' | 'enabled'>> = {
  carousel:      { label: 'Carousel',      emoji: '🎠', color: '#38bdf8', beta: false },
  deck:          { label: 'Deck',           emoji: '📊', color: '#a78bfa', beta: false },
  report:        { label: 'Report',         emoji: '📋', color: '#f472b6', beta: false },
  newsletter:    { label: 'Newsletter',     emoji: '📰', color: '#fb923c', beta: false },
  landing_page:  { label: 'Landing Page',   emoji: '🌐', color: '#34d399', beta: false },
  post:          { label: 'Post',           emoji: '✍️', color: '#fbbf24', beta: false },
  thread:        { label: 'Thread',         emoji: '🧵', color: '#60a5fa', beta: false },
  visual_brief:  { label: 'Visual Brief',   emoji: '🎨', color: '#e879f9', beta: false },
  pdf_document:  { label: 'PDF Document',   emoji: '📄', color: '#94a3b8', beta: true  },
  word_document: { label: 'Word Document',  emoji: '📝', color: '#3b82f6', beta: true  },
  icon_set:      { label: 'Icon Set',       emoji: '✦',  color: '#f59e0b', beta: true  },
  email_template:{ label: 'Email Template', emoji: '✉️', color: '#10b981', beta: true  },
  agent_workflow:{ label: 'Agent Workflow', emoji: '🤖', color: '#6366f1', beta: true  },
}

// ─── Export Config ────────────────────────────────────────────────────────────

export const EXPORT_CHANNEL_IDS = [
  'canva', 'figma', 'pptx', 'pdf', 'html',
  'docx', 'notion', 'webflow',
] as const

export type ExportChannelId = (typeof EXPORT_CHANNEL_IDS)[number]

export const ExportChannelMetaSchema = z.object({
  id:      z.enum(EXPORT_CHANNEL_IDS),
  enabled: z.boolean().default(false),
  label:   z.string(),
  desc:    z.string(),
  beta:    z.boolean().default(false),
})

export type ExportChannelMeta = z.infer<typeof ExportChannelMetaSchema>

export const EXPORT_CHANNEL_REGISTRY: Record<string, Omit<ExportChannelMeta, 'id' | 'enabled'>> = {
  canva:   { label: 'Canva',    desc: 'Export to Canva design',    beta: false },
  figma:   { label: 'Figma',    desc: 'Push to Figma file',        beta: false },
  pptx:    { label: 'PowerPoint',desc: 'Download .pptx',           beta: false },
  pdf:     { label: 'PDF',      desc: 'Render to PDF',             beta: false },
  html:    { label: 'HTML Preview', desc: 'Interactive preview',   beta: false },
  docx:    { label: 'Word',     desc: 'Export as .docx',           beta: true  },
  notion:  { label: 'Notion',   desc: 'Push to Notion page',       beta: true  },
  webflow: { label: 'Webflow',  desc: 'Publish to Webflow site',   beta: true  },
}

// ─── Render Settings ──────────────────────────────────────────────────────────

export const RenderSettingsSchema = z.object({
  maxSlidesPerDeck:        z.number().int().min(1).max(100).default(20),
  defaultCarouselPages:    z.number().int().min(1).max(20).default(6),
  themeStyle:              z.enum(['dark', 'light', 'brand', 'minimal']).default('dark'),
  autoImageGeneration:     z.boolean().default(false),
  brandPackRequired:       z.boolean().default(false),
  maxTokensPerArtifact:    z.number().int().min(100).max(32_000).default(4_000),
  concurrentRenderLimit:   z.number().int().min(1).max(20).default(4),
})

export type RenderSettings = z.infer<typeof RenderSettingsSchema>

// ─── Template Config ──────────────────────────────────────────────────────────

export const TemplateConfigSchema = z.object({
  id:        z.string().min(1),
  name:      z.string(),
  type:      z.string(),
  usage:     z.number().int().min(0).default(0),
  updatedAt: z.string(),
  active:    z.boolean().default(true),
})

export type TemplateConfig = z.infer<typeof TemplateConfigSchema>

// ─── Full Artifact Engine Config ──────────────────────────────────────────────

export const ArtifactEngineConfigSchema = z.object({
  // Which types are enabled for generation
  enabledTypes: z.array(z.string()).default([
    'carousel', 'deck', 'report', 'newsletter',
    'landing_page', 'post', 'thread', 'visual_brief',
  ]),

  // Export channel toggles
  exports: z.record(z.string(), z.boolean()).default({
    canva: true, figma: false, pptx: true, pdf: true, html: true,
    docx: false, notion: false, webflow: false,
  }),

  // Render settings
  renderSettings: RenderSettingsSchema,

  // Template library (metadata only — not the template content)
  templates: z.array(TemplateConfigSchema).default([]),
})

export type ArtifactEngineConfig = z.infer<typeof ArtifactEngineConfigSchema>

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_ARTIFACT_CONFIG: ArtifactEngineConfig = ArtifactEngineConfigSchema.parse({
  renderSettings: {},
})

// ─── Render Queue Types (read-only, from queue service) ───────────────────────

export interface RenderJob {
  id:         string
  artifact:   string
  artifactType: string
  status:     'pending' | 'running' | 'completed' | 'failed'
  startedAt:  string
  durationMs: number | null
  workspaceId: string
}

// ─── Service Interface ────────────────────────────────────────────────────────

export interface IArtifactConfigService {
  load(workspaceId?: string): Promise<ArtifactEngineConfig>
  save(patch: Partial<ArtifactEngineConfig>, workspaceId?: string): Promise<ArtifactEngineConfig>
  getCached(): ArtifactEngineConfig
}

export interface IRenderQueueService {
  getActive(workspaceId?: string): Promise<RenderJob[]>
  subscribe(workspaceId: string, onUpdate: (jobs: RenderJob[]) => void): () => void
}

// ─── L4 Additions ─────────────────────────────────────────────────────────────

export {
  validatePackage,
} from './validatePackage'

export type {
  PackageHealthReport,
  PackageHealthCheck,
} from './validatePackage'

export {
  PACKAGE_METADATA,
} from './IPackage'

export type {
  PackageCapabilityKey,
} from './IPackage'


