/**
 * Unit tests — governanceEngine.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { evaluateGovernance, registerPolicyViolationHandler } from '../../src/governanceEngine'

const CLEAN_TEXT = `Leadership requires courage. The best leaders make hard decisions early and own the outcome.
Building trust takes time. Consistency matters more than brilliance. Show up the same way every day.
Clarity beats complexity. One clear objective outperforms ten vague priorities in any quarter.
Teams succeed when people have both autonomy and accountability. Neither alone is enough.`.trim()

const CLICHE_TEXT = `Dive into this game-changer. In today's fast-paced landscape, we need to leverage the power of synergy.
It's important to note that this is a paradigm shift. Thought leaders move the needle.
In conclusion, absolutely — low-hanging fruit is the key. Of course, certainly, delve into this.`

const BUZZWORD_TEXT = `Our cutting-edge, bleeding-edge, state-of-the-art, world-class, best-in-class solution is robust.
It provides seamless, holistic, innovative solution delivery with actionable insights and key takeaways.
Elevate your impactful, scalable solution with end-to-end value-add.`

const WEAK_HOOK_TEXT = `In today's business world, companies face many challenges. Leadership is important.
We need to think about this carefully. The data shows interesting results.`

// High-penalty text combining clichés + buzzwords + em-dash abuse + weak hook → original_score < 50
const TERRIBLE_TEXT = `In today's fast-paced landscape, dive into this game-changer — a paradigm shift — of synergy.
Leveraging the power of thought leadership, in the ever-evolving landscape of cutting-edge, bleeding-edge, state-of-the-art, world-class, best-in-class, robust, seamless, holistic solutions.
Certainly, absolutely, of course, move the needle with low-hanging fruit. Circle back to boil the ocean.
Transformative journey with innovative solution, end-to-end value-add, actionable insights, key takeaways, elevate your impactful scalable solution.`

describe('evaluateGovernance', () => {
  describe('return shape', () => {
    it('returns all required fields', () => {
      const r = evaluateGovernance({ content: CLEAN_TEXT, taskType: 'post' })
      for (const f of ['passed','score','original_score','annotations','recommendations','violations','flags_remaining','approved_output','engine_badge']) {
        expect(r).toHaveProperty(f)
      }
    })

    it('score and original_score are always in [0, 100]', () => {
      for (const content of [CLEAN_TEXT, CLICHE_TEXT, BUZZWORD_TEXT, WEAK_HOOK_TEXT, '', 'x', TERRIBLE_TEXT]) {
        const r = evaluateGovernance({ content, taskType: 'post' })
        expect(r.score).toBeGreaterThanOrEqual(0)
        expect(r.score).toBeLessThanOrEqual(100)
        expect(r.original_score).toBeGreaterThanOrEqual(0)
        expect(r.original_score).toBeLessThanOrEqual(100)
      }
    })

    it('approved_output is always a string', () => {
      expect(typeof evaluateGovernance({ content: CLICHE_TEXT, taskType: 'post' }).approved_output).toBe('string')
    })

    it('annotations is always an array', () => {
      expect(Array.isArray(evaluateGovernance({ content: CLICHE_TEXT, taskType: 'post' }).annotations)).toBe(true)
    })
  })

  describe('clean text scoring', () => {
    it('clean text passes governance', () => {
      expect(evaluateGovernance({ content: CLEAN_TEXT, taskType: 'post' }).passed).toBe(true)
    })

    it('clean text original_score >= 80', () => {
      expect(evaluateGovernance({ content: CLEAN_TEXT, taskType: 'post' }).original_score).toBeGreaterThanOrEqual(80)
    })

    it('clean text has no violations', () => {
      const r = evaluateGovernance({ content: CLEAN_TEXT, taskType: 'post' })
      expect(r.violations).not.toContain('cliche_density')
      expect(r.violations).not.toContain('weak_hook')
    })
  })

  describe('cliché detection and scoring', () => {
    it('cliché text original_score lower than clean text original_score', () => {
      const clean  = evaluateGovernance({ content: CLEAN_TEXT, taskType: 'post' })
      const cliche = evaluateGovernance({ content: CLICHE_TEXT, taskType: 'post' })
      expect(cliche.original_score).toBeLessThan(clean.original_score)
    })

    it('detects cliche_density violation when >= 3 clichés', () => {
      expect(evaluateGovernance({ content: CLICHE_TEXT, taskType: 'post' }).violations).toContain('cliche_density')
    })

    it('removes clichés from approved_output (annotations mention clichés)', () => {
      const r = evaluateGovernance({ content: CLICHE_TEXT, taskType: 'post' })
      expect(r.approved_output.toLowerCase()).not.toContain('dive into')
      expect(r.annotations.some(a => a.includes('cliché'))).toBe(true)
    })

    it('final score >= original_score (fixes never make it worse)', () => {
      const r = evaluateGovernance({ content: CLICHE_TEXT, taskType: 'post' })
      expect(r.score).toBeGreaterThanOrEqual(r.original_score)
    })
  })

  describe('buzzword detection', () => {
    it('buzzword text original_score lower than clean text original_score', () => {
      const clean = evaluateGovernance({ content: CLEAN_TEXT, taskType: 'post' })
      const bw    = evaluateGovernance({ content: BUZZWORD_TEXT, taskType: 'post' })
      expect(bw.original_score).toBeLessThan(clean.original_score)
    })

    it('produces buzzword annotations when > 2 buzzwords present', () => {
      const r = evaluateGovernance({ content: BUZZWORD_TEXT, taskType: 'post' })
      expect(r.annotations.some(a => a.includes('buzzword'))).toBe(true)
    })
  })

  describe('weak hook detection', () => {
    it('detects weak_hook violation', () => {
      expect(evaluateGovernance({ content: WEAK_HOOK_TEXT, taskType: 'post' }).violations).toContain('weak_hook')
    })

    it('includes hook in flags_remaining (unfixable)', () => {
      const r = evaluateGovernance({ content: WEAK_HOOK_TEXT, taskType: 'post' })
      expect(r.flags_remaining.some(f => f.toLowerCase().includes('hook'))).toBe(true)
    })
  })

  describe('em-dash abuse', () => {
    it('penalises lines with 2+ em-dashes', () => {
      const heavy = 'This — has two — em-dashes.\nAnother — line with two — dashes.\n' + CLEAN_TEXT
      const rHeavy = evaluateGovernance({ content: heavy, taskType: 'post' })
      const rClean = evaluateGovernance({ content: CLEAN_TEXT, taskType: 'post' })
      expect(rHeavy.original_score).toBeLessThan(rClean.original_score)
    })
  })

  describe('context propagation', () => {
    it('uses provided engineBadge', () => {
      expect(evaluateGovernance({ content: CLEAN_TEXT, taskType: 'post', context: { engineBadge: 'TestBadge' } }).engine_badge).toBe('TestBadge')
    })

    it('defaults engineBadge to "Generated via BrandOS"', () => {
      expect(evaluateGovernance({ content: CLEAN_TEXT, taskType: 'post' }).engine_badge).toBe('Generated via BrandOS')
    })

    it('executive tone annotation appears with clichés', () => {
      const r = evaluateGovernance({ content: CLICHE_TEXT, taskType: 'post', context: { tone: 'executive' } })
      expect(r.annotations.some(a => a.includes('Executive'))).toBe(true)
    })
  })

  describe('score_below_threshold violation', () => {
    it('fires when original_score < 50 (terrible text with stacked penalties)', () => {
      const r = evaluateGovernance({ content: TERRIBLE_TEXT, taskType: 'post' })
      expect(r.violations).toContain('score_below_threshold')
    })
  })
})

describe('registerPolicyViolationHandler', () => {
  beforeEach(() => { registerPolicyViolationHandler(() => {}) })

  it('is callable', () => {
    const handler = vi.fn()
    expect(() => registerPolicyViolationHandler(handler)).not.toThrow()
  })

  it('receives type, score, details when terrible text evaluated', () => {
    const calls: Array<[string, number, string]> = []
    registerPolicyViolationHandler((type, score, details) => { calls.push([type, score, details]) })
    evaluateGovernance({ content: TERRIBLE_TEXT, taskType: 'post' })
    expect(calls.length).toBeGreaterThan(0)
    expect(typeof calls[0][0]).toBe('string')
    expect(typeof calls[0][1]).toBe('number')
    expect(typeof calls[0][2]).toBe('string')
  })
})


