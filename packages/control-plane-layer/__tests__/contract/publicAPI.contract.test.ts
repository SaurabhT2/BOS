/**
 * Contract tests — CPL public API surface
 *
 * Verifies that every symbol promised by the CPL package barrel
 * is actually exported and has the expected runtime shape.
 */

import { describe, it, expect } from 'vitest'
import * as PublicAPI from '../../src/index'

describe('CPL public API contract', () => {
  it('exports CPLOrchestrator as a class', () => {
    expect(typeof PublicAPI.CPLOrchestrator).toBe('function')
    expect(typeof PublicAPI.CPLOrchestrator.prototype.orchestrate).toBe('function')
  })

  it('exports initCPL as a function', () => {
    expect(typeof PublicAPI.initCPL).toBe('function')
  })

  // P2-5 FIX: BrandMemoryRepository, mergeBrandContext, resolveIdentity, recordBrandMemoryEntry
  // were removed as part of architectural Fix C3/C4 (CPL ↛ concrete BI repos rule).
  // They imported from './runtime/BrandIntelligenceRuntime' which no longer exists.
  // Tests updated to verify the replacement exports that consumers should use.

  it('exports runControlPlane as the primary generation entrypoint', () => {
    expect(typeof PublicAPI.runControlPlane).toBe('function')
  })

  it('exports executeArtifactPipeline as a function', () => {
    expect(typeof PublicAPI.executeArtifactPipeline).toBe('function')
  })

  it('exports recordBrandMemoryObservation (replaces recordBrandMemoryEntry)', () => {
    expect(typeof PublicAPI.recordBrandMemoryObservation).toBe('function')
  })
})


