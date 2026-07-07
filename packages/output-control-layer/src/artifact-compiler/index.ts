// @brandos/output-control-layer — artifact-compiler/index.ts

// Compilers
export { compileCarouselArtifact } from './compilers/carouselCompiler';
export type { OCLCompileResult } from './compilers/carouselCompiler';
export { compileDeckArtifact } from './compilers/deckCompiler';
export type { OCLDeckCompileResult } from './compilers/deckCompiler';
export { compileReportArtifact } from './compilers/reportCompiler';
export type { OCLReportCompileResult } from './compilers/reportCompiler';
export { compileNewsletterArtifact } from './compilers/newsletterCompiler';
export type { OCLNewsletterCompileResult } from './compilers/newsletterCompiler';

// Transformers
export { transformToCarouselSchema } from './transformers/transformToCarouselSchema';
export type { CanonicalCarouselSchema, CanonicalCarouselSlide } from './transformers/transformToCarouselSchema';
export { transformToDeckSchema } from './transformers/transformToDeckSchema';
export type { CanonicalDeckSchema } from './transformers/transformToDeckSchema';
export { transformToReportSchema } from './transformers/transformToReportSchema';
export type { CanonicalReportSchema } from './transformers/transformToReportSchema';

// Adapters
export {
  detectRichness,
  adaptWeakOutput,
  richPassthrough,
  WEAK_RICHNESS_THRESHOLD,
} from './adapters/weakModelAdapter';
export type { RichnessSignal, WeakAdaptationResult } from './adapters/weakModelAdapter';

export {
  normalizeCarouselOutput,
  parseCarouselTextOutput,
} from './adapters/normalizeCarouselText';
export type {
  ParsedCarouselSlide,
  ParsedCarouselMeta,
  ParsedCarouselResult,
} from './adapters/normalizeCarouselText';

// Utils
export { inferRoleFromIndex } from './utils/inferRoleFromIndex';
export { normalizeRawSlideObject } from './utils/normalizeRawSlideObject';
export { coerceString } from './utils/coerce';


