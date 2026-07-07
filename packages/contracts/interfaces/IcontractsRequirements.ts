// ============================================================
// @brandos/contracts — interfaces/IcontractsRequirements.ts
//
// MANDATORY IMPLEMENTATION REQUIREMENTS
//
// This file is executable documentation.
// Every rule here is enforced by one of:
//   (a) TypeScript compiler
//   (b) A test in src/__tests__/self-validate.test.ts
//   (c) A test in src/__tests__/contract-requirements.test.ts
//
// AGENT INSTRUCTIONS:
//   - Violating any rule in this file is a critical defect.
//   - Do not delete or soften rules without a monorepo-wide audit.
//   - Self-validation tests will fail if rules are violated.
// ============================================================

// ─────────────────────────────────────────────────────────────
// SECTION 1 — REQUIRED INVARIANTS
// ─────────────────────────────────────────────────────────────

export const REQUIRED_INVARIANTS = {
  /**
   * RINV-1: Zero runtime dependencies — HARD REQUIREMENT
   *
   * Rationale: @brandos/contracts is the L0 foundation.
   * Any runtime dep creates a transitive dep chain that can
   * cause version conflicts, circular deps, or tree-shaking failures
   * across the entire monorepo.
   *
   * How to verify:
   *   cat packages/contracts/package.json | jq '.dependencies'
   *   Expected: null or {}
   *
   * Violation severity: CRITICAL — blocks all builds if broken
   */
  ZERO_RUNTIME_DEPS: true,

  /**
   * RINV-2: No @brandos/* imports — HARD REQUIREMENT
   *
   * Rationale: Importing from a sibling package creates a build-time
   * dependency cycle. contracts is consumed by ALL packages;
   * it cannot depend on any of them.
   *
   * How to verify: src/__tests__/self-validate.test.ts INV-2
   */
  NO_BRANDOS_IMPORTS: true,

  /**
   * RINV-3: Single entry point — HARD REQUIREMENT
   *
   * The file packages/contracts/src/index.ts is the ONLY file
   * that consumers should import from. Sub-file imports
   * (e.g. '@brandos/contracts/src/artifact-v2') are forbidden
   * because they bypass the controlled surface and can break
   * when files are reorganised.
   *
   * How to verify: Package.json "exports" field locks to "."
   */
  SINGLE_ENTRY_POINT: true,

  /**
   * RINV-4: Additive-only schema evolution — HARD REQUIREMENT
   *
   * Consequence of violating:
   *   - Removing a type/interface = breaking change for all consumers
   *   - Adding a REQUIRED field to an existing interface = breaking change
   *   - Renaming an exported symbol = breaking change
   *
   * Only safe changes:
   *   - Adding a new type/interface
   *   - Adding an OPTIONAL field to an existing interface
   *   - Adding a new optional union member
   *
   * How to verify: TypeScript structural compatibility tests
   */
  ADDITIVE_ONLY_EVOLUTION: true,

  /**
   * RINV-5: ResolvedGenerationContract required slots — HARD REQUIREMENT
   *
   * intent: IIntentContribution — ALWAYS required
   * runtime: IRuntimeContribution — ALWAYS required
   *
   * These two slots MUST always be present. If they are missing,
   * the prompt compiler cannot function and the generation pipeline fails.
   *
   * How to verify: src/__tests__/contract-requirements.test.ts REQ-1
   */
  GENERATION_CONTRACT_REQUIRED_SLOTS: ['intent', 'runtime'] as const,

  /**
   * RINV-6: IContractContributor.contribute() must never throw
   *
   * Any exception from a contributor would propagate to the ContractAssembler
   * and crash the entire generation pipeline.
   *
   * How to implement:
   *   async contribute(ctx) {
   *     try {
   *       return await this.buildSlice(ctx)
   *     } catch (err) {
   *       console.error(`[${this.contributorId}] contribute() failed:`, err)
   *       return null
   *     }
   *   }
   */
  CONTRIBUTORS_NEVER_THROW: true,

  /**
   * RINV-7: Type guards must use artifact_type discriminant
   *
   * All isXxxArtifact() guards must check artifact_type, not $schema or
   * any structural field. The discriminant is the stable narrowing property.
   *
   * How to verify: src/__tests__/artifact-v2.test.ts
   */
  TYPE_GUARDS_USE_DISCRIMINANT: true,

  /**
   * RINV-8: Provider registry — no duplicate IDs, contiguous priorities
   *
   * PROVIDER_REGISTRY must have:
   *   - Unique id per entry
   *   - Unique priority_default per entry
   *   - Contiguous priorities starting at 1 (no gaps)
   *   - Local providers have requires_api_key === false
   *
   * How to verify: src/__tests__/provider-registry.test.ts
   */
  PROVIDER_REGISTRY_INTEGRITY: true,
} as const;

// ─────────────────────────────────────────────────────────────
// SECTION 2 — MANDATORY IMPLEMENTATION RULES
// ─────────────────────────────────────────────────────────────

export const MANDATORY_IMPLEMENTATION_RULES = {
  /**
   * MIR-1: Every new export MUST be added to both:
   *   1. src/index.ts (the runtime entry point)
   *   2. interfaces/Icontracts.ts (the boundary documentation)
   *   3. A test that verifies its presence in the public surface
   */
  NEW_EXPORT_CHECKLIST: [
    'Add to source file (artifact-v2.ts, airuntime-types.ts, etc.)',
    'Export from src/index.ts',
    'List in appropriate *_EXPORTS array in Icontracts.ts',
    'Add test in src/__tests__/index.test.ts smoke section',
  ],

  /**
   * MIR-2: Deprecated exports MUST have:
   *   - @deprecated JSDoc tag
   *   - Replacement documented in the JSDoc
   *   - Entry in DEPRECATED_EXPORTS in Icontracts.ts
   *   - Removal tracked (version or date target)
   */
  DEPRECATION_RULES: [
    'Tag with @deprecated in JSDoc',
    'Document replacement in JSDoc',
    'List in DEPRECATED_EXPORTS in Icontracts.ts',
    'Add removal target in DEPRECATED_EXPORTS entry',
  ],

  /**
   * MIR-3: New artifact types require FULL PIPELINE WIRING.
   * Declaring an ArtifactType without implementation is an overpromise.
   * If the full pipeline is not ready, do not add to ArtifactType union.
   *
   * Full pipeline = compiler + governance + renderer + export
   *
   * Exception: types may be added as 'planned' with explicit documentation
   * in the SCHEMA_CONTRACT.EXPORT_FORMAT_STATUS pattern.
   */
  NEW_ARTIFACT_TYPE_REQUIRES_FULL_PIPELINE: true,

  /**
   * MIR-4: ContributorContext extension must be additive-only.
   * New fields added to ContributorContext MUST be optional.
   * Required fields would break all existing IContractContributor
   * implementations across the monorepo.
   */
  CONTRIBUTOR_CONTEXT_ADDITIVE_ONLY: true,

  /**
   * MIR-5: CAROUSEL_SCHEMA_INSTRUCTION is single source of truth.
   * Other packages MUST import from '@brandos/contracts'.
   * Duplicating this string in another package creates silent drift risk.
   */
  CAROUSEL_SCHEMA_NO_DUPLICATION: true,

  /**
   * MIR-6: fromLegacyToRuntimeMode must handle null and undefined gracefully.
   * This function is called with raw DB values that may be null.
   * It must never throw — always return a valid RuntimeMode fallback.
   */
  LEGACY_MODE_CONVERTER_NULL_SAFE: true,
} as const;

// ─────────────────────────────────────────────────────────────
// SECTION 3 — VALIDATION REQUIREMENTS
// ─────────────────────────────────────────────────────────────

export const VALIDATION_REQUIREMENTS = {
  /**
   * VAL-1: Coverage targets (enforced by vitest --coverage in CI)
   */
  COVERAGE: {
    statements: 95,
    branches: 90,
    functions: 95,
    lines: 95,
  },

  /**
   * VAL-2: Required test suites
   * Every test file listed here MUST exist and pass.
   */
  REQUIRED_TEST_SUITES: [
    'src/__tests__/artifact-v2.test.ts',      // type guards, upcast, CAROUSEL_ROLES
    'src/__tests__/airuntime-types.test.ts',  // mode converters, RUNTIME_MODE_LABELS
    'src/__tests__/identity-types.test.ts',   // dimension helpers, DEFAULT_IDENTITY_CONFIG
    'src/__tests__/provider-registry.test.ts', // registry integrity
    'src/__tests__/index.test.ts',            // public surface smoke tests
    'src/__tests__/generation-contract.test.ts', // contract slot rules
    'src/__tests__/self-validate.test.ts',    // package invariants
  ],

  /**
   * VAL-3: Smoke test requirement
   * Every exported runtime VALUE (non-type) must appear in index.test.ts
   * as a live import assertion.
   */
  SMOKE_TEST_RUNTIME_VALUES: true,

  /**
   * VAL-4: Contract consistency requirement
   * ResolvedGenerationContract required slots must always produce a
   * non-null result when a correctly-implemented contributor is registered.
   */
  CONTRACT_CONSISTENCY_TESTS: true,

  /**
   * VAL-5: Edge case coverage
   * The following edge cases must have explicit tests:
   */
  REQUIRED_EDGE_CASES: [
    'fromLegacyToRuntimeMode(null) → cloud (safe default)',
    'fromLegacyToRuntimeMode(undefined) → cloud (safe default)',
    'fromLegacyToRuntimeMode("") → cloud (safe default)',
    'fromLegacyToRuntimeMode("CLOUD") → cloud (case-insensitive)',
    'isCarouselArtifact({artifact_type: "deck"}) → false',
    'upcastCarouselBlueprint with empty slides → handles gracefully',
    'PROVIDER_REGISTRY: no duplicate IDs',
    'PROVIDER_REGISTRY: contiguous priority_default values',
  ],
} as const;

// ─────────────────────────────────────────────────────────────
// SECTION 4 — EXTENSION REQUIREMENTS
// ─────────────────────────────────────────────────────────────

export const EXTENSION_REQUIREMENTS = {
  /**
   * EXT-1: How to add a new artifact type
   *
   * PRE-CONDITION: Full pipeline must be ready or explicitly planned.
   *
   * Steps:
   */
  ADD_ARTIFACT_TYPE: {
    steps: [
      'Define interface My<Type>Artifact extending BaseArtifact in artifact-v2.ts',
      'Add artifact_type: "my_type" discriminant field',
      'Add My<Type>Slide or My<Type>Section interface',
      'Add My<Type>Meta interface',
      'Add isMy<Type>Artifact() type guard',
      'Add to ArtifactType union: "carousel" | "deck" | "report" | "my_type"',
      'Add to ArtifactV2 union: CarouselArtifact | DeckArtifact | ReportArtifact | My<Type>Artifact',
      'Export from index.ts',
      'Update ARTIFACT_SCHEMA_EXPORTS in Icontracts.ts',
      'Update SCHEMA_CONTRACT.ARTIFACT_TYPES in Icontracts.ts',
      'Add type guard tests in artifact-v2.test.ts',
      'Implement compiler in artifact-engine-layer (REQUIRED — no overpromise)',
    ],
    verification: 'TypeScript must compile and all tests must pass',
  },

  /**
   * EXT-2: How to add a new generation contract slot
   *
   * Steps:
   */
  ADD_CONTRACT_SLOT: {
    steps: [
      'Define I<Slot>Contribution interface in generation-contract.ts',
      'Add optional slot?: I<Slot>Contribution to ResolvedGenerationContract',
      'Add slot to CONTRIBUTOR_MAP comment in generation-contract.ts',
      'Export interface from index.ts',
      'Update GENERATION_CONTRACT_EXPORTS in Icontracts.ts',
      'Implement IContractContributor<I<Slot>Contribution> in owning package',
      'Register in ContractAssembler bootstrap (output-control-layer)',
      'Add contract-requirements test for the new slot',
    ],
    rules: [
      'Slot MUST be optional in ResolvedGenerationContract (backward compat)',
      'Contributor MUST return null on any failure (never throw)',
      'Slot name must be a single lowercase word matching contributorId',
    ],
  },

  /**
   * EXT-3: How to add a new AI provider
   *
   * Steps:
   */
  ADD_PROVIDER: {
    steps: [
      'Add id to ProviderName union in airuntime-types.ts',
      'Add ProviderDefinition to PROVIDER_REGISTRY in provider-registry.ts',
      'Assign priority_default = max(existing) + 1 (no gaps)',
      'Set kind: "local" or "cloud"',
      'Set requires_api_key based on provider type',
      'Implement IProviderAdapter in ai-runtime-layer',
      'Update provider-registry.test.ts to cover the new entry',
    ],
    rules: [
      'priority_default must be unique and contiguous',
      'Local providers must have requires_api_key: false',
      'Cloud providers must have requires_api_key: true',
    ],
  },
} as const;

// ─────────────────────────────────────────────────────────────
// SECTION 5 — PACKAGE CONSTRAINTS
// ─────────────────────────────────────────────────────────────

export const PACKAGE_CONSTRAINTS = {
  /**
   * PC-1: This package CANNOT grow without a boundary review.
   * Trigger a review if adding more than 5 exported symbols in one change.
   */
  GROWTH_REVIEW_THRESHOLD: 5,

  /**
   * PC-2: This package CANNOT have a tsconfig "paths" alias.
   * Path aliases cause resolution issues when other packages import from here.
   */
  NO_TSCONFIG_PATHS: true,

  /**
   * PC-3: This package CANNOT have barrel files other than index.ts.
   * Multiple barrel files cause consumers to import from internal paths.
   */
  SINGLE_BARREL: true,

  /**
   * PC-4: Build output must be in dist/.
   * tsconfig.json must have outDir: "./dist".
   * This is required for the monorepo workspace resolution.
   */
  REQUIRED_OUTPUT_DIR: 'dist',

  /**
   * PC-5: Test files must NOT be included in the build output.
   * tsconfig.json must exclude "__tests__" from compilation.
   */
  TESTS_EXCLUDED_FROM_BUILD: true,
} as const;

// ─────────────────────────────────────────────────────────────
// SECTION 6 — DEPENDENCY CONSTRAINTS
// ─────────────────────────────────────────────────────────────

export const DEPENDENCY_CONSTRAINTS = {
  /**
   * DC-1: Zero production dependencies.
   * The "dependencies" key in package.json must be absent or empty.
   */
  ZERO_PRODUCTION_DEPS: true,

  /**
   * DC-2: Dev dependencies must be build/test tooling only.
   * No business-logic libraries in devDependencies.
   */
  DEV_DEPS_TOOLING_ONLY: true,

  /**
   * DC-3: TypeScript version must match monorepo root.
   * Mismatched TS versions can cause type incompatibilities.
   */
  TYPESCRIPT_VERSION_ALIGNED: true,
} as const;

// ─────────────────────────────────────────────────────────────
// SECTION 7 — ANTI-PATTERNS
//
// These are the known failure modes for this package.
// If you find yourself doing any of these, STOP.
// ─────────────────────────────────────────────────────────────

export const ANTI_PATTERNS = {
  /**
   * AP-1: Import from @brandos/* — CRITICAL VIOLATION
   *
   * WHY YOU MIGHT BE TEMPTED: You need a utility from shared-utils.
   * WHY IT'S WRONG: Creates a circular dependency in the monorepo.
   * CORRECT PATH: Copy the utility or define a type-only contract here.
   */
  IMPORT_FROM_BRANDOS: 'Never import from @brandos/* packages',

  /**
   * AP-2: Add implementation logic — VIOLATION
   *
   * WHY YOU MIGHT BE TEMPTED: You want to add a validation function.
   * WHY IT'S WRONG: Business logic in contracts creates implicit runtime
   * dependencies and makes the package harder to reason about.
   * CORRECT PATH: Add a type guard (pure, side-effect-free function only)
   * or put logic in the appropriate implementation package.
   */
  ADD_IMPLEMENTATION_LOGIC: 'Avoid business logic — types, constants, pure functions only',

  /**
   * AP-3: Add a required field to an existing interface — BREAKING CHANGE
   *
   * WHY YOU MIGHT BE TEMPTED: You need a new field everywhere.
   * WHY IT'S WRONG: All consumers would fail to compile immediately.
   * CORRECT PATH: Add the field as optional first; migrate consumers;
   * then consider whether required is truly needed.
   */
  REQUIRED_FIELD_ON_EXISTING_INTERFACE: 'New fields on existing interfaces must be optional',

  /**
   * AP-4: Declare an artifact type or export format without implementation
   *
   * WHY YOU MIGHT BE TEMPTED: You want to define the contract ahead of time.
   * WHY IT'S WRONG: Creates contract overpromise. Users and agents see
   * the type and assume it works. ExportFormat 'pptx' is the canonical
   * example of this mistake.
   * CORRECT PATH: Document in SCHEMA_CONTRACT.EXPORT_FORMAT_STATUS as
   * 'declared-not-implemented'. Or better: don't declare until ready.
   */
  DECLARE_WITHOUT_IMPLEMENTING: 'Do not add types for unimplemented features without explicit status documentation',

  /**
   * AP-5: Duplicate CAROUSEL_SCHEMA_INSTRUCTION
   *
   * WHY YOU MIGHT BE TEMPTED: Easier than importing.
   * WHY IT'S WRONG: Creates two sources of truth. Silent drift when
   * one copy is updated and the other isn't.
   * CORRECT PATH: Always import from '@brandos/contracts'.
   */
  DUPLICATE_SCHEMA_INSTRUCTION: 'Import CAROUSEL_SCHEMA_INSTRUCTION from @brandos/contracts — never copy it',

  /**
   * AP-6: Throw from IContractContributor.contribute()
   *
   * WHY YOU MIGHT BE TEMPTED: You have an unrecoverable error.
   * WHY IT'S WRONG: A throw propagates up through ContractAssembler and
   * crashes the ENTIRE generation pipeline for all artifact types.
   * CORRECT PATH: Log the error and return null for graceful degradation.
   */
  THROW_FROM_CONTRIBUTOR: 'IContractContributor.contribute() must never throw — return null',

  /**
   * AP-7: Deep imports into sub-files
   *
   * WHY YOU MIGHT BE TEMPTED: You only need one type from artifact-v2.ts.
   * WHY IT'S WRONG: Bypasses the controlled public surface. If artifact-v2.ts
   * is renamed or reorganised, all deep importers break.
   * CORRECT PATH: Always import from '@brandos/contracts' (index.ts).
   */
  DEEP_IMPORTS: "Import from '@brandos/contracts' — never from internal sub-files",

  /**
   * AP-8: Conflating TaskType and InvocationType
   *
   * WHY YOU MIGHT BE TEMPTED: They both describe AI operations.
   * WHY IT'S WRONG: They are different bounded contexts.
   *   TaskType = domain vocabulary (what to create: carousel, deck, report)
   *   InvocationType = runtime vocabulary (how AI executes: structured, streaming)
   * Unifying them breaks the domain model and creates routing confusion.
   * CORRECT PATH: Keep them separate. Use TaskType at the domain layer,
   * InvocationType at the runtime layer.
   */
  CONFLATE_TASK_AND_INVOCATION: 'TaskType and InvocationType are different bounded contexts — never unify',
} as const;


