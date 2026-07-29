import { describe, it, expect } from 'vitest'
import { isValidHexColor, normalizeHexColor } from '../colors'

describe('isValidHexColor', () => {
  it('accepts 6-char hex with #', () => {
    expect(isValidHexColor('#06b6d4')).toBe(true)
  })

  it('accepts 3-char hex with #', () => {
    expect(isValidHexColor('#fff')).toBe(true)
  })

  it('rejects hex without #', () => {
    expect(isValidHexColor('06b6d4')).toBe(false)
  })

  it('rejects invalid characters', () => {
    expect(isValidHexColor('#zzzzzz')).toBe(false)
  })

  it('rejects wrong length', () => {
    expect(isValidHexColor('#06b6d')).toBe(false)
  })
})

describe('normalizeHexColor', () => {
  it('adds a missing leading #', () => {
    // SemanticTheme.primaryColor/accentColor/bgColor are documented as
    // "6-char hex, no #" on ArtifactV2 — this is the exact shape
    // resolveTheme() will need to normalize when it reads them.
    expect(normalizeHexColor('06b6d4')).toBe('#06b6d4')
  })

  it('leaves an existing leading # untouched', () => {
    expect(normalizeHexColor('#06b6d4')).toBe('#06b6d4')
  })

  it('throws on invalid input', () => {
    expect(() => normalizeHexColor('not-a-color')).toThrow(/invalid hex color/)
  })
})
