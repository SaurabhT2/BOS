/**
 * Unit tests — GovernancePluginRegistry
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GovernancePluginRegistry, bootstrapGovernancePlugins } from '../../src/GovernancePluginRegistry'

beforeEach(() => {
  GovernancePluginRegistry._reset()
  // reset bootstrapped flag for testing
  ;(bootstrapGovernancePlugins as any).__bootstrapped = false
})

describe('GovernancePluginRegistry', () => {
  describe('registration', () => {
    it('registers a validator and resolves it', async () => {
      const mockValidator = { validate: vi.fn().mockResolvedValue({ passed: true }) }
      GovernancePluginRegistry.registerValidator({
        artifactType: 'carousel',
        capabilityKey: 'governance.validate.carousel',
        validator: mockValidator,
      })
      const resolved = GovernancePluginRegistry.resolveValidator('carousel', 'governance.validate.carousel')
      expect(resolved).toBe(mockValidator)
    })

    it('registers a repair and resolves it', () => {
      const mockRepair = { repair: vi.fn().mockResolvedValue({ success: true, artifact: {}, repaired: false, attempts: 0 }) }
      GovernancePluginRegistry.registerRepair({
        artifactType: 'deck',
        capabilityKey: 'governance.repair.deck',
        repair: mockRepair,
      })
      const resolved = GovernancePluginRegistry.resolveRepair('deck', 'governance.repair.deck')
      expect(resolved).toBe(mockRepair)
    })

    it('registers a scorer and resolves it', async () => {
      const mockScorer = { score: vi.fn().mockResolvedValue(85) }
      GovernancePluginRegistry.registerScorer({
        artifactType: 'report',
        capabilityKey: 'governance.score.report',
        scorer: mockScorer,
      })
      const resolved = GovernancePluginRegistry.resolveScorer('report', 'governance.score.report')
      expect(resolved).toBe(mockScorer)
    })
  })

  describe('resolution', () => {
    it('returns null for unregistered validator', () => {
      expect(GovernancePluginRegistry.resolveValidator('unknown', 'governance.validate.unknown')).toBeNull()
    })

    it('returns null for unregistered repair', () => {
      expect(GovernancePluginRegistry.resolveRepair('unknown', 'governance.repair.unknown')).toBeNull()
    })

    it('returns null for unregistered scorer', () => {
      expect(GovernancePluginRegistry.resolveScorer('unknown', 'governance.score.unknown')).toBeNull()
    })
  })

  describe('hasValidator / hasRepair', () => {
    it('returns true after registration', () => {
      GovernancePluginRegistry.registerValidator({
        artifactType: 'carousel',
        capabilityKey: 'governance.validate.carousel',
        validator: { validate: vi.fn().mockResolvedValue({ passed: true }) },
      })
      expect(GovernancePluginRegistry.hasValidator('carousel', 'governance.validate.carousel')).toBe(true)
    })

    it('returns false before registration', () => {
      expect(GovernancePluginRegistry.hasValidator('carousel', 'governance.validate.carousel')).toBe(false)
    })
  })

  describe('listCapabilities', () => {
    it('returns empty arrays before registration', () => {
      const caps = GovernancePluginRegistry.listCapabilities()
      expect(caps.validators).toEqual([])
      expect(caps.scorers).toEqual([])
      expect(caps.repairs).toEqual([])
    })

    it('lists all registered keys', () => {
      GovernancePluginRegistry.registerValidator({
        artifactType: 'carousel',
        capabilityKey: 'governance.validate.carousel',
        validator: { validate: vi.fn().mockResolvedValue({ passed: true }) },
      })
      GovernancePluginRegistry.registerRepair({
        artifactType: 'deck',
        capabilityKey: 'governance.repair.deck',
        repair: { repair: vi.fn().mockResolvedValue({ success: true, artifact: {}, repaired: false, attempts: 0 }) },
      })
      const caps = GovernancePluginRegistry.listCapabilities()
      expect(caps.validators).toContain('carousel:governance.validate.carousel')
      expect(caps.repairs).toContain('deck:governance.repair.deck')
    })
  })

  describe('idempotent registration (overwrite)', () => {
    it('later registration overwrites for same key', async () => {
      const v1 = { validate: vi.fn().mockResolvedValue({ passed: true }) }
      const v2 = { validate: vi.fn().mockResolvedValue({ passed: false }) }
      GovernancePluginRegistry.registerValidator({ artifactType: 'carousel', capabilityKey: 'governance.validate.carousel', validator: v1 })
      GovernancePluginRegistry.registerValidator({ artifactType: 'carousel', capabilityKey: 'governance.validate.carousel', validator: v2 })
      const resolved = GovernancePluginRegistry.resolveValidator('carousel', 'governance.validate.carousel')
      expect(resolved).toBe(v2)
    })
  })

  describe('_reset (test utility)', () => {
    it('clears all registrations', () => {
      GovernancePluginRegistry.registerValidator({
        artifactType: 'carousel',
        capabilityKey: 'governance.validate.carousel',
        validator: { validate: vi.fn().mockResolvedValue({ passed: true }) },
      })
      GovernancePluginRegistry._reset()
      expect(GovernancePluginRegistry.resolveValidator('carousel', 'governance.validate.carousel')).toBeNull()
    })
  })
})

describe('bootstrapGovernancePlugins', () => {
  it('registers carousel, deck, report, and newsletter validators and repairs', async () => {
    await bootstrapGovernancePlugins()
    const caps = GovernancePluginRegistry.listCapabilities()
    expect(caps.validators).toContain('carousel:governance.validate.carousel')
    expect(caps.validators).toContain('deck:governance.validate.deck')
    expect(caps.validators).toContain('report:governance.validate.report')
    expect(caps.validators).toContain('newsletter:governance.validate.newsletter')
    expect(caps.repairs).toContain('carousel:governance.repair.carousel')
    expect(caps.repairs).toContain('deck:governance.repair.deck')
    expect(caps.repairs).toContain('report:governance.repair.report')
    expect(caps.repairs).toContain('newsletter:governance.repair.newsletter')
  })
})


