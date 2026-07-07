/**
 * @brandos/artifact-config — IPackage.ts
 *
 * Machine-readable package metadata for repo-intelligence and agentic tooling.
 * L4 — added in Zod v4 migration wave.
 */

export const PACKAGE_METADATA = {
  name:    '@brandos/artifact-config' as const,
  version: '1.0.0',
  layer:   2,     // Config layer
  level:   'L4',  // Upgraded to L4 in Zod v4 migration wave

  /**
   * Capability ownership registry.
   */
  capabilities: {
    'artifact.types':          'ARTIFACT_TYPE_IDS, ARTIFACT_TYPE_REGISTRY, ArtifactTypeMetaSchema — canonical list of all artifact types',
    'artifact.exports':        'EXPORT_CHANNEL_IDS, EXPORT_CHANNEL_REGISTRY, ExportChannelMetaSchema — export channel definitions',
    'artifact.render':         'RenderSettingsSchema, RenderSettings — render pipeline configuration',
    'artifact.templates':      'TemplateConfigSchema, TemplateConfig — template library metadata shape',
    'artifact.engine.config':  'ArtifactEngineConfigSchema, ArtifactEngineConfig, DEFAULT_ARTIFACT_CONFIG — top-level engine config',
    'artifact.service':        'IArtifactConfigService, IRenderQueueService — service interfaces',
    'artifact.render_queue':   'RenderJob — render queue job shape (read-only, from queue service)',
  },

  /**
   * Dependencies.
   * INVARIANT: Never add governance-config, runtime-config, ai-runtime-layer, or control-plane-layer.
   */
  dependencies: [
    'zod',
  ],

  /**
   * Known consumers.
   */
  consumers: [
    '@brandos/artifact-engine-layer',
    '@brandos/control-plane-layer',
    'apps/web',
  ],

  /**
   * Invariants that must never be violated.
   */
  invariants: [
    'I-1: No imports from @brandos/governance-config, @brandos/runtime-config, @brandos/ai-runtime-layer, or @brandos/control-plane-layer',
    'I-2: ARTIFACT_TYPE_IDS is the single source of truth for valid artifact type identifiers',
    'I-3: DEFAULT_ARTIFACT_CONFIG is produced by ArtifactEngineConfigSchema.parse({ renderSettings: {} }) — defaults flow through schema',
    'I-4: Beta types must not appear in DEFAULT_ARTIFACT_CONFIG.enabledTypes',
    'I-5: renderSettings has no schema-level default — callers must always supply it (even as {})',
  ],

  /**
   * L4 additions in Zod v4 migration wave.
   */
  l4Additions: [
    'src/validatePackage.ts — self-check returns PackageHealthReport',
    'src/IPackage.ts — machine-readable metadata (this file)',
    'src/__tests__/validatePackage.test.ts — full L4 test suite',
    'AGENT_CONTEXT.md — authored to L4 standard',
  ],

  requiredReads: [
    'AGENT_CONTEXT.md',
    'src/IPackage.ts',   // this file
    'src/index.ts',      // all exports
  ],
} as const

export type PackageCapabilityKey = keyof typeof PACKAGE_METADATA.capabilities


