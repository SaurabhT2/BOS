/**
 * @brandos/artifact-engine-layer — IPackage.ts
 *
 * Machine-readable package boundary declaration.
 * Used by repo-intelligence, multi-agent coordinators, and CI gates.
 *
 * L4: Multi-Agent Collaboration
 */

export interface IPackage {
  name: string
  purpose: string
  responsibilities: string[]
  publicContracts: string[]
  allowedImports: string[]
  forbiddenImports: string[]
  ownedCapabilities: string[]
  invariants: string[]
  dependencies: string[]
  migrationHistory: string[]
}

export const ARTIFACT_ENGINE_LAYER_PACKAGE: IPackage = {
  name: '@brandos/artifact-engine-layer',

  purpose:
    'Horizontal artifact orchestration runtime. Owns compile → govern → repair → export pipeline ' +
    'for all artifact types with zero artifact-type branching in the engine itself.',

  responsibilities: [
    'IArtifactEngine implementation (compile, govern, compileAndGovern, compileAndExport, export, remix)',
    'IArtifactRegistry — compiler, governance, exporter, renderer registries',
    'Carousel/Deck/Report OCL adapter wrappers (delegate to output-control-layer)',
    'Carousel/Deck/Report governance adapter wrappers (delegate to governance-layer)',
    'bootstrapArtifactEngine() — server startup registration including task prompt push',
    'assertCompiledArtifact() — OCL-first law enforcement at 3 checkpoints',
    'Task prompt registration (Wave 2): pushes ARTIFACT_TASK_PROMPTS to AIRuntimeAdapter at bootstrap',
  ],

  publicContracts: [
    'src/IArtifactEngineLayer.ts',
    'src/interfaces.ts',
    'src/index.ts',
  ],

  allowedImports: [
    '@brandos/contracts',
    '@brandos/output-control-layer',
    '@brandos/governance-layer',
    '@brandos/iskill-runtime',
    'uuid',
  ],

  forbiddenImports: [
    '@brandos/ai-runtime-layer',
    '@brandos/control-plane-layer',
    '@supabase/supabase-js',
    'next',
    'react',
  ],

  ownedCapabilities: [
    'artifact.compile',
    'artifact.govern',
    'artifact.export',
    'artifact.render',
    'artifact.taskprompt',
  ],

  invariants: [
    'LAW 1: assertCompiledArtifact() runs at POST-COMPILE, PRE-GOVERNANCE, POST-REPAIR-COMPILE',
    'LAW 2: Repair re-enters OCL — recompile callback passes through ICompiler',
    'LAW 3: No artifact-type branching in engine.ts or registry.ts',
    'LAW 4: engine.ts never imports or calls any LLM SDK',
    'LAW 5: MAX_REPAIR_ATTEMPTS = 2',
    'LAW 6: compileAndExport() runs governance between compile and export',
  ],

  dependencies: [
    '@brandos/contracts',
    '@brandos/output-control-layer',
    '@brandos/governance-layer',
    '@brandos/iskill-runtime',
    'uuid',
  ],

  migrationHistory: [
    'Pre-Wave-2 (L3): compileAndExport() skipped governance. ARTIFACT_TASK_PROMPTS owned by ai-runtime-layer.',
    'Wave 2 (L4): LAW 6 added — compileAndExport() now governs. Task prompt ownership transferred to bootstrap.ts.',
  ],
}


