/**
 * @brandos/ui-admin — src/__tests__/validatePackage.test.ts
 *
 * Tests for validatePackage() and UIAdminCapabilityRegistry.
 * Run with: vitest
 */

import { describe, it, expect } from 'vitest'
import { validatePackage }             from '../validatePackage'
import { UIAdminCapabilityRegistry }   from '../CapabilityRegistry'
import type { CapabilityKey }          from '../CapabilityRegistry'

// ─── CapabilityRegistry ───────────────────────────────────────────────────────

describe('UIAdminCapabilityRegistry', () => {
  describe('.keys()', () => {
    it('returns all 11 capability keys', () => {
      const keys = UIAdminCapabilityRegistry.keys()
      expect(keys).toHaveLength(11)
    })

    it('includes all expected capability domains', () => {
      const keys = UIAdminCapabilityRegistry.keys()
      expect(keys).toContain('admin.design.tokens')
      expect(keys).toContain('admin.layout.card')
      expect(keys).toContain('admin.layout.section')
      expect(keys).toContain('admin.settings.toggle')
      expect(keys).toContain('admin.settings.number')
      expect(keys).toContain('admin.settings.select')
      expect(keys).toContain('admin.settings.segmented')
      expect(keys).toContain('admin.providers.status')
      expect(keys).toContain('admin.providers.stat')
      expect(keys).toContain('admin.save.button')
      expect(keys).toContain('admin.save.hook')
    })
  })

  describe('.owns()', () => {
    it('returns true for a registered capability', () => {
      expect(UIAdminCapabilityRegistry.owns('admin.design.tokens')).toBe(true)
    })

    it('returns false for an unknown capability', () => {
      expect(UIAdminCapabilityRegistry.owns('admin.nonexistent')).toBe(false)
    })

    it('returns false for an empty string', () => {
      expect(UIAdminCapabilityRegistry.owns('')).toBe(false)
    })

    it('returns false for a @brandos/* package capability that does not belong here', () => {
      expect(UIAdminCapabilityRegistry.owns('runtime.provider.call')).toBe(false)
    })
  })

  describe('.get()', () => {
    it('returns an entry for a known capability', () => {
      const entry = UIAdminCapabilityRegistry.get('admin.save.hook')
      expect(entry).toBeDefined()
      expect(entry?.owner).toBe('useAdminSave')
      expect(entry?.status).toBe('active')
    })

    it('returns undefined for an unknown capability', () => {
      const entry = UIAdminCapabilityRegistry.get('admin.nonexistent' as CapabilityKey)
      expect(entry).toBeUndefined()
    })

    it('entry includes usedBy array with at least one consumer', () => {
      const allKeys = UIAdminCapabilityRegistry.keys()
      for (const key of allKeys) {
        const entry = UIAdminCapabilityRegistry.get(key)
        expect(entry?.usedBy.length).toBeGreaterThan(0)
      }
    })
  })

  describe('.list()', () => {
    it('returns all entries', () => {
      const entries = UIAdminCapabilityRegistry.list()
      expect(entries).toHaveLength(11)
    })

    it('returns a copy — mutation does not affect registry', () => {
      const list1 = UIAdminCapabilityRegistry.list()
      list1.push({ key: 'admin.design.tokens', owner: 'fake', description: 'fake', status: 'active', usedBy: [] })
      const list2 = UIAdminCapabilityRegistry.list()
      expect(list2).toHaveLength(11)
    })

    it('all entries have active status (no deprecated capabilities)', () => {
      const entries = UIAdminCapabilityRegistry.list()
      for (const entry of entries) {
        expect(entry.status).toBe('active')
      }
    })
  })
})

// ─── validatePackage ──────────────────────────────────────────────────────────

describe('validatePackage()', () => {
  it('returns a PackageHealthReport', () => {
    const report = validatePackage()
    expect(report).toHaveProperty('package')
    expect(report).toHaveProperty('level')
    expect(report).toHaveProperty('healthy')
    expect(report).toHaveProperty('checkedAt')
    expect(report).toHaveProperty('checks')
    expect(report).toHaveProperty('failures')
    expect(report).toHaveProperty('warnings')
    expect(report).toHaveProperty('summary')
  })

  it('reports package name as @brandos/ui-admin', () => {
    const report = validatePackage()
    expect(report.package).toBe('@brandos/ui-admin')
  })

  it('reports level as L2', () => {
    const report = validatePackage()
    expect(report.level).toBe('L2')
  })

  it('is healthy — all critical and high checks pass', () => {
    const report = validatePackage()
    expect(report.healthy).toBe(true)
    expect(report.failures).toHaveLength(0)
  })

  it('runs all 6 expected checks', () => {
    const report = validatePackage()
    expect(report.checks).toHaveLength(6)
  })

  it('capability-registry-integrity check passes', () => {
    const report = validatePackage()
    const check = report.checks.find(c => c.id === 'capability-registry-integrity')
    expect(check?.passed).toBe(true)
  })

  it('export-surface-completeness check passes', () => {
    const report = validatePackage()
    const check = report.checks.find(c => c.id === 'export-surface-completeness')
    expect(check?.passed).toBe(true)
  })

  it('invariant-documentation check passes', () => {
    const report = validatePackage()
    const check = report.checks.find(c => c.id === 'invariant-documentation')
    expect(check?.passed).toBe(true)
  })

  it('export-status-consistency check passes (no unresolved MEDIUM_DEAD)', () => {
    const report = validatePackage()
    const check = report.checks.find(c => c.id === 'export-status-consistency')
    expect(check?.passed).toBe(true)
  })

  it('package-level-coherence check passes', () => {
    const report = validatePackage()
    const check = report.checks.find(c => c.id === 'package-level-coherence')
    expect(check?.passed).toBe(true)
  })

  it('summary includes package name', () => {
    const report = validatePackage()
    expect(report.summary).toContain('@brandos/ui-admin')
  })

  it('summary includes level', () => {
    const report = validatePackage()
    expect(report.summary).toContain('L2')
  })

  it('summary indicates healthy status', () => {
    const report = validatePackage()
    expect(report.summary).toMatch(/✅/)
  })
})


