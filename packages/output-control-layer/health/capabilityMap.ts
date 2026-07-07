// ============================================================
// @brandos/output-control-layer — health/capabilityMap.ts
//
// Machine-readable capability map for @brandos/output-control-layer.
//
// Used by agents and orchestrators to discover what OCL can do,
// what its dependencies are, and what extension points exist.
// ============================================================

export type CapabilityStatus = 'complete' | 'partial' | 'stub' | 'not_implemented';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface Capability {
  id: string;
  description: string;
  status: CapabilityStatus;
  risk: RiskLevel;
  entryPoint: string;
  testCoverage: boolean;
  extensionPoint: boolean;
  notes?: string;
}

export const OCL_CAPABILITY_MAP: Readonly<Capability[]> = [
  // ── Output normalizer ──────────────────────────────────────────────────────
  {
    id: 'normalize_output',
    description: 'Post-generation sub-steps: clean→extract→repair→transform, called inside compile*Artifact()',
    status: 'complete',
    risk: 'low',
    entryPoint: 'compile*Artifact() — sub-steps (cleanOutput, extractJSON, transformTo*Schema) called directly',
    testCoverage: true,
    extensionPoint: false,
    notes: 'normalizeOutput() coordinator is @deprecated since 2026-05-23 refactor; sub-steps are the live entry points',
  },
  {
    id: 'clean_output',
    description: 'Strip markdown fences, preambles, bold markers, control chars',
    status: 'complete',
    risk: 'low',
    entryPoint: 'cleanOutput(raw)',
    testCoverage: true,
    extensionPoint: false,
  },
  {
    id: 'extract_json',
    description: '3-pass bracket-depth JSON extraction (direct, object, array)',
    status: 'complete',
    risk: 'low',
    entryPoint: 'extractJSON(text)',
    testCoverage: true,
    extensionPoint: false,
  },
  {
    id: 'repair_json',
    description: 'Heuristic JSON repair (trailing commas, single quotes, unclosed braces)',
    status: 'complete',
    risk: 'low',
    entryPoint: 'repairJSON(text)',
    testCoverage: true,
    extensionPoint: false,
  },
  {
    id: 'llm_repair',
    description: 'LLM-assisted JSON repair via injected callLLM callback',
    status: 'complete',
    risk: 'medium',
    entryPoint: 'repairWithLLM(brokenJSON, callLLM)',
    testCoverage: true,
    extensionPoint: false,
    notes: 'Only invoked when NormalizeOptions.enableLLMRepair=true',
  },
  {
    id: 'parse_artifact',
    description: 'Robust artifact JSON parsing with 3-pass recovery',
    status: 'complete',
    risk: 'low',
    entryPoint: 'parseArtifact(raw)',
    testCoverage: true,
    extensionPoint: false,
  },

  // ── Artifact compiler ──────────────────────────────────────────────────────
  {
    id: 'compile_carousel',
    description: 'DraftArtifactInput → CarouselArtifact (canonical ArtifactV2)',
    status: 'complete',
    risk: 'low',
    entryPoint: 'compileCarouselArtifact(draft)',
    testCoverage: true,
    extensionPoint: false,
  },
  {
    id: 'compile_deck',
    description: 'DraftArtifactInput → DeckArtifact (canonical ArtifactV2)',
    status: 'complete',
    risk: 'low',
    entryPoint: 'compileDeckArtifact(draft)',
    testCoverage: true,
    extensionPoint: false,
  },
  {
    id: 'compile_report',
    description: 'DraftArtifactInput → ReportArtifact (canonical ArtifactV2)',
    status: 'complete',
    risk: 'low',
    entryPoint: 'compileReportArtifact(draft)',
    testCoverage: true,
    extensionPoint: false,
  },
  {
    id: 'weak_model_adapter',
    description: 'Richness detection and deterministic infill for sparse model output',
    status: 'complete',
    risk: 'medium',
    entryPoint: 'detectRichness(draft) / adaptWeakOutput(draft, richness)',
    testCoverage: true,
    extensionPoint: false,
    notes: 'WEAK_RICHNESS_THRESHOLD=40 aligns with ISkill MIN_RICHNESS_OVERALL',
  },
  {
    id: 'transform_carousel_schema',
    description: 'Loose JSON → CanonicalCarouselSchema (intermediate type)',
    status: 'complete',
    risk: 'low',
    entryPoint: 'transformToCarouselSchema(parsed)',
    testCoverage: true,
    extensionPoint: false,
  },
  {
    id: 'transform_deck_schema',
    description: 'Loose JSON → CanonicalDeckSchema (intermediate type)',
    status: 'complete',
    risk: 'low',
    entryPoint: 'transformToDeckSchema(parsed)',
    testCoverage: true,
    extensionPoint: false,
  },
  {
    id: 'transform_report_schema',
    description: 'Loose JSON → CanonicalReportSchema (intermediate type)',
    status: 'complete',
    risk: 'low',
    entryPoint: 'transformToReportSchema(parsed)',
    testCoverage: true,
    extensionPoint: false,
  },

  // ── Prompt compiler ────────────────────────────────────────────────────────
  {
    id: 'compile_prompt_from_contract',
    description: 'ResolvedGenerationContract → CompiledPrompt { system, user }',
    status: 'complete',
    risk: 'low',
    entryPoint: 'compilePromptFromContract(contract)',
    testCoverage: true,
    extensionPoint: false,
    notes: 'CAROUSEL_SCHEMA_INSTRUCTION sourced from @brandos/contracts (single source of truth)',
  },

  // ── Contract assembler ─────────────────────────────────────────────────────
  {
    id: 'contract_assembler',
    description: 'Parallel contributor orchestration → ResolvedGenerationContract',
    status: 'complete',
    risk: 'low',
    entryPoint: 'ContractAssemblerFactory.create({ contributorSet: "default" })',
    testCoverage: true,
    extensionPoint: true,
    notes: 'Extension: implement IContractContributor<T> and register via factory',
  },
  {
    id: 'identity_contributor',
    description: 'Populates IIdentityContribution from injected brand intelligence',
    status: 'complete',
    risk: 'low',
    entryPoint: 'new IdentityContributor()',
    testCoverage: true,
    extensionPoint: false,
  },
  {
    id: 'persona_contributor',
    description: 'Populates IPersonaContribution from injected brand voice',
    status: 'complete',
    risk: 'low',
    entryPoint: 'new PersonaContributor()',
    testCoverage: true,
    extensionPoint: false,
  },
  {
    id: 'intent_contributor',
    description: 'Populates IIntentContribution from task analysis',
    status: 'complete',
    risk: 'low',
    entryPoint: 'new IntentContributor()',
    testCoverage: true,
    extensionPoint: false,
  },
  {
    id: 'artifact_contributor',
    description: 'Populates IArtifactContribution (schema, required roles, schema instruction)',
    status: 'complete',
    risk: 'low',
    entryPoint: 'new ArtifactContributor()',
    testCoverage: true,
    extensionPoint: false,
  },
  {
    id: 'runtime_contributor',
    description: 'Populates IRuntimeContribution (thresholds, attempts, mode)',
    status: 'complete',
    risk: 'low',
    entryPoint: 'new RuntimeContributor()',
    testCoverage: true,
    extensionPoint: false,
  },
] as const;

/**
 * getCapability — look up a capability by ID.
 */
export function getCapability(id: string): Capability | undefined {
  return OCL_CAPABILITY_MAP.find(c => c.id === id);
}

/**
 * getExtensionPoints — list all capabilities that are safe to extend.
 */
export function getExtensionPoints(): Capability[] {
  return OCL_CAPABILITY_MAP.filter(c => c.extensionPoint);
}

/**
 * getMissingCoverage — list capabilities without test coverage.
 */
export function getMissingCoverage(): Capability[] {
  return OCL_CAPABILITY_MAP.filter(c => !c.testCoverage);
}


