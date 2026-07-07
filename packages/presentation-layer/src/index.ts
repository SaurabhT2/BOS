/**
 * @brandos/presentation-layer — Public API
 *
 * Wave 2: DeckRenderer and ReportRenderer added. RendererRegistry exported.
 * Wave 3 (SPRINT2-CHANGE F-17): NewsletterRenderer declared as owned capability.
 * Owned capabilities: presentation.render.carousel, presentation.render.deck,
 *                     presentation.render.report, presentation.render.newsletter
 */

export { PLAuthProvider } from './auth/PLAuthContext'
export type { IPLAuthContext } from './auth/PLAuthContext'

export { default as RuntimeModeSelector } from './components/RuntimeModeSelector'
export { default as ModelSelector } from './components/ModelSelector'
export { default as WorkspaceShell } from './components/WorkspaceShell'
export { default as AdminShell } from './components/AdminShell'
export { AdminNav } from './components/AdminNav'
export { GenerationProgressDisplay } from './components/GenerationProgressDisplay'
export { RecoveryBanner } from './components/RecoveryBanner'
export type { RecoveryBannerProps } from './components/RecoveryBanner'
// VLMAnalysisPanel removed — see components/index.ts for rationale.

// ─── Renderers (Wave 2: Deck and Report added) ────────────────────────────────
export { default as CarouselRenderer } from './renderers/CarouselRenderer'
export { default as DeckRenderer }     from './renderers/DeckRenderer'
export { default as ReportRenderer }   from './renderers/ReportRenderer'
export { default as NewsletterRenderer } from './renderers/NewsletterRenderer'

// ─── Renderer Registry (Wave 2) ───────────────────────────────────────────────
// Consumers can register custom renderers or resolve the correct component
// for a given ArtifactV2 artifact_type at render time.
// SPRINT2-CHANGE (F-05): bootstrapRenderers() is now exported and implemented.
export { RendererRegistry, bootstrapRenderers } from './renderers/RendererRegistry'
export type { ArtifactRendererComponent } from './renderers/RendererRegistry'

export { default as SkillShell } from './shells/SkillShell'
export { useAvailableModes } from './hooks/useAvailableModes'
export type { ModeStatus, AvailabilityState } from './hooks/useAvailableModes'
export type { ControlPlaneData } from './types/controlPlane'

// Auth symbols were previously re-exported here as a convenience surface.
// Removed in Cleanup Sprint 2 (WS1): Presentation Layer must be a pure UI package.
// Auth ownership belongs in @brandos/auth. Consumers import directly:
//
//   import { AuthProvider, useAuth, authService } from '@brandos/auth'
//   import type { AuthUser, AuthSession, AuthState, UserPlan } from '@brandos/auth'
//
// WorkspaceShell and AdminShell components continue to call useAuth() internally
// (they are UI components that render auth state — this is pure presentation).
// They import @brandos/auth directly; they do not re-export it.

// Control Plane
export { default as ControlPlanePanel } from './components/ControlPlanePanel'


