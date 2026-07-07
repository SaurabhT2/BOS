/**
 * BrandOS Web — UI Components Barrel
 * Phase 7: RuntimeModeSelector replaces runtimeModeSelector.
 */

// Layout
export { default as WorkspaceShell } from './WorkspaceShell'
export { default as AdminShell } from './AdminShell'
export { AdminNav, AdminNavSidebar } from './AdminNav'

// Controls
export { default as RuntimeModeSelector } from './RuntimeModeSelector'
export { default as ModelSelector } from './ModelSelector'

// Renderers
export { default as CarouselRenderer } from '../renderers/CarouselRenderer'
export { default as DeckRenderer } from '../renderers/DeckRenderer'
export { default as ReportRenderer } from '../renderers/ReportRenderer'
export { RendererRegistry } from '../renderers/RendererRegistry'
export type { ArtifactRendererComponent } from '../renderers/RendererRegistry'
export { default as SkillShell } from '../shells/SkillShell'

// Feedback / Progress
export { GenerationProgressDisplay } from './GenerationProgressDisplay'
// VLMAnalysisPanel removed (GTM Critical Item 1, 2026-06-21): dead code, never
// mounted in apps/web, called a deleted /api/vlm-analyze route, and its result
// shape didn't match the real analyze contract. The working VLM analysis flow
// lives in the Library asset drawer (POST /api/assets/[id]/analyze), already
// correctly consumed by the Brand page's VisualIdentityTab. See
// brandos-delivery-status-audit.md §2.3 for prior (incorrect) status and the
// GTM sprint completion notes for the verified finding.

// ControlPlaneData is exported from src/index.ts via types/controlPlane — not re-exported here
// to avoid duplicate export paths. Import from '@brandos/presentation-layer' directly.


