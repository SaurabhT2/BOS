/**
 * @brandos/presentation-layer — IPackage.ts
 *
 * Machine-readable package boundary declaration.
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

export const PRESENTATION_LAYER_PACKAGE: IPackage = {
  name: '@brandos/presentation-layer',

  purpose:
    'UI orchestration and artifact rendering layer. Owns all React components that display ' +
    'BrandOS generation outputs and workspace UI.',

  responsibilities: [
    'CarouselRenderer — renders CarouselArtifact',
    'DeckRenderer — renders DeckArtifact (Wave 2)',
    'ReportRenderer — renders ReportArtifact (Wave 2)',
    'RendererRegistry — pluggable registry for artifact type → renderer dispatch',
    'WorkspaceShell / AdminShell — layout orchestration (render user email + logout button from injected auth context)',
    'ModelSelector / RuntimeModeSelector — mode selection UI',
    'GenerationProgressDisplay — streaming progress UI',
    'ControlPlanePanel — admin observability panel',
  ],

  publicContracts: [
    'src/index.ts',
    'src/renderers/RendererRegistry.ts',
    'src/hooks/useAvailableModes.ts',
  ],

  allowedImports: [
    '@brandos/contracts',
    '@brandos/auth',    // internal use only — WorkspaceShell/AdminShell use useAuth() for rendering
    'react',
    'react-dom',
    'lucide-react',
  ],

  forbiddenImports: [
    '@brandos/ai-runtime-layer',
    '@brandos/control-plane-layer',
    '@brandos/output-control-layer',
    '@brandos/governance-layer',
  ],

  ownedCapabilities: [
    'presentation.render.carousel',
    'presentation.render.deck',
    'presentation.render.report',
    'presentation.registry',
    'presentation.shell.workspace',
    'presentation.shell.admin',
    'presentation.mode.selector',
  ],

  invariants: [
    'No imports from @brandos/ai-runtime-layer',
    'No imports from @brandos/control-plane-layer',
    'Renderers are deterministic — display only what exists in the artifact',
    'All renderer components must be use client',
    'New artifact types registered via RendererRegistry.register(), not hardcoded switch',
    'No @brandos/auth symbols re-exported from src/index.ts — consumers import from @brandos/auth directly',
    '@brandos/auth may be imported internally by shell components (WorkspaceShell, AdminShell) that render auth state',
  ],

  dependencies: [
    '@brandos/contracts',
    '@brandos/auth',
    'react',
    'lucide-react',
  ],

  migrationHistory: [
    'Pre-Wave-2 (L3): DeckRenderer and ReportRenderer MISSING. No RendererRegistry. Illegal import from ai-runtime-layer.',
    'Wave 2 (L4): DeckRenderer and ReportRenderer added. RendererRegistry introduced. Owned capabilities declared.',
    'Cleanup Sprint 1: Supabase client re-exports (supabase, getSupabaseClient, getSupabaseAdmin) removed from PL public API.',
    'Cleanup Sprint 2 (WS1): All @brandos/auth re-exports removed from src/index.ts. PL is now a pure UI package. Consumers import from @brandos/auth directly.',
    'GTM Critical Sprint (2026-06-21): VLMAnalysisPanel removed — never mounted in apps/web, called deleted /api/vlm-analyze route, result shape did not match the real /api/assets/[id]/analyze contract. Working VLM analysis flow is the Library asset drawer; consolidated rather than duplicated.',
  ],
}


