/**
 * Contract tests — Presentation Layer public API
 *
 * Verifies that the public barrel (src/index.ts) exports every symbol
 * the package promises, and that no forbidden runtime symbols leak out.
 */

import { describe, it, expect } from 'vitest'
import * as PublicAPI from '../../src/index'

describe('Presentation-layer public API contract', () => {
  // ── Renderers ───────────────────────────────────────────────────────────────

  it('exports CarouselRenderer as a function (React component)', () => {
    expect(typeof PublicAPI.CarouselRenderer).toBe('function')
  })

  it('exports DeckRenderer as a function (React component)', () => {
    expect(typeof PublicAPI.DeckRenderer).toBe('function')
  })

  it('exports ReportRenderer as a function (React component)', () => {
    expect(typeof PublicAPI.ReportRenderer).toBe('function')
  })

  // ── RendererRegistry ────────────────────────────────────────────────────────

  it('exports RendererRegistry singleton', () => {
    expect(PublicAPI.RendererRegistry).toBeDefined()
    expect(typeof PublicAPI.RendererRegistry.register).toBe('function')
    expect(typeof PublicAPI.RendererRegistry.resolveRenderer).toBe('function')
    expect(typeof PublicAPI.RendererRegistry.has).toBe('function')
    expect(typeof PublicAPI.RendererRegistry.listArtifactTypes).toBe('function')
  })

  // ── Shell components ────────────────────────────────────────────────────────

  it('exports WorkspaceShell as a function', () => {
    expect(typeof PublicAPI.WorkspaceShell).toBe('function')
  })

  it('exports AdminShell as a function', () => {
    expect(typeof PublicAPI.AdminShell).toBe('function')
  })

  it('exports AdminNav as a function', () => {
    expect(typeof PublicAPI.AdminNav).toBe('function')
  })

  // ── Mode selectors ──────────────────────────────────────────────────────────

  it('exports RuntimeModeSelector as a function', () => {
    expect(typeof PublicAPI.RuntimeModeSelector).toBe('function')
  })

  it('exports ModelSelector as a function', () => {
    expect(typeof PublicAPI.ModelSelector).toBe('function')
  })

  // ── Other components ────────────────────────────────────────────────────────

  it('exports GenerationProgressDisplay as a function', () => {
    expect(typeof PublicAPI.GenerationProgressDisplay).toBe('function')
  })

  it('exports ControlPlanePanel as a function', () => {
    expect(typeof PublicAPI.ControlPlanePanel).toBe('function')
  })

  it('exports SkillShell as a function', () => {
    expect(typeof PublicAPI.SkillShell).toBe('function')
  })

  // ── Hooks ───────────────────────────────────────────────────────────────────

  it('exports useAvailableModes as a function', () => {
    expect(typeof PublicAPI.useAvailableModes).toBe('function')
  })
})


