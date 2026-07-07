/**
 * @brandos/iskill-runtime — capability/SkillCapabilityRegistry.ts
 *
 * Machine-readable capability map for the ISkill runtime.
 * Provides queryable access to owned skill capabilities and validates
 * skill registration correctness.
 *
 * Additive-only. No behavioral changes, no new external dependencies.
 * Depends on: internal registry types only.
 */

import type { ISkillRuntimeEntry, ISkillRuntimeMetadata } from '../contracts'

// ─── Capability Key Types ─────────────────────────────────────────────────────

export type SkillCapabilityKey =
  | 'skill.generate.carousel'
  | 'skill.generate.deck'
  | 'skill.generate.report'
  | 'skill.govern.repair'
  | 'skill.runtime.register'
  | 'skill.runtime.resolve'
  | 'skill.runtime.list'
  | 'skill.runtime.validate'
  | 'skill.runtime.execute'
  | 'skill.runtime.personalize'
  | 'skill.runtime.lifecycle'
  | 'skill.runtime.bundle'
  | 'skill.runtime.health'

// ─── Capability Descriptor ────────────────────────────────────────────────────

export interface SkillCapabilityDescriptor {
  key: SkillCapabilityKey
  description: string
  exports: string[]
  /** Whether backed by a registered ISkill at runtime (dynamic) */
  hasRegisteredSkill: boolean
  /** Whether this capability is behind the production gate */
  gated: boolean
  notes?: string
}

// ─── Static capability definitions ───────────────────────────────────────────

export const STATIC_SKILL_CAPABILITIES: readonly Omit<SkillCapabilityDescriptor, 'hasRegisteredSkill'>[] = [
  {
    key: 'skill.generate.carousel',
    description: 'ISkill that generates CarouselArtifact via governed lifecycle. Reference: carousel-founder.',
    exports: ['CarouselFounderSkillDef', 'CarouselFounderLifecycle'],
    gated: true,
    notes: 'Production gate: globalThis.__brandos_iskill_contract_contributor must be true. carousel-founder is the reference implementation.',
  },
  {
    key: 'skill.generate.deck',
    description: 'ISkill that generates DeckArtifact. Not yet implemented — placeholder capability key.',
    exports: [],
    gated: true,
    notes: 'Not implemented. Add via registerSkill() after Phase 2.6.',
  },
  {
    key: 'skill.generate.report',
    description: 'ISkill that generates ReportArtifact. Not yet implemented — placeholder capability key.',
    exports: [],
    gated: true,
    notes: 'Not implemented. Add via registerSkill() after Phase 2.6.',
  },
  {
    key: 'skill.govern.repair',
    description: 'IGovernanceCaller bridge: delegates govern() calls to artifact-engine-layer.',
    exports: ['createGovernanceBridge', 'createTestOnlyGovernanceBridge'],
    gated: false,
    notes: 'createTestOnlyGovernanceBridge is for test environments only (production guard enforced).',
  },
  {
    key: 'skill.runtime.register',
    description: 'bootstrapSkillRuntime() — registers skills and bundles at server startup.',
    exports: ['bootstrapSkillRuntime', 'SkillRuntime'],
    gated: false,
  },
  {
    key: 'skill.runtime.resolve',
    description: 'getGlobalSkillRuntime() — resolves the singleton SkillRuntime instance.',
    exports: ['getGlobalSkillRuntime'],
    gated: false,
  },
  {
    key: 'skill.runtime.list',
    description: 'ISkillRuntime.listSkills() — returns registered skill metadata list.',
    exports: ['SkillRuntime'],
    gated: false,
  },
  {
    key: 'skill.runtime.validate',
    description: 'validateSkill() (from SkillCapabilityRegistry) — structural validation of ISkill entries.',
    exports: ['SkillCapabilityRegistry'],
    gated: false,
  },
  {
    key: 'skill.runtime.execute',
    description: '6-phase governed lifecycle: validate→prepare→execute→govern→repair→finalize.',
    exports: ['SkillRuntime'],
    gated: true,
    notes: 'Execution is gated on production flag. Safe to test via bootstrapSkillRuntime().',
  },
  {
    key: 'skill.runtime.personalize',
    description: 'buildPersonalizationContext() — assembles ISkillPersonalizationContext from brand memory signals.',
    exports: ['buildPersonalizationContext', 'SkillPersonalizationContext', 'EmptyPersonalizationContext'],
    gated: false,
  },
  {
    key: 'skill.runtime.lifecycle',
    description: 'ISkillLifecycle — 6-phase contract. SkillLifecycleExecutor orchestrates it.',
    exports: ['SkillRuntime'],
    gated: false,
  },
  {
    key: 'skill.runtime.bundle',
    description: 'IBundleDefinition — ICP Bundle runtime contract. AI_FOUNDER_GTM_BUNDLE is the reference bundle.',
    exports: ['AI_FOUNDER_GTM_BUNDLE', 'B2B_SAAS_LAUNCH_BUNDLE'],
    gated: false,
  },
  {
    key: 'skill.runtime.health',
    description: 'computeSkillHealth(), healthSummary() — derive SkillHealthScore from telemetry records.',
    exports: ['computeSkillHealth', 'healthSummary'],
    gated: false,
  },
] as const

// ─── SkillCapabilityRegistry ──────────────────────────────────────────────────

export class SkillCapabilityRegistry {
  private readonly staticMap: ReadonlyMap<SkillCapabilityKey, Omit<SkillCapabilityDescriptor, 'hasRegisteredSkill'>>
  private readonly skillMap = new Map<string, ISkillRuntimeEntry>()

  constructor() {
    this.staticMap = new Map(STATIC_SKILL_CAPABILITIES.map(c => [c.key, c]))
  }

  // ── Skill registration (mirrors SkillRegistry but at capability level) ──────

  /**
   * Register a skill entry in this capability registry.
   * Agents use SkillRuntime.registerSkill() in normal flow — this is the
   * capability-level mirror for observability and validation.
   */
  registerSkill(entry: ISkillRuntimeEntry): void {
    const skillId = entry.metadata.id
    if (this.skillMap.has(skillId)) {
      console.warn(`[SkillCapabilityRegistry] Replacing existing registration for skill: ${skillId}`)
    }
    this.skillMap.set(skillId, entry)
  }

  /**
   * Resolve a skill entry by ID.
   */
  resolveSkill(skillId: string): ISkillRuntimeEntry | undefined {
    return this.skillMap.get(skillId)
  }

  /**
   * List all registered skill metadata.
   */
  listSkills(): ISkillRuntimeMetadata[] {
    return [...this.skillMap.values()].map(e => e.metadata)
  }

  /**
   * validateSkill — structural validation of an ISkillRuntimeEntry.
   *
   * Checks:
   *   - metadata.id is non-empty string
   *   - metadata.version is semver-like (x.y.z)
   *   - metadata.artifactType is non-empty
   *   - metadata.consumedDimensions is an array
   *   - lifecycle.artifactContract.artifactType matches metadata.artifactType
   */
  validateSkill(entry: ISkillRuntimeEntry): SkillValidationResult {
    const errors: string[] = []
    const { metadata, lifecycle } = entry

    if (!metadata.id || typeof metadata.id !== 'string') {
      errors.push('metadata.id must be a non-empty string')
    }
    if (!metadata.version || !/^\d+\.\d+\.\d+/.test(metadata.version)) {
      errors.push(`metadata.version must be semver-like (got: "${metadata.version}")`)
    }
    if (!metadata.artifactType || typeof metadata.artifactType !== 'string') {
      errors.push('metadata.artifactType must be a non-empty string')
    }
    if (!Array.isArray(metadata.consumedDimensions)) {
      errors.push('metadata.consumedDimensions must be an array')
    }
    if (lifecycle.artifactContract.artifactType !== metadata.artifactType) {
      errors.push(
        `lifecycle.artifactContract.artifactType (${lifecycle.artifactContract.artifactType}) ` +
        `does not match metadata.artifactType (${metadata.artifactType})`
      )
    }
    if (typeof lifecycle.validate !== 'function') {
      errors.push('lifecycle.validate must be a function')
    }
    if (typeof lifecycle.execute !== 'function') {
      errors.push('lifecycle.execute must be a function (via ISkill)')
    }

    return { valid: errors.length === 0, errors, skillId: metadata.id }
  }

  // ── Capability query API ──────────────────────────────────────────────────

  getCapability(key: SkillCapabilityKey): SkillCapabilityDescriptor | undefined {
    const static_ = this.staticMap.get(key)
    if (!static_) return undefined
    // Dynamic: check if any registered skill covers a generate capability
    const skillArtifactType = key.replace('skill.generate.', '')
    const hasRegisteredSkill = this.listSkills().some(
      m => m.artifactType === skillArtifactType
    )
    return { ...static_, hasRegisteredSkill }
  }

  keys(): SkillCapabilityKey[] {
    return [...this.staticMap.keys()]
  }

  list(): SkillCapabilityDescriptor[] {
    return this.keys().map(k => this.getCapability(k)!)
  }

  owns(key: string): key is SkillCapabilityKey {
    return this.staticMap.has(key as SkillCapabilityKey)
  }

  gated(): SkillCapabilityDescriptor[] {
    return this.list().filter(c => c.gated)
  }

  unimplemented(): SkillCapabilityDescriptor[] {
    return this.list().filter(c => c.gated && c.exports.length === 0)
  }
}

// ─── Validation result ────────────────────────────────────────────────────────

export interface SkillValidationResult {
  valid: boolean
  errors: string[]
  skillId: string
}

/** Singleton */
export const skillCapabilityRegistry = new SkillCapabilityRegistry()


