// ============================================================
// @brandos/output-control-layer — index.ts
//
// Public API surface. Import ONLY from this file.
//
// CANONICAL RULE: CAROUSEL_SCHEMA_INSTRUCTION must be imported from
// @brandos/contracts, not from this package. The re-export via
// prompt-compiler is a legacy alias kept for backward compat only.
// All new code: import { CAROUSEL_SCHEMA_INSTRUCTION } from '@brandos/contracts'
// ============================================================

// ── Output normalizer ─────────────────────────────────────────────────────────
// @deprecated normalizeOutput is no longer called in production (2026-05-23 refactor).
// Normalization sub-steps run inside each compile*Artifact() compiler directly.
// Kept for backward compatibility; will be removed in the next cleanup sprint.
export { normalizeOutput } from './output-normalizer/normalizeOutput';
export { cleanOutput } from './output-normalizer/pipeline/cleanOutput';
export type { CleanResult } from './output-normalizer/pipeline/cleanOutput';
// Fix C2 backward compat: repairJSON and extractJSON are now canonical in @brandos/shared-utils.
// Re-exported here so any existing callers of @brandos/output-control-layer continue to compile.
// New code should import from @brandos/shared-utils directly.
export { repairJSON, extractJSON } from '@brandos/shared-utils';
export { repairWithLLM } from './output-normalizer/pipeline/repairJSON';
export { parseArtifact, parseArtifactJSON, validateArtifactFields } from './output-normalizer/parser/parseArtifact';
export type { ParseArtifactResult } from './output-normalizer/parser/parseArtifact';

// ── Artifact compiler ─────────────────────────────────────────────────────────
export { compileCarouselArtifact } from './artifact-compiler/compilers/carouselCompiler';
export type { OCLCompileResult } from './artifact-compiler/compilers/carouselCompiler';
export { compileDeckArtifact } from './artifact-compiler/compilers/deckCompiler';
export type { OCLDeckCompileResult } from './artifact-compiler/compilers/deckCompiler';
export { compileReportArtifact } from './artifact-compiler/compilers/reportCompiler';
export type { OCLReportCompileResult } from './artifact-compiler/compilers/reportCompiler';
export { compileNewsletterArtifact } from './artifact-compiler/compilers/newsletterCompiler';
export type { OCLNewsletterCompileResult } from './artifact-compiler/compilers/newsletterCompiler';
export { transformToCarouselSchema } from './artifact-compiler/transformers/transformToCarouselSchema';
export { transformToDeckSchema } from './artifact-compiler/transformers/transformToDeckSchema';
export { transformToReportSchema } from './artifact-compiler/transformers/transformToReportSchema';
export {
  detectRichness,
  adaptWeakOutput,
  richPassthrough,
  WEAK_RICHNESS_THRESHOLD,
} from './artifact-compiler/adapters/weakModelAdapter';
export type { RichnessSignal, WeakAdaptationResult } from './artifact-compiler/adapters/weakModelAdapter';
export { normalizeCarouselOutput, parseCarouselTextOutput } from './artifact-compiler/adapters/normalizeCarouselText';
export type { ParsedCarouselSlide, ParsedCarouselMeta, ParsedCarouselResult } from './artifact-compiler/adapters/normalizeCarouselText';

// ── Prompt compiler ───────────────────────────────────────────────────────────
export {
  compilePromptFromContract,
  // LEGACY RE-EXPORT: CAROUSEL_SCHEMA_INSTRUCTION is canonically owned by @brandos/contracts.
  // This re-export exists for backward compatibility with consumers that
  // import from @brandos/output-control-layer. New code must import from @brandos/contracts.
  CAROUSEL_SCHEMA_INSTRUCTION,
  ARTIFACT_TASK_PROMPTS,
} from './prompt-compiler/compilePromptFromContract';
export type { CompiledPrompt } from './prompt-compiler/compilePromptFromContract';

// ── Contract assembler ────────────────────────────────────────────────────────
export { ContractAssembler, getContractAssembler } from './contract-assembler/ContractAssembler';
// PREFERRED: use ContractAssemblerFactory.create() over getContractAssembler()
export { ContractAssemblerFactory } from './contract-assembler/ContractAssemblerFactory';
export { IdentityContributor } from './contract-assembler/contributors/IdentityContributor';
export { PersonaContributor }  from './contract-assembler/contributors/PersonaContributor';
export { IntentContributor }   from './contract-assembler/contributors/IntentContributor';
export { ArtifactContributor } from './contract-assembler/contributors/ArtifactContributor';
export { RuntimeContributor }  from './contract-assembler/contributors/RuntimeContributor';
export { SkillContributor }    from './contract-assembler/contributors/SkillContributor';

// ── Contracts re-exports ──────────────────────────────────────────────────────
export type {
  AIRuntimeOutput,
  NormalizedOutput,
  NormalizationTrace,
  CleaningStep,
  NormalizeOptions,
  DraftArtifactInput,
  DraftArtifactSlide,
  DraftArtifactMeta,
} from '@brandos/contracts';


