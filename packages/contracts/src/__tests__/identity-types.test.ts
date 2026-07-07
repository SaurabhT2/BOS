/**
 * @brandos/contracts — identity-types.test.ts
 *
 * Tests for dimension classification helpers and DEFAULT_IDENTITY_CONFIG.
 */

import { describe, it, expect } from 'vitest'
import {
  SEMANTIC_DIMENSIONS,
  VISUAL_DIMENSIONS,
  ALL_DIMENSIONS,
  isVisualDimension,
  isSemanticDimension,
  DEFAULT_IDENTITY_CONFIG,
  type IdentityDimension,
} from '../identity-types'

describe('dimension arrays', () => {
  it('ALL_DIMENSIONS is the union of SEMANTIC + VISUAL', () => {
    const combined = [...SEMANTIC_DIMENSIONS, ...VISUAL_DIMENSIONS]
    expect(ALL_DIMENSIONS.length).toBe(combined.length)
    combined.forEach(d => {
      expect(ALL_DIMENSIONS).toContain(d)
    })
  })

  it('SEMANTIC and VISUAL dimension sets are disjoint', () => {
    const semanticSet = new Set(SEMANTIC_DIMENSIONS)
    VISUAL_DIMENSIONS.forEach(d => {
      expect((SEMANTIC_DIMENSIONS as string[]).includes(d)).toBe(false)
    })
  })

  it('has no duplicates in SEMANTIC_DIMENSIONS', () => {
    expect(new Set(SEMANTIC_DIMENSIONS).size).toBe(SEMANTIC_DIMENSIONS.length)
  })

  it('has no duplicates in VISUAL_DIMENSIONS', () => {
    expect(new Set(VISUAL_DIMENSIONS).size).toBe(VISUAL_DIMENSIONS.length)
  })
})

describe('isVisualDimension', () => {
  it('returns true for a visual dimension', () => {
    expect(isVisualDimension('colorSystem')).toBe(true)
    expect(isVisualDimension('brandMood')).toBe(true)
  })

  it('returns false for a semantic dimension', () => {
    expect(isVisualDimension('tonePatterns')).toBe(false)
    expect(isVisualDimension('hookStyle')).toBe(false)
  })
})

describe('isSemanticDimension', () => {
  it('returns true for a semantic dimension', () => {
    expect(isSemanticDimension('tonePatterns')).toBe(true)
    expect(isSemanticDimension('phraseLibrary')).toBe(true)
  })

  it('returns false for a visual dimension', () => {
    expect(isSemanticDimension('colorSystem')).toBe(false)
  })
})

describe('DEFAULT_IDENTITY_CONFIG', () => {
  it('has all required fields', () => {
    expect(typeof DEFAULT_IDENTITY_CONFIG.signalScoreThreshold).toBe('number')
    expect(typeof DEFAULT_IDENTITY_CONFIG.confidenceThreshold).toBe('number')
    expect(typeof DEFAULT_IDENTITY_CONFIG.recencyDecayRate).toBe('number')
    expect(typeof DEFAULT_IDENTITY_CONFIG.maxSignalsPerDimension).toBe('number')
    expect(typeof DEFAULT_IDENTITY_CONFIG.requireReview).toBe('boolean')
  })

  it('has sane threshold values (0–100 range for score, 0–1 for confidence)', () => {
    expect(DEFAULT_IDENTITY_CONFIG.signalScoreThreshold).toBeGreaterThan(0)
    expect(DEFAULT_IDENTITY_CONFIG.signalScoreThreshold).toBeLessThanOrEqual(100)
    expect(DEFAULT_IDENTITY_CONFIG.confidenceThreshold).toBeGreaterThan(0)
    expect(DEFAULT_IDENTITY_CONFIG.confidenceThreshold).toBeLessThanOrEqual(1)
  })

  it('recencyDecayRate is between 0 and 1 exclusive (valid decay factor)', () => {
    expect(DEFAULT_IDENTITY_CONFIG.recencyDecayRate).toBeGreaterThan(0)
    expect(DEFAULT_IDENTITY_CONFIG.recencyDecayRate).toBeLessThan(1)
  })

  it('maxSignalsPerDimension is a positive integer', () => {
    expect(DEFAULT_IDENTITY_CONFIG.maxSignalsPerDimension).toBeGreaterThan(0)
    expect(Number.isInteger(DEFAULT_IDENTITY_CONFIG.maxSignalsPerDimension)).toBe(true)
  })
})


