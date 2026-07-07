/**
 * @brandos/iskill-runtime — IPackage.ts
 *
 * Machine-readable package metadata. L4 in Wave C.
 */

export const PACKAGE_METADATA = {
  name:    '@brandos/iskill-runtime' as const,
  version: '1.0.0',
  layer:   6,
  level:   'L4',

  capabilities: {
    'skill.generate.carousel':   'CarouselFounderSkillDef + CarouselFounderLifecycle (gated)',
    'skill.generate.deck':       'Not yet implemented — placeholder (gated)',
    'skill.generate.report':     'Not yet implemented — placeholder (gated)',
    'skill.govern.repair':       'createGovernanceBridge() — IGovernanceCaller bridge to artifact-engine-layer',
    'skill.runtime.register':    'bootstrapSkillRuntime() — server startup DI wiring',
    'skill.runtime.resolve':     'getGlobalSkillRuntime() — singleton resolution',
    'skill.runtime.list':        'ISkillRuntime.listSkills() — registry discovery',
    'skill.runtime.validate':    'SkillCapabilityRegistry.validateSkill() — structural validation',
    'skill.runtime.execute':     '6-phase lifecycle: validate→prepare→execute→govern→repair→finalize (gated)',
    'skill.runtime.personalize': 'buildPersonalizationContext() — ISkillPersonalizationContext assembly',
    'skill.runtime.lifecycle':   'ISkillLifecycle — 6-phase contract interface',
    'skill.runtime.bundle':      'IBundleDefinition — AI_FOUNDER_GTM_BUNDLE reference bundle',
    'skill.runtime.health':      'computeSkillHealth(), healthSummary() — SkillHealthScore from telemetry',
  },

  dependencies: [
    '@brandos/contracts',
    '@brandos/shared-utils',
  ],

  consumers: [
    '@brandos/output-control-layer', // SkillContributor (contract-assembler/contributors/SkillContributor.ts) — active in ContractAssemblerFactory's default set
    '@brandos/artifact-engine-layer', // skill-registry.ts (IPlatformPluginRegistry)
  ],

  productionGate: {
    flag: 'globalThis.__brandos_iskill_contract_contributor',
    status: 'ACTIVE',
    description: 'Phase 2.6 gate-lift complete (human-approved 2026-06-21). Flag set true in apps/web/instrumentation.ts after bootstrapSkillRuntime() succeeds. SkillContributor contributes for taskType==="carousel". SkillRuntime.execute()\'s full lifecycle remains separately unwired.',
    typeDeclaration: 'Declared in validatePackage.ts (Phase 0.4 fix)',
  },

  invariants: [
    'I-1: IdentityDimension and ISkillPersonalizationContext are RE-EXPORTED from @brandos/contracts — never redeclare',
    'I-2: Max repair attempts = 2 by default (configurable via IGovernanceOverrides.repairAttempts)',
    'I-3: _resetSkillRuntime() must remain exported for test isolation',
    'I-4: ISkillRuntime is the ONLY public API surface — no internal types should be consumed directly',
    'I-5: Skills receive identity via ISkillExecutionContext.personalization — never via direct import',
  ],

  l4Additions: [
    'src/capability/SkillCapabilityRegistry.ts — queryable capability map with registerSkill/resolveSkill/listSkills/validateSkill',
    'src/validatePackage.ts — self-check returns PackageHealthReport + globalThis.__brandos_iskill_contract_contributor type declaration (Phase 0.4)',
    'src/IPackage.ts — machine-readable metadata (this file)',
    'AGENT_CONTEXT.md — updated to L4',
    'src/__tests__/validatePackage.test.ts — L4 test coverage',
  ],

  requiredReads: [
    'AGENT_CONTEXT.md',
    'src/IPackage.ts',
    'src/index.ts',
    'src/capability/SkillCapabilityRegistry.ts',
    'src/contracts/index.ts',
  ],
} as const

export type PackageCapabilityKey = keyof typeof PACKAGE_METADATA.capabilities


