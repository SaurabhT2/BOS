/**
 * @brandos/iskill-runtime — bootstrap.ts
 *
 * ISkill Runtime bootstrap — creates the singleton runtime and registers
 * the first ICP bundle: AI Founder GTM Bundle.
 *
 * ARCHITECTURE DIRECTION (from Master Architecture):
 *   "Bundles must be statically registered at bootstrap for the first 90 days."
 *
 * INTEGRATION PATTERN:
 *
 *   // In apps/web/instrumentation.ts (server startup):
 *   import { bootstrapSkillRuntime } from '@brandos/iskill-runtime'
 *   import { globalArtifactEngine } from '@brandos/artifact-engine-layer'
 *
 *   bootstrapSkillRuntime({
 *     governanceCaller: createGovernanceBridge(globalArtifactEngine)
 *   })
 *
 * GOVERNANCE BRIDGE:
 *   The caller must provide an IGovernanceCaller that wraps ArtifactEngine.govern().
 *   This keeps iskill-runtime fully decoupled from artifact-engine-layer internals.
 *   See: createGovernanceBridge() in the integration guide.
 */

import { SkillRuntime } from './runtime/skill-runtime'
import {
  CarouselFounderSkillDef,
  CarouselFounderLifecycle,
} from './skills/carousel-founder'
import {
  LinkedInPostSkillDef,
  LinkedInPostLifecycle,
} from './skills/linkedin-post'
import type { IGovernanceCaller } from './lifecycle/executor'
import type { IBundleDefinition } from './contracts'
import { CAROUSEL_STRUCTURAL_CONSTRAINTS } from '@brandos/governance-config';

// ─── Bootstrap options ────────────────────────────────────────────────────────

export interface ISkillRuntimeBootstrapOptions {
  /** Governance bridge — wraps ArtifactEngine.govern() */
  governanceCaller: IGovernanceCaller
  /** Skip bundle registration (useful for testing) */
  skipBundleRegistration?: boolean
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let globalSkillRuntime: SkillRuntime | null = null
let bootstrapped = false

export function bootstrapSkillRuntime(options: ISkillRuntimeBootstrapOptions): SkillRuntime {
  if (bootstrapped) {
    console.warn('[ISkillRuntime] bootstrapSkillRuntime called more than once — skipping')
    return globalSkillRuntime!
  }

  const runtime = new SkillRuntime(options.governanceCaller)

  // ── Register skills ────────────────────────────────────────────────────────
  runtime.registerSkill(CarouselFounderSkillDef as any, new CarouselFounderLifecycle())
  runtime.registerSkill(LinkedInPostSkillDef as any, new LinkedInPostLifecycle())

  // Future skills registered here:
  // runtime.registerSkill(PostFounderSkillDef, new PostFounderLifecycle())       // Day 30–60
  // runtime.registerSkill(DeckFounderSkillDef, new DeckFounderLifecycle())       // Day 60–90
  // runtime.registerSkill(ThoughtLeadershipSkillDef, new ThoughtLeadershipLifecycle()) // Day 90

  // ── Register bundles ───────────────────────────────────────────────────────
  if (!options.skipBundleRegistration) {
    runtime.registerBundle(AI_FOUNDER_GTM_BUNDLE)

    // Future bundles:
    // runtime.registerBundle(B2B_SAAS_LAUNCH_BUNDLE)    // Day 60
    // runtime.registerBundle(THOUGHT_LEADERSHIP_BUNDLE) // Day 90
  }

  bootstrapped = true
  globalSkillRuntime = runtime

  console.info(
    `[ISkillRuntime] Bootstrap complete. ` +
    `Skills: [${runtime.listSkills().map(s => s.id).join(', ')}] ` +
    `Bundles: [${runtime.listBundles().map(b => b.id).join(', ')}]`,
  )

  return runtime
}

export function getGlobalSkillRuntime(): SkillRuntime {
  if (!globalSkillRuntime) {
    throw new Error(
      '[ISkillRuntime] Runtime not bootstrapped. ' +
      'Call bootstrapSkillRuntime() before using getGlobalSkillRuntime().',
    )
  }
  return globalSkillRuntime
}

/** For testing — resets singleton */
export function _resetSkillRuntime(): void {
  globalSkillRuntime = null
  bootstrapped = false
}

// ─── ICP Bundle Definitions ───────────────────────────────────────────────────

/**
 * AI Founder GTM Bundle — Priority #1 (Score 9.1)
 *
 * High-frequency buyers (5–10 pieces/week). Low CAC via organic LinkedIn.
 * Brand memory flywheel activates fastest. Self-serve acquisition.
 */
export const AI_FOUNDER_GTM_BUNDLE: IBundleDefinition = {
  id: 'ai-founder-gtm',
  name: 'AI Founder GTM Bundle',
  icp: 'AI-native startup founders doing content-led B2B GTM on LinkedIn and Twitter',
  skillIds: ['carousel-founder', 'linkedin-post'],  // grows: thought-leadership, cta-optimizer
  governanceOverrides: {
    minRichnessScore: 0.65,
    // NOTE: This bundle intentionally sets minSlides BELOW the canonical minimum
    // (CAROUSEL_STRUCTURAL_CONSTRAINTS.minSlides = ${CAROUSEL_STRUCTURAL_CONSTRAINTS.minSlides}).
    // This is a deliberate governance override for founder-tier content where
    // shorter carousels are acceptable. If the canonical minimum rises above 5,
    // revisit this bundle policy.
    minSlides: Math.min(5, CAROUSEL_STRUCTURAL_CONSTRAINTS.minSlides),
    repairAttempts: 2,
  },
  identityWeights: {
    hookStyle: 1.2,       // hooks matter most for founder voice
    ctaPatterns: 1.1,
    tonePatterns: 1.0,
    phraseLibrary: 0.9,
  },
  audienceProfile: {
    role: 'Founder / CEO',
    industry: 'B2B SaaS / AI',
    companySize: '1-50',
    painPoints: [
      'Building credibility without enterprise brand',
      'Converting LinkedIn followers to pipeline',
      'Consistent content without agency overhead',
    ],
    successMetrics: [
      'Inbound demo requests from content',
      'LinkedIn follower growth rate',
      'Content-attributed pipeline',
    ],
  },
  permissions: [],
  version: '1.0.0',
  active: true,
  source: 'static',
  registeredAt: new Date().toISOString(),
}

/**
 * B2B SaaS Launch Bundle — Priority #2 (Score 8.3) — Day 60
 * Multi-artifact workflow: carousel + post + report.
 * Requires DeckArtifact compiler registered first.
 */
export const B2B_SAAS_LAUNCH_BUNDLE: IBundleDefinition = {
  id: 'b2b-saas-launch',
  name: 'B2B SaaS Launch Bundle',
  icp: 'B2B SaaS companies launching new products or entering new market segments',
  skillIds: ['carousel-founder'],  // grows: post-founder, strategy-memo, deck-founder
  governanceOverrides: {
    minRichnessScore: 0.70,
    minSlides: CAROUSEL_STRUCTURAL_CONSTRAINTS.minSlides,
    repairAttempts: 2,
  },
  audienceProfile: {
    role: 'Head of Marketing / Product Marketing',
    industry: 'B2B SaaS',
    companySize: '50-500',
    painPoints: [
      'Launch content at scale without increasing headcount',
      'Consistent messaging across channels and formats',
    ],
    successMetrics: [
      'Launch-week pipeline generated',
      'Content engagement rate vs baseline',
    ],
  },
  permissions: [],
  version: '1.0.0',
  active: false,  // inactive until Day 60
  source: 'static',
  registeredAt: new Date().toISOString(),
}


