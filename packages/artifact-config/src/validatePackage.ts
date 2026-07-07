/**
 * @brandos/artifact-config — validatePackage.ts
 *
 * Self-validation: produces a PackageHealthReport describing the current
 * runtime state of this package's configuration contracts.
 *
 * Used by:
 *   - repo-intelligence tooling
 *   - CI gate (package self-check)
 *   - Agentic pre-flight before modification
 *
 * This file has NO side effects. It is additive-only.
 */

import {
  ARTIFACT_TYPE_IDS,
  ARTIFACT_TYPE_REGISTRY,
  EXPORT_CHANNEL_IDS,
  EXPORT_CHANNEL_REGISTRY,
  ArtifactEngineConfigSchema,
  RenderSettingsSchema,
  DEFAULT_ARTIFACT_CONFIG,
} from './index'

// ─── PackageHealthReport ───────────────────────────────────────────────────────

export interface PackageHealthCheck {
  name: string
  passed: boolean
  detail: string
}

export interface PackageHealthReport {
  package: '@brandos/artifact-config'
  level: 'L4'
  timestamp: string
  healthy: boolean
  checks: PackageHealthCheck[]
  summary: string
}

// ─── Individual checks ────────────────────────────────────────────────────────

function checkDefaultConfigParseable(): PackageHealthCheck {
  try {
    const result = ArtifactEngineConfigSchema.safeParse({ renderSettings: {} })
    return {
      name: 'default_config_parseable',
      passed: result.success,
      detail: result.success
        ? 'ArtifactEngineConfigSchema.parse({ renderSettings: {} }) succeeds with all defaults'
        : `Schema parse failed: ${result.error?.message}`,
    }
  } catch (err) {
    return { name: 'default_config_parseable', passed: false, detail: String(err) }
  }
}

function checkArtifactTypeRegistryComplete(): PackageHealthCheck {
  const missing = ARTIFACT_TYPE_IDS.filter(id => !ARTIFACT_TYPE_REGISTRY[id])
  return {
    name: 'artifact_type_registry_complete',
    passed: missing.length === 0,
    detail: missing.length === 0
      ? `All ${ARTIFACT_TYPE_IDS.length} artifact type IDs have registry entries`
      : `Missing registry entries for: ${missing.join(', ')}`,
  }
}

function checkExportChannelRegistryComplete(): PackageHealthCheck {
  const missing = EXPORT_CHANNEL_IDS.filter(id => !EXPORT_CHANNEL_REGISTRY[id])
  return {
    name: 'export_channel_registry_complete',
    passed: missing.length === 0,
    detail: missing.length === 0
      ? `All ${EXPORT_CHANNEL_IDS.length} export channel IDs have registry entries`
      : `Missing registry entries for: ${missing.join(', ')}`,
  }
}

function checkRenderSettingsDefaultsValid(): PackageHealthCheck {
  try {
    const result = RenderSettingsSchema.safeParse({})
    const passed = result.success &&
      result.data.maxSlidesPerDeck > 0 &&
      result.data.defaultCarouselPages > 0 &&
      result.data.maxTokensPerArtifact > 0 &&
      result.data.concurrentRenderLimit > 0
    return {
      name: 'render_settings_defaults_valid',
      passed,
      detail: passed
        ? 'RenderSettingsSchema defaults are positive and parseable'
        : 'RenderSettingsSchema defaults are invalid or non-positive',
    }
  } catch (err) {
    return { name: 'render_settings_defaults_valid', passed: false, detail: String(err) }
  }
}

function checkDefaultEnabledTypesValid(): PackageHealthCheck {
  const validIds = new Set(ARTIFACT_TYPE_IDS)
  const invalid = DEFAULT_ARTIFACT_CONFIG.enabledTypes.filter(t => !validIds.has(t as typeof ARTIFACT_TYPE_IDS[number]))
  const passed = invalid.length === 0 && DEFAULT_ARTIFACT_CONFIG.enabledTypes.length > 0
  return {
    name: 'default_enabled_types_valid',
    passed,
    detail: passed
      ? `${DEFAULT_ARTIFACT_CONFIG.enabledTypes.length} default enabled types are all valid ARTIFACT_TYPE_IDS`
      : invalid.length > 0
        ? `Unknown type IDs in default enabledTypes: ${invalid.join(', ')}`
        : 'enabledTypes must not be empty',
  }
}

function checkDefaultExportChannelsValid(): PackageHealthCheck {
  const { exports } = DEFAULT_ARTIFACT_CONFIG
  const expectedEnabled = ['canva', 'pptx', 'pdf', 'html']
  const expectedDisabled = ['figma', 'docx', 'notion', 'webflow']
  const failedEnabled = expectedEnabled.filter(ch => exports[ch] !== true)
  const failedDisabled = expectedDisabled.filter(ch => exports[ch] !== false)
  const passed = failedEnabled.length === 0 && failedDisabled.length === 0
  return {
    name: 'default_export_channels_valid',
    passed,
    detail: passed
      ? 'Default export channel toggles match expected on/off states'
      : [
          failedEnabled.length > 0 ? `Expected enabled but off: ${failedEnabled.join(', ')}` : '',
          failedDisabled.length > 0 ? `Expected disabled but on: ${failedDisabled.join(', ')}` : '',
        ].filter(Boolean).join('; '),
  }
}

function checkArtifactTypeIdUniqueness(): PackageHealthCheck {
  const unique = new Set(ARTIFACT_TYPE_IDS)
  const passed = unique.size === ARTIFACT_TYPE_IDS.length
  return {
    name: 'artifact_type_ids_unique',
    passed,
    detail: passed
      ? `All ${ARTIFACT_TYPE_IDS.length} ARTIFACT_TYPE_IDS are unique`
      : `Duplicate IDs found in ARTIFACT_TYPE_IDS`,
  }
}

function checkExportChannelIdUniqueness(): PackageHealthCheck {
  const unique = new Set(EXPORT_CHANNEL_IDS)
  const passed = unique.size === EXPORT_CHANNEL_IDS.length
  return {
    name: 'export_channel_ids_unique',
    passed,
    detail: passed
      ? `All ${EXPORT_CHANNEL_IDS.length} EXPORT_CHANNEL_IDS are unique`
      : `Duplicate IDs found in EXPORT_CHANNEL_IDS`,
  }
}

// ─── validatePackage ───────────────────────────────────────────────────────────

/**
 * validatePackage — run all self-checks and return a PackageHealthReport.
 *
 * No side effects. Call freely in CI or agentic pre-flight.
 * Returns a health report regardless of pass/fail — never throws.
 */
export function validatePackage(): PackageHealthReport {
  const checks: PackageHealthCheck[] = [
    checkDefaultConfigParseable(),
    checkArtifactTypeRegistryComplete(),
    checkExportChannelRegistryComplete(),
    checkRenderSettingsDefaultsValid(),
    checkDefaultEnabledTypesValid(),
    checkDefaultExportChannelsValid(),
    checkArtifactTypeIdUniqueness(),
    checkExportChannelIdUniqueness(),
  ]

  const failed = checks.filter(c => !c.passed)
  const healthy = failed.length === 0

  return {
    package: '@brandos/artifact-config',
    level: 'L4',
    timestamp: new Date().toISOString(),
    healthy,
    checks,
    summary: healthy
      ? `All ${checks.length} checks passed. Package is L4-healthy.`
      : `${failed.length}/${checks.length} checks failed: ${failed.map(c => c.name).join(', ')}`,
  }
}


