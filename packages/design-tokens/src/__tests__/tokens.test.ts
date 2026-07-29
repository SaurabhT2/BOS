import { describe, it, expect } from 'vitest'
import { BASE_TYPE_SCALE, DEFAULT_FONT_STACK } from '../typography'
import { BASE_SPACING } from '../spacing'
import { BASE_RADII } from '../radii'

describe('BASE_TYPE_SCALE', () => {
  it('is strictly descending from h1 to caption', () => {
    expect(BASE_TYPE_SCALE.h1).toBeGreaterThan(BASE_TYPE_SCALE.h2)
    expect(BASE_TYPE_SCALE.h2).toBeGreaterThan(BASE_TYPE_SCALE.h3)
    expect(BASE_TYPE_SCALE.h3).toBeGreaterThan(BASE_TYPE_SCALE.body)
    expect(BASE_TYPE_SCALE.body).toBeGreaterThan(BASE_TYPE_SCALE.caption)
  })
})

describe('DEFAULT_FONT_STACK', () => {
  it('is a non-empty font-family string', () => {
    expect(DEFAULT_FONT_STACK.length).toBeGreaterThan(0)
    expect(DEFAULT_FONT_STACK).toContain('sans-serif')
  })
})

describe('BASE_SPACING', () => {
  it('has a positive unit and derived values that are multiples of it', () => {
    expect(BASE_SPACING.unit).toBeGreaterThan(0)
    expect(BASE_SPACING.cardPadding % BASE_SPACING.unit).toBe(0)
    expect(BASE_SPACING.sectionGap % BASE_SPACING.unit).toBe(0)
  })
})

describe('BASE_RADII', () => {
  it('defines non-negative radii', () => {
    expect(BASE_RADII.card).toBeGreaterThanOrEqual(0)
    expect(BASE_RADII.pill).toBeGreaterThanOrEqual(0)
  })
})
