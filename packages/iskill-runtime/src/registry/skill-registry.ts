/**
 * @brandos/iskill-runtime — registry/skill-registry.ts
 *
 * ISkill Runtime Registry — registration, discovery, and versioning.
 *
 * RULES:
 *   - Skills registered with both ISkill (for SkillContext compatibility)
 *     and ISkillLifecycle (for governed lifecycle execution).
 *   - One canonical entry per skill ID. Duplicate registration logs a warning
 *     and replaces the previous entry.
 *   - Bundle association is managed here (not in bundle registry).
 *   - Version semver comparison for compatibility checks.
 */

import type { ISkill } from '@brandos/contracts'
import type {
  ISkillLifecycle,
  ISkillRuntimeEntry,
  ISkillRuntimeMetadata,
} from '../contracts'

// ─── Registry ─────────────────────────────────────────────────────────────────

export class SkillRegistry {
  private readonly entries = new Map<string, ISkillRuntimeEntry>()

  /**
   * Register a skill with its lifecycle contract.
   * Replaces any existing registration for the same skill ID.
   */
  register(skill: ISkill, lifecycle: ISkillLifecycle): ISkillRuntimeEntry {
    const now = new Date().toISOString()

    if (this.entries.has(skill.metadata.id)) {
      console.warn(
        `[SkillRegistry] Skill "${skill.metadata.id}" already registered — replacing. ` +
        `Previous version: ${this.entries.get(skill.metadata.id)?.metadata.version}`,
      )
    }

    const metadata: ISkillRuntimeMetadata = {
      ...skill.metadata,
      bundleIds: [],       // populated by bundle registry on bundle registration
      artifactType: lifecycle.artifactContract.artifactType,
      consumedDimensions: lifecycle.consumedDimensions,
      lifecycleVersion: '1.0.0',
      fixtureValidated: false,
    }

    const entry: ISkillRuntimeEntry = {
      skill,
      lifecycle,
      metadata,
      registeredAt: now,
    }

    this.entries.set(skill.metadata.id, entry)

    console.info(
      `[SkillRegistry] Registered: ${skill.metadata.id} v${skill.metadata.version} ` +
      `[${lifecycle.artifactContract.artifactType}] dims:[${lifecycle.consumedDimensions.join(', ')}]`,
    )

    return entry
  }

  /** Associate a skill with a bundle ID */
  associateBundle(skillId: string, bundleId: string): void {
    const entry = this.entries.get(skillId)
    if (!entry) {
      console.warn(`[SkillRegistry] Cannot associate bundle: skill "${skillId}" not found`)
      return
    }
    if (!entry.metadata.bundleIds.includes(bundleId)) {
      entry.metadata.bundleIds.push(bundleId)
    }
  }

  /** Mark a skill as fixture-validated */
  markFixtureValidated(skillId: string): void {
    const entry = this.entries.get(skillId)
    if (entry) {
      entry.metadata.fixtureValidated = true
    }
  }

  get(skillId: string): ISkillRuntimeEntry | undefined {
    return this.entries.get(skillId)
  }

  has(skillId: string): boolean {
    return this.entries.has(skillId)
  }

  list(): ISkillRuntimeMetadata[] {
    return [...this.entries.values()].map(e => e.metadata)
  }

  listEntries(): ISkillRuntimeEntry[] {
    return [...this.entries.values()]
  }

  listByBundle(bundleId: string): ISkillRuntimeEntry[] {
    return [...this.entries.values()].filter(e =>
      e.metadata.bundleIds.includes(bundleId),
    )
  }

  getVersion(skillId: string): string | undefined {
    return this.entries.get(skillId)?.metadata.version
  }

  /**
   * Check semver compatibility.
   * Returns true if registered version is >= required version.
   * Simple major.minor.patch comparison (no range syntax).
   */
  checkCompatibility(skillId: string, requiredVersion: string): boolean {
    const registered = this.entries.get(skillId)
    if (!registered) return false
    return compareVersions(registered.metadata.version, requiredVersion) >= 0
  }

  size(): number {
    return this.entries.size
  }
}

// ─── Semver comparison helper ─────────────────────────────────────────────────

function parseVersion(v: string): [number, number, number] {
  const parts = v.split('.').map(Number)
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

function compareVersions(a: string, b: string): number {
  const [aMaj, aMin, aPat] = parseVersion(a)
  const [bMaj, bMin, bPat] = parseVersion(b)
  if (aMaj !== bMaj) return aMaj - bMaj
  if (aMin !== bMin) return aMin - bMin
  return aPat - bPat
}


