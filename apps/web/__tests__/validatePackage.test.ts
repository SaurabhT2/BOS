/**
 * apps/web — __tests__/validatePackage.test.ts
 *
 * Tests for validatePackage() and WebAppCapabilityRegistry.
 * Run with: vitest (via `pnpm test` in apps/web)
 *
 * L5 update: reflects ISSUE-2 resolution, L5 level, 8 checks.
 */

import { describe, it, expect } from 'vitest'
import { validatePackage }            from '../lib/validatePackage'
import { WebAppCapabilityRegistry }   from '../lib/CapabilityRegistry'
import { ROUTE_INVENTORY }            from '../lib/IWebApp'
import type { CapabilityKey }         from '../lib/CapabilityRegistry'

// ─── WebAppCapabilityRegistry ─────────────────────────────────────────────────

describe('WebAppCapabilityRegistry', () => {
  describe('.keys()', () => {
    it('returns a non-empty array', () => {
      expect(WebAppCapabilityRegistry.keys().length).toBeGreaterThan(0)
    })

    it('includes all generation capabilities', () => {
      const keys = WebAppCapabilityRegistry.keys()
      expect(keys).toContain('generation.text')
      expect(keys).toContain('generation.carousel')
      expect(keys).toContain('generation.deck')
      expect(keys).toContain('generation.report')
    })

    it('includes auth capabilities', () => {
      const keys = WebAppCapabilityRegistry.keys()
      expect(keys).toContain('auth.user')
      expect(keys).toContain('auth.admin')
    })

    it('includes admin capabilities', () => {
      const keys = WebAppCapabilityRegistry.keys()
      expect(keys).toContain('admin.providers')
      expect(keys).toContain('admin.runtime-debug')
    })
  })

  describe('.owns()', () => {
    it('returns true for a registered key', () => {
      expect(WebAppCapabilityRegistry.owns('generation.carousel')).toBe(true)
    })

    it('returns false for an unknown key', () => {
      expect(WebAppCapabilityRegistry.owns('some.unknown.capability')).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(WebAppCapabilityRegistry.owns('')).toBe(false)
    })
  })

  describe('.get()', () => {
    it('returns entry for generation.carousel', () => {
      const entry = WebAppCapabilityRegistry.get('generation.carousel')
      expect(entry).toBeDefined()
      expect(entry?.status).toBe('active')
      expect(entry?.pipelineEntry).toBe('control-plane')
    })

    it('returns undefined for unknown key', () => {
      const entry = WebAppCapabilityRegistry.get('nonexistent' as CapabilityKey)
      expect(entry).toBeUndefined()
    })

    it('all active entries have an owner', () => {
      for (const key of WebAppCapabilityRegistry.keys()) {
        const entry = WebAppCapabilityRegistry.get(key)
        expect(entry?.owner).toBeTruthy()
      }
    })
  })

  describe('.list()', () => {
    it('returns all entries', () => {
      const list = WebAppCapabilityRegistry.list()
      expect(list.length).toBeGreaterThan(20)
    })

    it('returns a copy — mutation does not affect registry', () => {
      const list1 = WebAppCapabilityRegistry.list()
      const originalLength = list1.length
      list1.pop()
      const list2 = WebAppCapabilityRegistry.list()
      expect(list2.length).toBe(originalLength)
    })
  })

  describe('.listIssues()', () => {
    it('returns entries with tracked issues', () => {
      const issueEntries = WebAppCapabilityRegistry.listIssues()
      expect(issueEntries.length).toBeGreaterThan(0)
    })

    it('all returned entries have non-empty issues array', () => {
      for (const entry of WebAppCapabilityRegistry.listIssues()) {
        expect(entry.issues).toBeDefined()
        expect((entry.issues ?? []).length).toBeGreaterThan(0)
      }
    })

    it('ISSUE-2 is resolved — no entries should be tagged ISSUE-2 (only ISSUE-2-RESOLVED)', () => {
      const issueEntries = WebAppCapabilityRegistry.listIssues()
      const hasRawIssue2 = issueEntries.some(e => e.issues?.includes('ISSUE-2'))
      expect(hasRawIssue2).toBe(false)
    })

    it('ISSUE-2-RESOLVED is tracked in observability routes', () => {
      const issueEntries = WebAppCapabilityRegistry.listIssues()
      const hasResolved  = issueEntries.some(e => e.issues?.includes('ISSUE-2-RESOLVED'))
      expect(hasResolved).toBe(true)
    })
  })
})

// ─── ROUTE_INVENTORY ─────────────────────────────────────────────────────────

describe('ROUTE_INVENTORY', () => {
  it('has at least 30 routes', () => {
    expect(ROUTE_INVENTORY.length).toBeGreaterThanOrEqual(30)
  })

  it('every route has a path starting with /api/', () => {
    for (const route of ROUTE_INVENTORY) {
      expect(route.path).toMatch(/^\/api\//)
    }
  })

  it('every route has at least one HTTP method', () => {
    for (const route of ROUTE_INVENTORY) {
      expect(route.methods.length).toBeGreaterThan(0)
    }
  })

  it('every route has a pipelineEntry', () => {
    const valid = new Set(['control-plane', 'admin', 'observability', 'utility', 'none'])
    for (const route of ROUTE_INVENTORY) {
      expect(valid.has(route.pipelineEntry)).toBe(true)
    }
  })

  it('all /api/admin/* routes are marked adminRequired', () => {
    const adminRoutes = ROUTE_INVENTORY.filter(r => r.path.startsWith('/api/admin'))
    expect(adminRoutes.length).toBeGreaterThan(0)
    for (const route of adminRoutes) {
      expect(route.adminRequired).toBe(true)
    }
  })

  it('/api/generate has runtimeExport: true', () => {
    const generate = ROUTE_INVENTORY.find(r => r.path === '/api/generate')
    expect(generate?.runtimeExport).toBe(true)
  })

  it('/api/health does not require auth', () => {
    const health = ROUTE_INVENTORY.find(r => r.path === '/api/health')
    expect(health?.authRequired).toBe(false)
  })

  it('ISSUE-2 resolved — ALL routes have runtimeExport: true', () => {
    const missing = ROUTE_INVENTORY.filter(r => !r.runtimeExport)
    expect(missing).toHaveLength(0)
  })

  it('all control-plane/observability routes have runtimeExport: true', () => {
    const cpRoutes = ROUTE_INVENTORY.filter(
      r => r.pipelineEntry === 'control-plane' || r.pipelineEntry === 'observability'
    )
    for (const route of cpRoutes) {
      expect(route.runtimeExport).toBe(true)
    }
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

  it('reports package as apps/web', () => {
    expect(validatePackage().package).toBe('apps/web')
  })

  it('reports level as L5', () => {
    expect(validatePackage().level).toBe('L5')
  })

  it('runs 8 checks', () => {
    expect(validatePackage().checks).toHaveLength(8)
  })

  it('is healthy — all critical/high checks pass', () => {
    const report = validatePackage()
    expect(report.healthy).toBe(true)
    expect(report.failures).toHaveLength(0)
  })

  it('package-level-coherence passes', () => {
    const report = validatePackage()
    const check  = report.checks.find(c => c.id === 'package-level-coherence')
    expect(check?.passed).toBe(true)
  })

  it('admin-routes-marked passes', () => {
    const report = validatePackage()
    const check  = report.checks.find(c => c.id === 'admin-routes-marked')
    expect(check?.passed).toBe(true)
  })

  it('capability-registry-coherence passes', () => {
    const report = validatePackage()
    const check  = report.checks.find(c => c.id === 'capability-registry-coherence')
    expect(check?.passed).toBe(true)
  })

  it('route-inventory-completeness passes', () => {
    const report = validatePackage()
    const check  = report.checks.find(c => c.id === 'route-inventory-completeness')
    expect(check?.passed).toBe(true)
  })

  it('nodejs-runtime-export passes (ISSUE-2 resolved)', () => {
    const report = validatePackage()
    const check  = report.checks.find(c => c.id === 'nodejs-runtime-export')
    expect(check?.passed).toBe(true)
    expect(check?.detail).toContain('ISSUE-2 fully resolved')
  })

  it('known-issues-tracked passes (no stale ISSUE-2 tags)', () => {
    const report = validatePackage()
    const check  = report.checks.find(c => c.id === 'known-issues-tracked')
    expect(check?.passed).toBe(true)
  })

  it('server-analytics-consolidation passes', () => {
    const report = validatePackage()
    const check  = report.checks.find(c => c.id === 'server-analytics-consolidation')
    expect(check?.passed).toBe(true)
  })

  it('summary includes apps/web and L5', () => {
    const summary = validatePackage().summary
    expect(summary).toContain('apps/web')
    expect(summary).toContain('L5')
  })
})


