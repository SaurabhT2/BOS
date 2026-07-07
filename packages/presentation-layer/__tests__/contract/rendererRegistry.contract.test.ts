/**
 * Contract tests — RendererRegistry
 *
 * Verifies the RendererRegistry singleton behaves according to its contract:
 *   ✓ register() stores a renderer by artifact type
 *   ✓ resolveRenderer() returns the registered component
 *   ✓ resolveRenderer() returns null for unknown types
 *   ✓ has() returns correct presence flags
 *   ✓ listArtifactTypes() reflects registered types
 *   ✓ register() is idempotent — later registration wins
 *   ✓ Registry is independent of React rendering
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { RendererRegistry } from '../../src/renderers/RendererRegistry'
import type { ArtifactRendererComponent } from '../../src/renderers/RendererRegistry'
import type { ArtifactV2 } from '@brandos/contracts'

// ─── Minimal stub renderer components ────────────────────────────────────────

function makeStubRenderer(name: string): ArtifactRendererComponent {
  const Component = (_props: { artifact: ArtifactV2 }) => null
  Object.defineProperty(Component, 'name', { value: name })
  return Component
}

const CarouselStub = makeStubRenderer('CarouselStub')
const DeckStub     = makeStubRenderer('DeckStub')
const ReportStub   = makeStubRenderer('ReportStub')
const CustomStub   = makeStubRenderer('CustomStub')

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RendererRegistry contract', () => {
  // Reset registry between tests by re-registering known stubs
  // (Registry is a module singleton — we cannot reinstantiate it)
  beforeEach(() => {
    RendererRegistry.register('carousel', CarouselStub)
    RendererRegistry.register('deck',     DeckStub)
    RendererRegistry.register('report',   ReportStub)
  })

  // ── register / resolve ──────────────────────────────────────────────────────

  it('resolves a registered carousel renderer', () => {
    const resolved = RendererRegistry.resolveRenderer('carousel')
    expect(resolved).toBe(CarouselStub)
  })

  it('resolves a registered deck renderer', () => {
    const resolved = RendererRegistry.resolveRenderer('deck')
    expect(resolved).toBe(DeckStub)
  })

  it('resolves a registered report renderer', () => {
    const resolved = RendererRegistry.resolveRenderer('report')
    expect(resolved).toBe(ReportStub)
  })

  it('returns null for an unregistered artifact type', () => {
    const resolved = RendererRegistry.resolveRenderer('unknown_type' as any)
    expect(resolved).toBeNull()
  })

  // ── has() ───────────────────────────────────────────────────────────────────

  it('has() returns true for a registered type', () => {
    expect(RendererRegistry.has('carousel')).toBe(true)
    expect(RendererRegistry.has('deck')).toBe(true)
    expect(RendererRegistry.has('report')).toBe(true)
  })

  it('has() returns false for an unregistered type', () => {
    expect(RendererRegistry.has('not_registered' as any)).toBe(false)
  })

  // ── listArtifactTypes() ─────────────────────────────────────────────────────

  it('listArtifactTypes() includes all registered types', () => {
    const types = RendererRegistry.listArtifactTypes()
    expect(types).toContain('carousel')
    expect(types).toContain('deck')
    expect(types).toContain('report')
  })

  // ── idempotency / override ──────────────────────────────────────────────────

  it('later register() call overwrites the previous renderer for the same type', () => {
    const NewCarouselStub = makeStubRenderer('NewCarouselStub')
    RendererRegistry.register('carousel', NewCarouselStub)
    expect(RendererRegistry.resolveRenderer('carousel')).toBe(NewCarouselStub)
    // Restore
    RendererRegistry.register('carousel', CarouselStub)
  })

  it('registering a new type does not affect existing registrations', () => {
    RendererRegistry.register('custom_type' as any, CustomStub)
    expect(RendererRegistry.resolveRenderer('carousel')).toBe(CarouselStub)
    expect(RendererRegistry.resolveRenderer('deck')).toBe(DeckStub)
    expect(RendererRegistry.resolveRenderer('report')).toBe(ReportStub)
  })

  // ── Type safety ─────────────────────────────────────────────────────────────

  it('resolveRenderer returns a callable function (React component shape)', () => {
    const resolved = RendererRegistry.resolveRenderer('carousel')
    expect(typeof resolved).toBe('function')
  })
})


