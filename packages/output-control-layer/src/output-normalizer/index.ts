// @brandos/output-control-layer — output-normalizer/index.ts
export { normalizeOutput } from './normalizeOutput';
export { cleanOutput } from './pipeline/cleanOutput';
export type { CleanResult } from './pipeline/cleanOutput';
export { extractJSON } from './pipeline/extractJSON';
export { repairJSON, repairWithLLM } from './pipeline/repairJSON';
export { runTransformPipeline } from './pipeline/transformPipeline';
export { parseArtifact, parseArtifactJSON, validateArtifactFields } from './parser/parseArtifact';
export type { ParseArtifactResult } from './parser/parseArtifact';


