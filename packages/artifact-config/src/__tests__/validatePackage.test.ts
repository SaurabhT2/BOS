/**
 * @brandos/artifact-config — validatePackage.test.ts
 *
 * L4 test suite. Covers all exported schemas, registries, defaults,
 * and the validatePackage() self-check.
 *
 * Added: Zod v4 migration (was absent prior to this wave).
 */

import { describe, it, expect } from 'vitest'
import {
  // Type registries
  ARTIFACT_TYPE_IDS,
  ARTIFACT_TYPE_REGISTRY,
  ArtifactTypeMetaSchema,
  // Export channels
  EXPORT_CHANNEL_IDS,
  EXPORT_CHANNEL_REGISTRY,
  ExportChannelMetaSchema,
  // Render settings
  RenderSettingsSchema,
  // Template config
  TemplateConfigSchema,
  // Top-level config
  ArtifactEngineConfigSchema,
  DEFAULT_ARTIFACT_CONFIG,
} from '../index'
import { validatePackage } from '../validatePackage'

// ─── validatePackage() ────────────────────────────────────────────────────────

describe('validatePackage()', () => {
  it('returns a healthy report for the default configuration', () => {
    const report = validatePackage()
    expect(report.package).toBe('@brandos/artifact-config')
    expect(report.level).toBe('L4')
    expect(report.healthy).toBe(true)
    expect(report.checks.every(c => c.passed)).toBe(true)
  })

  it('includes all required check names', () => {
    const report = validatePackage()
    const names = report.checks.map(c => c.name)
    expect(names).toContain('default_config_parseable')
    expect(names).toContain('artifact_type_registry_complete')
    expect(names).toContain('export_channel_registry_complete')
    expect(names).toContain('render_settings_defaults_valid')
    expect(names).toContain('default_enabled_types_valid')
    expect(names).toContain('default_export_channels_valid')
  })

  it('never throws', () => {
    expect(() => validatePackage()).not.toThrow()
  })

  it('reports timestamp as valid ISO string', () => {
    const report = validatePackage()
    expect(() => new Date(report.timestamp)).not.toThrow()
    expect(new Date(report.timestamp).toISOString()).toBe(report.timestamp)
  })
})

// ─── ARTIFACT_TYPE_IDS ────────────────────────────────────────────────────────

describe('ARTIFACT_TYPE_IDS', () => {
  it('contains expected core types', () => {
    expect(ARTIFACT_TYPE_IDS).toContain('carousel')
    expect(ARTIFACT_TYPE_IDS).toContain('deck')
    expect(ARTIFACT_TYPE_IDS).toContain('report')
    expect(ARTIFACT_TYPE_IDS).toContain('newsletter')
    expect(ARTIFACT_TYPE_IDS).toContain('landing_page')
    expect(ARTIFACT_TYPE_IDS).toContain('post')
    expect(ARTIFACT_TYPE_IDS).toContain('thread')
    expect(ARTIFACT_TYPE_IDS).toContain('visual_brief')
  })

  it('contains expected future types', () => {
    expect(ARTIFACT_TYPE_IDS).toContain('pdf_document')
    expect(ARTIFACT_TYPE_IDS).toContain('word_document')
    expect(ARTIFACT_TYPE_IDS).toContain('icon_set')
    expect(ARTIFACT_TYPE_IDS).toContain('email_template')
    expect(ARTIFACT_TYPE_IDS).toContain('agent_workflow')
  })

  it('has no duplicate entries', () => {
    const unique = new Set(ARTIFACT_TYPE_IDS)
    expect(unique.size).toBe(ARTIFACT_TYPE_IDS.length)
  })
})

// ─── ARTIFACT_TYPE_REGISTRY ───────────────────────────────────────────────────

describe('ARTIFACT_TYPE_REGISTRY', () => {
  it('has an entry for every ARTIFACT_TYPE_ID', () => {
    for (const id of ARTIFACT_TYPE_IDS) {
      expect(ARTIFACT_TYPE_REGISTRY[id], `Missing registry entry for: ${id}`).toBeDefined()
    }
  })

  it('every entry has a non-empty label, emoji, and color', () => {
    for (const [id, meta] of Object.entries(ARTIFACT_TYPE_REGISTRY)) {
      expect(meta.label.length, `${id}.label empty`).toBeGreaterThan(0)
      expect(meta.emoji.length, `${id}.emoji empty`).toBeGreaterThan(0)
      expect(meta.color.length, `${id}.color empty`).toBeGreaterThan(0)
    }
  })

  it('core types are not marked beta', () => {
    const coreTypes = ['carousel', 'deck', 'report', 'newsletter', 'landing_page', 'post', 'thread', 'visual_brief']
    for (const id of coreTypes) {
      expect(ARTIFACT_TYPE_REGISTRY[id]!.beta, `${id} should not be beta`).toBe(false)
    }
  })

  it('future types are marked beta', () => {
    const futureTypes = ['pdf_document', 'word_document', 'icon_set', 'email_template', 'agent_workflow']
    for (const id of futureTypes) {
      expect(ARTIFACT_TYPE_REGISTRY[id]!.beta, `${id} should be beta`).toBe(true)
    }
  })
})

// ─── ArtifactTypeMetaSchema ───────────────────────────────────────────────────

describe('ArtifactTypeMetaSchema', () => {
  it('parses a valid artifact type meta', () => {
    const result = ArtifactTypeMetaSchema.safeParse({
      id: 'carousel', label: 'Carousel', emoji: '🎠', color: '#38bdf8',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabled).toBe(true)   // default
      expect(result.data.beta).toBe(false)      // default
    }
  })

  it('rejects an unknown artifact type id', () => {
    const result = ArtifactTypeMetaSchema.safeParse({
      id: 'unknown_type', label: 'X', emoji: '?', color: '#fff',
    })
    expect(result.success).toBe(false)
  })

  it('accepts enabled=false', () => {
    const result = ArtifactTypeMetaSchema.safeParse({
      id: 'deck', label: 'Deck', emoji: '📊', color: '#a78bfa', enabled: false,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.enabled).toBe(false)
  })

  it('accepts beta=true', () => {
    const result = ArtifactTypeMetaSchema.safeParse({
      id: 'pdf_document', label: 'PDF', emoji: '📄', color: '#94a3b8', beta: true,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.beta).toBe(true)
  })
})

// ─── EXPORT_CHANNEL_IDS ───────────────────────────────────────────────────────

describe('EXPORT_CHANNEL_IDS', () => {
  it('contains expected channels', () => {
    expect(EXPORT_CHANNEL_IDS).toContain('canva')
    expect(EXPORT_CHANNEL_IDS).toContain('figma')
    expect(EXPORT_CHANNEL_IDS).toContain('pptx')
    expect(EXPORT_CHANNEL_IDS).toContain('pdf')
    expect(EXPORT_CHANNEL_IDS).toContain('html')
    expect(EXPORT_CHANNEL_IDS).toContain('docx')
    expect(EXPORT_CHANNEL_IDS).toContain('notion')
    expect(EXPORT_CHANNEL_IDS).toContain('webflow')
  })

  it('has no duplicate entries', () => {
    const unique = new Set(EXPORT_CHANNEL_IDS)
    expect(unique.size).toBe(EXPORT_CHANNEL_IDS.length)
  })
})

// ─── EXPORT_CHANNEL_REGISTRY ──────────────────────────────────────────────────

describe('EXPORT_CHANNEL_REGISTRY', () => {
  it('has an entry for every EXPORT_CHANNEL_ID', () => {
    for (const id of EXPORT_CHANNEL_IDS) {
      expect(EXPORT_CHANNEL_REGISTRY[id], `Missing registry entry for: ${id}`).toBeDefined()
    }
  })

  it('every entry has a non-empty label and desc', () => {
    for (const [id, meta] of Object.entries(EXPORT_CHANNEL_REGISTRY)) {
      expect(meta.label.length, `${id}.label empty`).toBeGreaterThan(0)
      expect(meta.desc.length, `${id}.desc empty`).toBeGreaterThan(0)
    }
  })

  it('docx, notion, webflow are beta', () => {
    expect(EXPORT_CHANNEL_REGISTRY['docx']!.beta).toBe(true)
    expect(EXPORT_CHANNEL_REGISTRY['notion']!.beta).toBe(true)
    expect(EXPORT_CHANNEL_REGISTRY['webflow']!.beta).toBe(true)
  })

  it('canva, figma, pptx, pdf, html are not beta', () => {
    for (const id of ['canva', 'figma', 'pptx', 'pdf', 'html']) {
      expect(EXPORT_CHANNEL_REGISTRY[id]!.beta, `${id} should not be beta`).toBe(false)
    }
  })
})

// ─── ExportChannelMetaSchema ──────────────────────────────────────────────────

describe('ExportChannelMetaSchema', () => {
  it('parses a valid export channel', () => {
    const result = ExportChannelMetaSchema.safeParse({
      id: 'pdf', label: 'PDF', desc: 'Render to PDF',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabled).toBe(false)  // default
      expect(result.data.beta).toBe(false)      // default
    }
  })

  it('rejects an unknown channel id', () => {
    const result = ExportChannelMetaSchema.safeParse({
      id: 'google_slides', label: 'Slides', desc: 'Google Slides',
    })
    expect(result.success).toBe(false)
  })
})

// ─── RenderSettingsSchema ─────────────────────────────────────────────────────

describe('RenderSettingsSchema', () => {
  it('parses empty input with all defaults', () => {
    const result = RenderSettingsSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.maxSlidesPerDeck).toBe(20)
      expect(result.data.defaultCarouselPages).toBe(6)
      expect(result.data.themeStyle).toBe('dark')
      expect(result.data.autoImageGeneration).toBe(false)
      expect(result.data.brandPackRequired).toBe(false)
      expect(result.data.maxTokensPerArtifact).toBe(4_000)
      expect(result.data.concurrentRenderLimit).toBe(4)
    }
  })

  it('rejects maxSlidesPerDeck above 100', () => {
    expect(RenderSettingsSchema.safeParse({ maxSlidesPerDeck: 101 }).success).toBe(false)
  })

  it('rejects maxSlidesPerDeck below 1', () => {
    expect(RenderSettingsSchema.safeParse({ maxSlidesPerDeck: 0 }).success).toBe(false)
  })

  it('rejects invalid themeStyle', () => {
    expect(RenderSettingsSchema.safeParse({ themeStyle: 'cyberpunk' }).success).toBe(false)
  })

  it('accepts all valid themeStyle values', () => {
    for (const style of ['dark', 'light', 'brand', 'minimal']) {
      expect(RenderSettingsSchema.safeParse({ themeStyle: style }).success).toBe(true)
    }
  })

  it('rejects maxTokensPerArtifact above 32000', () => {
    expect(RenderSettingsSchema.safeParse({ maxTokensPerArtifact: 32_001 }).success).toBe(false)
  })

  it('rejects concurrentRenderLimit above 20', () => {
    expect(RenderSettingsSchema.safeParse({ concurrentRenderLimit: 21 }).success).toBe(false)
  })

  it('rejects non-integer values for int fields', () => {
    expect(RenderSettingsSchema.safeParse({ maxSlidesPerDeck: 5.5 }).success).toBe(false)
  })
})

// ─── TemplateConfigSchema ─────────────────────────────────────────────────────

describe('TemplateConfigSchema', () => {
  const validTemplate = {
    id: 'tmpl-001',
    name: 'Modern Dark',
    type: 'carousel',
    updatedAt: '2025-01-01T00:00:00.000Z',
  }

  it('parses a valid template with defaults', () => {
    const result = TemplateConfigSchema.safeParse(validTemplate)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.usage).toBe(0)     // default
      expect(result.data.active).toBe(true) // default
    }
  })

  it('rejects empty id', () => {
    expect(TemplateConfigSchema.safeParse({ ...validTemplate, id: '' }).success).toBe(false)
  })

  it('accepts active=false', () => {
    const result = TemplateConfigSchema.safeParse({ ...validTemplate, active: false })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.active).toBe(false)
  })

  it('accepts usage count', () => {
    const result = TemplateConfigSchema.safeParse({ ...validTemplate, usage: 42 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.usage).toBe(42)
  })

  it('rejects negative usage', () => {
    expect(TemplateConfigSchema.safeParse({ ...validTemplate, usage: -1 }).success).toBe(false)
  })
})

// ─── ArtifactEngineConfigSchema ───────────────────────────────────────────────

describe('ArtifactEngineConfigSchema', () => {
  it('parses with renderSettings: {} and applies all defaults', () => {
    const result = ArtifactEngineConfigSchema.safeParse({ renderSettings: {} })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabledTypes).toContain('carousel')
      expect(result.data.enabledTypes).toContain('deck')
      expect(result.data.exports['pptx']).toBe(true)
      expect(result.data.exports['pdf']).toBe(true)
      expect(result.data.exports['figma']).toBe(false)
      expect(result.data.templates).toEqual([])
      expect(result.data.renderSettings.maxSlidesPerDeck).toBe(20)
    }
  })

  it('rejects input without renderSettings', () => {
    // renderSettings has no default — it must be provided
    const result = ArtifactEngineConfigSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('accepts custom enabledTypes', () => {
    const result = ArtifactEngineConfigSchema.safeParse({
      renderSettings: {},
      enabledTypes: ['carousel', 'post'],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabledTypes).toEqual(['carousel', 'post'])
    }
  })

  it('accepts custom export channel toggles', () => {
    const result = ArtifactEngineConfigSchema.safeParse({
      renderSettings: {},
      exports: { canva: false, pdf: true },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.exports['canva']).toBe(false)
      expect(result.data.exports['pdf']).toBe(true)
    }
  })

  it('accepts an array of valid templates', () => {
    const result = ArtifactEngineConfigSchema.safeParse({
      renderSettings: {},
      templates: [
        { id: 'tmpl-1', name: 'T1', type: 'deck', updatedAt: '2025-01-01T00:00:00.000Z' },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.templates).toHaveLength(1)
  })
})

// ─── DEFAULT_ARTIFACT_CONFIG ──────────────────────────────────────────────────

describe('DEFAULT_ARTIFACT_CONFIG', () => {
  it('is a valid ArtifactEngineConfig', () => {
    const result = ArtifactEngineConfigSchema.safeParse(DEFAULT_ARTIFACT_CONFIG)
    expect(result.success).toBe(true)
  })

  it('has 8 enabled types by default', () => {
    expect(DEFAULT_ARTIFACT_CONFIG.enabledTypes).toHaveLength(8)
  })

  it('default enabled types are all core (non-beta) types', () => {
    const coreTypes = ['carousel', 'deck', 'report', 'newsletter', 'landing_page', 'post', 'thread', 'visual_brief']
    for (const t of coreTypes) {
      expect(DEFAULT_ARTIFACT_CONFIG.enabledTypes).toContain(t)
    }
  })

  it('beta types are not enabled by default', () => {
    const betaTypes = ['pdf_document', 'word_document', 'icon_set', 'email_template', 'agent_workflow']
    for (const t of betaTypes) {
      expect(DEFAULT_ARTIFACT_CONFIG.enabledTypes).not.toContain(t)
    }
  })

  it('has correct default export channel states', () => {
    const { exports } = DEFAULT_ARTIFACT_CONFIG
    expect(exports['canva']).toBe(true)
    expect(exports['pptx']).toBe(true)
    expect(exports['pdf']).toBe(true)
    expect(exports['html']).toBe(true)
    expect(exports['figma']).toBe(false)
    expect(exports['docx']).toBe(false)
    expect(exports['notion']).toBe(false)
    expect(exports['webflow']).toBe(false)
  })

  it('has correct render setting defaults', () => {
    const { renderSettings } = DEFAULT_ARTIFACT_CONFIG
    expect(renderSettings.maxSlidesPerDeck).toBe(20)
    expect(renderSettings.defaultCarouselPages).toBe(6)
    expect(renderSettings.themeStyle).toBe('dark')
    expect(renderSettings.autoImageGeneration).toBe(false)
    expect(renderSettings.maxTokensPerArtifact).toBe(4_000)
  })

  it('starts with an empty template list', () => {
    expect(DEFAULT_ARTIFACT_CONFIG.templates).toEqual([])
  })
})


