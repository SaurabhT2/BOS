/**
 * @brandos/governance-layer — GovernancePluginRegistry.ts
 *
 * Pluggable governance plugin registry.
 *
 * PURPOSE:
 *   Decouples governance capability dispatch from hardcoded artifact-type
 *   ownership assumptions. Consumers call registerValidator/registerRepair/registerScorer
 *   at startup. The registry dispatches by (artifactType, capabilityKey).
 *
 * OWNED CAPABILITIES (registered by this module):
 *   governance.validate.carousel   — carousel semantic validation
 *   governance.validate.deck       — deck semantic validation
 *   governance.validate.report     — report semantic validation
 *   governance.validate.newsletter — newsletter semantic validation
 *   governance.score.text          — text quality scoring (all types)
 *   governance.repair.carousel     — carousel LLM-assisted repair
 *   governance.repair.deck         — deck LLM-assisted repair
 *   governance.repair.report       — report LLM-assisted repair
 *   governance.repair.newsletter   — newsletter LLM-assisted repair
 *
 * DESIGN:
 *   - Module-level singleton (not React context)
 *   - Registration is idempotent — later registration overwrites for same key
 *   - Validator functions are pure; repair functions accept LLM callbacks
 *   - No LLM imports here — LLM is always injected by callers
 *   - Registry is effectively read-only after bootstrapGovernancePlugins() completes
 *
 * INVARIANTS:
 *   1. Validators MUST be pure and deterministic
 *   2. Repair functions MUST accept a callLLM callback — never call LLM SDK directly
 *   3. Scorer functions MUST return a number in [0, 100]
 */

import type {
  SemanticValidator,
  SemanticScorer,
  SemanticRepair,
} from './contracts'

// ─── Plugin types ──────────────────────────────────────────────────────────────

export type GovernanceCapabilityKey = string

export interface GovernanceValidatorPlugin<T = unknown> {
  capabilityKey: GovernanceCapabilityKey
  artifactType: string
  validator: SemanticValidator<T>
}

export interface GovernanceScorerPlugin<T = unknown> {
  capabilityKey: GovernanceCapabilityKey
  artifactType: string
  scorer: SemanticScorer<T>
}

export interface GovernanceRepairPlugin<T = unknown> {
  capabilityKey: GovernanceCapabilityKey
  artifactType: string
  repair: SemanticRepair<T>
}

// ─── Registry implementation ───────────────────────────────────────────────────

class GovernancePluginRegistryImpl {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _validators = new Map<string, GovernanceValidatorPlugin<any>>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _scorers    = new Map<string, GovernanceScorerPlugin<any>>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _repairs    = new Map<string, GovernanceRepairPlugin<any>>()

  // ── Registration ──────────────────────────────────────────────────────────

  registerValidator<T>(plugin: GovernanceValidatorPlugin<T>): void {
    const key = `${plugin.artifactType}:${plugin.capabilityKey}`
    this._validators.set(key, plugin)
    console.info(`[GovernancePluginRegistry] Registered validator: ${key}`)
  }

  registerScorer<T>(plugin: GovernanceScorerPlugin<T>): void {
    const key = `${plugin.artifactType}:${plugin.capabilityKey}`
    this._scorers.set(key, plugin)
    console.info(`[GovernancePluginRegistry] Registered scorer: ${key}`)
  }

  registerRepair<T>(plugin: GovernanceRepairPlugin<T>): void {
    const key = `${plugin.artifactType}:${plugin.capabilityKey}`
    this._repairs.set(key, plugin)
    console.info(`[GovernancePluginRegistry] Registered repair: ${key}`)
  }

  // ── Resolution ────────────────────────────────────────────────────────────

  resolveValidator<T>(
    artifactType: string,
    capabilityKey: GovernanceCapabilityKey
  ): SemanticValidator<T> | null {
    const plugin = this._validators.get(`${artifactType}:${capabilityKey}`)
    return (plugin?.validator as SemanticValidator<T>) ?? null
  }

  resolveScorer<T>(
    artifactType: string,
    capabilityKey: GovernanceCapabilityKey
  ): SemanticScorer<T> | null {
    const plugin = this._scorers.get(`${artifactType}:${capabilityKey}`)
    return (plugin?.scorer as SemanticScorer<T>) ?? null
  }

  resolveRepair<T>(
    artifactType: string,
    capabilityKey: GovernanceCapabilityKey
  ): SemanticRepair<T> | null {
    const plugin = this._repairs.get(`${artifactType}:${capabilityKey}`)
    return (plugin?.repair as SemanticRepair<T>) ?? null
  }

  // ── Introspection ─────────────────────────────────────────────────────────

  listCapabilities(): {
    validators: string[]
    scorers: string[]
    repairs: string[]
  } {
    return {
      validators: Array.from(this._validators.keys()),
      scorers:    Array.from(this._scorers.keys()),
      repairs:    Array.from(this._repairs.keys()),
    }
  }

  hasValidator(artifactType: string, capabilityKey: GovernanceCapabilityKey): boolean {
    return this._validators.has(`${artifactType}:${capabilityKey}`)
  }

  hasRepair(artifactType: string, capabilityKey: GovernanceCapabilityKey): boolean {
    return this._repairs.has(`${artifactType}:${capabilityKey}`)
  }

  /** For testing only — reset registry state between test suites */
  _reset(): void {
    this._validators.clear()
    this._scorers.clear()
    this._repairs.clear()
  }
}

// ─── Singleton export ──────────────────────────────────────────────────────────

export const GovernancePluginRegistry = new GovernancePluginRegistryImpl()

// ─── Bootstrap helper ──────────────────────────────────────────────────────────

/**
 * bootstrapGovernancePlugins — registers all built-in governance plugins.
 *
 * CALL ONCE at server startup (from bootstrapArtifactEngine or app init).
 * Idempotent — subsequent calls are no-ops with a warning.
 *
 * EXTENDING:
 *   To add governance for a new artifact type, call
 *   GovernancePluginRegistry.registerValidator() / registerRepair() / registerScorer()
 *   from the package that owns that artifact type's governance.
 *   This function handles only the built-in carousel, deck, report, and
 *   newsletter types.
 */

let bootstrapped = false

export async function bootstrapGovernancePlugins(): Promise<void> {
  if (bootstrapped) {
    console.warn('[GovernancePluginRegistry] bootstrapGovernancePlugins() called more than once — skipping.')
    return
  }

  const {
    validateCarouselArtifact, runCarouselSemanticGovernance,
  } = await import('./carousel/index.js')
  const {
    validateDeckArtifact, runDeckSemanticGovernance,
  } = await import('./deck/index.js')
  const {
    validateReportArtifact, runReportSemanticGovernance,
  } = await import('./report/index.js')
  const {
    validateNewsletterArtifact, runNewsletterSemanticGovernance,
  } = await import('./newsletter/index.js')

  // ── Carousel ──────────────────────────────────────────────────────────────
  GovernancePluginRegistry.registerValidator({
    artifactType: 'carousel',
    capabilityKey: 'governance.validate.carousel',
    validator: {
      async validate(input, requestId) {
        const outcome = validateCarouselArtifact(input as Parameters<typeof validateCarouselArtifact>[0], requestId)
        return {
          passed: outcome.valid,
          violations: outcome.valid ? [] : [outcome.reason],
        }
      },
    },
  })

  GovernancePluginRegistry.registerRepair({
    artifactType: 'carousel',
    capabilityKey: 'governance.repair.carousel',
    repair: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async repair(input, topic, callLLM, requestId) {
        return runCarouselSemanticGovernance(input as any, topic, callLLM, requestId)
      },
    },
  })

  // ── Deck ──────────────────────────────────────────────────────────────────
  GovernancePluginRegistry.registerValidator({
    artifactType: 'deck',
    capabilityKey: 'governance.validate.deck',
    validator: {
      async validate(input, requestId) {
        const outcome = validateDeckArtifact(input as Parameters<typeof validateDeckArtifact>[0], requestId)
        return {
          passed: outcome.valid,
          violations: outcome.valid ? [] : [outcome.reason],
        }
      },
    },
  })

  GovernancePluginRegistry.registerRepair({
    artifactType: 'deck',
    capabilityKey: 'governance.repair.deck',
    repair: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async repair(input, topic, callLLM, requestId) {
        return runDeckSemanticGovernance(input as any, topic, callLLM, requestId)
      },
    },
  })

  // ── Report ────────────────────────────────────────────────────────────────
  GovernancePluginRegistry.registerValidator({
    artifactType: 'report',
    capabilityKey: 'governance.validate.report',
    validator: {
      async validate(input, requestId) {
        const outcome = validateReportArtifact(input as Parameters<typeof validateReportArtifact>[0], requestId)
        return {
          passed: outcome.valid,
          violations: outcome.valid ? [] : [outcome.reason],
        }
      },
    },
  })

  GovernancePluginRegistry.registerRepair({
    artifactType: 'report',
    capabilityKey: 'governance.repair.report',
    repair: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async repair(input, topic, callLLM, requestId) {
        return runReportSemanticGovernance(input as any, topic, callLLM, requestId)
      },
    },
  })

  // ── Newsletter (G-23, Architecture Verification Report P1) ────────────────
  // The validator/scorer/repair implementations already existed in
  // packages/governance-layer/src/newsletter/ but were never registered —
  // newsletter generations previously received zero structural/semantic
  // validation or repair at all. Registered here mirroring the
  // carousel/deck/report pattern exactly; no new validator logic required.
  GovernancePluginRegistry.registerValidator({
    artifactType: 'newsletter',
    capabilityKey: 'governance.validate.newsletter',
    validator: {
      async validate(input, requestId) {
        const outcome = validateNewsletterArtifact(input as Parameters<typeof validateNewsletterArtifact>[0], requestId)
        return {
          passed: outcome.valid,
          violations: outcome.valid ? [] : [outcome.reason],
        }
      },
    },
  })

  GovernancePluginRegistry.registerRepair({
    artifactType: 'newsletter',
    capabilityKey: 'governance.repair.newsletter',
    repair: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async repair(input, topic, callLLM, requestId) {
        return runNewsletterSemanticGovernance(input as any, topic, callLLM, requestId)
      },
    },
  })

  bootstrapped = true

  const caps = GovernancePluginRegistry.listCapabilities()
  console.info(
    `[GovernancePluginRegistry] Bootstrap complete. ` +
    `Validators: [${caps.validators.join(', ')}] ` +
    `Repairs: [${caps.repairs.join(', ')}]`
  )
}


