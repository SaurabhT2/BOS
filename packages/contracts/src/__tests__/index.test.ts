/**
 * @brandos/contracts — index.test.ts
 *
 * Public surface smoke tests.
 *
 * Verifies that key symbols are actually exported from the package's
 * public entry point (index.ts). This catches cases where a type or
 * value is defined in a sub-file but accidentally omitted from the index.
 *
 * These tests act as a compilation-time + runtime boundary check:
 *   - If the import fails → the export is missing from index.ts
 *   - If the assertion fails → the exported value is malformed
 */

import { describe, it, expect } from 'vitest'
import {
  // Artifact type guards (must be runtime values, not just types)
  isCarouselArtifact,
  isDeckArtifact,
  isReportArtifact,
  upcastCarouselBlueprint,
  CAROUSEL_ROLES,
  CAROUSEL_SCHEMA_INSTRUCTION,

  // Provider registry
  PROVIDER_REGISTRY,
  getProviderDefinition,
  isLocalProvider,
  isCloudProvider,
  ALL_PROVIDER_IDS,

  // Runtime mode utils
  runtimeModeToExecutionMode,
  fromLegacyToRuntimeMode,
  RUNTIME_MODE_LABELS,

  // Identity
  SEMANTIC_DIMENSIONS,
  VISUAL_DIMENSIONS,
  ALL_DIMENSIONS,
  isVisualDimension,
  isSemanticDimension,
  DEFAULT_IDENTITY_CONFIG,
} from '../index'

describe('@brandos/contracts public surface', () => {
  it('exports artifact type guards as functions', () => {
    expect(typeof isCarouselArtifact).toBe('function')
    expect(typeof isDeckArtifact).toBe('function')
    expect(typeof isReportArtifact).toBe('function')
    expect(typeof upcastCarouselBlueprint).toBe('function')
  })

  it('exports CAROUSEL_ROLES as a non-empty array', () => {
    expect(Array.isArray(CAROUSEL_ROLES)).toBe(true)
    expect(CAROUSEL_ROLES.length).toBeGreaterThan(0)
  })

  it('exports CAROUSEL_SCHEMA_INSTRUCTION as a non-empty string', () => {
    expect(typeof CAROUSEL_SCHEMA_INSTRUCTION).toBe('string')
    expect(CAROUSEL_SCHEMA_INSTRUCTION.length).toBeGreaterThan(0)
  })

  it('exports PROVIDER_REGISTRY as a non-empty array', () => {
    expect(Array.isArray(PROVIDER_REGISTRY)).toBe(true)
    expect(PROVIDER_REGISTRY.length).toBeGreaterThan(0)
  })

  it('exports provider helper functions', () => {
    expect(typeof getProviderDefinition).toBe('function')
    expect(typeof isLocalProvider).toBe('function')
    expect(typeof isCloudProvider).toBe('function')
  })

  it('exports ALL_PROVIDER_IDS as a non-empty array', () => {
    expect(Array.isArray(ALL_PROVIDER_IDS)).toBe(true)
    expect(ALL_PROVIDER_IDS.length).toBeGreaterThan(0)
  })

  it('exports runtime mode conversion functions', () => {
    expect(typeof runtimeModeToExecutionMode).toBe('function')
    expect(typeof fromLegacyToRuntimeMode).toBe('function')
  })

  it('exports RUNTIME_MODE_LABELS for all runtime modes', () => {
    expect(RUNTIME_MODE_LABELS).toBeDefined()
    expect(RUNTIME_MODE_LABELS.local).toBeDefined()
    expect(RUNTIME_MODE_LABELS.cloud).toBeDefined()
  })

  it('exports identity dimension arrays', () => {
    expect(Array.isArray(SEMANTIC_DIMENSIONS)).toBe(true)
    expect(Array.isArray(VISUAL_DIMENSIONS)).toBe(true)
    expect(Array.isArray(ALL_DIMENSIONS)).toBe(true)
    expect(ALL_DIMENSIONS.length).toBe(SEMANTIC_DIMENSIONS.length + VISUAL_DIMENSIONS.length)
  })

  it('exports identity dimension helpers as functions', () => {
    expect(typeof isVisualDimension).toBe('function')
    expect(typeof isSemanticDimension).toBe('function')
  })

  it('exports DEFAULT_IDENTITY_CONFIG as an object', () => {
    expect(typeof DEFAULT_IDENTITY_CONFIG).toBe('object')
    expect(DEFAULT_IDENTITY_CONFIG).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Extended smoke tests — self-validation layer
// ─────────────────────────────────────────────────────────────────────────────

import {
  validateContractsPackage,
  checkProviderRegistryIntegrity,
} from '../index'

describe('@brandos/contracts — self-validation exports', () => {
  it('exports validateContractsPackage as a function', () => {
    expect(typeof validateContractsPackage).toBe('function')
  })

  it('exports checkProviderRegistryIntegrity as a function', () => {
    expect(typeof checkProviderRegistryIntegrity).toBe('function')
  })

  it('validateContractsPackage returns a well-formed report', () => {
    const report = validateContractsPackage()
    expect(report.packageName).toBe('@brandos/contracts')
    expect(typeof report.allPassed).toBe('boolean')
    expect(Array.isArray(report.checks)).toBe(true)
    expect(Array.isArray(report.violations)).toBe(true)
  })
})


