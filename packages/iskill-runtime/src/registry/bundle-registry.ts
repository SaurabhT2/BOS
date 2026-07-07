/**
 * @brandos/iskill-runtime — registry/bundle-registry.ts
 *
 * ICP Bundle Registry — registration and capability resolution.
 *
 * RULES:
 *   - Bundles are statically registered at bootstrap for the first 90 days.
 *   - Dynamic registration is supported but flagged as 'dynamic' source.
 *   - Bundle registration triggers skill association in SkillRegistry.
 *   - Bundle capability resolution returns available vs missing skills.
 */

import type {
  IBundleDefinition,
  IBundleCapabilities,
  ISkillRuntimeMetadata,
} from '../contracts'
import type { SkillRegistry } from './skill-registry'

export class BundleRegistry {
  private readonly bundles = new Map<string, IBundleDefinition>()

  constructor(private readonly skillRegistry: SkillRegistry) {}

  /**
   * Register an ICP bundle.
   * Automatically associates bundle ID with all declared skills.
   */
  register(bundle: IBundleDefinition): void {
    if (this.bundles.has(bundle.id)) {
      console.warn(
        `[BundleRegistry] Bundle "${bundle.id}" already registered — replacing.`,
      )
    }

    this.bundles.set(bundle.id, {
      ...bundle,
      registeredAt: new Date().toISOString(),
    })

    // Associate skills with this bundle
    for (const skillId of bundle.skillIds) {
      this.skillRegistry.associateBundle(skillId, bundle.id)
    }

    console.info(
      `[BundleRegistry] Registered bundle: ${bundle.id} (${bundle.name}) ` +
      `skills:[${bundle.skillIds.join(', ')}]`,
    )
  }

  get(bundleId: string): IBundleDefinition | undefined {
    return this.bundles.get(bundleId)
  }

  has(bundleId: string): boolean {
    return this.bundles.has(bundleId)
  }

  list(): IBundleDefinition[] {
    return [...this.bundles.values()]
  }

  listActive(): IBundleDefinition[] {
    return [...this.bundles.values()].filter(b => b.active)
  }

  /**
   * Resolve capabilities for a bundle.
   * Returns which skills are available (registered) vs missing.
   */
  resolveCapabilities(bundleId: string): IBundleCapabilities {
    const bundle = this.bundles.get(bundleId)
    if (!bundle) {
      throw new Error(`[BundleRegistry] Bundle "${bundleId}" not found`)
    }

    const availableSkills: ISkillRuntimeMetadata[] = []
    const missingSkills: string[] = []

    for (const skillId of bundle.skillIds) {
      const entry = this.skillRegistry.get(skillId)
      if (entry) {
        availableSkills.push(entry.metadata)
      } else {
        missingSkills.push(skillId)
      }
    }

    if (missingSkills.length > 0) {
      console.warn(
        `[BundleRegistry] Bundle "${bundleId}" has unregistered skills: [${missingSkills.join(', ')}]`,
      )
    }

    return {
      bundleId,
      skillIds: bundle.skillIds,
      availableSkills,
      missingSkills,
      governanceOverrides: bundle.governanceOverrides,
      identityWeights: bundle.identityWeights,
    }
  }

  /**
   * Get all skills for a bundle (only registered ones).
   */
  getBundleSkills(bundleId: string) {
    const bundle = this.bundles.get(bundleId)
    if (!bundle) {
      throw new Error(`[BundleRegistry] Bundle "${bundleId}" not found`)
    }
    return this.skillRegistry.listByBundle(bundleId)
  }

  size(): number {
    return this.bundles.size
  }
}


