/**
 * Contract tests — verify public API matches interface contracts.
 *
 * These tests ensure that every function and type promised by
 * IGovernanceLayer.ts is actually exported from src/index.ts
 * and satisfies the declared signature.
 */

import { describe, it, expect } from 'vitest'
import * as PublicAPI from '../../src/index'

describe('Public API contract compliance', () => {
  describe('evaluateGovernance', () => {
    it('is exported', () => expect(typeof PublicAPI.evaluateGovernance).toBe('function'))

    it('accepts GovernanceEvaluationInput and returns GovernanceEvaluationResult shape', () => {
      const result = PublicAPI.evaluateGovernance({ content: 'Test content', taskType: 'post' })
      expect(typeof result.passed).toBe('boolean')
      expect(typeof result.score).toBe('number')
      expect(typeof result.original_score).toBe('number')
      expect(Array.isArray(result.annotations)).toBe(true)
      expect(Array.isArray(result.recommendations)).toBe(true)
      expect(Array.isArray(result.violations)).toBe(true)
      expect(Array.isArray(result.flags_remaining)).toBe(true)
      expect(typeof result.approved_output).toBe('string')
      expect(typeof result.engine_badge).toBe('string')
    })
  })

  describe('registerPolicyViolationHandler', () => {
    it('is exported', () => expect(typeof PublicAPI.registerPolicyViolationHandler).toBe('function'))
    it('accepts a callback function', () => {
      expect(() => PublicAPI.registerPolicyViolationHandler(() => {})).not.toThrow()
    })
  })

  describe('validateCarouselArtifact', () => {
    it('is exported', () => expect(typeof PublicAPI.validateCarouselArtifact).toBe('function'))
    it('returns SemanticValidationOutcome with valid field', () => {
      const r = PublicAPI.validateCarouselArtifact(null as any)
      expect(typeof r.valid).toBe('boolean')
    })
  })

  describe('runCarouselSemanticGovernance', () => {
    it('is exported', () => expect(typeof PublicAPI.runCarouselSemanticGovernance).toBe('function'))
    it('returns a Promise', () => {
      const p = PublicAPI.runCarouselSemanticGovernance(
        { title: 'T', slides: [] } as any,
        'topic',
        async () => 'response'
      )
      expect(p).toBeInstanceOf(Promise)
    })
  })

  describe('validateDeckArtifact', () => {
    it('is exported', () => expect(typeof PublicAPI.validateDeckArtifact).toBe('function'))
  })

  describe('runDeckSemanticGovernance', () => {
    it('is exported', () => expect(typeof PublicAPI.runDeckSemanticGovernance).toBe('function'))
  })

  describe('validateReportArtifact', () => {
    it('is exported', () => expect(typeof PublicAPI.validateReportArtifact).toBe('function'))
  })

  describe('runReportSemanticGovernance', () => {
    it('is exported', () => expect(typeof PublicAPI.runReportSemanticGovernance).toBe('function'))
  })

  describe('GovernancePluginRegistry', () => {
    it('is exported', () => expect(PublicAPI.GovernancePluginRegistry).toBeDefined())
    it('has registerValidator', () => expect(typeof PublicAPI.GovernancePluginRegistry.registerValidator).toBe('function'))
    it('has registerScorer', () => expect(typeof PublicAPI.GovernancePluginRegistry.registerScorer).toBe('function'))
    it('has registerRepair', () => expect(typeof PublicAPI.GovernancePluginRegistry.registerRepair).toBe('function'))
    it('has resolveValidator', () => expect(typeof PublicAPI.GovernancePluginRegistry.resolveValidator).toBe('function'))
    it('has resolveScorer', () => expect(typeof PublicAPI.GovernancePluginRegistry.resolveScorer).toBe('function'))
    it('has resolveRepair', () => expect(typeof PublicAPI.GovernancePluginRegistry.resolveRepair).toBe('function'))
    it('has listCapabilities', () => expect(typeof PublicAPI.GovernancePluginRegistry.listCapabilities).toBe('function'))
    it('has hasValidator', () => expect(typeof PublicAPI.GovernancePluginRegistry.hasValidator).toBe('function'))
    it('has hasRepair', () => expect(typeof PublicAPI.GovernancePluginRegistry.hasRepair).toBe('function'))
  })

  describe('bootstrapGovernancePlugins', () => {
    it('is exported', () => expect(typeof PublicAPI.bootstrapGovernancePlugins).toBe('function'))
    it('returns a Promise', () => {
      const p = PublicAPI.bootstrapGovernancePlugins()
      expect(p).toBeInstanceOf(Promise)
    })
  })

  describe('validatePackage', () => {
    it('is exported', () => expect(typeof PublicAPI.validatePackage).toBe('function'))
    it('returns a Promise<PackageHealthReport>', async () => {
      const report = await PublicAPI.validatePackage()
      expect(report).toHaveProperty('package', '@brandos/governance-layer')
      expect(report).toHaveProperty('level', 'L5')
      expect(report).toHaveProperty('healthy')
      expect(report).toHaveProperty('checks')
      expect(report).toHaveProperty('checkedAt')
      expect(Array.isArray(report.checks)).toBe(true)
    })
  })

  describe('no forbidden exports', () => {
    const FORBIDDEN_EXPORTS = ['supabase', 'getSupabaseClient', 'AIRuntimeFactory', 'llmRouter']
    for (const name of FORBIDDEN_EXPORTS) {
      it(`does not export "${name}"`, () => {
        expect(name in PublicAPI).toBe(false)
      })
    }
  })
})


